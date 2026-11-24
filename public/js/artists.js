/* Stellar Music artists: a side page on the start screen. Pick an artist, scroll their whole catalogue, hear the
 * free 30-second Apple Music preview, and press Use to load it into the studio like a dropped song file.
 * The lists come from /api/catalog (private, needs the login). Preview audio is fetched with the login and played
 * from a local copy, and the copies are dropped when the page closes. */
(function(){
  "use strict";
  const pane = $("#artistsPane"), back = $("#artistsBack"), body = $("#arBody"), title = $("#arTitle"), prev = $("#arBack");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HUES = [222, 266, 330, 18, 160, 196];
  const hue = n => HUES[[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  let artists = null, listing = null;           // cached for the session
  const songsOf = new Map();                    // artist id -> {artist, songs}
  const blobs = new Map();                      // song id -> object URL of the preview
  const loading = new Map();                    // song id -> Promise of the Blob
  const blobData = new Map();                   // song id -> Blob
  let audio = null, playingId = "", openId = "", opener = null, token = 0, isOpen = false;

  const photo = (a, cls) => a.picture
    ? `<span class="ar-ph ${cls || ""}" style="--h:${hue(a.name)}"><b>${esc((a.name || "?").trim().charAt(0).toUpperCase())}</b><img src="${esc(a.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>`
    : `<span class="ar-ph ${cls || ""}" style="--h:${hue(a.name)}"><b>${esc((a.name || "?").trim().charAt(0).toUpperCase())}</b></span>`;
  const fail = (msg, retry) => `<div class="ar-state"><p>${esc(msg)}</p><button class="btn small primary" data-ar="retry" type="button">Try again</button></div>`;
  const skeleton = n => `<div class="ar-state ar-wait" role="status">Loading…</div>` + `<div class="ar-skel" aria-hidden="true">${"<i></i>".repeat(n)}</div>`;

  /* ---------- level 1: the artists ---------- */
  async function showArtists(){
    stopPreview(); openId = ""; const my = ++token;
    title.textContent = "Stellar Music artists"; prev.hidden = true;
    if(!artists){
      body.innerHTML = skeleton(6);
      try { artists = (await SLSBackend.api("/api/catalog")).artists || []; }
      catch(err){ if(my !== token) return; body.innerHTML = fail((err && err.message) || "Apple Music didn't answer. Try again.", true); return; }
      if(my !== token) return;
    }
    body.innerHTML = artists.length
      ? [["", "Stellar Music artists"], ["ai", "AI-assisted artists"]].map(([g, label]) => { const list = artists.filter(a => (a.group || "") === g); return list.length ? `<div class="ar-group">${label}</div><div class="ar-grid">${list.map(a => `<button class="ar-card" type="button" data-id="${esc(a.id)}">${photo(a, "big")}<span class="ar-name">${esc(a.name)}</span></button>`).join("")}</div>` : ""; }).join("")
      : `<div class="ar-state"><p>No artists yet.</p></div>`;
    const f = body.querySelector(".ar-card"); if(f && isOpen) f.focus({ preventScroll: true });
  }

  /* ---------- level 2: one artist's songs ---------- */
  async function showArtist(id){
    stopPreview(); openId = id; const my = ++token;
    const a0 = (artists || []).find(a => a.id === id) || { id, name: "", picture: "" };
    title.textContent = a0.name || "Artist"; prev.hidden = false;
    let d = songsOf.get(id);
    if(!d){
      body.innerHTML = skeleton(8);
      try { d = await SLSBackend.api("/api/catalog/" + encodeURIComponent(id)); songsOf.set(id, d); }
      catch(err){ if(my !== token) return; body.innerHTML = fail((err && err.message) || "Apple Music didn't answer. Try again.", true); return; }
      if(my !== token) return;
    }
    const a = d.artist || a0; title.textContent = a.name || "Artist"; listing = d.songs || [];
    body.innerHTML = `<div class="ar-top">
        <div class="ar-who">${photo(a, "mid")}<div><b>${esc(a.name)}</b><span>${listing.length} song${listing.length === 1 ? "" : "s"}</span></div></div>
        <input class="ar-search" id="arSearch" type="search" placeholder="Search songs" aria-label="Search songs" autocomplete="off" spellcheck="false">
        <p class="ar-note">30-second previews from Apple Music. For the whole song in full quality, drop the song file instead.</p>
      </div>
      <ul class="ar-songs" id="arSongs"></ul><p class="ar-none" id="arNone" hidden>No songs match that.</p>`;
    paintSongs(""); const s = $("#arSearch"); if(s) s.oninput = () => paintSongs(s.value);
  }
  function paintSongs(q){
    const ul = $("#arSongs"); if(!ul) return;
    const t = q.trim().toLowerCase();
    const rows = (listing || []).filter(s => !t || (s.title + " " + s.album).toLowerCase().includes(t));
    ul.innerHTML = rows.map(s => `<li class="ar-row" data-id="${esc(s.id)}" tabindex="-1">
        <img class="ar-cover" src="${esc(s.cover)}" alt="" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">
        <span class="ar-info"><b>${esc(s.title)}</b><span>${esc([s.album, s.year].filter(Boolean).join(" · "))}</span><em class="ar-err" hidden></em></span>
        <button class="icon-btn ar-play${s.id === playingId ? " on" : ""}" type="button" data-ar="play" aria-label="Play preview of ${esc(s.title)}">${s.id === playingId ? PAUSE : PLAY}</button>
        <button class="btn small" type="button" data-ar="use">Use</button></li>`).join("");
    const none = $("#arNone"); if(none) none.hidden = rows.length > 0;
  }
  const PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

  /* ---------- previews ---------- */
  const song = id => (listing || []).find(s => s.id === id);
  const rowOf = id => [...body.querySelectorAll(".ar-row")].find(r => r.dataset.id === id);
  function getBlob(s){
    if(blobData.has(s.id)) return Promise.resolve(blobData.get(s.id));
    if(!loading.has(s.id)){
      const p = SLSBackend.blob(s.preview).then(b => { blobData.set(s.id, b); loading.delete(s.id); return b; }, e => { loading.delete(s.id); throw e; });
      loading.set(s.id, p);
    }
    return loading.get(s.id);
  }
  function rowErr(id, msg){ const r = rowOf(id); if(!r) { toast(msg); return; } const e = r.querySelector(".ar-err"); e.textContent = msg; e.hidden = !msg; }
  function mark(id, state){          // state: "", "busy", "on"
    const r = rowOf(id); if(!r) return; const b = r.querySelector(".ar-play");
    b.classList.toggle("busy", state === "busy"); b.classList.toggle("on", state === "on"); b.disabled = false;
    b.innerHTML = state === "busy" ? '<span class="ar-spin" aria-hidden="true"></span>' : state === "on" ? PAUSE : PLAY;
    b.setAttribute("aria-label", (state === "on" ? "Pause preview of " : "Play preview of ") + ((song(id) || {}).title || "this song"));
  }
  function stopPreview(){
    const was = playingId; playingId = "";
    if(audio){ audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load(); }
    wanted = ""; if(was) mark(was, ""); api.playing = "";
  }
  let wanted = "";
  async function togglePlay(id){
    const s = song(id); if(!s) return;
    if(playingId === id){ stopPreview(); return; }
    stopPreview(); wanted = id; rowErr(id, ""); mark(id, "busy");
    let b; try { b = await getBlob(s); }
    catch(err){ if(wanted === id){ wanted = ""; mark(id, ""); } rowErr(id, (err && err.message) || "That preview didn't load. Try again."); return; }
    if(wanted !== id || !isOpen) return;                    // someone pressed something else meanwhile
    if(!blobs.has(id)) blobs.set(id, URL.createObjectURL(b));
    audio = audio || new Audio(); audio.src = blobs.get(id);
    try { await audio.play(); }
    catch { if(wanted === id){ wanted = ""; mark(id, ""); } rowErr(id, "This preview can't be played here."); return; }
    if(wanted !== id) return;
    playingId = id; api.playing = id; mark(id, "on");
    audio.onended = () => { if(playingId === id){ playingId = ""; api.playing = ""; mark(id, ""); } };
    audio.onerror = () => { stopPreview(); rowErr(id, "This preview can't be played here."); };
  }

  /* ---------- Use ---------- */
  let using = false;
  async function use(id){
    const s = song(id); if(!s || using) return; using = true;
    const r = rowOf(id), btn = r && r.querySelector('[data-ar="use"]');
    if(btn){ btn.disabled = true; btn.textContent = "Loading…"; } rowErr(id, "");
    try {
      const b = await getBlob(s);
      const file = new File([b], `${s.artist} - ${s.title} (preview).m4a`, { type: b.type || "audio/mp4" });
      close(); SLSApp.pick(file);
    } catch(err){ rowErr(id, (err && err.message) || "That preview didn't load. Try again."); if(btn){ btn.disabled = false; btn.textContent = "Use"; } }
    finally { using = false; }
  }

  /* ---------- open / close ---------- */
  function open(){
    if(isOpen) return; isOpen = true; opener = document.activeElement;
    back.hidden = false; pane.removeAttribute("inert"); pane.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => requestAnimationFrame(() => { pane.classList.add("open"); back.classList.add("open"); }));
    document.addEventListener("keydown", onKey, true);
    if(openId && (songsOf.get(openId) || artists)) showArtist(openId); else showArtists();
    setTimeout(() => { if(isOpen && !pane.contains(document.activeElement)) $("#arClose").focus({ preventScroll: true }); }, 60);
  }
  function close(){
    if(!isOpen) return; isOpen = false; stopPreview();
    pane.classList.remove("open"); back.classList.remove("open"); pane.setAttribute("aria-hidden", "true"); pane.setAttribute("inert", "");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => { if(!isOpen) back.hidden = true; }, 320);
    blobs.forEach(u => URL.revokeObjectURL(u)); blobs.clear(); blobData.clear();
    if(opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true }); opener = null;
  }
  function onKey(e){
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if(e.key !== "Tab") return;
    const f = [...pane.querySelectorAll("button:not([hidden]):not(:disabled),input,[tabindex='0']")].filter(x => x.offsetParent);
    if(!f.length) return; const a = f[0], z = f[f.length - 1];
    if(!pane.contains(document.activeElement)){ e.preventDefault(); a.focus(); }
    else if(e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); }
    else if(!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); }
  }

  pane.addEventListener("click", e => {
    const t = e.target.closest("button, .ar-row"); if(!t || !pane.contains(t)) return;
    if(t.id === "arClose") return close();
    if(t.id === "arBack") return showArtists();
    if(t.classList.contains("ar-card")) return showArtist(t.dataset.id);
    const k = t.dataset.ar;
    if(k === "retry") return openId ? showArtist(openId) : showArtists();
    const row = t.closest(".ar-row"); if(!row) return;
    if(k === "play") return togglePlay(row.dataset.id);
    use(row.dataset.id);                                    // the Use button or the row itself
  });
  back.addEventListener("click", close);
  $("#navArtists").onclick = e => { e.preventDefault(); open(); };
  $("#artistsBtn").onclick = e => { e.stopPropagation(); open(); };   // it sits inside the drop zone, which opens the file picker

  const api = { open, close, playing: "" };
  window.SLSArtists = api;
})();

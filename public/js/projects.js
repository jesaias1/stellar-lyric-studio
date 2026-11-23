"use strict";
/* Projects: everything you're working on, kept in this browser's own storage (IndexedDB) so a refresh or a
   closed tab doesn't lose anything. A project holds the song file, your clips (imported, stock and AI), the
   lyrics and timing, and every setting. It saves itself a moment after each change.
   Refreshing the page reopens the project you were in, at the step you were on. The start screen lists all
   projects. Storage is per browser and per computer; nothing is uploaded. Loaded after app.js. */
window.SLSProjects = (() => {
  const DB_NAME = "sls-projects";
  let dbp = null, cur = null, timer = null, saving = null, again = false, menuFor = null, confirmDel = null, opening = false;

  /* ---------- tiny IndexedDB helpers ---------- */
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("projects", { keyPath: "id" }); d.createObjectStore("blobs"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function run(store, mode, fn){ const t = (await db()).transaction(store, mode), out = await fn(t.objectStore(store)); await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("aborted")); }); return out; }
  const get = (store, key) => run(store, "readonly", s => req(s.get(key)));
  const put = (store, val, key) => run(store, "readwrite", s => req(key === undefined ? s.put(val) : s.put(val, key)));
  const del = (store, key) => run(store, "readwrite", s => req(s.delete(key)));
  const all = () => run("projects", "readonly", s => req(s.getAll()));
  const blobKeys = () => run("blobs", "readonly", s => req(s.getAllKeys()));

  const uid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isReal = () => S.audio && S.songName !== "Demo track";
  const quota = err => err && (err.name === "QuotaExceededError" || /quota/i.test(err.message || ""));
  const ago = t => { const s = (Date.now() - t) / 1000; if(s < 60) return "just now"; if(s < 3600) return Math.round(s / 60) + " min ago"; if(s < 86400) return Math.round(s / 3600) + " h ago"; if(s < 86400 * 7) return Math.round(s / 86400) + " days ago"; return new Date(t).toLocaleDateString(); };
  const STEP = { lyrics: "Lyrics", design: "Design" };

  /* ---------- saving ---------- */
  function thumb(){
    try { const k = 220 / Math.max(stage.width, stage.height), cv = document.createElement("canvas"); cv.width = Math.round(stage.width * k); cv.height = Math.round(stage.height * k);
      cv.getContext("2d").drawImage(stage, 0, 0, cv.width, cv.height); return cv.toDataURL("image/jpeg", 0.7); } catch { return ""; }
  }
  function schedule(ms = 900){ if(!cur || opening) return; clearTimeout(timer); timer = setTimeout(save, ms); }
  async function save(){
    if(!cur || opening || !isReal()) return;
    if(saving){ again = true; return saving; }
    saving = (async () => {
      try {
        const rec = (await get("projects", cur.id)) || { id: cur.id, createdAt: Date.now() };
        // clips: store each file once; forget files of clips that were removed
        const user = S.clips.filter(c => c.kind !== "gen");
        for(const c of user){ if(!c.bk && c.blob){ c.bk = `${cur.id}/clip/${uid()}`; await put("blobs", c.blob, c.bk); } }
        const keep = new Set(user.map(c => c.bk).filter(Boolean));
        for(const old of rec.clips || []) if(old.bk && !keep.has(old.bk)) await del("blobs", old.bk).catch(() => {});
        const P = JSON.parse(JSON.stringify(S.P));
        if(P.cuts && Array.isArray(P.cuts.slots)) P.cuts.slots = P.cuts.slots.map(sl => { const c = sl && S.clips.find(x => x.id === sl.c); return c && c.bk ? { ...sl, c: "bk:" + c.bk } : sl; });
        const step = SLSApp.step === "song" ? (rec.step || SLSApp.lastStep || "lyrics") : SLSApp.step;
        Object.assign(rec, { name: rec.name || S.songName, songName: S.songName, updatedAt: Date.now(), step, P, style: styleDef(S.P.style.preset).name, aspect: S.P.aspect,
          words: S.P.words.length, duration: S.audio ? +S.audio.duration.toFixed(1) : 0,
          clips: user.filter(c => c.bk).map(c => ({ bk: c.bk, name: c.name, kind: c.kind, credit: c.credit || null, src: c.src || null, on: c.on })),
          gens: Object.fromEntries(S.clips.filter(c => c.kind === "gen").map(c => [c.name, c.on])), thumb: thumb() || rec.thumb || "" });
        await put("projects", rec);
        cur.saved = Date.now(); paintStatus();
      } catch(err){ console.error("project save failed", err); if(quota(err)) toast("This browser is out of storage space, so the project couldn't be saved. Delete old projects on the start screen."); }
      finally { saving = null; if(again){ again = false; schedule(300); } }
    })();
    return saving;
  }

  /* ---------- create, open ---------- */
  async function create(file){
    if(!isReal()) return;
    const id = uid(); cur = { id };
    try {
      await put("blobs", file, `${id}/audio`);
      await put("projects", { id, name: S.songName, songName: S.songName, songFile: { name: file.name, size: file.size, type: file.type }, createdAt: Date.now(), updatedAt: Date.now(), step: "lyrics", clips: [], gens: {} });
      S.clips.forEach(c => { if(c.kind !== "gen") delete c.bk; });
      remember(id); persist(); await save();
    } catch(err){ console.error("project create failed", err); cur = null; toast(quota(err) ? "This browser is out of storage space, so this song can't be saved as a project." : "This project couldn't be saved in the browser."); }
  }
  async function findSong(file){
    try { return (await all()).filter(p => p.songFile && p.songFile.name === file.name && p.songFile.size === file.size).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null; } catch { return null; }
  }
  async function open(id, { quiet = false } = {}){
    const rec = await get("projects", id).catch(() => null); if(!rec){ forget(); return false; }
    const audio = await get("blobs", `${id}/audio`).catch(() => null);
    if(!audio){ toast(`The song file of "${rec.name}" is missing from this browser.`); return false; }
    if(cur && cur.id !== id) await save();
    opening = true; clearTimeout(timer);
    SLSApp.working(rec.name, "Opening your project");
    try {
      // clear the clips of whatever was open
      for(const c of S.clips.filter(c => c.kind !== "gen")){ if(c.url) URL.revokeObjectURL(c.url); }
      S.clips = S.clips.filter(c => c.kind === "gen");
      const f = rec.songFile || {};
      await loadSong(new File([audio], f.name || rec.songName + ".mp3", { type: f.type || audio.type || "audio/mpeg" }), { useDraft: false });
      const map = {};
      for(const rc of rec.clips || []){
        const blob = await get("blobs", rc.bk).catch(() => null); if(!blob) continue;
        const [nid] = await addFootage([blob], [{ name: rc.name, kind: rc.kind, credit: rc.credit, src: rc.src }], { quiet: true });
        const c = S.clips.find(x => x.id === nid); if(c){ c.bk = rc.bk; c.on = rc.on !== false; map["bk:" + rc.bk] = nid; }
      }
      S.clips.forEach(c => { if(c.kind === "gen" && rec.gens && c.name in rec.gens) c.on = !!rec.gens[c.name]; });
      const P = rec.P ? JSON.parse(JSON.stringify(rec.P)) : null;
      if(P){ if(P.cuts && Array.isArray(P.cuts.slots)) P.cuts.slots = P.cuts.slots.map(sl => sl && typeof sl.c === "string" && sl.c.startsWith("bk:") ? { ...sl, c: map[sl.c] || null } : sl); applyProject(P); }
      S.songName = rec.songName || S.songName; S.P.song = { name: S.songName, duration: S.audio.duration };
      HIST.undo = []; HIST.redo = []; HIST.last = JSON.stringify(S.P); syncUndoUI();
      cur = { id, saved: rec.updatedAt }; remember(id); SLSLyricsUI.forgetReview();
      renderClips(); syncUI(); updateMeta();
      opening = false;
      SLSApp.go(STEP[rec.step] ? rec.step : "lyrics");
      if(!quiet) toast(`"${rec.name}" is open.`);
      return true;
    } catch(err){ console.error("project open failed", err); opening = false; toast(`"${rec.name}" couldn't be opened.`); SLSApp.go("song"); return false; }
  }
  // which project this tab has open: a refresh reopens it. A new tab starts on the start screen.
  function remember(id){ try { sessionStorage.setItem("sls-open", id); localStorage.setItem("sls-last-project", id); } catch {} }
  function forget(){ try { sessionStorage.removeItem("sls-open"); } catch {} }
  function persist(){ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }

  /* ---------- manage ---------- */
  async function rename(id, name){ const r = await get("projects", id); if(!r) return; r.name = name; r.updatedAt = Date.now(); await put("projects", r); paint(); }
  async function duplicate(id){
    const r = await get("projects", id); if(!r) return; const nid = uid();
    try {
      await put("blobs", await get("blobs", `${id}/audio`), `${nid}/audio`);
      const clips = [];
      for(const c of r.clips || []){ const b = await get("blobs", c.bk); if(!b) continue; const bk = `${nid}/clip/${uid()}`; await put("blobs", b, bk); clips.push({ ...c, bk }); }
      const P = r.P ? JSON.parse(JSON.stringify(r.P)) : null;
      if(P && P.cuts && Array.isArray(P.cuts.slots)){ const m = Object.fromEntries((r.clips || []).map((c, i) => ["bk:" + c.bk, clips[i] ? "bk:" + clips[i].bk : null])); P.cuts.slots = P.cuts.slots.map(sl => sl && m[sl.c] ? { ...sl, c: m[sl.c] } : sl); }
      await put("projects", { ...r, id: nid, name: r.name + " copy", P, clips, createdAt: Date.now(), updatedAt: Date.now() });
      toast(`"${r.name} copy" made.`);
    } catch(err){ toast(quota(err) ? "Not enough storage space for a copy." : "The project couldn't be copied."); }
    paint();
  }
  async function remove(id){
    const keys = (await blobKeys()).filter(k => String(k).startsWith(id + "/"));
    for(const k of keys) await del("blobs", k).catch(() => {});
    await del("projects", id);
    if(cur && cur.id === id){ cur = null; forget(); }
    paint();
  }

  /* ---------- the list on the start screen ---------- */
  const box = document.createElement("section"); box.className = "projects"; box.id = "projects"; box.hidden = true;
  box.innerHTML = `<div class="pj-head"><h2>Your projects</h2><span class="hint" id="pjUse"></span></div><div class="pj-grid" id="pjGrid"></div>`;
  $(".how").before(box);
  let painting = false;
  async function paint(){
    if(painting) return; painting = true;
    try {
      const startVisible = !$("#home").hidden && !$("#start").hidden;
      const list = (await all().catch(() => [])).sort((a, b) => b.updatedAt - a.updatedAt);
      box.hidden = !startVisible || !list.length; if(box.hidden) return;
      $("#pjGrid").innerHTML = list.map(p => `
        <div class="pj-card${cur && cur.id === p.id ? " current" : ""}" data-id="${esc(p.id)}">
          <button class="pj-open" data-act="open" title="Open ${esc(p.name)}">
            <span class="pj-thumb ${p.aspect === "16:9" ? "wide" : ""}">${p.thumb ? `<img alt="" src="${p.thumb}">` : `<i>${esc((p.name || "?").slice(0, 1))}</i>`}</span>
            <span class="pj-info"><b>${esc(p.name)}</b><span>${p.songName && p.songName !== p.name ? esc(p.songName) + " · " : ""}${p.words ? p.words + " words · " : ""}${esc(p.style || "")}</span><span class="hint">${cur && cur.id === p.id ? "Open now · " : ""}Edited ${ago(p.updatedAt)}${STEP[p.step] ? " · " + STEP[p.step] : ""}</span></span>
          </button>
          <button class="pj-more" data-act="menu" aria-label="More for ${esc(p.name)}">⋯</button>
          ${menuFor === p.id ? `<div class="pj-menu"><button data-act="rename">Rename</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">${confirmDel === p.id ? "Click again to delete for good" : "Delete"}</button></div>` : ""}
        </div>`).join("");
      if(navigator.storage && navigator.storage.estimate){ const e = await navigator.storage.estimate().catch(() => null); if(e && e.usage) $("#pjUse").textContent = `${list.length} project${list.length === 1 ? "" : "s"} · ${(e.usage / 1048576).toFixed(0)} MB in this browser`; }
    } finally { painting = false; }
  }
  $("#pjGrid").onclick = async e => {
    const b = e.target.closest("[data-act]"), card = e.target.closest(".pj-card"); if(!b || !card) return; const id = card.dataset.id, act = b.dataset.act;
    if(act === "open"){ menuFor = null; if(cur && cur.id === id && isReal()){ SLSApp.go(SLSApp.lastStep || "lyrics"); return; } return open(id); }
    if(act === "menu"){ menuFor = menuFor === id ? null : id; confirmDel = null; return paint(); }
    if(act === "rename"){ const r = await get("projects", id), n = prompt("Project name", r ? r.name : ""); if(n && n.trim()) await rename(id, n.trim()); menuFor = null; return paint(); }
    if(act === "dup"){ menuFor = null; return duplicate(id); }
    if(act === "del"){ if(confirmDel !== id){ confirmDel = id; return paint(); } confirmDel = null; menuFor = null; await remove(id); toast("Project deleted"); }
  };

  /* ---------- the little "saved" note in the top bar ---------- */
  const status = document.createElement("span"); status.className = "pj-status"; status.id = "pjStatus"; $(".top .song").prepend(status);
  function paintStatus(){ status.textContent = cur && cur.saved ? "Saved" : ""; status.title = cur && cur.saved ? `Saved in this browser at ${new Date(cur.saved).toLocaleTimeString()}` : ""; status.classList.remove("pulse"); void status.offsetWidth; status.classList.add("pulse"); }

  /* ---------- hooks ---------- */
  const origSaveDraft = window.saveDraft;
  window.saveDraft = function(){ origSaveDraft.apply(this, arguments); schedule(); };   // every edit in the editor ends up here
  slsOn("change", () => schedule());
  slsOn("step", step => { if(step === "song") forget(); else if(cur) remember(cur.id); schedule(200); });
  document.addEventListener("visibilitychange", () => { if(document.hidden) save(); });
  addEventListener("pagehide", () => { save(); });

  // reopen what this tab had open before a refresh
  (async () => {
    let sid = null; try { sid = sessionStorage.getItem("sls-open"); } catch {}
    if(sid && await get("projects", sid).catch(() => null)) await open(sid, { quiet: true });
    else paint();
  })();

  return { create, open, findSong, save, paint, get current(){ return cur && cur.id; } };
})();

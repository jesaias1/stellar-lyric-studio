"use strict";
/* Photos for the video: the image grabber and moodboards. Loaded after footage.js, which makes the Photos tab.
   Search: keywords or a prompt (plus the lyrics) go to /api/photos/pick, which searches free photos and/or
   Pinterest and has an AI rank what it found. Moodboards: your own image collections, kept in this browser,
   filled from files or from a public Pinterest board. Either way you get as many images as the soundbite has
   lyric lines, a window to throw out the bad ones, and the rest goes into the footage pool as a slideshow. */
window.SLSPhotos = (() => {
  const api = window.SLSBackend, panel = $('[data-fxp="photos"]');
  const keep = { get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const errText = err => err && err.message ? err.message : "Something went wrong.";
  const fmtLen = s => s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)} s`;
  const IDEAS = ["golden hour beach", "summer in Italy", "rainy city nights", "flower fields", "neon Tokyo", "snowy village", "desert road trip", "pink sunset clouds"];

  panel.innerHTML = `
    <div class="seg" id="phFrom"><button data-v="search">Search</button><button data-v="boards">My moodboards</button></div>
    <div class="ph-box" id="phSearchBox">
      <label class="field"><span class="hint">What should the images look like? Keywords or a prompt.</span>
        <textarea id="phPrompt" rows="2" maxlength="300" placeholder="e.g. rainy city nights, neon, shot on film"></textarea></label>
      <div class="chips fx-ideas" id="phIdeas">${IDEAS.map(q => `<button type="button" data-q="${q}">${q}</button>`).join("")}</div>
      <div class="field"><span class="hint">Look</span><div class="seg ph-src" id="phLook"><button data-v="mix" title="Paintings, illustration and film-style photos">Mixed</button><button data-v="art" title="Paintings, drawings and illustration">Art</button><button data-v="photo" title="Film-style and real photos, no stock">Photos</button></div></div>
      <div class="field"><span class="hint">From</span><div class="seg ph-src" id="phSrc"><button data-v="free">Free photos</button><button data-v="pinterest">Pinterest</button><button data-v="both">Both</button></div></div>
      <div class="hint ph-note" id="phSrcNote"></div>
    </div>
    <div class="ph-box" id="phBoardBox" hidden>
      <div class="mb-list" id="mbList"></div>
      <button class="btn small" id="mbNew" type="button">+ New moodboard</button>
    </div>
    <div class="field ph-count">
      <span class="row" style="justify-content:space-between"><span class="hint">Number of images</span><span class="hint" id="phCountVal"></span></span>
      <input type="range" id="phCount" min="2" max="40" step="1" aria-label="Number of images">
      <span class="hint" id="phCountWhy"></span>
    </div>
    <button class="btn primary small" id="phGo" type="button">Find the best images</button>
    <div class="fx-msg hint" id="phMsg"></div>`;

  /* ---------- how many images ---------- */
  let manualCount = null;
  function autoCount(){
    const { a, b } = S.P.section, len = b - a;
    if(S.P.words.some(w => w.t >= a - 0.2 && w.t < b)){
      const was = S.P.cuts.mode; let n;
      S.P.cuts.mode = "lines"; try { n = segments().length; } finally { S.P.cuts.mode = was; }   // the same cuts the slideshow will get
      return { n: clamp(n, 2, 40), why: `One per lyric line in your ${fmtLen(len)} soundbite.` };
    }
    return { n: clamp(Math.round(len / 2.5), 2, 40), why: `One every 2 to 3 seconds of your ${fmtLen(len)} soundbite.` };
  }
  const count = () => manualCount ?? autoCount().n;
  function paintCount(){
    if(!S.P) return;
    const auto = autoCount(), n = count();
    $("#phCount").value = n;
    $("#phCountVal").innerHTML = manualCount == null ? `${n} · auto` : `${n} · <button class="linkish" id="phAuto" type="button">back to auto (${auto.n})</button>`;
    $("#phCountWhy").textContent = manualCount == null ? auto.why : "";
  }
  $("#phCount").oninput = e => { manualCount = +e.target.value; paintCount(); };
  $("#phCountVal").onclick = e => { if(e.target.id === "phAuto"){ manualCount = null; paintCount(); } };
  slsOn("change", () => { if(!panel.hidden) paintCount(); });

  /* ---------- where the images come from ---------- */
  let mode = keep.get("sls-ph-mode", "search"), from = keep.get("sls-ph-from", "free"), look = keep.get("sls-ph-look", "mix"), health = null, pinLeft = null;
  const msg = (t) => { $("#phMsg").textContent = t || ""; };
  async function getHealth(){ if(health) return health; try { health = await api.health(); } catch { health = {}; } return health; }
  function paintMode(){
    $$("#phFrom button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === mode)));
    $$("#phSrc button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === from)));
    $$("#phLook button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === look)));
    $("#phSearchBox").hidden = mode !== "search"; $("#phBoardBox").hidden = mode !== "boards";
    $("#phGo").textContent = mode === "boards" ? "Pick images from this moodboard" : "Find the best images";
    if(mode === "boards") paintBoards();
    getHealth().then(h => {
      const p = h.photos || {}, free = p.pexels || p.pixabay;
      const notes = [];
      if(from !== "free" && h.photos && !p.pinterest) notes.push("Pinterest search isn't switched on yet. It needs a SerpApi key (SERPAPI_KEY) in the site's settings.");
      else if(from !== "pinterest" && h.photos && !free) notes.push("Free photo search isn't switched on yet. It needs a free Pixabay or Pexels key in the site's settings.");
      if(from !== "free" && p.pinterest){
        notes.push(`Each search with Pinterest on uses 3 to 4 of the SerpApi account's monthly searches${pinLeft != null ? ` (${pinLeft} left this month)` : ""}. Looking through the results costs nothing extra, and nothing is downloaded until you add the images.`);
        notes.push("Pinterest images belong to the people who posted them. Fine for drafts and moods; for videos you publish, the free photos are the safe choice.");
      }
      $("#phSrcNote").textContent = notes.join(" ");
    });
    msg("");
  }
  $("#phFrom").onclick = e => { const b = e.target.closest("button"); if(!b) return; mode = b.dataset.v; keep.set("sls-ph-mode", mode); paintMode(); };
  $("#phLook").onclick = e => { const b = e.target.closest("button"); if(!b) return; look = b.dataset.v; keep.set("sls-ph-look", look); paintMode(); };
  $("#phSrc").onclick = e => { const b = e.target.closest("button"); if(!b) return; from = b.dataset.v; keep.set("sls-ph-from", from); paintMode(); };
  $("#phIdeas").onclick = e => { const b = e.target.closest("[data-q]"); if(!b) return; $("#phPrompt").value = b.dataset.q; $("#phPrompt").focus(); };
  $("#phPrompt").value = keep.get("sls-ph-prompt", "");
  $("#phPrompt").oninput = () => keep.set("sls-ph-prompt", $("#phPrompt").value);

  function sectionLyrics(){
    const { a, b } = S.P.section, groups = lineGroups(), inside = groups.filter(L => L[0].t >= a - 0.5 && L[0].t < b);
    return (inside.length ? inside : groups).map(L => L.map(w => w.w).join(" ")).join("\n");
  }

  /* ---------- search ---------- */
  let busy = false;
  $("#phGo").onclick = () => mode === "boards" ? fromBoard() : grab();
  $("#phPrompt").onkeydown = e => { if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); grab(); } };
  async function grab(){
    if(busy) return;
    const prompt = $("#phPrompt").value.trim(), lyrics = sectionLyrics();
    if(!prompt && !lyrics.trim()){ msg("Type a few keywords or a prompt first."); $("#phPrompt").focus(); return; }
    if(!(await SLSApp.ensurePass())) return;
    const n = count(), go = $("#phGo"); busy = true; go.disabled = true; go.textContent = "Finding images…";
    msg(`Searching ${from === "free" ? "free photos" : from === "pinterest" ? "Pinterest" : "free photos and Pinterest"} and picking the ${n} that fit your song best…`);
    try {
      const d = await api.api("/api/photos/pick", { method: "POST", body: { prompt, lyrics, count: n, aspect: aspectKey(), from, look, exclude: usedKeys() }, timeout: 120000 });
      if(d.pinLeft != null){ pinLeft = d.pinLeft; paintMode(); }
      if(!d.picks.length){ msg(d.message || "Nothing found. Try other keywords."); return; }
      const toItem = photoItem(prompt);
      msg(d.errors && d.errors.length ? d.errors.join(" · ") : "");
      review({ picks: d.picks.map(toItem), spare: d.spare.map(toItem), target: n, searched: d.queries, page: d.page || 1, next: d.next || {}, prompt, lyrics, from, look, skipped: d.skipped || 0 });
    } catch(err){ msg(errText(err)); }
    finally { busy = false; go.disabled = false; go.textContent = "Find the best images"; }
  }

  const photoItem = prompt => r => ({ id: r.id, thumb: r.thumb, file: r.file, source: r.source, name: (r.title || r.q || prompt || "Photo").split(/[,·]/)[0].trim().slice(0, 28) || "Photo",
    credit: `${r.author} on ${r.source}`, src: { kind: "photo", id: r.id, file: r.file, thumb: r.thumb, page: r.page, author: r.author, source: r.source, title: r.title || "" } });

  /* ---------- images already used ----------
     An image goes into one video once. Everything added from a search is remembered in this browser (and
     everything already in this project counts too), so later searches only bring new images. */
  const USED = "sls-used-images";
  function usedKeys(){
    const inProject = S.clips.flatMap(c => c.src && c.src.kind === "photo" ? [c.src.id, c.src.page] : []);
    return [...new Set([...keep.get(USED, []), ...inProject].filter(Boolean))].slice(-3500);
  }
  function markUsed(items){
    const list = keep.get(USED, []), have = new Set(list);
    for(const p of items) for(const k of [p.id, p.src && p.src.page]) if(k && !have.has(k)){ have.add(k); list.push(k); }
    keep.set(USED, list.slice(-3000));
  }

  /* ---------- the review window ---------- */
  const rv = document.createElement("div"); rv.className = "modal"; rv.id = "phModal"; rv.hidden = true;
  rv.innerHTML = `<div class="dialog ph-dialog" role="dialog" aria-modal="true" aria-labelledby="phTitle">
      <div class="ph-head"><h2 id="phTitle">Keep the good ones</h2><button class="btn small ghost" id="phX" type="button" aria-label="Close">✕</button></div>
      <div class="hint" id="phInfo"></div>
      <div class="ph-grid" id="phPicks"></div>
      <div class="ph-spare-h" id="phSpareH"><span class="label">More options</span><span class="hint">Tap one to add it</span></div>
      <div class="ph-grid ph-spare" id="phSpare"></div>
      <label class="ph-only"><input type="checkbox" id="phOnly" checked> Use only these images in the video <span class="hint">(your other clips are switched off, not deleted)</span></label>
      <div class="field" id="phRun" hidden><div class="bar"><i id="phBar"></i></div><div class="hint" id="phRunMsg"></div></div>
      <div class="row ph-actions"><button class="btn primary" id="phAdd" type="button">Add</button><button class="btn" id="phSwap" type="button">Replace the removed ones</button><button class="btn" id="phMore" type="button">Find more images</button><button class="btn ghost" id="phCancel" type="button">Cancel</button></div>
    </div>`;
  document.body.append(rv);
  let R = null;   // {picks, spare, target, searched, board}
  function review(r){ R = r; R.picks.forEach(p => p.out = false); $("#phOnly").checked = keep.get("sls-ph-only", true); $("#phRun").hidden = true; setBusy(false); rv.hidden = false; paintReview(); setTimeout(() => $("#phAdd").focus(), 30); }
  function tileHTML(p, i, n){
    return `<button class="ph-tile${p.out ? " out" : ""}" type="button" data-i="${i}" title="${esc(p.credit || p.name)}">
      <img alt="" loading="lazy" src="${esc(p.thumb)}">${n ? `<span class="ph-n">${n}</span>` : ""}<span class="fx-src">${esc(p.source || "")}</span>
      ${n !== undefined ? `<span class="ph-x" aria-hidden="true">${p.out ? "↺" : "✕"}</span>` : `<span class="ph-plus" aria-hidden="true">+</span>`}</button>`;
  }
  function paintReview(){
    let k = 0; const kept = R.picks.filter(p => !p.out).length, removed = R.picks.length - kept;
    $("#phPicks").innerHTML = R.picks.map((p, i) => tileHTML(p, i, p.out ? 0 : ++k)).join("");
    $("#phSpare").innerHTML = R.spare.map((p, i) => tileHTML(p, i)).join("");
    $("#phSpareH").hidden = !R.spare.length; $("#phSpare").hidden = !R.spare.length;
    const unit = S.P.words.length ? "lyric line" : "part of the soundbite";
    let info = `${kept} image${kept === 1 ? "" : "s"} for ${R.target} ${unit}${R.target === 1 ? "" : "s"}. Tap an image to throw it out, tap it again to bring it back.`;
    if(kept && kept < R.target) info += R.board ? ` That's fewer than ${R.target}, so each image stays up a little longer (none is shown twice).`
      : ` That's fewer than ${R.target}: tap Find more images, or each image stays up a little longer (none is shown twice).`;
    if(R.note) info += " " + R.note;
    if(R.searched && R.searched.length) info += ` Searched for ${R.searched.map(q => `“${q}”`).join(", ")}.`;
    $("#phInfo").textContent = info;
    $("#phAdd").textContent = kept ? `Add ${kept} image${kept === 1 ? "" : "s"}` : "Add";
    $("#phAdd").disabled = !kept;
    $("#phSwap").hidden = !(removed && R.spare.length);
    const more = $("#phMore"); more.hidden = !!R.board; more.classList.toggle("primary", !R.board && kept < R.target && !R.spare.length);
    $("#phAdd").classList.toggle("primary", !more.classList.contains("primary"));
  }
  // the same searches, further down the results, leaving out everything already used or on screen
  $("#phMore").onclick = async () => {
    if(!R || R.board || rv.classList.contains("busy")) return;
    const b = $("#phMore"), shown = [...R.picks, ...R.spare].flatMap(p => [p.id, p.src && p.src.page]).filter(Boolean);
    setBusy(true); b.textContent = "Finding more…";
    try {
      const d = await api.api("/api/photos/pick", { method: "POST", timeout: 120000, body: { prompt: R.prompt, lyrics: R.lyrics, from: R.from, aspect: aspectKey(),
        count: Math.max(6, R.target), queries: R.searched, page: R.page, next: R.next, look: R.look, exclude: [...usedKeys(), ...shown] } });
      if(!R) return;
      if(d.pinLeft != null) pinLeft = d.pinLeft;
      R.page = d.page || R.page + 1; R.next = d.next || {};
      const fresh = [...d.picks, ...d.spare].map(photoItem(R.prompt));
      if(!fresh.length){ R.note = "No new images left for these searches. Close this and try other keywords."; paintReview(); return; }
      // fill up to the number needed first, the rest go to the options
      let kept = R.picks.filter(p => !p.out).length;
      for(const p of fresh){ if(kept < R.target){ R.picks.push({ ...p, out: false }); kept++; } else R.spare.push(p); }
      R.note = `${fresh.length} new image${fresh.length === 1 ? "" : "s"} found.`;
      paintReview();
    } catch(err){ R.note = errText(err); paintReview(); }
    finally { setBusy(false); b.textContent = "Find more images"; }
  };
  $("#phPicks").onclick = e => { const t = e.target.closest(".ph-tile"); if(!t || rv.classList.contains("busy")) return; const p = R.picks[+t.dataset.i]; p.out = !p.out; paintReview(); };
  $("#phSpare").onclick = e => { const t = e.target.closest(".ph-tile"); if(!t || rv.classList.contains("busy")) return; const [p] = R.spare.splice(+t.dataset.i, 1); p.out = false; R.picks.push(p); paintReview(); };
  $("#phSwap").onclick = () => { R.picks = R.picks.map(p => p.out && R.spare.length ? { ...R.spare.shift(), out: false } : p); paintReview(); };
  const close = () => { if(rv.classList.contains("busy")) return; rv.hidden = true; R = null; };
  $("#phCancel").onclick = close; $("#phX").onclick = close;
  rv.addEventListener("click", e => { if(e.target === rv) close(); });
  addEventListener("keydown", e => { if(e.key === "Escape" && !rv.hidden) close(); });
  function setBusy(on){ rv.classList.toggle("busy", on); ["phAdd", "phSwap", "phMore", "phCancel"].forEach(id => $("#" + id).disabled = on); $("#phOnly").disabled = on; }

  async function inParallel(list, limit, fn){ let next = 0; await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => { while(next < list.length){ const i = next++; await fn(list[i], i); } })); }
  $("#phAdd").onclick = async () => {
    const chosen = R.picks.filter(p => !p.out); if(!chosen.length) return;
    const only = $("#phOnly").checked; keep.set("sls-ph-only", only);
    setBusy(true); $("#phRun").hidden = false; $("#phBar").style.width = "0"; let done = 0, failed = 0;
    $("#phRunMsg").textContent = `Getting the images (0 of ${chosen.length})…`;
    const blobs = new Array(chosen.length);
    await inParallel(chosen, 4, async (p, i) => {
      try { blobs[i] = p.k ? await boardBlob(p.k) : await api.blob(p.file); } catch(err){ failed++; console.warn("image unavailable", err); }
      done++; $("#phBar").style.width = (done / chosen.length * 100).toFixed(0) + "%"; $("#phRunMsg").textContent = `Getting the images (${done} of ${chosen.length})…`;
    });
    const files = [], metas = [];
    chosen.forEach((p, i) => { if(blobs[i]){ files.push(blobs[i]); metas.push({ name: p.name, kind: "img", credit: p.credit, src: p.src }); } });
    try {
      const ids = await addFootage(files, metas, { quiet: true });
      if(!ids.length){ $("#phRunMsg").textContent = "None of the images could be read. Try again or pick others."; setBusy(false); return; }
      if(!R.board) markUsed(chosen.filter((p, i) => blobs[i]));
      useAsSlideshow(ids, only);
      setBusy(false); rv.hidden = true; R = null;
      toast(`${ids.length} image${ids.length === 1 ? "" : "s"} added` + (S.P.words.length ? ": a new one on every lyric line." : ".") + (failed ? ` ${failed} couldn't be downloaded.` : ""));
    } catch(err){ $("#phRunMsg").textContent = errText(err); setBusy(false); }
  };
  /* the images become the video: in the order you kept them, one per lyric line (or spread evenly with no lyrics) */
  function useAsSlideshow(ids, only){
    if(only) S.clips.forEach(c => { c.on = ids.includes(c.id); });
    S.P.cuts.order = "inorder"; S.P.cuts.slots = null; S.P.cuts.points = null;
    const on = S.clips.filter(c => c.on).length;
    S.P.cuts.mode = "count"; S.P.cuts.count = on;
    // one image per lyric line, unless there are fewer images than lines: then each is shown once, for longer,
    // rather than the slideshow starting over and showing them twice
    if(S.P.words.some(w => w.t >= S.P.section.a - 0.2 && w.t < S.P.section.b)){ S.P.cuts.mode = "lines"; if(segments().length > on){ S.P.cuts.mode = "count"; S.P.cuts.count = on; } }
    renderClips(); syncUI(); dirty();
  }

  /* ---------- moodboards (IndexedDB, this browser only) ---------- */
  const DB = (() => {
    let opening = null;
    const open = () => opening || (opening = new Promise((res, rej) => { const r = indexedDB.open("sls-moodboards", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("boards", { keyPath: "id" }); d.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const run = async (store, rw, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, rw ? "readwrite" : "readonly"), q = fn(t.objectStore(store));
      t.oncomplete = () => res(q && "result" in q ? q.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("Storage full?")); }); };
    return { all: () => run("boards", false, s => s.getAll()), put: b => run("boards", true, s => s.put(b)), del: id => run("boards", true, s => s.delete(id)),
      blob: k => run("blobs", false, s => s.get(k)), putBlob: (k, b) => run("blobs", true, s => s.put(b, k)), delBlob: k => run("blobs", true, s => s.delete(k)) };
  })();
  const boardBlob = async k => { const b = await DB.blob(k); if(!b) throw new Error("missing"); return b; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let boards = [], selected = keep.get("sls-mb-sel", null);
  async function loadBoards(){ try { boards = (await DB.all()).sort((a, b) => b.at - a.at); } catch { boards = []; } }
  async function paintBoards(){
    await loadBoards();
    if(!boards.some(b => b.id === selected)) selected = boards[0] ? boards[0].id : null;
    $("#mbList").innerHTML = boards.length ? boards.map(b => `<div class="mb-card${b.id === selected ? " on" : ""}" data-id="${b.id}">
        <button class="mb-pick" type="button" aria-pressed="${b.id === selected}"><span class="mb-mosaic">${b.items.slice(0, 4).map(it => `<img alt="" src="${it.thumb}">`).join("") || "<i></i>"}</span>
        <span class="mb-name">${esc(b.name)}</span><span class="hint">${b.items.length} image${b.items.length === 1 ? "" : "s"}</span></button>
        <button class="btn small ghost mb-edit" type="button" data-edit="${b.id}">Edit</button></div>`).join("")
      : `<div class="hint">A moodboard is your own set of images: drop in photos from your computer or paste a public Pinterest board. The grabber then picks from it for each song.</div>`;
  }
  $("#mbList").onclick = e => {
    const ed = e.target.closest("[data-edit]"); if(ed){ editBoard(boards.find(b => b.id === ed.dataset.edit)); return; }
    const c = e.target.closest(".mb-card"); if(!c) return; selected = c.dataset.id; keep.set("sls-mb-sel", selected); paintBoards();
  };
  $("#mbNew").onclick = () => editBoard(null);

  async function fromBoard(){
    if(busy) return;
    const b = boards.find(x => x.id === selected);
    if(!b){ msg("Make a moodboard first: + New moodboard."); return; }
    if(!b.items.length){ msg("This moodboard is empty. Edit it to add images."); return; }
    const n = count(); let order = b.items.map(it => it.k), ranked = false;
    if(b.items.length > n && api.hasPass() && b.items.some(it => it.title)){
      busy = true; $("#phGo").disabled = true; msg("Picking the images that fit your song best…");
      try { const d = await api.api("/api/photos/rank", { method: "POST", body: { lyrics: sectionLyrics(), prompt: b.name, count: n, items: b.items.map(it => ({ id: it.k, text: it.title || it.name, shape: it.shape })) }, timeout: 60000 });
        if(d.ai && Array.isArray(d.order)){ order = d.order; ranked = true; } } catch {}
      finally { busy = false; $("#phGo").disabled = false; msg(""); }
    }
    if(!ranked && b.items.length > n){   // no titles to go by: an even spread over the whole board, the rest as options
      const step = b.items.length / n, first = Array.from({ length: n }, (_, i) => b.items[Math.floor(i * step)].k);
      order = [...first, ...order.filter(k => !first.includes(k))];
    }
    const byK = new Map(b.items.map(it => [it.k, it]));
    const toItem = it => ({ id: it.k, k: it.k, thumb: it.thumb, source: it.source || "", name: (it.title || it.name || b.name).slice(0, 28), credit: it.credit || null, src: { kind: "board", board: b.name, page: it.page || null, source: it.source || null } });
    const items = order.map(k => byK.get(k)).filter(Boolean).map(toItem);
    review({ picks: items.slice(0, n), spare: items.slice(n), target: n, board: b.name });
  }

  /* ---------- the moodboard editor ---------- */
  const ed = document.createElement("div"); ed.className = "modal"; ed.id = "mbModal"; ed.hidden = true;
  ed.innerHTML = `<div class="dialog ph-dialog" role="dialog" aria-modal="true" aria-labelledby="mbTitle">
      <div class="ph-head"><h2 id="mbTitle">Moodboard</h2><button class="btn small ghost" id="mbX" type="button" aria-label="Close">✕</button></div>
      <label class="field"><span class="hint">Name</span><input type="text" id="mbName" maxlength="60" placeholder="e.g. Summer nights"></label>
      <label class="mb-drop" id="mbDrop"><input type="file" id="mbFiles" accept="image/*" multiple hidden>
        <b>Drop images here</b><span class="hint">or <span class="drop-link">choose them from your computer</span></span></label>
      <form class="fx-search" id="mbPinForm" autocomplete="off"><input type="url" id="mbPin" placeholder="…or paste a public Pinterest board link" aria-label="Pinterest board link"><button class="btn small" type="submit">Import</button></form>
      <div class="mb-pin-app"><a class="btn small mb-open-pin" href="https://www.pinterest.com/" target="_blank" rel="noopener">Open Pinterest</a><button class="btn small" id="mbPaste" type="button">Paste board link</button>
        <span class="hint">In Pinterest, open the board, tap Share, then Copy link. Come back and tap Paste board link.</span></div>
      <div class="hint" id="mbMsg"></div>
      <div class="hint" id="mbOrderHint" hidden>Drag the images to put them in order. On a phone, press and hold an image first.</div>
      <div class="ph-grid mb-grid" id="mbGrid"></div>
      <div class="row ph-actions"><button class="btn primary" id="mbDone" type="button">Done</button><button class="btn ghost" id="mbDel" type="button">Delete moodboard</button></div>
    </div>`;
  document.body.append(ed);
  let B = null, edBusy = false;   // the board being edited
  const mbMsg = t => { $("#mbMsg").textContent = t || ""; };
  function editBoard(b){
    B = b ? { ...b, items: b.items.slice() } : { id: "mb" + uid(), name: "", at: Date.now(), items: [], fresh: true };
    $("#mbName").value = B.name; $("#mbPin").value = ""; mbMsg(""); $("#mbDel").hidden = !!B.fresh; ed.hidden = false; paintEditor();
    if(B.fresh) setTimeout(() => $("#mbName").focus(), 30);
  }
  function paintEditor(){
    $("#mbGrid").innerHTML = B.items.map(it => `<div class="ph-tile mb-tile" data-k="${esc(it.k)}"><img alt="" src="${it.thumb}" draggable="false"><button class="ph-x" type="button" data-rm="${esc(it.k)}" aria-label="Remove">✕</button></div>`).join("");
    $("#mbTitle").textContent = B.items.length ? `Moodboard · ${B.items.length} image${B.items.length === 1 ? "" : "s"}` : "Moodboard";
    $("#mbOrderHint").hidden = B.items.length < 2;
  }
  async function saveBoard(){ B.name = $("#mbName").value.trim() || B.name || "My moodboard"; const { fresh, ...rec } = B; rec.at = Date.now(); await DB.put(rec); B.fresh = false; selected = B.id; keep.set("sls-mb-sel", selected); $("#mbDel").hidden = false; }
  $("#mbGrid").onclick = async e => {
    const x = e.target.closest("[data-rm]"); if(!x || edBusy || mbDrag.justDropped) return;
    const i = B.items.findIndex(it => it.k === x.dataset.rm); if(i < 0) return;
    const [it] = B.items.splice(i, 1); paintEditor(); try { await DB.delBlob(it.k); await saveBoard(); } catch {}
  };
  /* drag the images into the order you want them: with the mouse straight away, on a phone press and hold first
     (so a normal swipe still scrolls). The order is saved with the moodboard and is the order the grabber uses. */
  const mbDrag = (() => {
    const grid = $("#mbGrid"), st = { justDropped: false };
    let d = null;   // the drag going on: { tile, ghost, id, x0, y0, dx, dy, live, timer, touch }
    const HOLD = 280, SLOP = 8;
    const clear = () => { if(!d) return; clearTimeout(d.timer); cancelAnimationFrame(d.raf); if(d.ghost) d.ghost.remove(); if(d.tile) d.tile.classList.remove("dragging"); grid.classList.remove("sorting"); d = null; };
    function lift(){
      const r = d.tile.getBoundingClientRect(), g = d.tile.cloneNode(true);
      g.classList.add("mb-ghost"); g.style.width = r.width + "px"; g.style.height = r.height + "px"; g.style.left = r.left + "px"; g.style.top = r.top + "px";
      document.body.append(g); d.ghost = g; d.dx = d.x0 - r.left; d.dy = d.y0 - r.top; d.live = true;
      d.tile.classList.add("dragging"); grid.classList.add("sorting");
      if(d.touch && navigator.vibrate) try { navigator.vibrate(12); } catch {}
    }
    function moveTo(x, y){
      d.x = x; d.y = y; d.ghost.style.transform = `translate(${x - d.dx - parseFloat(d.ghost.style.left)}px,${y - d.dy - parseFloat(d.ghost.style.top)}px) scale(1.06)`;
      const over = document.elementFromPoint(x, y), t = over && over.closest(".mb-tile");
      if(!t || t === d.tile || t.parentNode !== grid) return;
      const tiles = [...grid.children], from = tiles.indexOf(d.tile), to = tiles.indexOf(t);
      grid.insertBefore(d.tile, from < to ? t.nextSibling : t);
    }
    // near the top or bottom of the image grid while dragging: scroll it
    function edgeScroll(){
      if(!d || !d.live) return;
      const r = grid.getBoundingClientRect(), edge = Math.min(48, r.height / 4);
      const v = d.y < r.top + edge ? -(r.top + edge - d.y) : d.y > r.bottom - edge ? d.y - (r.bottom - edge) : 0;
      if(v){ grid.scrollTop += Math.max(-14, Math.min(14, v / 3)); moveTo(d.x, d.y); }
      d.raf = requestAnimationFrame(edgeScroll);
    }
    grid.addEventListener("pointerdown", e => {
      if(edBusy || d || e.button > 0 || e.target.closest("[data-rm]")) return;
      const tile = e.target.closest(".mb-tile"); if(!tile || B.items.length < 2) return;
      d = { tile, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false, touch: e.pointerType !== "mouse" };
      if(d.touch) d.timer = setTimeout(() => { if(d && !d.live){ lift(); moveTo(d.x, d.y); edgeScroll(); } }, HOLD);
    });
    addEventListener("pointermove", e => {
      if(!d || e.pointerId !== d.id) return;
      d.x = e.clientX; d.y = e.clientY;
      if(!d.live){
        if(Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < SLOP) return;
        if(d.touch){ clear(); return; }   // moved before the hold: it's a scroll
        lift(); edgeScroll();
      }
      e.preventDefault(); moveTo(e.clientX, e.clientY);
    }, { passive: false });
    // once a touch drag has started, stop the page from scrolling under the finger
    grid.addEventListener("touchmove", e => { if(d && d.live) e.preventDefault(); }, { passive: false });
    grid.addEventListener("contextmenu", e => { if(d) e.preventDefault(); });
    const drop = async e => {
      if(!d || e.pointerId !== d.id) return;
      const wasLive = d.live; clear(); if(!wasLive || !B || ed.hidden) return;   // the window was closed mid-drag (Escape)
      st.justDropped = true; setTimeout(() => { st.justDropped = false; }, 0);
      const byK = new Map(B.items.map(it => [it.k, it])), order = [...grid.children].map(t => byK.get(t.dataset.k)).filter(Boolean);
      if(order.length !== B.items.length || order.every((it, i) => it === B.items[i])) return;
      B.items = order; paintEditor();
      try { await saveBoard(); } catch(err){ mbMsg("Couldn't save the new order: " + errText(err)); }
    };
    addEventListener("pointerup", drop);
    addEventListener("pointercancel", e => { if(d && e.pointerId === d.id){ const live = d.live; clear(); if(live) paintEditor(); } });
    return st;
  })();
  const closeEd = async () => { if(edBusy) return; if(B && (!B.fresh || B.items.length)) { try { await saveBoard(); } catch {} } ed.hidden = true; B = null; if(mode === "boards") paintBoards(); };
  $("#mbDone").onclick = closeEd; $("#mbX").onclick = closeEd;
  ed.addEventListener("click", e => { if(e.target === ed) closeEd(); });
  addEventListener("keydown", e => { if(e.key === "Escape" && !ed.hidden) closeEd(); });
  $("#mbDel").onclick = async () => {
    if(edBusy || !confirmDelete()) return;
    for(const it of B.items) await DB.delBlob(it.k).catch(() => {});
    await DB.del(B.id).catch(() => {}); B = null; ed.hidden = true; paintBoards(); toast("Moodboard deleted");
  };
  function confirmDelete(){ const b = $("#mbDel"); if(b.dataset.sure){ return true; } b.dataset.sure = "1"; b.textContent = "Tap again to delete it and its images"; setTimeout(() => { delete b.dataset.sure; b.textContent = "Delete moodboard"; }, 3000); return false; }

  /* images in: kept as they are, so they stay sharp in the video. Only very big photos (over 4096 px, enough for a
     4K video with room to zoom) or very heavy files are scaled down, in halving steps so fine detail survives.
     A small thumbnail is kept for the lists. */
  const MB_MAX = 4096, MB_HEAVY = 15e6;
  async function addImage(blob, info = {}){
    const url = URL.createObjectURL(blob), img = new Image(); img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); return false; }
    const w = img.naturalWidth, h = img.naturalHeight, big = Math.max(w, h);
    let keepBlob = blob;
    if(big > MB_MAX || blob.size > MB_HEAVY){ const k = Math.min(1, MB_MAX / big), cv = stepDown(img, w, h, Math.round(w * k), Math.round(h * k));
      keepBlob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.95)) || blob; }
    const tc = document.createElement("canvas"); tc.width = 120; tc.height = 160; coverDraw(tc.getContext("2d"), img, 120, 160, w, h, 1, 0, 0);
    URL.revokeObjectURL(url);
    const it = { k: `${B.id}/${uid()}`, name: (info.name || "").replace(/\.[^.]+$/, "").slice(0, 40), title: info.title || "", thumb: tc.toDataURL("image/jpeg", 0.75),
      shape: h > w * 1.15 ? "portrait" : w > h * 1.15 ? "landscape" : "square", source: info.source || "", page: info.page || "", credit: info.credit || null };
    await DB.putBlob(it.k, keepBlob); B.items.push(it); return true;
  }
  async function addFiles(files){
    files = files.filter(f => /^image\//.test(f.type)); if(!files.length || edBusy) return;
    edBusy = true; let ok = 0;
    for(const [i, f] of files.entries()){ mbMsg(`Adding ${i + 1} of ${files.length}…`); try { if(await addImage(f, { name: f.name })) ok++; } catch(err){ mbMsg(errText(err)); } paintEditor(); }
    try { await saveBoard(); } catch(err){ mbMsg("Couldn't save the moodboard: " + errText(err)); edBusy = false; return; }
    edBusy = false; mbMsg(ok < files.length ? `${files.length - ok} file${files.length - ok === 1 ? "" : "s"} couldn't be read.` : "");
  }
  $("#mbFiles").onchange = e => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); };
  const drop = $("#mbDrop");
  ["dragenter", "dragover"].forEach(k => drop.addEventListener(k, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(k => drop.addEventListener(k, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => addFiles([...(e.dataTransfer && e.dataTransfer.files || [])]));
  const PIN_LINK = /https:\/\/(([a-z]{2,3}\.)?pinterest\.[a-z.]+|pin\.it)\/[^\s"'<>]+/i;
  // the board link from the clipboard (what Pinterest's Copy link puts there), imported straight away
  $("#mbPaste").onclick = async () => {
    let t = ""; try { t = await navigator.clipboard.readText(); } catch { mbMsg("The browser didn't allow reading the clipboard. Press and hold the link box and choose Paste."); $("#mbPin").focus(); return; }
    const m = PIN_LINK.exec(t || ""); if(!m){ mbMsg("There's no Pinterest link on the clipboard. In Pinterest, open the board, tap Share, then Copy link."); return; }
    $("#mbPin").value = m[0]; $("#mbPinForm").requestSubmit();
  };
  /* shared from the Pinterest app ("Share" to the installed studio on Android, see manifest share_target):
     a new moodboard opens and the board is imported */
  async function fromShare(){
    const q = new URLSearchParams(location.search); if(!q.has("share")) return;
    const m = PIN_LINK.exec([q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" "));
    history.replaceState(null, "", location.pathname + location.hash);
    if(!m){ toast("Only Pinterest board links can be shared to the studio."); return; }
    if(window.SLSAuth && SLSAuth.ready) await SLSAuth.ready;
    editBoard(null); $("#mbPin").value = m[0]; $("#mbPinForm").requestSubmit();
  }
  setTimeout(fromShare, 0);
  $("#mbPinForm").onsubmit = async e => {
    e.preventDefault(); const link = $("#mbPin").value.trim(); if(!link || edBusy) return;
    if(!(await SLSApp.ensurePass())) return;
    edBusy = true; mbMsg("Reading the board…");
    try {
      const d = await api.api("/api/moodboard/pinterest", { method: "POST", body: { url: link }, timeout: 30000 });
      if(!$("#mbName").value.trim()) $("#mbName").value = d.name;
      let ok = 0; const have = new Set(B.items.map(it => it.page).filter(Boolean));
      const fresh = d.images.filter(im => !im.page || !have.has(im.page));
      for(const [i, im] of fresh.entries()){
        mbMsg(`Importing ${i + 1} of ${fresh.length}…`);
        const info = { title: im.title, source: "Pinterest", page: im.page, credit: "Pinterest" };
        // the full-size picture first; if Pinterest doesn't have it (or it won't open), the smaller one
        let added = false;
        for(const f of [im.file, im.alt].filter(Boolean)){
          try { if(await addImage(await api.blob(f), info)){ added = true; break; } } catch(err){ console.warn("pin unavailable", err); }
        }
        if(added) ok++;
        paintEditor();
      }
      await saveBoard(); $("#mbPin").value = "";
      mbMsg(`${ok} image${ok === 1 ? "" : "s"} imported from the board.` + (fresh.length < d.images.length ? ` ${d.images.length - fresh.length} were already here.` : "") + (d.note ? " " + d.note : ""));
    } catch(err){ mbMsg(errText(err)); }
    finally { edBusy = false; }
  };

  /* ---------- start ---------- */
  const tabBtn = $('.fx-tabs [data-fx="photos"]');
  if(tabBtn) tabBtn.addEventListener("click", () => { paintCount(); paintMode(); });
  paintMode(); paintCount();
  return { review, count, paintCount };
})();

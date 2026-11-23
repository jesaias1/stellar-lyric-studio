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
  const IDEAS = ["rainy city nights", "golden hour beach", "90s film photos", "neon Tokyo", "foggy forest", "snowy cabin", "desert road trip", "pink sunset clouds"];

  panel.innerHTML = `
    <div class="seg" id="phFrom"><button data-v="search">Search</button><button data-v="boards">My moodboards</button></div>
    <div class="ph-box" id="phSearchBox">
      <label class="field"><span class="hint">What should the images look like? Keywords or a prompt.</span>
        <textarea id="phPrompt" rows="2" maxlength="300" placeholder="e.g. rainy city nights, neon, shot on film"></textarea></label>
      <div class="chips fx-ideas" id="phIdeas">${IDEAS.map(q => `<button type="button" data-q="${q}">${q}</button>`).join("")}</div>
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
  let mode = keep.get("sls-ph-mode", "search"), from = keep.get("sls-ph-from", "free"), health = null;
  const msg = (t) => { $("#phMsg").textContent = t || ""; };
  async function getHealth(){ if(health) return health; try { health = await api.health(); } catch { health = {}; } return health; }
  function paintMode(){
    $$("#phFrom button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === mode)));
    $$("#phSrc button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === from)));
    $("#phSearchBox").hidden = mode !== "search"; $("#phBoardBox").hidden = mode !== "boards";
    $("#phGo").textContent = mode === "boards" ? "Pick images from this moodboard" : "Find the best images";
    if(mode === "boards") paintBoards();
    getHealth().then(h => {
      const p = h.photos || {}, free = p.pexels || p.pixabay;
      const notes = [];
      if(from !== "free" && h.photos && !p.pinterest) notes.push("Pinterest search isn't switched on yet. It needs a SerpApi key (SERPAPI_KEY) in the site's settings.");
      else if(from !== "pinterest" && h.photos && !free) notes.push("Free photo search isn't switched on yet. It needs a free Pixabay or Pexels key in the site's settings.");
      if(from !== "free" && p.pinterest) notes.push("Pinterest images belong to the people who posted them. Fine for drafts and moods; for videos you publish, the free photos are the safe choice.");
      $("#phSrcNote").textContent = notes.join(" ");
    });
    msg("");
  }
  $("#phFrom").onclick = e => { const b = e.target.closest("button"); if(!b) return; mode = b.dataset.v; keep.set("sls-ph-mode", mode); paintMode(); };
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
      const d = await api.api("/api/photos/pick", { method: "POST", body: { prompt, lyrics, count: n, aspect: S.P.aspect, from }, timeout: 120000 });
      if(!d.picks.length){ msg(d.message || "Nothing found. Try other keywords."); return; }
      const toItem = r => ({ id: r.id, thumb: r.thumb, file: r.file, source: r.source, name: (r.title || r.q || prompt || "Photo").split(/[,·]/)[0].trim().slice(0, 28) || "Photo",
        credit: `${r.author} on ${r.source}`, src: { kind: "photo", file: r.file, thumb: r.thumb, page: r.page, author: r.author, source: r.source, title: r.title || "" } });
      msg(d.errors && d.errors.length ? d.errors.join(" · ") : "");
      review({ picks: d.picks.map(toItem), spare: d.spare.map(toItem), target: n, searched: d.queries });
    } catch(err){ msg(errText(err)); }
    finally { busy = false; go.disabled = false; go.textContent = "Find the best images"; }
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
      <div class="row ph-actions"><button class="btn primary" id="phAdd" type="button">Add</button><button class="btn" id="phSwap" type="button">Replace the removed ones</button><button class="btn ghost" id="phCancel" type="button">Cancel</button></div>
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
    if(kept && kept < R.target) info += ` With fewer images than ${unit}s, some will show twice.`;
    if(R.searched && R.searched.length) info += ` Searched for ${R.searched.map(q => `“${q}”`).join(", ")}.`;
    $("#phInfo").textContent = info;
    $("#phAdd").textContent = kept ? `Add ${kept} image${kept === 1 ? "" : "s"}` : "Add";
    $("#phAdd").disabled = !kept;
    $("#phSwap").hidden = !(removed && R.spare.length);
  }
  $("#phPicks").onclick = e => { const t = e.target.closest(".ph-tile"); if(!t || rv.classList.contains("busy")) return; const p = R.picks[+t.dataset.i]; p.out = !p.out; paintReview(); };
  $("#phSpare").onclick = e => { const t = e.target.closest(".ph-tile"); if(!t || rv.classList.contains("busy")) return; const [p] = R.spare.splice(+t.dataset.i, 1); p.out = false; R.picks.push(p); paintReview(); };
  $("#phSwap").onclick = () => { R.picks = R.picks.map(p => p.out && R.spare.length ? { ...R.spare.shift(), out: false } : p); paintReview(); };
  const close = () => { if(rv.classList.contains("busy")) return; rv.hidden = true; R = null; };
  $("#phCancel").onclick = close; $("#phX").onclick = close;
  rv.addEventListener("click", e => { if(e.target === rv) close(); });
  addEventListener("keydown", e => { if(e.key === "Escape" && !rv.hidden) close(); });
  function setBusy(on){ rv.classList.toggle("busy", on); ["phAdd", "phSwap", "phCancel"].forEach(id => $("#" + id).disabled = on); $("#phOnly").disabled = on; }

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
      useAsSlideshow(ids, only);
      setBusy(false); rv.hidden = true; R = null;
      toast(`${ids.length} image${ids.length === 1 ? "" : "s"} added` + (S.P.words.length ? ": a new one on every lyric line." : ".") + (failed ? ` ${failed} couldn't be downloaded.` : ""));
    } catch(err){ $("#phRunMsg").textContent = errText(err); setBusy(false); }
  };
  /* the images become the video: in the order you kept them, one per lyric line (or spread evenly with no lyrics) */
  function useAsSlideshow(ids, only){
    if(only) S.clips.forEach(c => { c.on = ids.includes(c.id); });
    S.P.cuts.order = "inorder"; S.P.cuts.slots = null; S.P.cuts.points = null;
    if(S.P.words.some(w => w.t >= S.P.section.a - 0.2 && w.t < S.P.section.b)) S.P.cuts.mode = "lines";
    else { S.P.cuts.mode = "count"; S.P.cuts.count = ids.length; }
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
      <div class="hint" id="mbMsg"></div>
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
    $("#mbGrid").innerHTML = B.items.map((it, i) => `<div class="ph-tile mb-tile"><img alt="" src="${it.thumb}"><button class="ph-x" type="button" data-rm="${i}" aria-label="Remove">✕</button></div>`).join("");
    $("#mbTitle").textContent = B.items.length ? `Moodboard · ${B.items.length} image${B.items.length === 1 ? "" : "s"}` : "Moodboard";
  }
  async function saveBoard(){ B.name = $("#mbName").value.trim() || B.name || "My moodboard"; const { fresh, ...rec } = B; rec.at = Date.now(); await DB.put(rec); B.fresh = false; selected = B.id; keep.set("sls-mb-sel", selected); $("#mbDel").hidden = false; }
  $("#mbGrid").onclick = async e => { const x = e.target.closest("[data-rm]"); if(!x || edBusy) return; const [it] = B.items.splice(+x.dataset.rm, 1); paintEditor(); try { await DB.delBlob(it.k); await saveBoard(); } catch {} };
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

  /* images in: big photos are scaled down to 2400 px (plenty for a 1080p video), a small thumbnail is kept for the lists */
  async function addImage(blob, info = {}){
    const url = URL.createObjectURL(blob), img = new Image(); img.src = url;
    try { await img.decode(); } catch { URL.revokeObjectURL(url); return false; }
    const w = img.naturalWidth, h = img.naturalHeight, big = Math.max(w, h);
    let keepBlob = blob;
    if(big > 2400 || blob.size > 3e6){ const k = Math.min(1, 2400 / big), cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); keepBlob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.9)) || blob; }
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
        try { const blob = await api.blob(im.file); if(await addImage(blob, { title: im.title, source: "Pinterest", page: im.page, credit: "Pinterest" })) ok++; } catch(err){ console.warn("pin unavailable", err); }
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

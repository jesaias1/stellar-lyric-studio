"use strict";
/* Projects: everything you're working on, kept in this browser's own storage (IndexedDB) so a refresh or a
   closed tab doesn't lose anything. A project holds the song file, your clips (imported, stock and AI), the
   lyrics and timing, and every setting. It saves itself a moment after each change.
   Each project belongs to the person logged in. The edit itself (lyrics, timing, style, cuts, texts) is also
   saved to their account, so it shows up on any computer they log in on; the song and footage stay on the
   computer they came from (opening the project elsewhere asks for the song, and refetches stock photos and
   videos). Refreshing the page reopens the project you were in, at the step you were on. Loaded after app.js. */
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
  // only this user's projects; ones made before logins existed go to whoever logs in first on this computer
  const me = () => { const u = window.SLSAuth && SLSAuth.user(); return (u && u.id) || "team"; };
  async function all(){
    if(!window.SLSAuth || !SLSAuth.signedIn()) return [];
    const list = await run("projects", "readonly", s => req(s.getAll()));
    for(const r of list) if(!r.owner){ r.owner = me(); await put("projects", r).catch(() => {}); }
    return list.filter(r => r.owner === me());
  }
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
          clips: user.filter(c => c.bk).map(c => ({ bk: c.bk, name: c.name, kind: c.kind, credit: c.credit || null, src: c.src || null, on: c.on, sound: !!c.sound })),
          gens: Object.fromEntries(S.clips.filter(c => c.kind === "gen").map(c => [c.name, c.on])), thumb: thumb() || rec.thumb || "" });
        rec.owner = rec.owner || me();
        await put("projects", rec);
        cur.saved = Date.now(); paintStatus(); cloud.push(rec);
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
      await put("projects", { id, owner: me(), name: S.songName, songName: S.songName, songFile: { name: file.name, size: file.size, type: file.type }, createdAt: Date.now(), updatedAt: Date.now(), step: "lyrics", clips: [], gens: {} });
      S.clips.forEach(c => { if(c.kind !== "gen") delete c.bk; });
      remember(id); persist(); await save();
    } catch(err){ console.error("project create failed", err); cur = null; toast(quota(err) ? "This browser is out of storage space, so this song can't be saved as a project." : "This project couldn't be saved in the browser."); }
  }
  async function findSong(file){
    try { return (await all()).filter(p => p.songFile && p.songFile.name === file.name && p.songFile.size === file.size).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null; } catch { return null; }
  }
  async function open(id, { quiet = false } = {}){
    const rec = await get("projects", id).catch(() => null); if(!rec || (rec.owner && rec.owner !== me())){ forget(); return false; }
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
        const c = S.clips.find(x => x.id === nid); if(c){ c.bk = rc.bk; c.on = rc.on !== false; c.sound = !!rc.sound; map["bk:" + rc.bk] = nid; }
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
      if(window.SLSTikTokSound) SLSTikTokSound.attach({ use: false }).then(() => SLSApp.paintBites());   // a TikTok sound a teammate matched since
      if(!quiet) toast(`"${rec.name}" is open.`);
      return true;
    } catch(err){ console.error("project open failed", err); opening = false; toast(`"${rec.name}" couldn't be opened.`); SLSApp.go("song"); return false; }
  }
  // which project this tab has open: a refresh reopens it. A new tab starts on the start screen.
  function remember(id){ try { sessionStorage.setItem("sls-open", id); localStorage.setItem("sls-last-project", id); } catch {} }
  function forget(){ try { sessionStorage.removeItem("sls-open"); } catch {} }
  function persist(){ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }

  /* ---------- manage ---------- */
  async function rename(id, name){ const r = await get("projects", id); if(r){ r.name = name; r.updatedAt = Date.now(); await put("projects", r); cloud.push(r); } else cloud.rename(id, name); paint(); }
  async function duplicate(id){
    const r = await get("projects", id); if(!r) return; const nid = uid();
    try {
      await put("blobs", await get("blobs", `${id}/audio`), `${nid}/audio`);
      const clips = [];
      for(const c of r.clips || []){ const b = await get("blobs", c.bk); if(!b) continue; const bk = `${nid}/clip/${uid()}`; await put("blobs", b, bk); clips.push({ ...c, bk }); }
      const P = r.P ? JSON.parse(JSON.stringify(r.P)) : null;
      if(P && P.cuts && Array.isArray(P.cuts.slots)){ const m = Object.fromEntries((r.clips || []).map((c, i) => ["bk:" + c.bk, clips[i] ? "bk:" + clips[i].bk : null])); P.cuts.slots = P.cuts.slots.map(sl => sl && m[sl.c] ? { ...sl, c: m[sl.c] } : sl); }
      const copy = { ...r, id: nid, owner: me(), name: r.name + " copy", P, clips, createdAt: Date.now(), updatedAt: Date.now() };
      await put("projects", copy); cloud.push(copy);
      toast(`"${r.name} copy" made.`);
    } catch(err){ toast(quota(err) ? "Not enough storage space for a copy." : "The project couldn't be copied."); }
    paint();
  }
  async function remove(id){
    const keys = (await blobKeys()).filter(k => String(k).startsWith(id + "/"));
    for(const k of keys) await del("blobs", k).catch(() => {});
    await del("projects", id); cloud.remove(id);
    if(cur && cur.id === id){ cur = null; forget(); }
    paint();
  }

  /* ---------- the copy in the user's account ---------- */
  const cloud = (() => {
    const on = () => window.SLSAuth && SLSAuth.mode === "accounts" && SLSAuth.signedIn();
    const q = new Map(); let timer = null, list = null, listAt = 0;
    const data = r => ({ v: 1, name: r.name, P: r.P || null, songName: r.songName, songFile: r.songFile || null, step: r.step, style: r.style, aspect: r.aspect, words: r.words, duration: r.duration,
      gens: r.gens || {}, thumb: r.thumb || "", createdAt: r.createdAt, updatedAt: r.updatedAt,
      clips: (r.clips || []).map(c => ({ bk: c.bk, name: c.name, kind: c.kind, credit: c.credit || null, src: c.src || null, on: c.on, sound: !!c.sound })) });
    function push(r){ if(!on() || !r || !r.P) return; q.set(r.id, r); clearTimeout(timer); timer = setTimeout(flush, 2500); }
    async function flush(){
      const recs = [...q.values()]; q.clear();
      for(const r of recs){
        try { await SLSAuth.rest("projects?on_conflict=user_id,local_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
            body: { local_id: r.id, name: String(r.name || "").slice(0, 200), data: data(r), updated_at: new Date(r.updatedAt || Date.now()).toISOString() } });
          if(list){ const i = list.findIndex(x => x.local_id === r.id), row = { local_id: r.id, name: r.name, updated_at: new Date(r.updatedAt).toISOString() }; i >= 0 ? (list[i] = { ...list[i], ...row }) : list.push(row); }
          if(cur && cur.id === r.id){ cur.cloud = Date.now(); paintStatus(); } }
        catch(err){ console.warn("project not saved to the account", err); if(cur && cur.id === r.id){ cur.cloudErr = true; paintStatus(); } }
      }
    }
    async function rows(force){
      if(!on()) return [];
      if(list && !force && Date.now() - listAt < 30000) return list;
      try { list = await SLSAuth.rest("projects?select=local_id,name,updated_at,songName:data->>songName,thumb:data->>thumb,step:data->>step,style:data->>style,aspect:data->>aspect,words:data->>words&order=updated_at.desc&limit=200") || []; listAt = Date.now(); }
      catch(err){ console.warn("couldn't list the account's projects", err); list = list || []; }
      return list;
    }
    async function full(id){ const r = await SLSAuth.rest("projects?select=data,name&local_id=eq." + encodeURIComponent(id) + "&limit=1"); return r && r[0] ? { ...r[0].data, name: r[0].name } : null; }
    function remove(id){ if(!on()) return; list = list && list.filter(x => x.local_id !== id); SLSAuth.rest("projects?local_id=eq." + encodeURIComponent(id), { method: "DELETE" }).catch(err => console.warn(err)); }
    function rename(id, name){ if(!on()) return; SLSAuth.rest("projects?local_id=eq." + encodeURIComponent(id), { method: "PATCH", body: { name, updated_at: new Date().toISOString() } }).then(() => rows(true)).then(() => paint()).catch(err => console.warn(err)); }
    addEventListener("pagehide", () => { if(q.size) flush(); });
    return { push, rows, full, remove, rename, on, flush };
  })();

  /* A project saved in the account but not in this browser: pick the song file, then it opens like any other.
     Stock photos and videos are fetched again; clips from the other computer have to be added again. */
  const songPick = document.createElement("input"); songPick.type = "file"; songPick.accept = "audio/*"; songPick.hidden = true; document.body.append(songPick);
  async function openFromCloud(id){
    let d; try { d = await cloud.full(id); } catch(err){ toast("That project couldn't be loaded from your account."); return; }
    if(!d){ toast("That project isn't in your account any more."); paint(); return; }
    const want = d.songFile && d.songFile.name ? `"${d.songFile.name}"` : `the song "${d.songName || d.name}"`;
    toast(`Pick ${want} from this computer to open the project.`);
    const file = await new Promise(res => { songPick.value = ""; songPick.onchange = () => res(songPick.files[0] || null); songPick.click(); });
    if(!file) return;
    SLSApp.working(d.name || "Project", "Getting your project");
    try {
      await put("blobs", file, `${id}/audio`);
      const clips = [], missing = [];
      for(const c of d.clips || []){
        const s2 = c.src; if(!(s2 && (s2.kind === "stock" || s2.kind === "photo") && s2.file)){ missing.push(c); continue; }
        try { const blob = await SLSBackend.blob(s2.file); await put("blobs", blob, c.bk); clips.push(c); } catch { missing.push(c); }
      }
      await put("projects", { id, owner: me(), name: d.name, songName: d.songName, songFile: { name: file.name, size: file.size, type: file.type }, createdAt: d.createdAt || Date.now(), updatedAt: d.updatedAt || Date.now(),
        step: d.step || "lyrics", P: d.P, style: d.style, aspect: d.aspect, words: d.words, duration: d.duration, gens: d.gens || {}, thumb: d.thumb || "", clips });
      const ok = await open(id, { quiet: true });
      if(ok) toast(`"${d.name}" is open.` + (missing.length ? ` ${missing.length} clip${missing.length === 1 ? " was" : "s were"} only on the other computer: add ${missing.length === 1 ? "it" : "them"} again in Clips.` : ""));
    } catch(err){ console.error(err); toast(quota(err) ? "This browser is out of storage space." : "That project couldn't be opened."); SLSApp.go("song"); }
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
      const local = (await all().catch(() => [])), ids = new Set(local.map(p => p.id)), rows = await cloud.rows();
      const inCloud = new Set(rows.map(r => r.local_id));
      const away = rows.filter(r => !ids.has(r.local_id)).map(r => ({ id: r.local_id, away: true, name: r.name, songName: r.songName, thumb: /^data:image\//.test(r.thumb || "") ? r.thumb : "", step: r.step, style: r.style, aspect: r.aspect, words: +r.words || 0, updatedAt: Date.parse(r.updated_at) || 0 }));
      const list = [...local, ...away].sort((a, b) => b.updatedAt - a.updatedAt);
      box.hidden = !startVisible || !list.length; if(box.hidden) return;
      $("#pjGrid").innerHTML = list.map(p => `
        <div class="pj-card${cur && cur.id === p.id ? " current" : ""}${p.away ? " away" : ""}" data-id="${esc(p.id)}"${p.away ? ' data-away="1"' : ""}>
          <button class="pj-open" data-act="open" title="Open ${esc(p.name)}">
            <span class="pj-thumb ${p.aspect && isWide(p.aspect) ? "wide" : ""}">${p.thumb ? `<img alt="" src="${esc(p.thumb)}">` : `<i>${esc((p.name || "?").slice(0, 1))}</i>`}</span>
            <span class="pj-info"><b>${esc(p.name)}</b><span>${p.songName && p.songName !== p.name ? esc(p.songName) + " · " : ""}${p.words ? p.words + " words · " : ""}${esc(p.style || "")}</span><span class="hint">${p.away ? "In your account · add the song to open it" : (cur && cur.id === p.id ? "Open now · " : "") + "Edited " + ago(p.updatedAt) + (STEP[p.step] ? " · " + STEP[p.step] : "") + (inCloud.has(p.id) ? " · saved to your account" : "")}</span></span>
          </button>
          <button class="pj-more" data-act="menu" aria-label="More for ${esc(p.name)}">⋯</button>
          ${menuFor === p.id ? `<div class="pj-menu"><button data-act="rename">Rename</button>${p.away ? "" : '<button data-act="dup">Duplicate</button>'}<button data-act="del" class="danger">${confirmDel === p.id ? "Click again to delete for good" : "Delete"}</button></div>` : ""}
        </div>`).join("");
      if(navigator.storage && navigator.storage.estimate){ const e = await navigator.storage.estimate().catch(() => null); if(e && e.usage) $("#pjUse").textContent = `${list.length} project${list.length === 1 ? "" : "s"} · ${(e.usage / 1048576).toFixed(0)} MB of songs and footage in this browser`; }
    } finally { painting = false; }
  }
  $("#pjGrid").onclick = async e => {
    const b = e.target.closest("[data-act]"), card = e.target.closest(".pj-card"); if(!b || !card) return; const id = card.dataset.id, act = b.dataset.act;
    if(act === "open"){ menuFor = null; if(card.dataset.away) return openFromCloud(id); if(cur && cur.id === id && isReal()){ SLSApp.go(SLSApp.lastStep || "lyrics"); return; } return open(id); }
    if(act === "menu"){ menuFor = menuFor === id ? null : id; confirmDel = null; return paint(); }
    if(act === "rename"){ const r = await get("projects", id), n = prompt("Project name", r ? r.name : (card.querySelector("b") || {}).textContent || ""); if(n && n.trim()) await rename(id, n.trim()); menuFor = null; return paint(); }
    if(act === "dup"){ menuFor = null; return duplicate(id); }
    if(act === "del"){ if(confirmDel !== id){ confirmDel = id; return paint(); } confirmDel = null; menuFor = null; if(card.dataset.away){ cloud.remove(id); paint(); toast("Project deleted from your account"); return; } await remove(id); toast("Project deleted"); }
  };

  /* ---------- the little "saved" note in the top bar ---------- */
  const status = document.createElement("span"); status.className = "pj-status"; status.id = "pjStatus"; $(".top .song").prepend(status);
  function paintStatus(){ status.textContent = cur && cur.saved ? "Saved" : ""; status.title = cur && cur.saved ? `Saved in this browser at ${new Date(cur.saved).toLocaleTimeString()}` + (cur.cloud ? ", and the edit to your account" : cur.cloudErr ? ". Not saved to your account yet (offline?)" : "") : ""; status.classList.remove("pulse"); void status.offsetWidth; status.classList.add("pulse"); }

  /* ---------- hooks ---------- */
  const origSaveDraft = window.saveDraft;
  window.saveDraft = function(){ origSaveDraft.apply(this, arguments); schedule(); };   // every edit in the editor ends up here
  slsOn("change", () => schedule());
  slsOn("step", step => { if(step === "song") forget(); else if(cur) remember(cur.id); schedule(200); });
  document.addEventListener("visibilitychange", () => { if(document.hidden) save(); });
  addEventListener("pagehide", () => { save(); });

  // reopen what this tab had open before a refresh (once someone is logged in: projects belong to them)
  (async () => {
    await window.SLSAuth.ready;
    SLSAuth.onChange(() => paint());
    let sid = null; try { sid = sessionStorage.getItem("sls-open"); } catch {}
    if(sid && await get("projects", sid).catch(() => null)) await open(sid, { quiet: true });
    else paint();
  })();

  // the names of the projects in this browser, newest first (for suggestions, e.g. in the content plan)
  async function names(){ try { return (await all()).filter(p => !p.owner || p.owner === me()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(p => p.name).filter(Boolean); } catch { return []; } }
  return { create, open, findSong, save, paint, names, get current(){ return cur && cur.id; } };
})();

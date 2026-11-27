"use strict";
/* Templates, rebuilt. A template is a reusable look you apply to any song: you choose which parts it carries
   (lyric style, text and title, cuts and transitions, format, footage, and optionally the lyrics and timing of
   this song). Applying one only changes those parts, so your new song keeps its own lyrics.
   Starter looks come built in. Saved templates live in this browser, or are shared with the team when the
   backend has template storage. Takes over the Templates tab from studio.js and reuses its storage code
   (templates, DB, localMode, initTemplates). */
window.SLSTemplates = (() => {
  const PARTS = [
    { id: "look", name: "Lyric style", desc: "style, fonts, colours, size, position, darkening" },
    { id: "text", name: "Title and text boxes", desc: "the hook title and any extra text" },
    { id: "cuts", name: "Cuts and transitions", desc: "when the footage changes and how" },
    { id: "format", name: "Format", desc: "frame shape and soundbite length" },
    { id: "footage", name: "Footage", desc: "stock clips, built-in visuals and AI scenes" },
    { id: "lyrics", name: "Lyrics and timing", desc: "this song's words, timing and soundbite. Only useful for this song", off: true },
  ];
  const STARTERS = [
    { id: "s-neon", name: "Neon Nights", desc: "Glowing tubes over dark city footage", style: { preset: "neon", color: "#ffffff", scrim: 0.35, his: { neon: "#ff3df2" } }, cuts: { mode: "lines", transition: "blur", xf: 0.4 }, gens: ["Midnight", "Violet"], bg: ["#06131f", "#3b1d73"] },
    { id: "s-xmas", name: "Christmas Glow", desc: "Soft serif with sparkles, warm crossfades", style: { preset: "starlight", color: "#fff7ea", scrim: 0.3, his: { starlight: "#ffe2a8" } }, cuts: { mode: "lines", transition: "crossfade", xf: 0.7 }, gens: ["Crimson", "Midnight"], bg: ["#2b1b4d", "#7a3b2e"] },
    { id: "s-ballad", name: "Cinematic Ballad", desc: "Letterboxed, wide-spaced lines, slow fades", style: { preset: "cinema", color: "#ffffff", scrim: 0.2 }, cuts: { mode: "lines", transition: "crossfade", xf: 0.8, order: "inorder" }, gens: ["Graphite", "Forest"], bg: ["#111", "#3a3a3a"] },
    { id: "s-rap", name: "Rap Impact", desc: "Huge 3D words, flash cuts on the beat", style: { preset: "impact", color: "#ffffff", scrim: 0.4, his: { impact: "#ffd23f" } }, cuts: { mode: "beat", every: 2, transition: "flash", xf: 0.2 }, gens: ["Royal", "Deep blue"], bg: ["#0d0a2b", "#5a3cff"] },
    { id: "s-pop", name: "Pop Bounce", desc: "Bouncy words, zoom transitions", style: { preset: "bounce", color: "#ffffff", scrim: 0.25, his: { bounce: "#ffd23f" } }, cuts: { mode: "beat", every: 4, transition: "zoom", xf: 0.35 }, gens: ["Sunset", "Crimson"], bg: ["#3a0f2b", "#c2386b"] },
    { id: "s-diary", name: "Diary", desc: "Handwritten lines, gentle slides", style: { preset: "diary", color: "#ffffff", scrim: 0.18, his: { diary: "#ff6b8a" } }, cuts: { mode: "lines", transition: "slide", xf: 0.5, order: "inorder" }, gens: ["Graphite", "Forest"], bg: ["#1c1a17", "#8a7d63"] },
    { id: "s-glitch", name: "Glitch Club", desc: "RGB glitch words, spin cuts every beat", style: { preset: "glitch", color: "#ffffff", scrim: 0.35 }, cuts: { mode: "beat", every: 1, transition: "spin", xf: 0.25 }, gens: ["Royal", "Deep blue"], bg: ["#000", "#5a3cff"] },
    { id: "s-karaoke", name: "Clean Karaoke", desc: "Classic sing-along fill, push cuts", style: { preset: "karaoke", color: "#ffffff", scrim: 0.3, his: { karaoke: "#ffe14a" } }, cuts: { mode: "lines", transition: "push", xf: 0.4 }, gens: ["Royal", "Violet"], bg: ["#062421", "#139a87"] },
  ];
  const pane = $("#tplPane");
  pane.innerHTML = `
    <div class="tp-head"><span class="label">Complete looks</span><button class="btn small" id="tpNew">+ Save current look</button></div>
    <div class="hint">A complete look also carries the cuts, transitions, format and footage, not just the lyric template.</div>
    <form class="tp-form card" id="tpForm" hidden>
      <label class="field"><span class="hint">Name</span><input type="text" id="tpName" placeholder="e.g. Ingrid · Christmas look" maxlength="80"></label>
      <div class="field"><span class="hint">What it should carry</span><div class="tp-parts" id="tpParts">${PARTS.map(p => `<label class="tp-part"><input type="checkbox" value="${p.id}" ${p.off ? "" : "checked"}><span><b>${p.name}</b><i>${p.desc}</i></span></label>`).join("")}</div></div>
      <div class="row"><button class="btn primary small" id="tpSave">Save template</button><button type="button" class="btn ghost small" id="tpCancel">Cancel</button></div>
    </form>
    <div class="label">Starter looks</div>
    <div class="tp-grid" id="tpStarters"></div>
    <div class="label">Your templates</div>
    <div class="tp-grid" id="tplList"></div>
    <div class="hint" id="tplWhere">Saved in this browser. Use "Save as file" to keep a copy or share one with someone.</div>
    <div class="row"><button class="btn small ghost" id="tplDownload">Save all as file</button><label class="btn small ghost file">Open file<input id="tplOpen" type="file" accept=".json,application/json"></label></div>
    <div class="label">Song templates</div>
    <div class="tlist" id="builtinList"></div>
    <div class="hint">A song template is made for one specific song. Load that song and it lines up automatically.</div>`;

  const partNames = parts => PARTS.filter(p => parts && parts[p.id]).map(p => p.name);
  const clone = o => JSON.parse(JSON.stringify(o ?? null));

  /* ---------- capture what's on screen ---------- */
  function preview(){
    try { const cv = document.createElement("canvas"), k = 200 / Math.max(stage.width, stage.height); cv.width = Math.round(stage.width * k); cv.height = Math.round(stage.height * k);
      renderFrame(S.t); cv.getContext("2d").drawImage(stage, 0, 0, cv.width, cv.height); return cv.toDataURL("image/jpeg", 0.72); } catch { return ""; }
  }
  function capture(parts){
    const P = S.P, data = {};
    if(parts.look) data.look = clone(P.style);
    if(parts.text) data.text = { hook: clone(P.hook), texts: clone(P.texts || []), tTracks: clone(P.tTracks || [{}]) };
    if(parts.cuts){ const { mode, every, count, transition, xf, order, seed } = P.cuts; data.cuts = { mode: mode === "manual" ? "lines" : mode, every, count, transition, xf, order, seed }; }
    if(parts.format) data.format = { aspect: P.aspect, length: +(P.section.b - P.section.a).toFixed(2) };
    if(parts.footage) data.footage = {
      gens: S.clips.filter(c => c.kind === "gen" && c.on).map(c => c.name),
      stock: S.clips.filter(c => c.src && (c.src.kind === "stock" || c.src.kind === "photo") && c.on).map(c => ({ name: c.name, credit: c.credit, ...c.src })),
      scenes: S.clips.filter(c => c.src && c.src.kind === "ai").map(c => c.src.prompt).filter(Boolean),
      own: S.clips.filter(c => c.kind !== "gen" && (!c.src || c.src.kind === "board") && c.on).length };
    if(parts.lyrics){ const { lyrics, words, section, bpm, offset, markers, srcLyrics, lang, song } = P; data.lyrics = clone({ lyrics, words, section, bpm, offset, markers, srcLyrics, lang, song, points: P.cuts.points || null, slots: P.cuts.slots || null }); }
    return data;
  }

  /* ---------- apply ---------- */
  async function apply(tpl){
    const d = tpl.data || legacyData(tpl), P = S.P, done = [];
    pause();
    if(d.look){ const st = clone(d.look); P.style = { ...P.style, ...st, fonts: { ...P.style.fonts, ...(st.fonts || {}) }, his: { ...P.style.his, ...(st.his || {}) }, vars: { ...P.style.vars, ...(st.vars || {}) } };
      if(!PRESETS.some(p => p.id === P.style.preset)) P.style.preset = "stack"; done.push("style"); }
    if(d.text){ P.hook = { ...P.hook, ...clone(d.text.hook) }; P.texts = clone(d.text.texts) || []; P.tTracks = clone(d.text.tTracks) || [{}]; done.push("text"); }
    if(d.cuts){ P.cuts = { ...P.cuts, ...clone(d.cuts), points: null, slots: null }; done.push("cuts"); }
    if(d.format){ if(aspectOK(d.format.aspect)) P.aspect = d.format.aspect; if(d.format.length && S.audio){ const len = Math.min(d.format.length, S.audio.duration), a = clamp(P.section.a, 0, S.audio.duration - len); P.section = { a, b: +(a + len).toFixed(2) }; } done.push("format"); }
    if(d.lyrics){ const L = clone(d.lyrics); Object.assign(P, { lyrics: L.lyrics, words: L.words || [], bpm: L.bpm ?? P.bpm, offset: L.offset ?? P.offset, markers: L.markers || [], srcLyrics: L.srcLyrics, lang: L.lang });
      if(L.section) P.section = L.section; if(L.points) P.cuts.points = L.points; if(L.slots) P.cuts.slots = L.slots; if(L.points) P.cuts.mode = "manual"; done.push("lyrics");
      if(S.audio && L.song && L.song.name && L.song.name !== S.songName) toast(`These lyrics were timed on "${L.song.name}". Load that song for the timing to match.`); }
    sortWords(); syncUI(); renderPresetGrid(); dirty(); SLSLyricsUI.schedule && SLSLyricsUI.schedule();
    if(d.footage) await applyFootage(d.footage);
    toast(`"${tpl.name}" applied` + (done.length ? `: ${done.join(", ")}` : "") + ".");
  }
  async function applyFootage(f){
    const user = S.clips.some(c => c.kind !== "gen" && c.on);
    if(f.gens && f.gens.length && !user) S.clips.forEach(c => { if(c.kind === "gen") c.on = f.gens.includes(c.name); });
    renderClips(); tlDirty = true;
    const missing = (f.stock || []).filter(s => !S.clips.some(c => c.src && c.src.file === s.file));
    if(missing.length){
      if(!(await SLSApp.ensurePass())) return;
      toast(`Fetching ${missing.length} stock file${missing.length === 1 ? "" : "s"} for this template…`);
      for(const s of missing){ try { const blob = await SLSBackend.blob(s.file), photo = s.kind === "photo"; await addFootage([blob], [{ name: s.name, kind: photo ? "img" : "video", credit: s.credit, src: { kind: photo ? "photo" : "stock", file: s.file, thumb: s.thumb, page: s.page, author: s.author, source: s.source, title: s.title } }], { quiet: true }); }
        catch(err){ console.warn("stock clip unavailable", err); } }
    }
    if(f.scenes && f.scenes.length && window.SLSFootage && SLSFootage.setScenes) SLSFootage.setScenes(f.scenes);
    if(f.own) toast(`This template also used ${f.own} clip${f.own === 1 ? "" : "s"} from a computer or a moodboard. Add them again in the Clips tab if you want them.`);
  }
  // templates saved by the old version: a whole project
  function legacyData(t){ const p = t.project || {}; return { look: p.style, text: { hook: p.hook, texts: p.texts || [], tTracks: p.tTracks || [{}] }, cuts: p.cuts, format: { aspect: p.aspect, length: p.section ? p.section.b - p.section.a : null },
    lyrics: { lyrics: p.lyrics, words: p.words, section: p.section, bpm: p.bpm, offset: p.offset, song: p.song, points: p.cuts && p.cuts.points } }; }
  function starterApply(s){ apply({ name: s.name, data: { look: { ...S.P.style, ...s.style, x: 0.5, y: 0.5, size: 1, case: "auto" }, cuts: { every: 2, count: 8, seed: 7, order: "shuffle", ...s.cuts }, footage: { gens: s.gens } } }); }

  /* ---------- storage ---------- */
  async function store_(doc, id){
    if(localMode){ if(id){ const i = templates.findIndex(x => x.id === id); if(i >= 0) templates[i] = { ...doc, id }; } else { doc.id = "l" + Date.now(); templates.unshift(doc); }
      store.set("sls-templates", templates); renderTemplates(); return true; }
    try { if(id) await DB.collection("templates").doc(id).set(doc); else await DB.collection("templates").add(doc); return true; }
    catch(err){ toast("Couldn't save: " + (err.message || err.code)); return false; }
  }
  async function remove(id){
    if(localMode){ templates = templates.filter(x => x.id !== id); store.set("sls-templates", templates); renderTemplates(); return; }
    try { await DB.collection("templates").doc(id).delete(); } catch(err){ toast("Couldn't delete: " + (err.message || err.code)); }
  }

  /* ---------- drawing the tab ---------- */
  let confirmDel = null, menuFor = null;
  window.renderTemplates = function(){
    const el = $("#tplList"); if(!el) return;
    if(!templates.length){ el.innerHTML = `<div class="empty" style="grid-column:1/-1">No templates yet. Make a video look the way you like, then "Save current as template" to reuse it on the next song.</div>`; return; }
    el.innerHTML = templates.map(t => { const parts = t.parts ? partNames(t.parts) : ["Whole project"], song = t.data && t.data.lyrics && t.data.lyrics.song ? t.data.lyrics.song.name : t.project && t.project.song ? t.project.song.name : "";
      return `<div class="tp-card" data-id="${esc(t.id)}">
        <button class="tp-thumb" data-act="apply" title="Apply to this song">${t.preview ? `<img alt="" src="${esc(t.preview)}">` : `<span>${esc((t.name || "?").slice(0, 1))}</span>`}</button>
        <div class="tp-info"><b>${esc(t.name || "Untitled")}</b><span class="tp-chips">${parts.map(p => `<i>${esc(p)}</i>`).join("")}</span><span class="hint">${song ? esc(song) + " · " : ""}${new Date(t.savedAt || Date.now()).toLocaleDateString()}</span></div>
        <div class="tp-acts"><button class="btn small primary" data-act="apply">Apply</button><button class="btn small ghost tp-more" data-act="menu" aria-label="More actions">⋯</button></div>
        ${menuFor === t.id ? `<div class="tp-menu"><button data-act="update">Update with what's on screen now</button><button data-act="rename">Rename</button><button data-act="dup">Duplicate</button><button data-act="file">Save as file</button><button data-act="del" class="danger">${confirmDel === t.id ? "Click again to delete" : "Delete"}</button></div>` : ""}
      </div>`; }).join("");
  };
  function drawStarters(){
    $("#tpStarters").innerHTML = STARTERS.map(s => `<button class="tp-starter" data-starter="${s.id}" title="${esc(s.desc)}"><canvas width="120" height="168" data-s="${s.id}"></canvas><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></button>`).join("");
    $$("#tpStarters canvas").forEach(cv => { const s = STARTERS.find(x => x.id === cv.dataset.s), pr = styleDef(s.style.preset), c = cv.getContext("2d");
      const g = c.createLinearGradient(0, 0, 0, cv.height); g.addColorStop(0, s.bg[0]); g.addColorStop(1, s.bg[1]); c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
      const st = { ...S.P.style, ...s.style, x: 0.5, y: 0.5, size: 1, case: "auto" }, d = demoState(pr, 99); if(!d) return;
      c.save(); pr.draw(c, cv.width, cv.height, d, d.words[d.words.length - 1].t + 0.6, st, styleOpts(st, pr)); c.restore(); });
  }

  $("#tpNew").onclick = () => { const f = $("#tpForm"); f.hidden = !f.hidden; if(!f.hidden){ $("#tpName").value = `${S.songName === "Demo track" ? "My look" : S.songName} · ${styleDef(S.P.style.preset).name}`; $("#tpName").select(); } };
  $("#tpCancel").onclick = () => { $("#tpForm").hidden = true; };
  $("#tpForm").onsubmit = async e => {
    e.preventDefault();
    const parts = Object.fromEntries($$("#tpParts input").map(i => [i.value, i.checked])); if(!Object.values(parts).some(Boolean)){ toast("Pick at least one part"); return; }
    const doc = { v: 2, name: $("#tpName").value.trim() || "Untitled", savedAt: Date.now(), parts, data: capture(parts), preview: preview() };
    if(await store_(doc)){ $("#tpForm").hidden = true; toast(localMode ? "Template saved in this browser" : "Template saved for the team"); }
  };
  $("#tpStarters").onclick = e => { const b = e.target.closest("[data-starter]"); if(b) starterApply(STARTERS.find(s => s.id === b.dataset.starter)); };
  $("#tplList").onclick = async e => {
    const b = e.target.closest("[data-act]"), card = e.target.closest(".tp-card"); if(!b || !card) return;
    const t = templates.find(x => x.id === card.dataset.id); if(!t) return; const act = b.dataset.act;
    if(act === "apply"){ menuFor = null; renderTemplates(); return apply(t); }
    if(act === "menu"){ menuFor = menuFor === t.id ? null : t.id; confirmDel = null; return renderTemplates(); }
    if(act === "update"){ const parts = t.parts || Object.fromEntries(PARTS.map(p => [p.id, true])); await store_({ ...t, parts, data: capture(parts), preview: preview(), savedAt: Date.now() }, t.id); menuFor = null; renderTemplates(); return toast("Template updated"); }
    if(act === "rename"){ const n = prompt("New name", t.name); if(n && n.trim()){ await store_({ ...t, name: n.trim() }, t.id); menuFor = null; renderTemplates(); } return; }
    if(act === "dup"){ const { id, ...rest } = t; await store_({ ...clone(rest), name: t.name + " copy", savedAt: Date.now() }); menuFor = null; return renderTemplates(); }
    if(act === "file"){ await saveFile(`${(t.name || "template").replace(/[^\w\- ]+/g, "").trim() || "template"}.sls-template.json`, JSON.stringify({ app: "Stellar Lyric Studio", templates: [t] }, null, 2)); return; }
    if(act === "del"){ if(confirmDel !== t.id){ confirmDel = t.id; return renderTemplates(); } confirmDel = null; menuFor = null; await remove(t.id); toast("Template deleted"); }
  };
  $("#tplDownload").onclick = async () => { if(!templates.length){ toast("No templates to save yet"); return; } const ok = await saveFile("stellar-templates.json", JSON.stringify({ app: "Stellar Lyric Studio", templates }, null, 2)); if(ok === false) toast("Saving files isn't available in this view"); };
  $("#tplOpen").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if(!f) return;
    try { const j = JSON.parse(await f.text()), list = Array.isArray(j.templates) ? j.templates : [j.project ? { name: j.name || f.name.replace(/\..*$/, ""), savedAt: j.savedAt || Date.now(), project: j.project } : j];
      let n = 0; for(const t of list){ if(!t || !(t.data || t.project)) continue; const { id, ...rest } = t; if(await store_({ ...rest, savedAt: rest.savedAt || Date.now() })) n++; }
      toast(n ? `${n} template${n === 1 ? "" : "s"} added` : "That file has no Lyric Studio templates"); }
    catch { toast("That file isn't a Lyric Studio template"); }
  };
  $("#builtinList").onclick = e => { const b = e.target.closest("[data-builtin]"); if(!b) return; useBuiltin(BUILTINS.find(x => x.id === b.dataset.builtin)); renderBuiltins(); };
  document.fonts.ready.then(drawStarters); drawStarters();
  renderTemplates(); renderBuiltins();
  return { apply, starters: STARTERS };
})();

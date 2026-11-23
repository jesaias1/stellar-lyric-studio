"use strict";
/* The lyric review panel (step 2): every line of the song, each word clickable.
   Click a word to fix it. Words the AI wasn't sure about are marked, and can be kept or corrected one by one.
   Works on the same word list as the rest of the studio (S.P.words in js/studio.js), so the timeline, the
   preview and undo all stay in step. Exposes window.SLSLyricsUI. */
window.SLSLyricsUI = (() => {
  const list = $("#lyList");
  const IC = {
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>',
    join: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V7M6.5 12.5 12 7l5.5 5.5M5 4h14"/></svg>',
    bin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>',
  };
  const clock = t => { t = Math.max(0, t); const m = Math.floor(t / 60); return m + ":" + String(Math.floor(t - m * 60)).padStart(2, "0"); };

  let flat = [], els = [], rows = [], rowOf = [];   // words in reading order, their buttons, the line rows, word index -> row index
  let open = null;                                  // {w, original} while a word is being edited
  let stale = true, queued = false, lastNow = -1, lastRow = -1, hadUnsure = false, hearEnd = null, userScroll = 0;
  ["wheel", "touchmove", "pointerdown"].forEach(ev => list.addEventListener(ev, () => { userScroll = performance.now(); }, { passive: true }));

  /* ---------- drawing ---------- */
  function render(){
    stale = false;
    const groups = lineGroups(), keep = open && S.P.words.includes(open.w) ? open : null;
    open = null; flat = []; els = []; rows = []; rowOf = []; lastNow = -1; lastRow = -1;
    list.textContent = "";
    if(!groups.length){ list.append(emptyState()); syncBars(); return; }
    const frag = document.createDocumentFragment();
    groups.forEach((L, li) => {
      const prev = groups[li - 1], gap = prev ? L[0].t - (prev[prev.length - 1].t + prev[prev.length - 1].d) : L[0].t;
      if(gap > 8){ const g = document.createElement("div"); g.className = "ly-gap"; g.textContent = "music · " + Math.round(gap) + "s"; frag.append(g); }
      const row = document.createElement("div"); row.className = "ly-line" + (L.every(w => w.g) ? " missing" : ""); row.dataset.li = li;
      if(L.every(w => w.g)) row.title = "None of this line could be found in the song. It may not be sung in this version.";
      const t = document.createElement("button"); t.className = "ly-t"; t.title = "Play from this line"; t.innerHTML = IC.play + "<span>" + clock(L[0].t) + "</span>";
      const ws = document.createElement("div"); ws.className = "ly-words"; if(/[֐-ࣿ]/.test(L[0].w)) ws.dir = "rtl";
      L.forEach(w => { const b = document.createElement("button"); b.className = "ly-w" + (w.u ? " u" : ""); b.textContent = w.w; if(w.u) b.title = w.g ? "This word couldn't be found in the vocal, so its timing is a guess" : "The AI wasn't sure about this word"; rowOf.push(rows.length); flat.push(w); els.push(b); ws.append(b); });
      const ops = document.createElement("div"); ops.className = "ly-ops";
      ops.innerHTML = (li > 0 ? `<button class="ly-op" data-op="join" title="Join with the line above" aria-label="Join with the line above">${IC.join}</button>` : "") + `<button class="ly-op" data-op="drop" title="Remove this line" aria-label="Remove this line">${IC.bin}</button>`;
      row.append(t, ws, ops); rows.push(row); frag.append(row);
    });
    list.append(frag);
    syncBars();
    if(keep) openWord(keep.w, { focus: false, original: keep.original });
  }
  function emptyState(){
    const d = document.createElement("div"); d.className = "ly-empty";
    d.innerHTML = `<b>No lyrics yet</b><span>Let Stellar listen to the song and write them, or paste the lyrics if you have them.</span><div class="row" style="justify-content:center"><button class="btn primary" data-empty="listen">Listen to the song</button><button class="btn" data-empty="paste">Paste lyrics</button></div>`;
    return d;
  }
  function syncBars(){
    const words = S.P.words, unsure = words.filter(w => w.u).length, lines = new Set(words.map(w => w.l)).size, bar = $("#lyReview");
    const missing = lineGroups().filter(L => L.every(w => w.g)), inMissing = missing.reduce((a, L) => a + L.length, 0);
    $("#lyDropMissing").hidden = !missing.length;
    if(missing.length){ hadUnsure = true; bar.hidden = false; bar.classList.remove("clear");
      const rest = unsure - inMissing;
      $("#lyReviewTxt").textContent = `${missing.length === 1 ? "1 line" : missing.length + " lines"} couldn't be found in the song at all. ${missing.length === 1 ? "It's" : "They're"} probably not sung in this version.` + (rest > 0 ? ` ${rest} other word${rest === 1 ? "" : "s"} to check.` : "");
      $("#lyNextU").hidden = rest <= 0; $("#lyAcceptAll").hidden = true; }
    else if(unsure){ hadUnsure = true; bar.hidden = false; bar.classList.remove("clear");
      const guessed = words.filter(w => w.u && w.g).length, n = unsure === 1 ? "1 word" : unsure + " words";
      $("#lyReviewTxt").textContent = guessed === unsure ? `${n} to check. ${unsure === 1 ? "It" : "They"} couldn't be found in the vocal, so the timing is a guess.`
        : guessed ? `${n} to check: the AI wasn't sure it heard some, and couldn't find others in the vocal.` : `${n} to check. The AI wasn't sure it heard ${unsure === 1 ? "it" : "them"} right.`;
      $("#lyNextU").hidden = false; $("#lyAcceptAll").hidden = false; }
    else if(hadUnsure && words.length){ bar.hidden = false; bar.classList.add("clear"); $("#lyReviewTxt").textContent = "Every word is checked."; $("#lyNextU").hidden = true; $("#lyAcceptAll").hidden = true; }
    else bar.hidden = true;
    const lang = S.P.lang && window.SLSTranscribe ? " · " + SLSTranscribe.langName(S.P.lang) : "";
    $("#lyStat").textContent = words.length ? `${words.length} words · ${lines} lines${lang}` : "";
    $("#lySub").textContent = words.length ? "Click any word to fix it. Click a line's time to hear it." : "Nothing here yet.";
  }
  function schedule(){ stale = true; if(queued) return; queued = true; requestAnimationFrame(() => { queued = false; if(stale && document.body.dataset.step === "lyrics") render(); }); }

  /* ---------- the word editor ---------- */
  function closeEditor(){
    if(!open) return; const i = flat.indexOf(open.w); if(i >= 0){ els[i].classList.remove("sel"); rows[rowOf[i]].classList.remove("open"); }
    list.querySelector(".ly-edit")?.remove(); open = null;
  }
  function openWord(w, { focus = true, original } = {}){
    closeEditor();
    const i = flat.indexOf(w); if(i < 0) return;
    pause(); S.t = clamp(w.t + 0.01, 0, S.audio ? S.audio.duration : w.t);
    open = { w, original: original ?? w.w };
    const row = rows[rowOf[i]]; els[i].classList.add("sel"); row.classList.add("open");
    const p = document.createElement("div"); p.className = "ly-edit" + (w.u ? " unsure" : "");
    p.innerHTML =
      (w.u ? (w.g ? `<div class="ly-edit-note"><b>Timing guessed</b><span>This word couldn't be found in the vocal, so its time is estimated from the words around it. Hear it, and move it earlier or later if it's off.</span></div>`
        : `<div class="ly-edit-note"><b>Not sure</b><span>${w.alt ? "The AI heard this two different ways." : "The AI could barely make this out, or isn't sure a word is sung here."} Listen, then keep it or fix it.</span></div>`) : "") +
      `<div class="ly-edit-main"><button class="btn ly-hear" data-op="hear" title="Play this word in the song">${IC.play}Hear it</button>` +
      `<input type="text" id="lyInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Word" enterkeyhint="done">` +
      `<button class="btn primary ly-keep" data-op="keep">${IC.check}${w.u ? "Keep" : "Done"}</button></div>` +
      (w.u && w.alt ? `<div class="ly-alts"><span>Could also be</span><button data-op="alt"></button></div>` : "") +
      `<div class="ly-tools"><button class="btn small" data-op="split" title="Start a new line at this word">New line from here</button><button class="btn small" data-op="add">Add a word after</button><button class="btn small" data-op="del">Remove word</button><span class="sp"></span>` +
      `<span class="nudge">timing<button class="btn small" data-op="early" title="Show this word 0.05s earlier">earlier</button><button class="btn small" data-op="late" title="Show this word 0.05s later">later</button></span></div>`;
    const inp = p.querySelector("#lyInput"); inp.value = w.w; if(w.alt) p.querySelector('[data-op="alt"]').textContent = w.alt;
    row.append(p);
    if(focus){ inp.focus({ preventScroll: true }); inp.select(); reveal(row); }
  }
  function reveal(row){ const a = row.offsetTop - list.offsetTop, b = a + row.offsetHeight, top = list.scrollTop, h = list.clientHeight; if(a < top + 8) list.scrollTop = a - 24; else if(b > top + h - 8) list.scrollTop = b - h + 24; }
  function setLyricsText(){ S.P.lyrics = lineGroups().map(L => L.map(w => w.w).join(" ")).join("\n"); const ta = $("#lyricsText"); if(ta) ta.value = S.P.lyrics; }
  function relabel(groups){ groups.forEach((L, li) => L.forEach(w => w.l = li)); }
  function changed(){ sortWords(); setLyricsText(); dirty(); }

  /* Saves what is typed. Empty removes the word; several words typed into one box become several words. */
  function commit(){
    if(!open) return null; const w = open.w, text = $("#lyInput") ? $("#lyInput").value.trim() : w.w, parts = text.split(/\s+/).filter(Boolean);
    delete w.u; delete w.g; delete w.alt;
    let last = w;
    if(!parts.length){ S.P.words = S.P.words.filter(x => x !== w); last = null; }
    else if(parts.length === 1) w.w = parts[0];
    else { const total = parts.join("").length, t0 = w.t, d0 = w.d; let acc = 0;
      parts.forEach((txt, k) => { const share = txt.length / total, o = k === 0 ? w : { l: w.l }; o.w = txt; o.t = +(t0 + d0 * acc).toFixed(3); o.d = +Math.max(0.06, d0 * share - 0.02).toFixed(3); acc += share; if(k) S.P.words.push(o); last = o; }); }
    open = null; changed(); render(); return last;
  }
  // the next word to review; lines not found in the song at all are left for "Remove those lines"
  function nextUnsure(after){ const skip = new Set(lineGroups().filter(L => L.every(w => w.g)).flat()), ok = w => w.u && !skip.has(w), from = after ? flat.indexOf(after) : -1;
    return flat.find((w, k) => k > from && ok(w)) || flat.find(ok) || null; }
  function step(dir){ const i = flat.indexOf(open.w), kept = commit(), j = kept ? flat.indexOf(kept) + dir : Math.min(i, flat.length - 1); if(flat[j]) openWord(flat[j]); }
  function hear(w){ const a = Math.max(0, w.t - 0.8); S.t = a; hearEnd = Math.min(S.audio ? S.audio.duration : 1e9, w.t + w.d + 0.7); play({}); }

  list.addEventListener("click", e => {
    const emp = e.target.closest("[data-empty]"); if(emp){ window.SLSApp[emp.dataset.empty === "listen" ? "listen" : "paste"](); return; }
    const op = e.target.closest("[data-op]");
    if(op && op.closest(".ly-edit") && open){
      const w = open.w, k = op.dataset.op;
      if(k === "hear"){ hear(w); $("#lyInput")?.focus({ preventScroll: true }); return; }
      if(k === "keep"){ const wasU = w.u, last = commit(), nx = wasU ? nextUnsure(last) : null; if(nx) openWord(nx); return; }
      if(k === "alt"){ $("#lyInput").value = w.alt; const last = commit(), nx = nextUnsure(last); if(nx) openWord(nx); return; }
      if(k === "del"){ $("#lyInput").value = ""; commit(); return; }
      if(k === "split"){ const kept = commit(); if(!kept) return; const g = lineGroups(), li = g.findIndex(L => L.includes(kept)), at = g[li].indexOf(kept); if(at > 0){ g.splice(li, 1, g[li].slice(0, at), g[li].slice(at)); relabel(g); changed(); render(); } openWord(kept); return; }
      if(k === "add"){ const kept = commit(); if(!kept) return; const nx = flat[flat.indexOf(kept) + 1], room = nx ? nx.t - (kept.t + kept.d) : 9;
        if(room < 0.16){ kept.d = +Math.max(0.06, kept.d / 2).toFixed(3); }
        const nw = { w: "…", l: kept.l, t: +(kept.t + kept.d + 0.02).toFixed(3), d: +Math.max(0.08, Math.min(0.35, (nx ? nx.t : 1e9) - (kept.t + kept.d) - 0.04)).toFixed(3) };
        S.P.words.push(nw); changed(); render(); openWord(nw); const inp = $("#lyInput"); if(inp){ inp.value = ""; open.original = ""; } return; }
      if(k === "early" || k === "late"){ const i = flat.indexOf(w), pv = flat[i - 1], nx = flat[i + 1], d = k === "early" ? -0.05 : 0.05;
        w.t = +clamp(w.t + d, pv ? pv.t + 0.03 : 0, nx ? nx.t - 0.03 : 1e9).toFixed(3); if(nx) w.d = Math.max(0.06, Math.min(w.d, nx.t - w.t - 0.02)); if(pv && pv.t + pv.d > w.t - 0.02) pv.d = Math.max(0.06, w.t - pv.t - 0.02);
        S.t = w.t + 0.01; changed(); toast(`${w.w}: ${d < 0 ? "0.05s earlier" : "0.05s later"}`); return; }
      return;
    }
    if(op){ const row = op.closest(".ly-line"), li = +row.dataset.li, g = lineGroups(); commit();
      if(op.dataset.op === "join" && li > 0){ g.splice(li - 1, 2, [...g[li - 1], ...g[li]]); relabel(g); changed(); render(); }
      if(op.dataset.op === "drop"){ const gone = new Set(g[li]); S.P.words = S.P.words.filter(w => !gone.has(w)); changed(); render(); toast("Line removed. Undo with Ctrl+Z."); }
      return; }
    const tb = e.target.closest(".ly-t"); if(tb){ const li = +tb.closest(".ly-line").dataset.li, L = lineGroups()[li]; if(L){ commit(); hearEnd = null; S.t = Math.max(0, L[0].t - 0.25); play({}); } return; }
    const wb = e.target.closest(".ly-w"); if(wb){ const w = flat[els.indexOf(wb)]; if(!w) return; if(open && open.w === w){ $("#lyInput")?.focus(); return; } if(open) commit(); const again = S.P.words.includes(w) ? w : null; if(again) openWord(again); return; }
  });
  list.addEventListener("input", e => { if(e.target.id !== "lyInput" || !open) return; const i = flat.indexOf(open.w), v = e.target.value.trim(); if(i >= 0) els[i].textContent = v || open.original || "…"; if(v && !/\s/.test(v)) open.w.w = v; });
  list.addEventListener("keydown", e => {
    if(e.target.id !== "lyInput" || !open || e.isComposing) return;
    if(e.key === "Enter"){ e.preventDefault(); const wasU = open.w.u, last = commit(), nx = wasU ? nextUnsure(last) : null; if(nx) openWord(nx); }
    else if(e.key === "Tab"){ e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if(e.key === "Escape"){ e.preventDefault(); const w = open.w; if(open.original === "" ){ S.P.words = S.P.words.filter(x => x !== w); open = null; changed(); render(); } else { w.w = open.original; closeEditor(); render(); } }
    else if(e.key === "Backspace" && e.target.value === "" && !e.repeat){ e.preventDefault(); const i = flat.indexOf(open.w), pv = flat[i - 1]; commit(); if(pv && S.P.words.includes(pv)) openWord(pv); }
  });
  $("#lyDropMissing").onclick = () => { if(open) commit(); const gone = new Set(lineGroups().filter(L => L.every(w => w.g)).flat()); if(!gone.size) return;
    const lines = new Set([...gone].map(w => w.l)).size; S.P.words = S.P.words.filter(w => !gone.has(w)); relabel(lineGroups()); changed(); render();
    toast(`${lines} line${lines === 1 ? "" : "s"} removed. Undo with Ctrl+Z.`); };
  $("#lyNextU").onclick = () => { const cur = open ? open.w : null; if(open) commit(); const nx = nextUnsure(cur && S.P.words.includes(cur) ? cur : null); if(nx) openWord(nx); };
  $("#lyAcceptAll").onclick = () => { if(open) commit(); const n = S.P.words.filter(w => w.u).length; S.P.words.forEach(w => { delete w.u; delete w.g; delete w.alt; }); dirty(); render(); toast(`${n} word${n === 1 ? "" : "s"} accepted. Undo with Ctrl+Z.`); };

  /* ---------- follow the music ---------- */
  function tick(){
    if(document.body.dataset.step !== "lyrics" || !flat.length) return;
    const t = songTime();
    if(hearEnd != null && (!S.playing || t >= hearEnd)){ if(S.playing) pause(); hearEnd = null; }
    let lo = 0, hi = flat.length - 1, i = -1; while(lo <= hi){ const mid = (lo + hi) >> 1; if(flat[mid].t <= t){ i = mid; lo = mid + 1; } else hi = mid - 1; }
    const on = i >= 0 && t < flat[i].t + flat[i].d + 0.25 ? i : -1, key = i * 2 + (on >= 0 ? 1 : 0);
    if(key === lastNow) return;
    const prevI = lastNow < 0 ? -1 : Math.floor(lastNow / 2);
    for(let k = Math.max(0, Math.min(prevI, i) - 1); k <= Math.min(flat.length - 1, Math.max(prevI, i) + 1); k++){ els[k].classList.toggle("now", k === on); els[k].classList.toggle("past", k < i || (k === i && on < 0)); }
    lastNow = key;
    const r = i >= 0 ? rowOf[i] : -1;
    if(r !== lastRow){ if(rows[lastRow]) rows[lastRow].classList.remove("now-line"); if(rows[r] && S.playing) rows[r].classList.add("now-line");
      if(S.playing && !open && rows[r] && performance.now() - userScroll > 2500){ const row = rows[r], want = row.offsetTop - list.offsetTop - list.clientHeight * 0.35; list.scrollTo({ top: Math.max(0, want), behavior: "smooth" }); }
      lastRow = r; }
    if(!S.playing && rows[lastRow]) rows[lastRow].classList.remove("now-line");
  }
  function resetMarks(){ lastNow = -1; els.forEach(b => b.classList.remove("now", "past")); rows.forEach(r => r.classList.remove("now-line")); lastRow = -1; }

  slsOn("change", () => { if(open && document.activeElement && document.activeElement.id === "lyInput") return; schedule(); });

  return { render, tick, schedule, resetMarks, commit: () => { if(open) commit(); }, reviewFirst: () => { const nx = nextUnsure(null); if(nx) openWord(nx); }, clearHear: () => { hearEnd = null; }, forgetReview: () => { hadUnsure = false; } };
})();

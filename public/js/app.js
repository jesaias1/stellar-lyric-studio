"use strict";
/* The guided flow around the editor: splash, start screen, the four steps,
   and the "song in, lyrics out" job. Loaded last. Uses js/studio.js (the editor), js/backend.js,
   js/transcribe.js and js/lyrics.js. Exposes window.SLSApp. */
window.SLSApp = (() => {
  const api = window.SLSBackend, body = document.body, root = document.documentElement;
  const home = $("#home"), keep = { get(k){ try { return localStorage.getItem(k); } catch { return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch {} } };
  let lastStep = "lyrics", job = null, lastFile = null, started = false;

  /* ---------- splash ---------- */
  (function splash(){
    const el = $("#splash"), sky = $("#splashSky"); let seen = false; try { seen = sessionStorage.getItem("sls-splash") === "1"; sessionStorage.setItem("sls-splash", "1"); } catch {}
    const r = rng(11); for(let i = 0; i < 46; i++){ const s = document.createElement("i"), k = 1 + r() * 2.2; s.style.cssText = `left:${(r() * 100).toFixed(2)}%;top:${(r() * 100).toFixed(2)}%;width:${k.toFixed(1)}px;height:${k.toFixed(1)}px;animation-delay:${(r() * 2.6).toFixed(2)}s;animation-duration:${(1.8 + r() * 2.4).toFixed(2)}s`; sky.append(s); }
    if(seen) el.classList.add("quick");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const done = () => { el.classList.add("out"); removeEventListener("keydown", done); setTimeout(() => el.remove(), 900); };
    const timer = setTimeout(done, reduce ? 900 : seen ? 1500 : 3100);
    el.addEventListener("click", () => { clearTimeout(timer); done(); });
    addEventListener("keydown", done, { once: true });
  })();

  /* ---------- light or dark, in the editor only (the start screen is Stellar blue either way) ---------- */
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z"/></svg>';
  function paintTheme(){ const dark = root.dataset.theme === "dark"; $$("[data-theme-toggle]").forEach(b => { b.innerHTML = dark ? SUN : MOON; b.title = dark ? "Switch to the light look" : "Switch to the dark look"; }); tlDirty = true; }
  $$("[data-theme-toggle]").forEach(b => b.onclick = () => { root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"; keep.set("sls-theme", root.dataset.theme); paintTheme(); });
  paintTheme();

  /* ---------- steps ---------- */
  function paintSteps(){ const cur = home.hidden ? body.dataset.step : "song", order = ["song", "lyrics", "design", "export"];
    $$("#steps button").forEach(b => { const k = b.dataset.go; if(k === cur) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); b.classList.toggle("done", order.indexOf(k) < order.indexOf(cur)); }); }
  function go(step){
    if(step === "export"){ go("design"); $("#exportBtn").click(); return; }
    SLSLyricsUI.commit(); SLSLyricsUI.clearHear();
    if(step === "song"){ pause(); showHome("drop"); $("#homeBack").hidden = !started; paintSteps(); slsEmit("step", step); return; }
    started = true; home.hidden = true; lastStep = step;
    if(S.tap){ pause(); endTap(false); }
    pause();
    body.dataset.step = step; S.review = step === "lyrics";
    if(step === "design"){ S.t = clamp(S.t, S.P.section.a, S.P.section.b); selectNone(); sizeTimeline(); renderPresetThumbs(); }
    else { closeSheet(); SLSLyricsUI.resetMarks(); SLSLyricsUI.render(); $("#rvSeek").max = S.audio ? S.audio.duration : 100; }
    tlDirty = true; requestAnimationFrame(fitStage); paintSteps(); slsEmit("step", step);
  }
  $("#steps").onclick = e => { const b = e.target.closest("[data-go]"); if(b) go(b.dataset.go); };
  $("#brandBtn").onclick = () => go("song");
  $("#homeBack").onclick = () => go(lastStep);
  $("#lyNext").onclick = () => go("design");
  $("#openLyEd").onclick = () => go("lyrics");
  $("#navDemo").onclick = e => { e.preventDefault(); $("#demoBtn").click(); };
  $("#navProjects").onclick = e => { e.preventDefault(); const p = $("#projects"); if(p && !p.hidden) p.scrollIntoView({ behavior: "smooth", block: "start" }); else toast("No projects yet. Drop a song to start one."); };
  $("#demoBtn").onclick = () => { go("lyrics"); toast("This is the demo track. Load your own song to have the lyrics written for you."); };

  /* ---------- start screen states ---------- */
  function showHome(state){ home.hidden = false; if(window.SLSProjects) setTimeout(() => SLSProjects.paint(), 0); $("#start").hidden = state !== "drop"; $("#homeOpts").hidden = state !== "drop"; $("#work").hidden = state !== "work"; $("#oops").hidden = state !== "oops"; $(".how").hidden = state !== "drop"; if(state !== "drop") home.scrollTop = 0; }
  function progress(p){
    const LABEL = { read: "Reading your song", listen: "Listening for the words", check: "Listening again to double-check", time: "Timing every word", bites: "Finding the best parts for TikTok and Reels" }, order = ["read", "listen", "check", "time", "bites"];
    $("#workStep").textContent = LABEL[p.stage] + (p.total && p.stage !== "time" && p.stage !== "read" ? "…" : "");
    $("#workBar").style.width = (clamp(p.pct, 0, 1) * 100).toFixed(1) + "%";
    $$("#workList li").forEach(li => { const a = order.indexOf(li.dataset.k), b = order.indexOf(p.stage); li.classList.toggle("on", a === b); li.classList.toggle("ok", a < b); });
  }
  function oops(title, text, { retry = true, manual = true } = {}){ $("#oopsTitle").textContent = title; $("#oopsText").textContent = text; $("#oopsRetry").hidden = !retry; $("#oopsManual").hidden = !manual; showHome("oops"); }
  $("#oopsOther").onclick = () => showHome("drop");
  $("#oopsManual").onclick = () => { go("lyrics"); paste(homeLyrics.value.trim() || S.P.srcLyrics || ""); };

  /* ---------- lyrics pasted on the start screen ---------- */
  const homeLyrics = $("#homeLyrics");
  function paintHomeLyrics(){
    const lines = SLSTranscribe.cleanLyrics(homeLyrics.value), words = lines.join(" ").split(/\s+/).filter(Boolean).length, raw = homeLyrics.value.trim();
    $("#homeLyricsInfo").textContent = raw ? `${lines.length} line${lines.length === 1 ? "" : "s"} · ${words} word${words === 1 ? "" : "s"} ready to time` : "";
    $("#homeLyricsClear").hidden = !raw; $("#pasteCard").classList.toggle("has", !!raw);
    $("#drop .drop-title").lastChild.textContent = raw ? "Now drop the song" : "Drop your song here";
  }
  homeLyrics.value = keep.get("sls-home-lyrics") || "";
  homeLyrics.addEventListener("input", () => { keep.set("sls-home-lyrics", homeLyrics.value); paintHomeLyrics(); });
  $("#homeLyricsClear").onclick = () => { homeLyrics.value = ""; keep.set("sls-home-lyrics", ""); paintHomeLyrics(); homeLyrics.focus(); };
  paintHomeLyrics();
  $("#oopsRetry").onclick = () => { if(S.audio && S.songName !== "Demo track") listen({ lyrics: homeLyrics.value.trim() || S.P.srcLyrics || "" }); else if(lastFile) pick(lastFile); else showHome("drop"); };
  $("#workCancel").onclick = () => { if(job) job.abort(); };

  /* ---------- language ---------- */
  const langSel = $("#langSel");
  langSel.innerHTML = '<option value="">Detect automatically</option>' + SLSTranscribe.LANGUAGES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
  langSel.value = keep.get("sls-lang") || ""; langSel.onchange = () => keep.set("sls-lang", langSel.value);

  /* ---------- login ---------- */
  // everything that needs the server waits until someone is logged in (auth.js shows the login window)
  const loggedIn = async () => { await SLSAuth.ready; return true; };

  /* ---------- song in, lyrics out ---------- */
  async function pick(file){
    if(!file) return; if(job) job.abort();
    lastFile = file; SLSLyricsUI.commit(); pause();
    $("#workSong").textContent = file.name; showHome("work"); progress({ stage: "read", pct: 0.01 }); paintSteps();
    const pasted = homeLyrics.value.trim();
    // the same song file again, with no new lyrics pasted: open the project that already has it
    const same = !pasted && window.SLSProjects ? await SLSProjects.findSong(file) : null;
    if(same){ await SLSProjects.open(same.id); toast(`Opened your project "${same.name}". To start again on this song, use Listen again in the Lyrics step.`); return; }
    try { await loadSong(file, { useDraft: false }); }
    catch { oops("That file couldn't be read", "Try an MP3, WAV, M4A or FLAC file. If it came from a streaming app it may be protected.", { retry: false, manual: false }); return; }
    started = true; SLSLyricsUI.forgetReview();
    if(window.SLSProjects) await SLSProjects.create(file);
    await listen({ lyrics: pasted });
  }
  /* lyrics: text to time to the song. Left out, "Listen again" reuses the lyrics this song was last timed with. */
  async function listen({ lyrics } = {}){
    if(!S.audio || S.songName === "Demo track"){ toast("Load your own song first"); go("song"); return; }
    if(lyrics == null) lyrics = S.P.srcLyrics || "";
    const given = lyrics.trim() && SLSTranscribe.cleanLyrics(lyrics).length ? lyrics.trim() : "";
    $("#workList [data-k=listen]").textContent = given ? "Find your lyrics in the song" : "Listen for the words";
    if(job) job.abort();
    const ctl = job = new AbortController();
    $("#workSong").textContent = S.songName; showHome("work"); progress({ stage: "read", pct: 0.02 }); paintSteps();
    try {
      await loggedIn();
      let out;
      for(let tries = 0;; tries++){
        try { out = await SLSTranscribe.run(S.audio, { language: langSel.value || null, signal: ctl.signal, onProgress: progress, lyrics: given }); break; }
        catch(err){ if(err.code !== "unauthorized" || tries > 2) throw err; await SLSAuth.ready; await new Promise(r => { const off = SLSAuth.onChange(u => { if(u){ off(); r(); } }); }); }
      }
      if(ctl.signal.aborted) return;
      if(out.words.length){ progress({ stage: "bites", pct: 0.98 }); await findBites(out); if(ctl.signal.aborted) return; }
      if(given && !out.words.length){
        // nothing in the song matched the pasted lyrics: keep them, spread evenly, and say so
        S.P.srcLyrics = given; $("#lyricsText").value = SLSTranscribe.cleanLyrics(given).join("\n"); $("#applyLyrics").click();
        go("lyrics"); toast("None of your lyrics could be found in the song, so they're spread evenly. Check the song and the language."); return;
      }
      S.P.words = out.words; S.P.lyrics = out.lyrics; S.P.lang = out.language; S.P.srcLyrics = given || "";
      if(given){ homeLyrics.value = ""; keep.set("sls-home-lyrics", ""); paintHomeLyrics(); }   // used up: the next song starts with an empty box
      // the video starts on the best part for TikTok (or, without one, where the singing starts)
      if(S.P.bites.length) useBite(0, { quiet: true });
      else if(out.words.length && S.audio.duration > 60){ const len = S.P.section.b - S.P.section.a, a = clamp(out.words[0].t - 0.6, 0, S.audio.duration - len); S.P.section = { a: +a.toFixed(2), b: +(a + len).toFixed(2) }; }
      sortWords(); syncUI(); dirty(); SLSLyricsUI.forgetReview();
      S.t = S.P.words.length ? Math.max(0, S.P.words[0].t - 0.5) : 0;
      go("lyrics");
      const s = n => n === 1 ? "" : "s";
      if(!out.words.length) toast("No sung words were found. You can paste the lyrics instead.");
      else if(out.part){ const n = out.occurrences.length; toast(n > 1 ? `Your lyrics are the hook, so the video is just the hook. It's sung ${n} times: pick which one at the top.` : "Your lyrics are the hook, so the video is just the hook."); }
      else if(out.mode === "aligned" && out.matched < 0.4) toast(`Only ${Math.round(out.matched * 100)}% of your lyrics were found in the song. Check they belong to this song, and pick the song's language.`);
      else if(out.mode === "aligned"){
        const left = out.dropped ? ` ${out.dropped} line${s(out.dropped)} from your paste ${out.dropped === 1 ? "isn't" : "aren't"} sung in the song, so ${out.dropped === 1 ? "it was" : "they were"} left out.` : "";
        toast((out.unsure ? `Your lyrics are timed. ${out.unsure} word${s(out.unsure)} couldn't be found in the vocal: check those.` : "Your lyrics are timed. Every word was found in the vocal.") + left);
      }
      else toast(out.unsure ? `Lyrics ready. ${out.unsure} word${s(out.unsure)} to check.` : "Lyrics ready. Every word was heard the same way twice.");
    } catch(err){
      if(ctl.signal.aborted || err.code === "cancelled"){ if(S.P.words.length) go(lastStep); else oops("Stopped", "The song is loaded, but the lyrics weren't written. You can try again or type them in.", {}); return; }
      const MSG = {
        offline: ["Can't reach the lyric AI", "The studio server isn't answering. Check your connection, or type the lyrics in yourself."],
        not_configured: ["The lyric AI isn't switched on yet", "Logins aren't set up on the server yet. Until then you can type or paste the lyrics."],
        no_ai: ["The lyric AI isn't connected", "The server is running but has no speech model attached. You can type or paste the lyrics for now."],
        rate_limited: ["Too many requests", "Wait a minute, then try again."],
        timeout: ["That took too long", "The lyric AI didn't answer in time. Trying again usually works."],
      };
      const [t, m] = MSG[err.code] || ["The lyrics couldn't be written", (err.message || "Something went wrong.") + " You can try again, or type them in."];
      console.error("lyric job failed:", err.code, err.message);
      oops(t, m);
    } finally { if(job === ctl) job = null; }
  }
  slsOn("pick", pick);

  /* ---------- the best parts for TikTok and Reels (js/soundbites.js) ----------
     S.P.bites: up to 3 suggestions [{a, b, label, score, reasons, words?, lyrics?}], best first. When only the
     hook was pasted, each suggestion is one time the hook is sung, with its own timed words. */
  const clock = t => { t = Math.max(0, t); const m = Math.floor(t / 60); return m + ":" + String(Math.floor(t - m * 60)).padStart(2, "0"); };
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function findBites(out){
    S.P.bites = []; S.P.bitesHook = false;
    if(!window.SLSSoundbites || !S.audio) return;
    try {
      if(out.part && out.occurrences && out.occurrences.length){
        const occ = out.occurrences, all = occ.flatMap((o, k) => o.words.map(w => ({ ...w, l: w.l + k * 1000 })));
        const r = await SLSSoundbites.find(S.audio, all, { title: S.songName, ranges: occ.map(o => ({ a: o.a, b: o.b })) });
        S.P.bites = r.parts.map(p => ({ ...p, words: occ[p.occ].words, lyrics: occ[p.occ].lyrics })); S.P.bitesHook = true;
      } else {
        const r = await SLSSoundbites.find(S.audio, out.words, { title: S.songName, lyrics: out.lyrics || "", ask: body => api.api("/api/hooks", { method: "POST", body, timeout: 15000 }) });
        S.P.bites = r.parts;
      }
    } catch(err){ console.error("finding the best parts failed:", err); S.P.bites = []; }
  }
  const biteOn = p => Math.abs(S.P.section.a - p.a) < 0.3 && Math.abs(S.P.section.b - Math.min(p.b, p.a + 60)) < 0.3;
  function useBite(i, { quiet = false, hear = false } = {}){
    const p = (S.P.bites || [])[i]; if(!p || !S.audio) return;
    if(p.words){ S.P.words = p.words.map(w => ({ ...w })); S.P.lyrics = p.lyrics || ""; sortWords(); $("#lyricsText").value = S.P.lyrics; }
    const a = clamp(p.a, 0, S.audio.duration - 2), b = clamp(p.b, a + 2, Math.min(S.audio.duration, a + 60));
    setSection(a, b); if(quiet) return;
    syncUI(); dirty(); paintBites(); SLSLyricsUI.render();
    if(hear){ S.t = a; play({}); }
    toast(`"${p.label}" is in your video: ${clock(a)} to ${clock(b)}.`);
  }
  function biteCards(where){
    const bites = S.P.bites || [];
    return bites.map((p, i) => { const on = biteOn(p), len = Math.round(Math.min(p.b, p.a + 60) - p.a);
      return `<div class="bite${on ? " on" : ""}" data-i="${i}">
        <div class="bite-top"><span class="bite-n">${i + 1}</span><b>${esc(p.label)}</b><span class="bite-score" title="How well this part fits what works on TikTok and Reels, out of 100">${p.score}</span></div>
        <div class="bite-time">${clock(p.a)} to ${clock(Math.min(p.b, p.a + 60))} · ${len} s</div>
        <ul class="bite-why">${(p.reasons || []).map(r => `<li>${esc(r)}</li>`).join("")}</ul>
        <div class="bite-btns">${where === "lyrics" ? `<button class="btn small ghost" data-bact="hear">${'<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>'} Hear it</button>` : ""}${on ? `<span class="bite-in">In your video</span>` : `<button class="btn small" data-bact="use">Use this</button>`}</div>
      </div>`; }).join("");
  }
  function paintBites(){
    const bites = S.P.bites || [], box = $("#bites"), real = S.audio && S.songName !== "Demo track";
    box.hidden = !bites.length || !real;
    $("#bitesBtn").hidden = !bites.length || !real;
    if(!bites.length) return;
    $("#bitesTitle").textContent = S.P.bitesHook ? (bites.length > 1 ? `Your hook is sung ${bites.length} times. Pick one for the video` : "Your hook") : "Best parts for TikTok & Reels";
    $("#bitesSub").textContent = S.P.bitesHook ? "You pasted the hook, so the video is just the hook." : "Picked from what the viral sounds have in common: the hook, energy, a strong start and quotable lyrics.";
    $("#bitesRow").innerHTML = biteCards("lyrics");
    $("#bitesPopRow").innerHTML = biteCards("design");
  }
  function onBiteClick(e){
    const card = e.target.closest(".bite"); if(!card) return; const i = +card.dataset.i, p = S.P.bites[i], act = e.target.closest("[data-bact]")?.dataset.bact;
    if(act === "hear"){ if(p.words && !biteOn(p)) useBite(i, { quiet: false }); SLSLyricsUI.hear(p.a, Math.min(p.b, p.a + 60)); return; }
    if(act === "use" || (!act && !biteOn(p))) useBite(i, { hear: document.body.dataset.step === "design" });
    if(e.currentTarget.id === "bitesPopRow") $("#bitesPop").hidden = true;
  }
  $("#bitesRow").addEventListener("click", onBiteClick);
  $("#bitesPopRow").addEventListener("click", onBiteClick);
  $("#bitesBtn").onclick = e => { e.stopPropagation(); paintBites(); $("#bitesPop").hidden = !$("#bitesPop").hidden; };
  document.addEventListener("click", e => { const pop = $("#bitesPop"); if(!pop.hidden && !pop.contains(e.target) && e.target.id !== "bitesBtn") pop.hidden = true; });
  slsOn("change", () => paintBites());
  slsOn("step", () => paintBites());

  /* drop zone */
  const drop = $("#drop"), homeFile = $("#homeFile");
  drop.onclick = () => homeFile.click();
  drop.onkeydown = e => { if(e.target !== drop) return; if(e.key === "Enter" || e.key === " "){ e.preventDefault(); homeFile.click(); } };
  homeFile.onchange = () => { const f = homeFile.files[0]; homeFile.value = ""; pick(f); };
  let dragDepth = 0;
  const isFile = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  addEventListener("dragenter", e => { if(!isFile(e)) return; e.preventDefault(); dragDepth++; drop.classList.add("over"); });
  addEventListener("dragover", e => { if(isFile(e)) e.preventDefault(); });
  addEventListener("dragleave", e => { if(!isFile(e)) return; if(--dragDepth <= 0){ dragDepth = 0; drop.classList.remove("over"); } });
  addEventListener("drop", e => { if(!isFile(e)) return; e.preventDefault(); dragDepth = 0; drop.classList.remove("over");
    const f = [...e.dataTransfer.files].find(x => /^audio\//.test(x.type) || /\.(mp3|wav|m4a|flac|ogg|aac|aiff?)$/i.test(x.name));
    if(f) pick(f); else toast("Drop an audio file (MP3, WAV, M4A or FLAC)"); });

  /* ---------- lyric panel menu ---------- */
  const menu = $("#lyMenu"), more = $("#lyMore");
  const closeMenu = () => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); };
  more.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute("aria-expanded", String(!menu.hidden)); };
  document.addEventListener("click", e => { if(!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  function paste(text){
    const real = !!(S.audio && S.songName !== "Demo track");
    $("#pasteText").value = text != null ? text : (S.P.srcLyrics || S.P.lyrics || "");
    $("#pasteTime").hidden = !real;
    $("#pasteHint").textContent = real ? "One line per lyric line. The AI listens to the song and gives every word its time. Labels like [Verse 1], Chorus x2 or (Artist name) are removed for you."
      : "One line per lyric line. Load your own song to have them timed automatically. Labels like [Verse 1], Chorus x2 or (Artist name) are removed for you.";
    $("#pasteModal").hidden = false; setTimeout(() => $("#pasteText").focus(), 30);
  }
  $("#pasteCancel").onclick = () => { $("#pasteModal").hidden = true; };
  $("#pasteOk").onclick = () => { $("#pasteModal").hidden = true; const t = $("#pasteText").value; S.P.srcLyrics = t.trim(); $("#lyricsText").value = SLSTranscribe.cleanLyrics(t).join("\n"); $("#applyLyrics").click(); SLSLyricsUI.render(); };
  $("#pasteTime").onclick = () => { const t = $("#pasteText").value.trim(); if(!SLSTranscribe.cleanLyrics(t).length){ toast("Paste some lyrics first"); return; } $("#pasteModal").hidden = true; listen({ lyrics: t }); };
  menu.onclick = e => { const b = e.target.closest("[data-act]"); if(!b) return; closeMenu(); SLSLyricsUI.commit(); const a = b.dataset.act;
    if(a === "paste") paste();
    if(a === "import") $("#lrcFile").click();
    if(a === "lrc") $("#lrcOut").click();
    if(a === "srt") $("#srtOut").click();
    if(a === "clear"){ if(!S.P.words.length) return; S.P.words = []; S.P.lyrics = ""; $("#lyricsText").value = ""; selectNone(); dirty(); SLSLyricsUI.render(); toast("Lyrics cleared. Undo with Ctrl+Z."); } };
  $("#lyRedo").onclick = () => { SLSLyricsUI.commit(); listen(); };

  /* ---------- small things ---------- */
  const tlBtn = $("#tlToggle");
  function setTl(open){ body.dataset.tl = open ? "open" : "closed"; tlBtn.textContent = open ? "Hide timeline" : "Show timeline"; tlBtn.setAttribute("aria-expanded", String(open)); keep.set("sls-tl", open ? "1" : "0"); requestAnimationFrame(() => { sizeTimeline(); fitStage(); tlDirty = true; }); }
  tlBtn.onclick = () => setTl(body.dataset.tl !== "open"); setTl(keep.get("sls-tl") === "1");
  const vid = $("#vidCard"); if(vid && !window.claude?.use) vid.hidden = true;   // that tool only works inside Claude
  const seekBar = $("#rvSeek"); let seeking = false;
  seekBar.addEventListener("pointerdown", () => { seeking = true; }); addEventListener("pointerup", () => { seeking = false; });
  seekBar.addEventListener("input", () => { SLSLyricsUI.clearHear(); seek(+seekBar.value); });
  (function frame(){ try { if(home.hidden && body.dataset.step === "lyrics"){ SLSLyricsUI.tick(); if(!seeking) seekBar.value = songTime(); } } catch(err){ if(!frame.warned){ frame.warned = true; console.error(err); } } requestAnimationFrame(frame); })();

  body.dataset.step = "lyrics"; S.review = false; showHome("drop"); paintSteps();
  /* true once someone is logged in (the login window is up until then) */
  async function ensurePass(){
    if(SLSAuth.signedIn()) return true;
    SLSAuth.requireLogin("Log in to carry on."); await SLSAuth.ready; return SLSAuth.signedIn();
  }
  /* the "working" card on the start screen, for other parts of the app (opening a project) */
  function working(title, step){ $("#workSong").textContent = title; showHome("work"); $("#workStep").textContent = step; $("#workBar").style.width = "35%"; $$("#workList li").forEach(li => { li.className = ""; }); paintSteps(); }
  return { go, pick, listen, paste, ensurePass, working, useBite, paintBites, get step(){ return home.hidden ? body.dataset.step : "song"; }, get lastStep(){ return lastStep; } };
})();

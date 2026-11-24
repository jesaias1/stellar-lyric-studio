"use strict";
/* Video export. Renders the soundbite frame by frame (faster than real time on most computers, and every frame
   is exact), encodes it with the computer's own video encoder (WebCodecs) and packs it into the chosen file type
   with mediabunny (public/vendor, MPL-2.0). Browsers without WebCodecs fall back to the old real-time recorder. */
window.SLSExport = (() => {
  const LIB = "/vendor/mediabunny-1.65.2.min.mjs";
  const FORMATS = [
    { id: "mp4", label: "MP4 · H.264", note: "Plays everywhere. Best for Instagram, TikTok, YouTube", ext: "mp4", mime: "video/mp4", fmt: "Mp4OutputFormat", video: "avc", audio: ["aac", "opus"] },
    { id: "mp4hevc", label: "MP4 · H.265", note: "Smaller file at the same quality", ext: "mp4", mime: "video/mp4", fmt: "Mp4OutputFormat", video: "hevc", audio: ["aac", "opus"] },
    { id: "mov", label: "MOV · H.264", note: "For Premiere, Final Cut and QuickTime", ext: "mov", mime: "video/quicktime", fmt: "MovOutputFormat", video: "avc", audio: ["aac", "pcm-s16"] },
    { id: "webm", label: "WebM · VP9", note: "Open format, good for the web", ext: "webm", mime: "video/webm", fmt: "WebMOutputFormat", video: "vp9", audio: ["opus"] },
    { id: "webmav1", label: "WebM · AV1", note: "Smallest files, newer devices", ext: "webm", mime: "video/webm", fmt: "WebMOutputFormat", video: "av1", audio: ["opus"] },
    { id: "mkv", label: "MKV · H.264", note: "For editing and archiving", ext: "mkv", mime: "video/x-matroska", fmt: "MkvOutputFormat", video: "avc", audio: ["aac", "opus", "pcm-s16"] },
  ];
  const RES = [{ id: 720, label: "720p" }, { id: 1080, label: "1080p" }, { id: 2160, label: "4K" }];
  const FPS = [24, 25, 30, 60];
  const QUAL = [{ id: "MEDIUM", label: "Standard" }, { id: "HIGH", label: "High" }, { id: "VERY_HIGH", label: "Best" }];
  const keep = { get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let opt = Object.assign({ format: "mp4", res: 1080, fps: 30, q: "HIGH" }, keep.get("sls-export", {}));
  let MB = null, support = null, job = null, result = null;

  const modal = $("#exportModal");
  modal.innerHTML = `
  <div class="dialog ex-dialog" role="dialog" aria-labelledby="exTitle">
    <h2 id="exTitle">Export video</h2>
    <div id="exSetup" class="ex-setup">
      <div class="ex-sum" id="exSum"></div>
      <div class="field"><span class="label">File type</span><div class="ex-formats" id="exFormats"></div><button class="link-btn ex-more" id="exMore" type="button">More file types</button></div>
      <div class="ex-row"><div class="field"><span class="label">Resolution</span><div class="seg" id="exRes"></div></div>
        <div class="field"><span class="label">Frame rate</span><div class="seg" id="exFps"></div></div>
        <div class="field"><span class="label">Quality</span><div class="seg" id="exQ"></div></div></div>
      <div class="hint" id="exEst"></div>
      <div class="row"><button class="btn primary" id="exGo">Export</button><button class="btn ghost" id="exClose">Cancel</button></div>
    </div>
    <div id="exRun" class="field" hidden>
      <div class="bar"><i id="exBar"></i></div>
      <div class="hint" id="exStatus">Preparing…</div>
      <div class="row"><button class="btn small ghost" id="exStop">Stop</button></div>
    </div>
    <div id="exDone" class="field" hidden>
      <video id="exVideo" controls playsinline></video>
      <div class="hint" id="exNote"></div>
      <div class="row"><button class="btn primary" id="exSave">Save video</button><button class="btn" id="exAgain">Export another version</button><button class="btn ghost" id="exDone2">Close</button></div>
    </div>
  </div>`;

  const dims = () => {   // output size: the frame's shape at the chosen short side, even numbers for the encoder
    const own = customSize(S.P.aspect); if(own) return own;   // your own size: exactly that, whatever the resolution choice
    const [bw, bh] = frameSize(), k = opt.res / Math.min(bw, bh), ev = n => Math.max(2, Math.round(n * k / 2) * 2);
    return [ev(bw), ev(bh)];
  };
  async function load(){
    if(MB) return MB;
    if(!window.VideoEncoder) return null;
    try { MB = await import(LIB); } catch(err){ console.error("encoder library failed to load", err); return null; }
    return MB;
  }
  async function check(){
    const mb = await load(); if(!mb) return null;
    const [w, h] = dims(), out = {};
    await Promise.all(FORMATS.map(async f => {
      const v = await mb.canEncodeVideo(f.video, { width: w, height: h }).catch(() => false);
      let a = null; for(const c of f.audio){ if(await mb.canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false)){ a = c; break; } }
      out[f.id] = v && a ? { audio: a } : null;
    }));
    return out;
  }
  const seg = (id, list, cur, lab = x => x.label ?? x) => { $(id).innerHTML = list.map(x => `<button data-v="${x.id ?? x}" aria-pressed="${String((x.id ?? x) === cur)}">${lab(x)}</button>`).join(""); };
  async function paint(){
    const len = S.P.section.b - S.P.section.a, [w, h] = dims();
    const own = customSize(S.P.aspect);
    $("#exSum").innerHTML = `<b>${esc(S.songName)}</b><span>${fmt(S.P.section.a)} to ${fmt(S.P.section.b)} · ${len.toFixed(1)} s · ${own ? "your own size" : S.P.aspect} · ${w}×${h}</span>`;
    if(own) $("#exRes").innerHTML = `<span class="ex-own">${w}×${h}, your own size</span>`;   // exported exactly as you set it
    else seg("#exRes", RES, opt.res);
    seg("#exFps", FPS, opt.fps, x => x + " fps"); seg("#exQ", QUAL, opt.q);
    $("#exFormats").innerHTML = FORMATS.map(f => { const ok = !support || support[f.id];
      return `<button class="ex-f${f.id === opt.format || f.id === FORMATS[0].id ? " keep" : ""}" data-v="${f.id}" aria-pressed="${f.id === opt.format}" ${ok ? "" : "disabled"}><b>${f.label}</b><span>${ok ? f.note : "This browser can't encode it"}</span></button>`; }).join("");
    if(support && !support[opt.format]){ const first = FORMATS.find(f => support[f.id]); if(first){ opt.format = first.id; return paint(); } }
    const mbps = { MEDIUM: 0.09, HIGH: 0.16, VERY_HIGH: 0.3 }[opt.q] * w * h * opt.fps / 1e6 / 30 * (FORMATS.find(f => f.id === opt.format).video === "avc" ? 1 : 0.65);
    $("#exEst").textContent = support === null ? "Checking what this computer can encode…" : support === false ? "This browser can't encode video files, so the video will be recorded in real time instead (WebM or MP4, depending on the browser). Chrome or Edge can export every format."
      : `About ${Math.max(1, mbps * len / 8 + 0.03 * len).toFixed(0)} MB. Rendering takes a few seconds to a minute; you can keep working in other tabs.`;
    $("#exGo").textContent = support === false ? "Record in real time" : "Export";
  }
  async function open(){
    if(S.tap) return; pause(); SLSLyricsUI.commit && SLSLyricsUI.commit();
    $("#exSetup").hidden = false; $("#exRun").hidden = true; $("#exDone").hidden = true; modal.hidden = false;
    support = null; paint(); const s = await check(); support = s || false; paint();
  }
  $("#exMore").onclick = () => { const all = $("#exFormats").classList.toggle("all"); $("#exMore").textContent = all ? "Fewer file types" : "More file types"; };
  modal.addEventListener("click", e => {
    const b = e.target.closest("button[data-v]"); if(!b || b.disabled) return; const p = b.parentElement.id, v = b.dataset.v;
    if(p === "exFormats" || b.classList.contains("ex-f")) opt.format = v; else if(p === "exRes") opt.res = +v; else if(p === "exFps") opt.fps = +v; else if(p === "exQ") opt.q = v; else return;
    keep.set("sls-export", opt); if(p === "exRes"){ support = null; paint(); check().then(s => { support = s || false; paint(); }); } else paint();
  });
  $("#exClose").onclick = $("#exDone2").onclick = () => { modal.hidden = true; $("#exVideo").pause(); };
  $("#exAgain").onclick = () => { $("#exVideo").pause(); open(); };
  $("#exStop").onclick = () => { if(job) job.cancel = true; };
  $("#exportBtn").onclick = open;

  /* ---------- rendering ---------- */
  function waitSeek(v, t){
    if(!v.duration) return Promise.resolve();
    t = Math.max(0, Math.min(v.duration - 0.01, t)); if(Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return Promise.resolve();
    return new Promise(res => { const done = () => { v.removeEventListener("seeked", done); clearTimeout(to); res(); }, to = setTimeout(done, 3000); v.addEventListener("seeked", done); v.currentTime = t; });
  }
  async function prepFrame(t){   // put the clip that's on screen at time t on exactly the right frame
    const { segs, order } = segInfo(); let si = segs.findIndex(s => t >= s.a && t < s.b); if(si < 0) si = segs.length - 1;
    const clip = si >= 0 ? S.clips.find(c => c.id === order[si]) : null;
    if(clip && clip.kind === "video"){ const v = vidFor(clip, si); if(!v.paused) v.pause(); if(v.readyState < 1) await new Promise(r => { v.onloadedmetadata = r; setTimeout(r, 3000); });
      await waitSeek(v, wantTime(v, t - segs[si].a, si)); }
  }
  /* Video clips are decoded straight from their files, frame by frame in order, instead of seeking a <video>
     element for every frame (which is slow, especially for 4K stock footage). Per cut, all the frame times are
     known up front, so the decoder reads each part of the file once. Returns false when it can't help, and the
     caller falls back to seeking. */
  class Frames {
    constructor(mb, w, h, a, dt, total){ Object.assign(this, { mb, w, h, a, dt, total, inputs: new Map(), si: -1, gen: null, clip: null }); }
    async sink(clip){
      if(!this.inputs.has(clip.id)){
        let s = null;
        try { const input = new this.mb.Input({ source: new this.mb.BlobSource(clip.blob), formats: this.mb.ALL_FORMATS }), track = await input.getPrimaryVideoTrack();
          if(track && await track.canDecode()) s = new this.mb.CanvasSink(track, { width: this.w, height: this.h, fit: "cover", poolSize: 2 }); } catch(e){ console.warn("decoder unavailable for", clip.name, e); }
        this.inputs.set(clip.id, s);
      }
      return this.inputs.get(clip.id);
    }
    async at(i, t){
      const { segs, order } = segInfo(); let si = segs.findIndex(s => t >= s.a && t < s.b); if(si < 0) si = segs.length - 1;
      const clip = si >= 0 ? S.clips.find(c => c.id === order[si]) : null;
      if(!clip || clip.kind !== "video") return true;   // nothing to decode for photos and built-in visuals
      if(!clip.blob) return false;
      if(si !== this.si){
        if(this.gen) await this.gen.return().catch(() => {});
        this.si = si; this.clip = clip; this.gen = null;
        const sink = await this.sink(clip); if(!sink) return false;
        const v = clip.el, seg = segs[si], times = [];
        for(let k = i; k < this.total; k++){ const tk = this.a + k * this.dt; if(tk >= seg.b) break; times.push(wantTime(v, tk - seg.a, si)); }
        this.gen = sink.canvasesAtTimestamps(times);
      }
      if(!this.gen) return false;
      const { value } = await this.gen.next();
      if(value && value.canvas) clip.xf = value.canvas;
      return !!clip.xf;
    }
  }
  async function renderAudio(a, b, rate){
    const len = Math.max(0.1, b - a), oc = new OfflineAudioContext(2, Math.ceil(len * rate), rate), out = oc.createGain(); out.connect(oc.destination);
    const main = oc.createBufferSource(); main.buffer = playBuffer(); const g = oc.createGain(); g.gain.value = S.P.mainMute ? 0 : (S.P.mainVol ?? 1); main.connect(g).connect(out); main.start(0, a, len);
    (S.P.aux || []).forEach(x => { const buf = S.auxBuf[x.id]; if(!buf || x.mute) return; const s = oc.createBufferSource(), gg = oc.createGain(); s.buffer = buf; gg.gain.value = x.vol ?? 1; s.connect(gg).connect(out);
      const off = -(x.start || 0); if(off < 0) s.start(-off, 0); else if(off < buf.duration) s.start(0, off); });
    out.gain.setValueAtTime(0, 0); out.gain.linearRampToValueAtTime(1, 0.01); out.gain.setValueAtTime(1, Math.max(0.02, len - 0.03)); out.gain.linearRampToValueAtTime(0, len);   // no clicks at the cut points
    return oc.startRendering();
  }
  async function run(){
    if(support === false){ legacy(); return; }
    const mb = await load(), f = FORMATS.find(x => x.id === opt.format), s = support && support[f.id]; if(!mb || !s) return;
    const { a, b } = S.P.section, fps = opt.fps, dt = 1 / fps, total = Math.max(1, Math.round((b - a) * fps)), [w, h] = dims();
    $("#exSetup").hidden = true; $("#exRun").hidden = false; $("#exBar").style.width = "0%";
    job = { cancel: false }; S.exporting = { offline: true }; S.review = false;
    const selWas = S.sel; S.sel = null; tlDirty = true;
    const keepSize = [stage.width, stage.height]; stage.width = w; stage.height = h;
    const t0 = performance.now(); let ok = false, err = null;
    try {
      const output = new mb.Output({ format: new mb[f.fmt](), target: new mb.BufferTarget() });
      const quality = mb["QUALITY_" + opt.q];
      const video = new mb.CanvasSource(stage, { codec: f.video, bitrate: quality, keyFrameInterval: 2, latencyMode: "quality" });
      output.addVideoTrack(video, { frameRate: fps });
      const audio = new mb.AudioBufferSource({ codec: s.audio, bitrate: quality });
      output.addAudioTrack(audio);
      await output.start();
      $("#exStatus").textContent = "Mixing the audio…";
      const audioBuf = await renderAudio(a, b, 48000);
      const frames = new Frames(mb, w, h, a, dt, total);
      for(let i = 0; i < total; i++){
        if(job.cancel) throw { cancelled: true };
        const t = a + i * dt;   // frame i shows the moment it starts
        if(!(await frames.at(i, t))) await prepFrame(t);
        renderFrame(t);
        await video.add(i * dt, dt);
        if(i % 3 === 0 || i === total - 1){ const p = (i + 1) / total, el = (performance.now() - t0) / 1000, left = el / p - el;
          $("#exBar").style.width = (p * 92).toFixed(1) + "%"; $("#exStatus").textContent = `Rendering frame ${i + 1} of ${total}` + (i > 15 ? ` · about ${Math.max(1, Math.round(left))} s left` : "");
          await new Promise(r => setTimeout(r, 0)); }   // let the page breathe
      }
      $("#exStatus").textContent = "Encoding the audio and finishing the file…"; $("#exBar").style.width = "96%";
      await audio.add(audioBuf);
      await output.finalize();
      result = { blob: new Blob([output.target.buffer], { type: f.mime }), f, w, h, fps };
      ok = true;
    } catch(e){ err = e; if(!e || !e.cancelled) console.error("export failed", e); }
    finally {
      S.clips.forEach(c => { delete c.xf; });
      stage.width = keepSize[0]; stage.height = keepSize[1]; S.exporting = null; S.sel = selWas; tlDirty = true; syncUI(); fitStage(); job = null;
    }
    if(ok){
      const url = URL.createObjectURL(result.blob), v = $("#exVideo"); if(v.dataset.url) URL.revokeObjectURL(v.dataset.url); v.dataset.url = url; v.src = url;
      $("#exRun").hidden = true; $("#exDone").hidden = false;
      const secs = ((performance.now() - t0) / 1000).toFixed(0);
      $("#exNote").textContent = `${(result.blob.size / 1048576).toFixed(1)} MB ${result.f.label} · ${result.w}×${result.h} · ${result.fps} fps · made in ${secs} s.` + (result.f.id === "mov" || result.f.id === "mkv" ? " The preview may not play in the browser; the file opens in editing apps." : "");
    } else {
      $("#exRun").hidden = true; $("#exSetup").hidden = false;
      $("#exEst").textContent = err && err.cancelled ? "Export stopped." : "The export failed: " + ((err && err.message) || "unknown error") + ". Try another file type or a lower resolution.";
    }
  }
  $("#exGo").onclick = run;
  $("#exSave").onclick = async () => {
    if(!result) return;
    // Song_Title_2026-11-24.mp4: the song title and today's date, so exports are easy to find and tell apart
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const title = String(S.songName || "Lyric video").replace(/\.[a-z0-9]{2,4}$/i, "").normalize("NFC").replace(/[\\/:*?"<>|#%&{}$!'@+`=]+/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "Lyric_video";
    const name = `${title}_${day}.${result.f.ext}`;
    const ok = await saveFile(name, result.blob);
    if(ok) toast("Video saved"); else if(ok === false) $("#exNote").textContent = "Saving isn't available in this view. Right-click the video and choose Save video as.";
  };

  /* old real-time recorder, for browsers without WebCodecs (it lives in studio.js) */
  function legacy(){ $("#exSetup").hidden = true; $("#exRun").hidden = false; $("#exStatus").textContent = "Recording in real time…"; $("#exStart") ? $("#exStart").click() : legacyRecord(); }
  function legacyRecord(){
    const mime = pickMime(); if(!mime){ $("#exStatus").textContent = "This browser can't make video files. Use Chrome, Edge or Safari."; return; }
    exExt = mime.startsWith("video/mp4") ? "mp4" : "webm";
    const c = ctx(); c.resume(); const dest = c.createMediaStreamDestination(), vstream = stage.captureStream(30);
    const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]), chunks = [], rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9e6 });
    rec.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    rec.onstop = () => { vstream.getTracks().forEach(t => t.stop()); const blob = new Blob(chunks, { type: mime.split(";")[0] });
      result = { blob, f: { label: exExt.toUpperCase(), ext: exExt, id: exExt }, w: stage.width, h: stage.height, fps: 30 };
      const v = $("#exVideo"); v.src = URL.createObjectURL(blob); $("#exRun").hidden = true; $("#exDone").hidden = false; $("#exNote").textContent = `${(blob.size / 1048576).toFixed(1)} MB ${exExt.toUpperCase()}, recorded in real time.`; };
    S.t = S.P.section.a; S.exporting = { rec }; S.review = false; renderFrame(S.t); rec.start(250); play({ dest });
  }
  /* the last finished export, for posting it (js/publish.js) */
  return { open, formats: FORMATS, get result(){ return result; }, get audioCodec(){ return result && support && support[result.f.id] ? support[result.f.id].audio : null; } };
})();

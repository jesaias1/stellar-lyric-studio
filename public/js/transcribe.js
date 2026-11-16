"use strict";
/* Song in, timed lyrics out.

   How it works:
   1. The song is mixed down to 16 kHz mono (what the speech model wants) and cut into pieces of up to 30 seconds.
   2. Every piece goes to the backend, which runs Whisper on it and returns words with start and end times.
   3. The song is listened to twice, with the cuts in different places. Where both passes heard the same word,
      it is trusted. Where they disagree, or only one pass heard something, the word is marked "unsure" and the
      other reading is kept as a suggestion. That is what the review step shows the user.
   4. Word timings are tidied and the words are grouped into lines.

   Needs: window.SLSBackend (js/backend.js). Exposes window.SLSTranscribe. */
window.SLSTranscribe = (() => {
  const RATE = 16000, CHUNK = 30, OVERLAP = 2, PARALLEL = 3;

  // Whisper's language list, most common first in the menu.
  const LANGUAGES = [["en","English"],["es","Spanish"],["it","Italian"],["fr","French"],["de","German"],["pt","Portuguese"],["da","Danish"],["sv","Swedish"],["no","Norwegian"],["nl","Dutch"],
    ["af","Afrikaans"],["sq","Albanian"],["am","Amharic"],["ar","Arabic"],["hy","Armenian"],["az","Azerbaijani"],["eu","Basque"],["be","Belarusian"],["bn","Bengali"],["bs","Bosnian"],["bg","Bulgarian"],["my","Burmese"],["yue","Cantonese"],["ca","Catalan"],["zh","Chinese"],["hr","Croatian"],["cs","Czech"],["et","Estonian"],["fo","Faroese"],["fi","Finnish"],["gl","Galician"],["ka","Georgian"],["el","Greek"],["gu","Gujarati"],["ht","Haitian Creole"],["ha","Hausa"],["haw","Hawaiian"],["he","Hebrew"],["hi","Hindi"],["hu","Hungarian"],["is","Icelandic"],["id","Indonesian"],["ja","Japanese"],["jw","Javanese"],["kn","Kannada"],["kk","Kazakh"],["km","Khmer"],["ko","Korean"],["lo","Lao"],["la","Latin"],["lv","Latvian"],["ln","Lingala"],["lt","Lithuanian"],["lb","Luxembourgish"],["mk","Macedonian"],["mg","Malagasy"],["ms","Malay"],["ml","Malayalam"],["mt","Maltese"],["mi","Maori"],["mr","Marathi"],["mn","Mongolian"],["ne","Nepali"],["nn","Nynorsk"],["oc","Occitan"],["ps","Pashto"],["fa","Persian"],["pl","Polish"],["pa","Punjabi"],["ro","Romanian"],["ru","Russian"],["sa","Sanskrit"],["sr","Serbian"],["sn","Shona"],["sd","Sindhi"],["si","Sinhala"],["sk","Slovak"],["sl","Slovenian"],["so","Somali"],["su","Sundanese"],["sw","Swahili"],["tl","Tagalog"],["tg","Tajik"],["ta","Tamil"],["tt","Tatar"],["te","Telugu"],["th","Thai"],["bo","Tibetan"],["tr","Turkish"],["tk","Turkmen"],["uk","Ukrainian"],["ur","Urdu"],["uz","Uzbek"],["vi","Vietnamese"],["cy","Welsh"],["yi","Yiddish"],["yo","Yoruba"]];
  const NO_SPACES = new Set(["zh","ja","yue","th","lo","my","km","bo"]);   // written without spaces between words
  const langName = code => (LANGUAGES.find(l => l[0] === code) || [code, code])[1];

  /* ---------- audio prep ---------- */
  async function toMono16k(buf){
    const n = Math.ceil(buf.duration * RATE);
    let out;
    try {
      const oc = new OfflineAudioContext(1, n, RATE), src = oc.createBufferSource(); src.buffer = buf;
      const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90; hp.Q.value = 0.7;   // takes the kick and sub-bass out of the way of the voice
      src.connect(hp).connect(oc.destination); src.start();
      out = (await oc.startRendering()).getChannelData(0);
    } catch {
      // a browser that can't render at 16 kHz: average the channels and step through the samples by hand
      const ch = []; for(let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
      const step = buf.sampleRate / RATE; out = new Float32Array(n);
      for(let i = 0; i < n; i++){ const a = Math.floor(i * step), b = Math.min(buf.length, Math.max(a + 1, Math.floor((i + 1) * step))); let v = 0;
        for(let k = a; k < b; k++){ for(const d of ch) v += d[k]; } out[i] = v / ((b - a) * ch.length || 1); }
    }
    let peak = 0; for(let i = 0; i < out.length; i += 3){ const v = Math.abs(out[i]); if(v > peak) peak = v; }
    if(peak > 0.001){ const g = Math.min(8, 0.95 / peak); if(Math.abs(g - 1) > 0.05) for(let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * g)); }
    return out;
  }
  function wavBase64(samples, from, to){
    const n = to - from, bytes = new Uint8Array(44 + n * 2), dv = new DataView(bytes.buffer), wr = (o, s) => { for(let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    wr(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); wr(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, "data"); dv.setUint32(40, n * 2, true);
    for(let i = 0; i < n; i++){ const v = Math.max(-1, Math.min(1, samples[from + i])); dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    let bin = ""; for(let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /* ---------- where to cut ---------- */
  // One listening pass: pieces of up to CHUNK seconds that overlap by OVERLAP, the first cut at `first`.
  function plan(dur, first){
    const cuts = []; let s = 0, e = Math.min(dur, first > 0 ? first + OVERLAP : CHUNK);
    for(;;){ cuts.push({ s, e }); if(e >= dur - 0.05) break; s = e - OVERLAP; e = Math.min(dur, s + CHUNK); if(dur - s < OVERLAP + 0.6) break; }
    cuts[cuts.length - 1].e = dur;
    return cuts;
  }
  function loudness(samples, c){ let e = 0, k = 0; for(let i = Math.floor(c.s * RATE); i < Math.floor(c.e * RATE); i += 16){ e += samples[i] * samples[i]; k++; } return k ? e / k : 0; }

  /* ---------- text helpers ---------- */
  const norm = w => w.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
  const tidy = w => w.replace(/^[\s.,;:"“”„«»…\-–—(\[♪♫]+|[\s.,;:"“”„«»…\-–—)\]♪♫]+$/gu, "");
  const JUNK = /subtit|amara\.org|thanks? (you )?for watching|sottotitoli|untertitel|sous-titres|ondertitel|napisy|www\.|https?:|\.com\b/i;

  /* ---------- one pass: stitch the pieces back together ---------- */
  function stitch(cuts, results, dur){
    const words = [];
    cuts.forEach((c, k) => {
      const r = results[k]; if(!r) return;
      const lo = k > 0 ? (c.s + cuts[k - 1].e) / 2 : -1, hi = k < cuts.length - 1 ? (cuts[k + 1].s + c.e) / 2 : Infinity;   // each overlap is split down the middle
      for(const seg of r.segments || []){
        if(JUNK.test(seg.text)) continue;
        if((seg.nsp ?? 0) > 0.6 && (seg.lp ?? 0) < -1) continue;       // the model itself thinks nobody is singing here
        (seg.words || []).forEach((w, i) => {
          const text = tidy(w.w); if(!text || !norm(text)) return;
          const s = c.s + (w.s ?? 0), e = c.s + Math.max(w.e ?? 0, (w.s ?? 0) + 0.04); if(s < lo || s >= hi || s > dur + 0.5) return;
          const edge = Math.min(c.s > 0 ? s - c.s : Infinity, c.e < dur - 0.05 ? c.e - s : Infinity);
          words.push({ w: text, n: norm(text), s, e, lp: seg.lp ?? -0.5, edge, brk: i === 0 });
        });
      }
    });
    words.sort((a, b) => a.s - b.s);
    // the same word caught on both sides of a seam
    return words.filter((w, i) => !(i > 0 && w.n === words[i - 1].n && w.s - words[i - 1].s < 0.6 && w.edge < OVERLAP + 0.5 && words[i - 1].edge < OVERLAP + 0.5));
  }

  /* ---------- two passes into one transcript, with doubts marked ---------- */
  function reconcile(A, B){
    const n = A.length, m = B.length;
    if(!m) return A.map(w => ({ ...w, u: w.lp < -0.7 ? 1 : 0 }));
    if(!n) return B.map(w => ({ ...w, u: 1 }));
    // longest common run of words that also agree roughly on when they were sung
    const W = m + 1, dp = new Uint16Array((n + 1) * W);
    const same = (i, j) => A[i].n === B[j].n && Math.abs(A[i].s - B[j].s) < 2.5;
    for(let i = n - 1; i >= 0; i--) for(let j = m - 1; j >= 0; j--)
      dp[i * W + j] = same(i, j) ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    const out = []; let i = 0, j = 0, ra = [], rb = [];
    const score = r => r.reduce((a, w) => a + w.lp - (w.edge < 1.2 ? 0.6 : 0), 0) / r.length;
    const flush = () => {
      if(ra.length && rb.length){
        // both heard something here, but not the same thing: keep the more confident reading, offer the other
        const [keep, other] = score(ra) >= score(rb) ? [ra, rb] : [rb, ra], pair = keep.length === other.length;
        keep.forEach((w, k) => out.push({ ...w, u: 1, alt: pair ? (other[k].n !== w.n ? other[k].w : "") : (k === 0 ? other.map(x => x.w).join(" ") : "") }));
      } else {
        // only one pass heard these. Right at a cut that is expected, so trust it; elsewhere, ask.
        for(const w of ra.length ? ra : rb){ if(w.lp < -1.1) continue; out.push({ ...w, u: 1, alt: "" }); }
      }
      ra = []; rb = [];
    };
    while(i < n && j < m){
      if(same(i, j)){ flush(); const a = A[i], b = B[j]; out.push({ ...(a.edge >= b.edge ? a : b), w: a.w, brk: a.brk, u: 0 }); i++; j++; }
      else if(dp[(i + 1) * W + j] >= dp[i * W + j + 1]) ra.push(A[i++]);
      else rb.push(B[j++]);
    }
    while(i < n) ra.push(A[i++]); while(j < m) rb.push(B[j++]);
    flush();
    return out.sort((a, b) => a.s - b.s);
  }

  /* ---------- timing and lines ---------- */
  function finish(list, lang){
    if(!list.length) return { words: [], lyrics: "" };
    // Whisper gives the silence before a word to that word, so a word after a pause seems to start far too early.
    // A word that runs much longer than its length explains is pulled up to where it would really begin.
    list.forEach(w => { const cap = Math.min(1.5, Math.max(0.45, 0.3 + 0.09 * [...w.w].length)); if(w.e - w.s > cap * 1.7) w.s = w.e - cap; });
    list.sort((a, b) => a.s - b.s);
    // lines: a real pause, or one of Whisper's own phrase breaks
    let lines = [], cur = [];
    list.forEach((w, k) => { const prev = list[k - 1]; if(cur.length && (w.s - prev.e > 0.5 || (w.brk && w.s - prev.e > 0.12) || (w.brk && cur.length >= 6))){ lines.push(cur); cur = []; } cur.push(w); });
    if(cur.length) lines.push(cur);
    // a single word left alone joins its neighbour when they are sung back to back
    for(let k = lines.length - 1; k > 0; k--){ if(lines[k].length === 1 && lines[k - 1].length < 7 && lines[k][0].s - lines[k - 1][lines[k - 1].length - 1].e < 0.3){ lines[k - 1].push(lines[k][0]); lines.splice(k, 1); } }
    const len = L => L.reduce((a, w) => a + [...w.w].length + 1, 0);
    const split = L => {
      if(L.length < 4 || (L.length <= 8 && len(L) <= 46)) return [L];
      let best = Math.floor(L.length / 2), gap = -1; const lo = Math.max(1, Math.floor(L.length * 0.3)), hi = Math.min(L.length - 1, Math.ceil(L.length * 0.7));
      for(let k = lo; k <= hi; k++){ const g = L[k].s - L[k - 1].e - Math.abs(k - L.length / 2) * 0.01; if(g > gap){ gap = g; best = k; } }
      return [...split(L.slice(0, best)), ...split(L.slice(best))];
    };
    lines = lines.flatMap(split);
    // languages written without spaces arrive as single characters: join them into short phrases
    if(NO_SPACES.has(lang)) lines = lines.map(L => { const out = []; for(const w of L){ const p = out[out.length - 1];
      if(p && w.s - p.e < 0.25 && [...p.w].length + [...w.w].length <= 6){ p.w += w.w; p.e = w.e; p.u = p.u || w.u; if(w.alt) p.alt = (p.alt || "") + w.alt; } else out.push({ ...w }); } return out; });
    const words = [];
    lines.forEach((L, li) => L.forEach(w => { const o = { w: w.w, l: li, t: +Math.max(0, w.s).toFixed(3), d: +(w.e - w.s).toFixed(3) }; if(w.u) o.u = 1; if(w.alt && norm(w.alt) !== norm(w.w)) o.alt = w.alt; words.push(o); }));
    words.sort((a, b) => a.t - b.t);
    words.forEach((w, k) => { const nx = words[k + 1]; w.d = +Math.max(0.06, Math.min(Math.max(w.d, 0.12), 2.5, nx ? nx.t - w.t - 0.02 : 9)).toFixed(3); });
    return { words, lyrics: lines.map(L => L.map(w => w.w).join(" ")).join("\n") };
  }

  /* ---------- the whole job ---------- */
  async function run(buf, { language = null, signal = null, onProgress = () => {} } = {}){
    const api = window.SLSBackend, stop = () => { if(signal && signal.aborted) throw new api.ApiError("cancelled", "Cancelled.", 0); };
    onProgress({ stage: "read", pct: 0.02 });
    const mono = await toMono16k(buf), dur = mono.length / RATE; stop();
    const first = Math.min(CHUNK / 2 - 1, Math.max(4, dur / 2));
    const A = plan(dur, 0), B = dur > 6 ? plan(dur, first) : [];
    const jobs = [...A.map((c, k) => ({ c, k, pass: "A" })), ...B.map((c, k) => ({ c, k, pass: "B" }))], res = { A: [], B: [] };
    let done = 0;
    const tick = () => { const inA = done < A.length; onProgress({ stage: inA ? "listen" : "check", pct: 0.06 + 0.86 * done / jobs.length, done, total: jobs.length }); };
    const one = async (job, lang) => {
      const payload = { audio: wavBase64(mono, Math.floor(job.c.s * RATE), Math.floor(job.c.e * RATE)), at: +job.c.s.toFixed(2), len: +(job.c.e - job.c.s).toFixed(2) };
      if(lang) payload.language = lang;
      for(let attempt = 0; ; attempt++){
        stop();
        try { return await api.transcribe(payload, signal); }
        catch(err){
          const retry = ["busy", "timeout", "offline", "ai_failed", "server_error", "rate_limited"].includes(err.code) && attempt < 3;
          if(!retry) throw err;
          await new Promise(r => setTimeout(r, err.code === "rate_limited" ? 8000 : 900 * (attempt + 1) * (attempt + 1)));
        }
      }
    };
    tick();
    // language: when not given, the loudest piece is heard first and the rest follow its verdict
    let lang = language || null, detected = null;
    if(!lang && A.length > 1){
      const probe = A.map((c, k) => ({ k, e: loudness(mono, c) })).sort((x, y) => y.e - x.e)[0].k, r = await one(jobs[probe], null);
      res.A[probe] = r; jobs[probe].done = true; done++; tick();
      if(r.language && (r.languageProbability ?? 1) >= 0.5) lang = detected = r.language;
    }
    const queue = jobs.filter(j => !j.done); let failedB = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      for(;;){ const job = queue.shift(); if(!job) return;
        try { const r = await one(job, lang); res[job.pass][job.k] = r; if(!detected && r.language) detected = r.language; }
        catch(err){ if(job.pass === "A" || ["unauthorized", "cancelled", "not_configured", "no_ai"].includes(err.code)) throw err; failedB++; }   // the second opinion is optional
        done++; tick(); }
    }));
    stop();
    onProgress({ stage: "time", pct: 0.95 });
    const a = stitch(A, res.A, dur), b = B.length && failedB < B.length ? stitch(B, res.B, dur) : [];
    const final = finish(reconcile(a, b), lang || detected);
    onProgress({ stage: "time", pct: 1 });
    return { ...final, language: lang || detected || null, unsure: final.words.filter(w => w.u).length, doubleChecked: b.length > 0 };
  }

  return { run, LANGUAGES, langName, _test: { plan, stitch, reconcile, finish, norm, tidy } };
})();

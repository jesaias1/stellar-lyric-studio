"use strict";
/* Which part of the song to post: finds the 3 parts most likely to work as a TikTok / Reels sound.

   TikTok doesn't publish which part of a song people use (and a new song has no data yet), so the studio goes by
   what the viral sounds have in common and checks the song for each:
   - the hook: the part that comes back (the same chords and sound later in the song, and the same lyric lines)
   - energy: louder and fuller than the rest of the song
   - it hits right away: the clip starts on the vocal or on a lift in the music, not on a slow build
   - singing most of the way, whole lines, and an ending that loops back to the start
   - about 15 to 20 seconds long (the typical length of a sound that takes off)
   - the song title in it
   - the lyrics: an AI rates the best candidates' words for being quotable, relatable and caption-ready
     (src/hooks.js). Without it the audio decides alone.

   prepare(buf, words, opts) measures the song and scores every sensible clip (starts on a line or a change in
   the music, ends at the end of a line). shortlist() hands the best few to the AI, choose() picks 3 different
   ones and writes why. Exposes window.SLSSoundbites. */
window.SLSSoundbites = (() => {
  const SR = 11025, N = 4096, HOP = 0.25, BLK = 0.5;            // analysis rate, FFT size, frame step, block for repetition
  const W = { rep: 0.26, energy: 0.16, punch: 0.14, vocals: 0.10, loop: 0.06, len: 0.08, clean: 0.08, title: 0.04, ai: 0.14 };

  /* ---------- the song, measured ---------- */
  async function mono(buf){
    const n = Math.ceil(buf.duration * SR);
    try { const oc = new OfflineAudioContext(1, n, SR), src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start(); return (await oc.startRendering()).getChannelData(0); }
    catch {
      const ch = []; for(let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
      const step = buf.sampleRate / SR, out = new Float32Array(n);
      for(let i = 0; i < n; i++){ const k = Math.min(buf.length - 1, Math.floor(i * step)); let v = 0; for(const d of ch) v += d[k]; out[i] = v / ch.length; }
      return out;
    }
  }
  function fft(re, im){
    const n = re.length;
    for(let i = 1, j = 0; i < n; i++){ let bit = n >> 1; for(; j & bit; bit >>= 1) j ^= bit; j ^= bit; if(i < j){ [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for(let len = 2; len <= n; len <<= 1){
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for(let i = 0; i < n; i += len){ let cr = 1, ci = 0;
        for(let k = 0; k < len / 2; k++){ const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  // per 0.25 s: loudness (dB), chroma (which notes), and the spread over 8 frequency bands (the sound of the mix)
  function measure(x){
    const hop = Math.round(SR * HOP), n = Math.max(1, Math.floor((x.length - N) / hop) + 1);
    const win = new Float32Array(N); for(let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const hz = k => k * SR / N, kLo = Math.ceil(55 * N / SR), kHi = Math.floor(5000 * N / SR);
    const pc = new Int8Array(kHi + 1), band = new Int8Array(kHi + 1), EDGES = [55, 120, 250, 500, 1000, 2000, 3200, 4200, 5000];
    for(let k = kLo; k <= kHi; k++){ const f = hz(k); pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12; let b = 0; while(b < 7 && f >= EDGES[b + 1]) b++; band[k] = b; }
    const loud = new Float32Array(n), chroma = [], bands = [], re = new Float32Array(N), im = new Float32Array(N);
    for(let f = 0; f < n; f++){
      const a = f * hop; let e = 0;
      for(let i = 0; i < N; i++){ const v = x[a + i] || 0; e += v * v; re[i] = v * win[i]; im[i] = 0; }
      loud[f] = 10 * Math.log10(1e-10 + e / N);
      fft(re, im);
      const c = new Float32Array(12), bd = new Float32Array(8);
      for(let k = kLo; k <= kHi; k++){ const m = Math.hypot(re[k], im[k]); if(hz(k) >= 110 && hz(k) <= 4200) c[pc[k]] += Math.log1p(m * 10); bd[band[k]] += m * m; }
      let s = 0; for(let i = 0; i < 12; i++) s += c[i] * c[i]; s = Math.sqrt(s) || 1; for(let i = 0; i < 12; i++) c[i] /= s;
      for(let i = 0; i < 8; i++) bd[i] = Math.log10(1e-9 + bd[i]);
      chroma.push(c); bands.push(bd);
    }
    // the band spread is compared after taking away the song's average, so it says how this moment differs
    const mean = new Float32Array(8), sd = new Float32Array(8);
    for(const b of bands) for(let i = 0; i < 8; i++) mean[i] += b[i] / n;
    for(const b of bands) for(let i = 0; i < 8; i++) sd[i] += (b[i] - mean[i]) ** 2 / n;
    for(let i = 0; i < 8; i++) sd[i] = Math.sqrt(sd[i]) || 1;
    const vec = chroma.map((c, f) => { const v = new Float32Array(20); v.set(c); for(let i = 0; i < 8; i++) v[12 + i] = 0.6 * (bands[f][i] - mean[i]) / sd[i] / Math.sqrt(8); return v; });
    return { n, loud, vec };
  }
  const cos = (a, b) => { let x = 0, y = 0, z = 0; for(let i = 0; i < a.length; i++){ x += a[i] * b[i]; y += a[i] * a[i]; z += b[i] * b[i]; } return y && z ? x / Math.sqrt(y * z) : 0; };
  function avgVec(vs, a, b){ const out = new Float32Array(vs[0] ? vs[0].length : 20); let k = 0; for(let i = Math.max(0, a); i < Math.min(vs.length, b); i++){ for(let j = 0; j < out.length; j++) out[j] += vs[i][j]; k++; } if(k) for(let j = 0; j < out.length; j++) out[j] /= k; return out; }

  // how much each moment comes back later or earlier in the song: the same notes and sound for 6 s or more
  function repetition(vec){
    const per = Math.round(BLK / HOP), m = Math.floor(vec.length / per), blocks = [];
    for(let i = 0; i < m; i++) blocks.push(avgVec(vec, i * per, (i + 1) * per));
    const S = new Float32Array(m * m);
    for(let i = 0; i < m; i++) for(let j = i; j < m; j++){ const v = cos(blocks[i], blocks[j]); S[i * m + j] = v; S[j * m + i] = v; }
    const K = 12, MIN = 16, start = new Float32Array(m);   // 6 s windows, at least 8 s apart
    for(let i = 0; i + K <= m; i++){
      const lag = [];
      for(let j = 0; j + K <= m; j++){ if(Math.abs(i - j) < MIN) continue; let s = 0; for(let k = 0; k < K; k++) s += S[(i + k) * m + j + k]; lag.push([s / K, j]); }
      lag.sort((p, q) => q[0] - p[0]);
      const peaks = []; for(const [v, j] of lag){ if(peaks.every(p => Math.abs(p[1] - j) >= 8)) peaks.push([v, j]); if(peaks.length === 2) break; }
      start[i] = peaks.length ? peaks.reduce((a, p) => a + p[0], 0) / peaks.length : 0;
    }
    const at = new Float32Array(m); for(let i = 0; i < m; i++){ let x = 0; for(let o = 0; o < K; o++) if(i - o >= 0) x = Math.max(x, start[i - o]); at[i] = x; }
    const sorted = Array.from(at).sort((a, b) => a - b), lo = sorted[Math.floor(m * 0.5)] || 0, hi = sorted[Math.floor(m * 0.97)] || 1;
    return { per: BLK, rep: at.map(v => Math.max(0, Math.min(1, (v - lo) / Math.max(1e-4, hi - lo)))) };
  }

  /* ---------- lyrics ---------- */
  const norm = w => String(w).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
  function linesOf(words){
    const by = new Map(); for(const w of words){ if(!by.has(w.l)) by.set(w.l, []); by.get(w.l).push(w); }
    const L = [...by.values()].map(ws => ws.sort((a, b) => a.t - b.t)).sort((a, b) => a[0].t - b[0].t)
      .map(ws => ({ t0: ws[0].t, t1: ws[ws.length - 1].t + ws[ws.length - 1].d, text: ws.map(w => w.w).join(" "), toks: ws.map(w => norm(w.w)).filter(Boolean) }));
    const jac = (a, b) => { const A = new Set(a), B = new Set(b); let i = 0; for(const x of A) if(B.has(x)) i++; return i / Math.max(1, A.size + B.size - i); };
    L.forEach(x => { x.count = x.toks.length < 2 ? 1 : L.filter(y => y.toks.length >= 2 && (y === x || jac(x.toks, y.toks) >= 0.6)).length; });
    return L;
  }
  const STOP = new Set("the a an and or of to in on my me you i it is feat ft official audio video lyric lyrics master mix final version remix edit demo radio clean explicit wav mp3".split(" "));
  function titleToks(name){
    let t = String(name || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ");
    if(t.includes(" - ")) t = t.split(" - ").slice(1).join(" ");
    t = t.replace(/[\[(][^\])]*[\])]/g, " ").replace(/\b(feat|ft)\.?\b.*$/i, " ");
    return t.split(/\s+/).map(norm).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w) && !/^v\d+$/.test(w)).slice(0, 6);
  }

  /* ---------- every sensible clip, scored ---------- */
  async function prepare(buf, words = [], { title = "", ranges = null } = {}){
    const x = await mono(buf), dur = x.length / SR, F = measure(x), R = repetition(F.vec);
    words = (words || []).filter(w => w && w.w && isFinite(w.t)).slice().sort((a, b) => a.t - b.t);
    const lines = linesOf(words), tt = titleToks(title);
    // prefix sums to average anything over a stretch of time
    const pre = arr => { const p = new Float64Array(arr.length + 1); for(let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i]; return p; };
    const sortedLoud = Array.from(F.loud).sort((a, b) => a - b), rank = v => { let lo = 0, hi = sortedLoud.length; while(lo < hi){ const m = (lo + hi) >> 1; if(sortedLoud[m] <= v) lo = m + 1; else hi = m; } return lo / sortedLoud.length; };
    const pctArr = Array.from(F.loud, rank), Ppct = pre(pctArr), Ploud = pre(F.loud), Prep = pre(R.rep);
    const voc = new Float32Array(F.n); { const spans = []; for(const w of words){ const s = w.t, e = w.t + Math.max(0.1, w.d); if(spans.length && s - spans[spans.length - 1][1] < 0.6) spans[spans.length - 1][1] = Math.max(spans[spans.length - 1][1], e); else spans.push([s, e]); }
      for(const [s, e] of spans) for(let f = Math.max(0, Math.floor(s / HOP)); f < Math.min(F.n, Math.ceil(e / HOP)); f++) voc[f] = 1; }
    const Pvoc = pre(voc);
    const fi = t => Math.max(0, Math.min(F.n, Math.round(t / HOP))), bi = t => Math.max(0, Math.min(R.rep.length, Math.round(t / BLK)));
    const mean = (P, a, b) => b > a ? (P[b] - P[a]) / (b - a) : 0;
    const loudAt = (a, b) => mean(Ploud, fi(a), fi(b));
    // where the music changes (a new section): the sound 4 s before against the 4 s after, plus the lift in level
    const nov = new Float32Array(F.n), jumpAt = t => loudAt(t, t + 3) - loudAt(t - 3, t);
    for(let f = 16; f < F.n - 16; f++) nov[f] = (1 - cos(avgVec(F.vec, f - 16, f), avgVec(F.vec, f, f + 16))) + Math.max(0, (mean(Ploud, f, f + 12) - mean(Ploud, f - 12, f)) / 12);
    const novSorted = Array.from(nov).sort((a, b) => a - b), novHi = novSorted[Math.floor(F.n * 0.85)] || 0;
    const bounds = []; for(let f = 2; f < F.n - 2; f++) if(nov[f] > novHi && nov[f] >= nov[f - 1] && nov[f] >= nov[f + 1] && nov[f] >= nov[f - 2] && nov[f] >= nov[f + 2] && (!bounds.length || f * HOP - bounds[bounds.length - 1] > 4)) bounds.push(f * HOP);

    function score(a, b, extra = {}){
      const len = b - a, inW = lines.filter(L => L.t0 >= a - 0.05 && L.t0 < b - 0.3);
      const lyricRep = inW.length ? Math.min(1, inW.reduce((s, L) => s + (L.t1 - L.t0) * Math.min(1, (L.count - 1) / 2), 0) / Math.max(0.1, inW.reduce((s, L) => s + (L.t1 - L.t0), 0))) : 0;
      const audioRep = mean(Prep, bi(a), bi(b));
      const rep = words.length ? 0.6 * lyricRep + 0.4 * audioRep : audioRep;
      const energy = Math.max(0, Math.min(1, (mean(Ppct, fi(a), fi(b)) - 0.3) / 0.55));
      const first = words.find(w => w.t >= a - 0.05), lead = first ? first.t - a : 99;
      const vocalStart = !words.length ? 0 : lead <= 1.2 ? 1 : lead <= 3 ? 0.5 : 0;
      const jump = jumpAt(a), punch = words.length ? 0.55 * vocalStart + 0.45 * Math.max(0, Math.min(1, (jump + 1) / 7)) : Math.max(0, Math.min(1, (jump + 1) / 7));
      const vocals = words.length ? Math.min(1, mean(Pvoc, fi(a), fi(b)) / 0.6) : 0.5;
      const loop = Math.max(0, Math.min(1, (cos(avgVec(F.vec, fi(a), fi(a + 2)), avgVec(F.vec, fi(b - 2), fi(b))) - 0.7) / 0.28)) * 0.7 + 0.3 * Math.max(0, 1 - Math.abs(loudAt(a, a + 2) - loudAt(b - 2, b)) / 8);
      const lenS = extra.fixed ? 1 : Math.exp(-(((len - 17) / 7) ** 2));
      const cut = words.some(w => w.t < b - 0.08 && w.t + w.d > b + 0.12), midLine = lines.some(L => L.t0 < a - 0.1 && L.t1 > a + 0.4);
      const clean = !words.length ? 1 : 1 - (cut ? 0.5 : 0) - (midLine ? 0.5 : 0);
      const toks = words.filter(w => w.t >= a && w.t < b).map(w => norm(w.w));
      const title = tt.length && toks.join(" ").includes(tt.join(" ")) ? 1 : 0;
      const lineCount = inW.length ? Math.max(...inW.map(L => L.count)) : 0;
      const lateLift = Math.max(0, ...bounds.filter(t => t > a + len * 0.45 && t < b - 2).map(jumpAt));   // the music lifts in the second half: a build into a drop
      return { a: +a.toFixed(2), b: +b.toFixed(2), s: { rep, energy, punch, vocals, loop, len: lenS, clean, title }, info: { lyricRep, audioRep, lineCount, jump, lateLift, lead, toks, text: inW.map(L => L.text).join(" / ") } };
    }

    let cands = [];
    if(ranges && ranges.length){
      // the lyrics given are a part of the song (the hook): one candidate per time it's sung
      ranges.forEach((r, k) => { const a = Math.max(0, r.a - 0.3), b = Math.min(dur, r.b + 0.45); cands.push({ ...score(a, b, { fixed: true }), occ: k }); });
    } else {
      const starts = new Set();
      lines.forEach((L, i) => { const prevEnd = i ? lines[i - 1].t1 : 0; starts.add(+Math.max(prevEnd, L.t0 - 0.3, 0).toFixed(2)); });
      bounds.forEach(t => starts.add(+t.toFixed(2)));
      if(!words.length) for(let t = 0; t < dur - 8; t += 2) starts.add(t);
      for(const a of starts){
        if(a > dur - 6) continue;
        const ends = new Set();
        lines.forEach((L, i) => { const nx = lines[i + 1], e = Math.min(L.t1 + 0.45, nx ? nx.t0 - 0.05 : dur); if(e - a >= 9 && e - a <= 31) ends.add(+e.toFixed(2)); });
        bounds.forEach(t => { if(t - a >= 9 && t - a <= 31) ends.add(+t.toFixed(2)); });
        if(!ends.size) [15, 20].forEach(L => { if(a + L <= dur) ends.add(+(a + L).toFixed(2)); });
        for(const b of ends) cands.push(score(a, Math.min(dur, b)));
      }
    }
    cands.forEach((c, i) => { c.id = "c" + i; c.total = total(c); });
    cands.sort((p, q) => q.total - p.total);
    return { dur, cands, words, lines, ranges: ranges || null };
  }
  function total(c, useAI){
    let s = 0, w = 0; for(const k in c.s){ s += W[k] * c.s[k]; w += W[k]; }
    if(useAI && c.ai != null){ s += W.ai * c.ai; w += W.ai; }
    return s / w;
  }
  const overlap = (p, q) => Math.max(0, Math.min(p.b, q.b) - Math.max(p.a, q.a)) / Math.max(0.1, Math.min(p.b - p.a, q.b - q.a));
  const sameWords = (p, q) => { if(!p.info.toks.length || !q.info.toks.length) return false; const A = new Set(p.info.toks), B = new Set(q.info.toks); let i = 0; for(const x of A) if(B.has(x)) i++; return i / Math.max(1, Math.min(A.size, B.size)) > 0.6; };
  function pickDiverse(list, k){
    const out = [];
    for(const [ov, dupOk] of [[0.25, false], [0.25, true], [0.6, true]]){
      for(const c of list){ if(out.length >= k) break; if(out.includes(c)) continue;
        if(out.some(o => overlap(o, c) > ov || (!dupOk && sameWords(o, c)))) continue; out.push(c); }
      if(out.length >= k) break;
    }
    return out;
  }
  /* the best few different candidates, for the AI to read */
  function shortlist(ctx, k = 8){ return pickDiverse(ctx.cands, k).filter(c => c.info.text).map(c => ({ id: c.id, text: c.info.text.slice(0, 480), repeats: c.info.lineCount })); }

  /* ---------- the 3 to show ---------- */
  const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
  function choose(ctx, ai = null, k = 3){
    const byId = new Map((ai || []).map(x => [x.id, x]));
    ctx.cands.forEach(c => { const r = byId.get(c.id); if(r){ c.ai = r.score / 10; c.why = r.why; } c.final = total(c, !!byId.size); });
    // a candidate the AI didn't read is ranked as if it had an average lyric score
    if(byId.size) ctx.cands.forEach(c => { if(c.ai == null) c.final = (total(c, false) * (1 - W.ai) + W.ai * 0.45); });
    const list = ctx.cands.slice().sort((p, q) => q.final - p.final);
    const picks = ctx.ranges ? list.slice(0, k) : pickDiverse(list, k);
    const used = {};
    return picks.map(c => {
      const kind = kindOf(c, ctx);
      let label = LABEL[kind]; used[kind] = (used[kind] || 0) + 1; if(used[kind] > 1) label = AGAIN[kind] || label;
      if(ctx.ranges){ const n = ctx.ranges.length; label = c.occ === n - 1 && n > 2 ? "Hook, last time" : `Hook, ${ORD[c.occ] || (c.occ + 1) + "th"} time`; }
      return { a: c.a, b: c.b, score: Math.round(100 * Math.min(0.99, c.final)), label, kind, reasons: reasons(c, ctx), occ: c.occ ?? null };
    });
  }
  const LABEL = { hook: "The hook", drop: "The drop", build: "Build-up into the drop", quote: "The quotable line", peak: "The high point", verse: "The verse moment" };
  const AGAIN = { hook: "The other hook", drop: "The second drop", peak: "Another high point", quote: "Another quotable line", verse: "Another verse moment", build: "Another build-up" };
  function kindOf(c, ctx){
    const s = c.s;
    if(s.rep >= 0.55) return "hook";
    if(c.info.jump >= 4 && s.energy >= 0.55) return "drop";
    if(c.info.lateLift >= 4) return "build";
    if(c.ai != null && c.ai >= 0.7) return "quote";
    if(s.energy >= 0.6) return "peak";
    return "verse";
  }
  function reasons(c, ctx){
    const s = c.s, i = c.info, out = [], add = (w, t) => { if(t) out.push([w, t]); };
    if(c.why) add(0.2 + (c.ai || 0) * 0.3, c.why.replace(/\.$/, ""));
    if(i.lineCount >= 2 && i.lyricRep > 0.3) add(W.rep * s.rep + 0.05, `Its lines come back ${i.lineCount} times in the song`);
    else if(i.audioRep > 0.6) add(W.rep * s.rep, "This part comes back in the song: the bit people remember");
    if(s.energy >= 0.55) add(W.energy * s.energy, `Louder and fuller than ${Math.round((0.3 + 0.55 * s.energy) * 100)}% of the song`);
    if(i.lead <= 1.2) add(W.punch * s.punch + 0.02, "Starts right on the vocal, no slow build-up");
    else if(i.jump >= 3) add(W.punch * s.punch, "Starts on a lift in the music");
    if(i.lateLift >= 4) add(0.06, "Builds up and lands on the drop");
    if(s.title) add(0.07, "Has the song title in it");
    if(s.loop >= 0.7) add(W.loop * s.loop, "Loops smoothly back to the start");
    const len = Math.round(c.b - c.a); if(!ctx.ranges && s.len >= 0.75) add(W.len * s.len * 0.8, `${len} s, the typical length of a sound that takes off`);
    if(s.vocals >= 0.9 && ctx.words.length) add(W.vocals * 0.5, "Singing nearly all the way through");
    return out.sort((p, q) => q[0] - p[0]).slice(0, 3).map(p => p[1]);
  }

  /* everything in one go: measure, ask the AI about the best candidates (if it answers in time), pick 3 */
  async function find(buf, words, { title = "", ranges = null, lyrics = "", ask = null, timeout = 12000 } = {}){
    const ctx = await prepare(buf, words, { title, ranges });
    if(!ctx.cands.length) return { parts: [], ai: false };
    let ai = null;
    if(ask && words && words.length){
      const parts = ctx.ranges ? ctx.cands.slice(0, 6).map(c => ({ id: c.id, text: c.info.text.slice(0, 480), repeats: c.info.lineCount })) : shortlist(ctx, 8);
      if(parts.length > 1) try { ai = await Promise.race([ask({ title, lyrics: lyrics.slice(0, 3500), parts }), new Promise(r => setTimeout(() => r(null), timeout))]); } catch { ai = null; }
    }
    const scores = ai && Array.isArray(ai.scores) && ai.scores.length ? ai.scores : null;
    return { parts: choose(ctx, scores), ai: !!scores };
  }

  return { find, prepare, shortlist, choose, _test: { titleToks, linesOf, measure, repetition } };
})();

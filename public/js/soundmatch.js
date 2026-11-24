"use strict";
/* Finds where a TikTok sound sits in the song, so the video uses exactly the part people already know.

   The sound comes from a saved TikTok video (or its audio) or from a TikTok link the server could read. Both
   are turned into a sound fingerprint every 0.05 s (the shape of the spectrum in 24 bands plus which notes
   sound), and the sound's fingerprint is slid along the song's to find where they agree best: first roughly
   (every 0.2 s), then finely around the best places, then to 0.01 s on the attacks.

   match(songBuf, soundBuf) -> { ok, start, len, score, sure, lead, speed?, why? }
     start: where the sound starts in the song (s), len: how long it is (s, at most 60), sure: 0..1.
     speed: when it only fits sped up or slowed down (a "sped up" TikTok version), how much (e.g. 1.25).
   Exposes window.SLSSoundMatch. */
window.SLSSoundMatch = (() => {
  const SR = 11025, N = 2048, HOP = 0.05, NB = 24;

  async function mono(buf){
    const n = Math.ceil(buf.duration * SR);
    try { const oc = new OfflineAudioContext(1, n, SR), src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start();
      return (await Promise.race([oc.startRendering(), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 8000))])).getChannelData(0); }
    catch {
      const ch = []; for(let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
      const step = buf.sampleRate / SR, out = new Float32Array(n);
      for(let i = 0; i < n; i++){ const a = Math.floor(i * step), b = Math.min(buf.length, Math.max(a + 1, Math.floor((i + 1) * step))); let v = 0, k = 0; for(let j = a; j < b; j++){ for(const d of ch) v += d[j]; k++; } out[i] = k ? v / (k * ch.length) : 0; }
      return out;
    }
  }
  function fft(re, im){
    const n = re.length;
    for(let i = 1, j = 0; i < n; i++){ let bit = n >> 1; for(; j & bit; bit >>= 1) j ^= bit; j ^= bit; if(i < j){ [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for(let len = 2; len <= n; len <<= 1){ const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for(let i = 0; i < n; i += len){ let cr = 1, ci = 0;
        for(let k = 0; k < len / 2; k++){ const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  /* per 0.05 s: 24 bands (log energy, minus the frame's average: the sound's colour, whatever the volume) and 12
     note classes; plus the loudness, used to trim silence and to line up the attacks */
  async function features(x){
    const hop = Math.round(SR * HOP), n = Math.max(1, Math.floor((x.length - N) / hop) + 1);
    const win = new Float32Array(N); for(let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const kLo = Math.ceil(80 * N / SR), kHi = Math.floor(5000 * N / SR), band = new Int8Array(kHi + 1), pc = new Int8Array(kHi + 1);
    for(let k = kLo; k <= kHi; k++){ const f = k * SR / N; band[k] = Math.min(NB - 1, Math.floor(NB * Math.log(f / 80) / Math.log(5000 / 80))); pc[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12; }
    const B = new Float32Array(n * NB), C = new Float32Array(n * 12), loud = new Float32Array(n), flux = new Float32Array(n), re = new Float32Array(N), im = new Float32Array(N), prev = new Float64Array(NB);
    for(let f = 0; f < n; f++){
      if(f % 400 === 399) await tick();     // keep the page responsive on long songs
      const a = f * hop; let e = 0;
      for(let i = 0; i < N; i++){ const v = x[a + i] || 0; e += v * v; re[i] = v * win[i]; im[i] = 0; }
      loud[f] = 10 * Math.log10(1e-10 + e / N);
      fft(re, im);
      const bd = new Float64Array(NB), c = new Float64Array(12);
      for(let k = kLo; k <= kHi; k++){ const m2 = re[k] * re[k] + im[k] * im[k]; bd[band[k]] += m2; if(k * SR / N >= 110 && k * SR / N <= 4200) c[pc[k]] += Math.sqrt(m2); }
      // flux: how much louder each band got since the last frame, with near-silent bands floored (60 dB under the
      // loudest band) so compression noise in empty bands doesn't count
      let mean = 0, fl = 0, mx = 0; for(let i = 0; i < NB; i++) mx = Math.max(mx, bd[i]);
      for(let i = 0; i < NB; i++){ const lf = Math.log(1e-6 * mx + bd[i] + 1e-12); if(f) fl += Math.max(0, lf - prev[i]); prev[i] = lf; bd[i] = Math.log(1e-9 + bd[i]); mean += bd[i] / NB; }
      flux[f] = fl;
      for(let i = 0; i < NB; i++) B[f * NB + i] = bd[i] - mean;
      let s = 0; for(let i = 0; i < 12; i++) s += c[i] * c[i]; s = Math.sqrt(s) || 1; for(let i = 0; i < 12; i++) C[f * 12 + i] = c[i] / s;
    }
    return { n, B, C, loud, flux };
  }
  /* averaged over `per` frames (and normalised), for the rough pass */
  function pool(F, per){
    const m = Math.floor(F.n / per), D = NB + 12, V = new Float32Array(m * D);
    for(let j = 0; j < m; j++){
      for(let f = j * per; f < (j + 1) * per; f++){ for(let i = 0; i < NB; i++) V[j * D + i] += F.B[f * NB + i]; for(let i = 0; i < 12; i++) V[j * D + NB + i] += F.C[f * 12 + i] * 3; }
      norm(V, j * D, D);
    }
    return { m, D, V };
  }
  function norm(V, o, D){ let s = 0; for(let i = 0; i < D; i++) s += V[o + i] * V[o + i]; s = Math.sqrt(s) || 1; for(let i = 0; i < D; i++) V[o + i] /= s; }
  function frameVecs(F, rotate = 0){
    const D = NB + 12, V = new Float32Array(F.n * D);
    for(let f = 0; f < F.n; f++){ for(let i = 0; i < NB; i++) V[f * D + i] = F.B[f * NB + i]; for(let i = 0; i < 12; i++) V[f * D + NB + i] = F.C[f * 12 + ((i - rotate) % 12 + 12) % 12] * 3; norm(V, f * D, D); }
    return { m: F.n, D, V };
  }
  // how alike the sound (Q) is to the song (S) when the sound starts at song frame o: the average over the sound
  function simAt(S, Q, o, step = 1){
    const D = S.D; let s = 0, k = 0;
    for(let j = 0; j < Q.m; j += step){ const a = (o + j) * D, b = j * D; if(o + j >= S.m) break; let d = 0; for(let i = 0; i < D; i++) d += S.V[a + i] * Q.V[b + i]; s += d; k++; }
    return k ? s / k : -1;
  }
  // the part of the sound that isn't silence (a video can start or end quietly)
  function trim(F){
    let peak = -200; for(let f = 0; f < F.n; f++) peak = Math.max(peak, F.loud[f]);
    const gate = Math.max(-55, peak - 38); let a = 0, b = F.n - 1;
    while(a < F.n && F.loud[a] < gate) a++; while(b > a && F.loud[b] < gate) b--;
    return [a, b + 1];
  }
  function slice(F, a, b){ return { n: b - a, B: F.B.slice(a * NB, b * NB), C: F.C.slice(a * 12, b * 12), loud: F.loud.slice(a, b), flux: F.flux.slice(a, b) }; }
  // the sound played at another speed (a "sped up" or "slowed" version): frame i of it is song time i * rate
  function restretch(F, rate){
    const n = Math.floor(F.n * rate), out = { n, B: new Float32Array(n * NB), C: new Float32Array(n * 12), loud: new Float32Array(n), flux: new Float32Array(n) };
    for(let f = 0; f < n; f++){ const s = Math.min(F.n - 1, Math.floor(f / rate)); out.B.set(F.B.subarray(s * NB, s * NB + NB), f * NB); out.C.set(F.C.subarray(s * 12, s * 12 + 12), f * 12); out.loud[f] = F.loud[s]; out.flux[f] = Math.floor((f + 1) / rate) !== s ? F.flux[s] : 0; }
    return out;
  }

  // how well the attacks line up (Pearson correlation of the spectral flux), sharply peaked at the right spot
  function rhythmAt(SF, QF, o){
    const m = Math.min(QF.n, SF.n - o); if(m < 20) return -1;
    let sa = 0, sb = 0; for(let j = 0; j < m; j++){ sa += SF.flux[o + j]; sb += QF.flux[j]; } sa /= m; sb /= m;
    let xy = 0, xx = 0, yy = 0; for(let j = 0; j < m; j++){ const x = SF.flux[o + j] - sa, y = QF.flux[j] - sb; xy += x * y; xx += x * x; yy += y * y; }
    return xx && yy ? xy / Math.sqrt(xx * yy) : 0;
  }
  async function search(SF, QF, { rotate = 0 } = {}){
    const per = 4, Sp = pool(SF, per), Qp0 = pool(QF, per);
    if(rotate){ const D = Qp0.D; for(let j = 0; j < Qp0.m; j++){ const c = Qp0.V.slice(j * D + NB, j * D + D); for(let i = 0; i < 12; i++) Qp0.V[j * D + NB + i] = c[((i - rotate) % 12 + 12) % 12]; } }
    if(Qp0.m < 10 || Sp.m < Qp0.m) return null;
    const last = Sp.m - Qp0.m, scores = new Float32Array(last + 1);
    for(let o = 0; o <= last; o++){ scores[o] = simAt(Sp, Qp0, o); if(o % 300 === 299) await tick(); }
    // the background level: how alike any random place is
    const sorted = Array.from(scores).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
    let mad = 0; for(const v of sorted) mad += Math.abs(v - med); mad = Math.max(1e-3, mad / sorted.length);
    const tops = []; for(const o of Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a])){ if(tops.every(t => Math.abs(t - o) > 3)) tops.push(o); if(tops.length === 12) break; }
    // the attacks everywhere (cheap), so a steady song where every place sounds alike still finds the exact spot
    const lastF = SF.n - QF.n, rh = new Float32Array(Math.max(0, lastF + 1));
    for(let o = 0; o <= lastF; o++){ rh[o] = rhythmAt(SF, QF, o); if(o % 500 === 499) await tick(); }
    const rtops = []; for(const o of Array.from(rh.keys()).sort((a, b) => rh[b] - rh[a])){ if(rtops.every(t => Math.abs(t - o) > 6)) rtops.push(o); if(rtops.length === 12) break; }
    // fine pass around each candidate from either list
    const Sf = frameVecs(SF), Qf = frameVecs(QF, rotate), seen = new Set();
    let best = { o: 0, s: -2, c: -2, r: -1 };
    for(const c0 of [...tops.map(t => t * per), ...rtops]){ for(let o = Math.max(0, c0 - 8); o <= Math.min(Sf.m - Qf.m, c0 + 8); o++){ if(seen.has(o)) continue; seen.add(o);
      const s = simAt(Sf, Qf, o), r = rh[o] ?? rhythmAt(SF, QF, o), c = s + 0.3 * r; if(c > best.c) best = { o, s, c, r }; } }
    const second = tops.length > 1 ? scores[tops[1]] : med;
    return { o: best.o, score: best.s, rhythm: best.r, z: (scores[tops[0]] - med) / mad, gap: scores[tops[0]] - second };
  }

  // the attacks, every 0.01 s, to place the start exactly
  function onsets(x, a, b){
    const hop = Math.round(SR * 0.01), n = Math.max(0, Math.floor((b - a) / hop)), e = new Float32Array(n);
    let prev = 0; for(let f = 0; f < n; f++){ let s = 0; const st = a + f * hop; for(let i = 0; i < hop; i++){ const v = x[st + i] || 0; s += v * v; } const l = Math.log(1e-8 + s); e[f] = Math.max(0, l - prev); prev = l; }
    return e;
  }
  function refine(xs, xq, startS, leadS, lenS){
    const W = Math.min(lenS, 12), q = onsets(xq, Math.floor(leadS * SR), Math.floor((leadS + W) * SR));
    let best = 0, bs = -1;
    for(let d = -8; d <= 8; d++){ const t = startS + d * 0.01; if(t < 0) continue; const s = onsets(xs, Math.floor(t * SR), Math.floor((t + W) * SR)); let v = 0; for(let i = 0; i < Math.min(s.length, q.length); i++) v += s[i] * q[i]; if(v > bs){ bs = v; best = d; } }
    return startS + best * 0.01;
  }

  async function match(songBuf, soundBuf){
    const xs = await mono(songBuf), xq = await mono(soundBuf);
    const SF = await features(xs), QF0 = await features(xq), [a, b] = trim(QF0);
    const lead = a * HOP, QF = slice(QF0, a, Math.min(b, a + Math.round(60 / HOP)));
    // where the sound really begins, to 0.01 s (the 0.05 s frames overlap, so they see it a little early)
    let lead2 = lead; { let pk = 0; for(let i = 0; i < xq.length; i++) pk = Math.max(pk, Math.abs(xq[i])); const g = pk * 0.0126, hop = Math.round(SR * 0.01);   // 38 dB under the peak
      for(let i = Math.floor(lead * SR); i + hop < xq.length; i += hop){ let e = 0; for(let j = 0; j < hop; j++) e = Math.max(e, Math.abs(xq[i + j])); if(e > g){ lead2 = i / SR; break; } } }
    const len = QF.n * HOP;
    if(len < 3) return { ok: false, why: "short", len };
    if(len > songBuf.duration + 1) return { ok: false, why: "longer", len };
    let r = await search(SF, QF);
    // a real match is near-identical (0.9+); an unrelated sound scores near 0. When a part repeats exactly (the same
    // chorus copied), any copy is the same audio, so the first best one is fine.
    const good = r => r && r.rhythm > 0.35 && (r.score > 0.75 || (r.score > 0.55 && r.z > 4));
    if(good(r)){
      // how long the sound keeps matching the song (a saved TikTok video ends with TikTok's own outro)
      const Sf = frameVecs(SF), Qf = frameVecs(QF), D = Sf.D, d = new Float32Array(Qf.m);
      for(let j = 0; j < Qf.m && r.o + j < Sf.m; j++){ let v = 0; for(let i = 0; i < D; i++) v += Sf.V[(r.o + j) * D + i] * Qf.V[j * D + i]; d[j] = v; }
      const W = 20, sm = new Float32Array(Qf.m); for(let j = 0; j < Qf.m; j++){ let a = 0, k = 0; for(let q = Math.max(0, j - W / 2); q < Math.min(Qf.m, j + W / 2); q++){ a += d[q]; k++; } sm[j] = a / k; }
      const typical = Array.from(sm).sort((a, b) => a - b)[Math.floor(Qf.m / 2)], cut = Math.max(0.35, typical * 0.6);
      let lastOk = Qf.m - 1; while(lastOk > 0 && sm[lastOk] < cut) lastOk--;
      const kept = Math.min(len, (lastOk + 1 + W / 4) * HOP);
      const start = refine(xs, xq, r.o * HOP, lead, len) + (lead2 - lead), sure = Math.max(0, Math.min(1, Math.min((r.score - 0.55) / 0.35, (r.rhythm - 0.35) / 0.4)));
      return { ok: true, start: +Math.max(0, start).toFixed(2), len: +Math.min(60, kept - (lead2 - lead), songBuf.duration - start).toFixed(2), score: +r.score.toFixed(3), rhythm: +r.rhythm.toFixed(3), sure: +sure.toFixed(2), lead: +lead2.toFixed(2) };
    }
    // not found at the song's own speed: try the usual sped-up and slowed versions (pitch moves with the speed)
    for(const rate of [1.25, 1.2, 1.3, 1.15, 1.1, 1.35, 0.85, 0.8, 0.9]){
      const R = restretch(QF, rate), rot = -Math.round(12 * Math.log2(rate)), rr = await search(SF, R, { rotate: rot });
      if(good(rr)) return { ok: false, why: "speed", speed: rate, start: +(rr.o * HOP).toFixed(2), len: +(R.n * HOP).toFixed(2), score: +rr.score.toFixed(3) };
    }
    return { ok: false, why: "nomatch", score: r ? +r.score.toFixed(3) : 0, rhythm: r ? +(r.rhythm || 0).toFixed(3) : 0, z: r ? +r.z.toFixed(1) : 0, at: r ? r.o * HOP : 0 };
  }
  /* reads a dropped file (a video saved from TikTok, or audio) into sound */
  async function decode(file){
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    try { return await ac.decodeAudioData(await file.arrayBuffer()); } finally { ac.close && ac.close(); }
  }
  return { match, decode, _t: { mono, features, rhythmAt, trim, slice, frameVecs, simAt } };
})();

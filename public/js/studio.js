"use strict";
/* ============ helpers ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const fmt = s => { s = Math.max(0, s); const m = Math.floor(s/60); return m + ":" + (s - m*60).toFixed(1).padStart(4,"0"); };
function rng(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let toastTimer;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.hidden = true, 2600); }
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
/* the guided UI (js/app.js, js/lyrics.js) listens to these: "change" = the project changed, "pick" = a song file was chosen */
const HOOKS = {change:[], pick:[], step:[], vibe:[]};   // "vibe" = the song's vibe was read (js/vibe.js)
const slsOn = (k, f) => HOOKS[k].push(f);
const slsEmit = (k, ...a) => { for(const f of HOOKS[k]){ try { f(...a); } catch(err){ console.error(err); } } };
const ASPECTS = { "9:16":[720,1280], "4:5":[864,1080], "1:1":[1080,1080], "16:9":[1280,720], "5:4":[1080,864] };
/* The frame: one of the shapes above, or your own size written "1080x1350" (width x height in pixels).
   Your own size is exported exactly as typed (rounded to even numbers, which video needs). */
const SIZE_MIN = 240, SIZE_MAX = 4096, SIZE_RATIO = 4;   // each side 240 to 4096 px, at most 4 times wider than tall or the other way
const MIRROR = { "9:16":"16:9", "16:9":"9:16", "4:5":"5:4", "5:4":"4:5", "1:1":"1:1" };
const evenPx = n => Math.max(2, Math.round(n / 2) * 2);
function sizeProblem(w, h){
  if(!(w > 0) || !(h > 0)) return "Type a width and a height in pixels.";
  if(w < SIZE_MIN || h < SIZE_MIN) return `Each side needs at least ${SIZE_MIN} px.`;
  if(w > SIZE_MAX || h > SIZE_MAX) return `Each side can be at most ${SIZE_MAX} px.`;
  if(w / h > SIZE_RATIO || h / w > SIZE_RATIO) return `That's too long and thin: at most ${SIZE_RATIO} times wider than tall, or taller than wide.`;
  return "";
}
function customSize(a){ const m = /^(\d{2,4})x(\d{2,4})$/.exec(a || ""); if(!m) return null; const w = evenPx(+m[1]), h = evenPx(+m[2]); return sizeProblem(w, h) ? null : [w, h]; }
const aspectOK = a => !!ASPECTS[a] || !!customSize(a);
// the frame the editor works in: the shapes as listed; your own size scaled to about the same number of pixels as 9:16
function frameSize(a = S.P.aspect){
  if(ASPECTS[a]) return ASPECTS[a];
  const c = customSize(a); if(!c) return ASPECTS["9:16"];
  const k = Math.min(1, Math.sqrt(720 * 1280 / (c[0] * c[1]))); return [evenPx(c[0] * k), evenPx(c[1] * k)];
}
const frameKind = (a = S.P.aspect) => { const [w, h] = frameSize(a); return h > w * 1.15 ? "portrait" : w > h * 1.15 ? "landscape" : "square"; };
const isWide = (a = S.P.aspect) => { const [w, h] = frameSize(a); return w > h; };
// the nearest of the four classic shapes (for stock search, AI backgrounds and safe zones); exact: only a shape that matches within 1%
function aspectKey(a = S.P.aspect, exact = false){
  if(ASPECTS[a] && a !== "5:4") return a;
  const [w, h] = frameSize(a), r = Math.log(w / h);
  let best = "9:16", d = Infinity;
  for(const k of ["9:16", "4:5", "1:1", "16:9"]){ const [kw, kh] = ASPECTS[k], dk = Math.abs(Math.log(kw / kh) - r); if(dk < d){ d = dk; best = k; } }
  return exact && d > 0.01 ? null : best;
}
const aspectLabel = (a = S.P.aspect) => { const c = customSize(a); return c ? `Your size ${c[0]}×${c[1]}` : a; };

/* ============ state ============ */
const S = {
  audio:null, songName:"Demo track", peaks:null,
  P:null,                 // project (serialisable)
  clips:[], overrides:{}, cutStart:{}, // overrides: segIndex -> clip id
  playing:false, t:0, noOverlap:true, tool:"select", markers:null, locks:{hook:false, lyrics:false, cuts:false, audio:false}, vocal:"on", reduced:null, inst:null, instName:"",
  sel:null,               // {type:'word', i} | {type:'seg', i}
  tap:null, snap:true, zoom:1, auxBuf:{}, auxPk:{},
  exporting:null
};
function defaultProject(){
  return {
    v:1, song:{name:"Demo track", duration:25}, section:{a:2.5, b:17.5}, bites:[], bitesHook:false,
    bpm:96, offset:0, lyrics:"", words:[],
    style:{preset:"stack", size:1, x:0.5, y:0.5, scrim:0.25, color:"#ffffff", case:"auto", fonts:{}, his:{}, vars:{}},
    hook:{on:false, text:"New single out now", dur:3, start:0, look:"pill", font:"sans", size:1, x:0.5, y:0.09, color:"#ffffff", bg:"#0a090e", anim:"none"},
    cuts:{every:2, seed:7, mode:"beat", count:8, transition:"none", motion:"still"}, aspect:"9:16",
    tTracks:[{}], aux:[], mainVol:1, mainMute:false
  };
}

/* ============ audio ============ */
let actx = null, src = null, gain = null, startAt = 0, startT = 0, mainG = null, auxSrcs = [];
/* extra audio tracks play on top of the song, placed relative to the start of the soundbite */
function startAux(c, out, at, songT){ const lt = songT - S.P.section.a;
  (S.P.aux || []).forEach(a => { const buf = S.auxBuf[a.id]; if(!buf || a.mute) return; const off = lt - (a.start || 0); if(off >= buf.duration) return;
    const s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; g.gain.value = a.vol ?? 1; s.connect(g); g.connect(out);
    if(off < 0) s.start(at - off, 0); else s.start(at, off); auxSrcs.push(s); }); }
function restartAudio(){ if(S.playing && !S.exporting){ S.t = songTime(); play({}); } }
function ctx(){ if(!actx){ actx = new (window.AudioContext || window.webkitAudioContext)(); gain = actx.createGain(); gain.connect(actx.destination); } return actx; }
function bounds(){ return S.review && S.audio ? {a:0, b:S.audio.duration} : S.P.section; }
function songTime(){ return S.playing ? startT + (actx.currentTime - startAt) : S.t; }
function play(opts={}){
  if(!S.audio) return; ensureDemo();
  const c = ctx(); c.resume();
  stopSource();
  src = c.createBufferSource(); src.buffer = playBuffer();
  const out = opts.dest || gain; mainG = c.createGain(); mainG.gain.value = S.P.mainMute ? 0 : (S.P.mainVol ?? 1); src.connect(mainG); mainG.connect(out);
  const sec = bounds();
  if(S.t < sec.a || S.t >= sec.b - 0.02) S.t = sec.a;
  startAt = c.currentTime + 0.02; startT = S.t;
  src.start(startAt, S.t);
  startAux(c, out, startAt, S.t);
  S.playing = true; S.playDest = opts.dest || null;
  syncPlayIcon();
}
/* vocals: original, reduced (centre-channel removal with the low end kept), or a loaded instrumental */
function playBuffer(){
  if(S.vocal === "inst" && S.inst) return S.inst;
  if(S.vocal === "reduced" && S.reduced) return S.reduced;
  return S.audio;
}
async function makeReduced(buf){
  if(buf.numberOfChannels < 2) return null;
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length, sr = buf.sampleRate;
  const oc = new OfflineAudioContext(2, n, sr), mid = oc.createBuffer(1, n, sr), side = oc.createBuffer(1, n, sr), m = mid.getChannelData(0), sd = side.getChannelData(0);
  for(let i=0;i<n;i++){ m[i] = (L[i] + R[i])*0.5; sd[i] = (L[i] - R[i])*0.5; }
  const ms = oc.createBufferSource(); ms.buffer = mid; const lp = oc.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 170; lp.Q.value = 0.6;
  const lp2 = oc.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = 170; lp2.Q.value = 0.6;
  const ss = oc.createBufferSource(); ss.buffer = side; const gL = oc.createGain(), gR = oc.createGain(); gL.gain.value = 1.35; gR.gain.value = -1.35;
  const merge = oc.createChannelMerger(2);
  ms.connect(lp).connect(lp2); lp2.connect(merge, 0, 0); lp2.connect(merge, 0, 1);
  ss.connect(gL).connect(merge, 0, 0); ss.connect(gR).connect(merge, 0, 1);
  merge.connect(oc.destination); ms.start(); ss.start();
  const out = await oc.startRendering();
  // level-match to the original so the switch doesn't jump in loudness
  const rms = b => { let e = 0, c = 0; for(let ch=0; ch<b.numberOfChannels; ch++){ const d = b.getChannelData(ch); for(let i=0;i<d.length;i+=64){ e += d[i]*d[i]; c++; } } return Math.sqrt(e/Math.max(1,c)); };
  const g = Math.min(4, rms(buf)/Math.max(1e-6, rms(out))*0.9);
  for(let ch=0; ch<2; ch++){ const d = out.getChannelData(ch); for(let i=0;i<d.length;i++) d[i] = Math.max(-1, Math.min(1, d[i]*g)); }
  return out;
}
function syncVocalUI(){
  $$("#vocalMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === S.vocal)));
  const ib = $('#vocalMode [data-v="inst"]'); ib.textContent = S.inst ? "Instrumental ✓" : "Instrumental"; ib.title = S.inst ? `Using ${S.instName}. Shift-click to load a different file.` : "Load the instrumental file for this song";
}
async function setVocal(mode){
  if(mode === "reduced" && !S.reduced){
    if(S.audio.numberOfChannels < 2){ toast("This song is mono, so the vocals can't be separated. Load the instrumental instead."); return; }
    toast("Reducing vocals…"); await new Promise(r => setTimeout(r, 30));
    try { S.reduced = await makeReduced(S.audio); } catch { S.reduced = null; }
    if(!S.reduced){ toast("Couldn't reduce the vocals on this file"); return; }
  }
  if(mode === "inst" && !S.inst){ $("#instFile").click(); return; }
  const was = S.playing; S.vocal = mode; syncVocalUI();
  if(was && !S.exporting){ S.t = songTime(); play({}); }
  if(mode === "reduced") toast("Vocals reduced. Results vary by mix: it works best when the lead vocal sits in the centre.");
}
function stopSource(){ if(src){ try{ src.onended = null; src.stop(); }catch{} src.disconnect(); src = null; } auxSrcs.forEach(a => { try{ a.stop(); }catch{} a.disconnect(); }); auxSrcs = []; }
function pause(){ if(S.playing){ S.t = songTime(); } S.playing = false; stopSource(); syncPlayIcon(); pauseVideos(); }
function seek(t){
  const sec = bounds(); S.t = clamp(t, sec.a, sec.b);
  if(S.playing && !S.exporting){ play({}); }
}
function syncPlayIcon(){
  const icon = S.playing ? '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>' : '<path d="M4 2.5v11l9-5.5z"/>';
  $("#playIcon").innerHTML = icon; $("#playBtn").setAttribute("aria-label", S.playing ? "Pause" : "Play");
  const mp = document.getElementById("msheetPlay"); if(mp){ mp.firstElementChild.innerHTML = icon; mp.setAttribute("aria-label", S.playing ? "Pause" : "Play"); }
}

/* The sample song, "Faker" by aleksiah (js/demo-song.js): the editor starts with a silent buffer of the same length so
   the page loads fast, and the real audio (about 1 MB) is fetched the first time anyone opens the editor or presses
   play without a song of their own. It is copied into that same buffer, so nothing that holds S.audio has to change. */
let demoPending = null;
function silentDemo(){ const c = ctx(); return c.createBuffer(2, Math.ceil(SLS_DEMO.duration*c.sampleRate), c.sampleRate); }
function ensureDemo(){
  if(!demoPending) return;
  if(S.audio !== demoPending.buf){ demoPending = null; return; }   // a real song came in: never needed
  const { buf } = demoPending; demoPending = null;
  fetch(SLS_DEMO.url).then(r => { if(!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
    .then(ab => ctx().decodeAudioData(ab))
    .then(full => {
      if(S.audio !== buf) return;
      for(let ch = 0; ch < 2; ch++){ const d = full.getChannelData(Math.min(ch, full.numberOfChannels - 1)); buf.copyToChannel(d.length > buf.length ? d.subarray(0, buf.length) : d, ch); }
      S.peaks = computePeaks(buf); tlDirty = true; restartAudio();
    })
    .catch(() => { if(S.audio === buf) demoPending = { buf }; });   // offline or a hiccup: tried again on the next play
}

function computePeaks(buf, count=1400){
  const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length/count)), out = new Float32Array(count);
  for(let i=0;i<count;i++){ let m=0; const a=i*step, b=Math.min(d.length,a+step), st=Math.max(1,Math.floor(step/60)); for(let k=a;k<b;k+=st){ const v=Math.abs(d[k]); if(v>m) m=v; } out[i]=m; }
  let mx=0; for(const v of out) mx=Math.max(mx,v); if(mx>0) for(let i=0;i<count;i++) out[i]/=mx;
  return out;
}

/* tempo detection: onset envelope scored against a comb of beat positions */
function detectTempo(buf, from, len){
  const sr = buf.sampleRate, d = buf.getChannelData(0), hop = Math.floor(sr/200);
  const a = Math.floor(from*sr), b = Math.min(d.length, Math.floor((from+len)*sr));
  const env = []; let prev = 0;
  for(let i=a;i+hop<b;i+=hop){ let e=0; for(let k=i;k<i+hop;k+=2) e+=d[k]*d[k]; e=Math.log(1e-6+Math.sqrt(e/(hop/2))); env.push(Math.max(0,e-prev)); prev=e; }
  if(env.length < 600) return null;
  const fps = sr/hop; let best = -1, bestBpm = 0, bestPh = 0;
  const score = (bpm) => { const per = fps*60/bpm; let bs = -1, bp = 0;
    for(let ph=0; ph<per; ph+=1){ let s=0, n=0; for(let x=ph; x<env.length-1; x+=per){ const i=Math.round(x); s += env[i] + 0.5*(env[i+1]||0); n++; } s/=n; if(s>bs){ bs=s; bp=ph; } }
    return {s:bs, ph:bp}; };
  for(let bpm=70; bpm<=180; bpm+=0.5){ const r = score(bpm), w = 1 - 0.15*Math.abs(Math.log2(bpm/110)); if(r.s*w > best){ best = r.s*w; bestBpm = bpm; bestPh = r.ph; } }
  for(let bpm=bestBpm-0.5; bpm<=bestBpm+0.5; bpm+=0.1){ const r = score(bpm); if(r.s > best){ best = r.s; bestBpm = bpm; bestPh = r.ph; } }
  return { bpm: Math.round(bestBpm*10)/10, offset: Math.round((from + bestPh/fps)*1000)/1000 };
}

/* ============ beat grid & cuts ============ */
const beatLen = () => 60 / S.P.bpm;
function beatsIn(a,b){
  const bl = beatLen(), off = S.P.offset, out = [];
  for(let k=Math.ceil((a-off)/bl - 1e-6); ; k++){ const t = off + k*bl; if(t > b + 1e-6) break; out.push({t, k}); if(out.length > 4000) break; }
  return out;
}
/* where a dragged cut edge sticks: the start of a lyric line first, then a word, then the beat. Only when it's
   within a few pixels, so it never jumps far. Option/Alt drags freely. */
function snapCut(t){
  const px = 8 / Math.max(1e-6, xOf(1) - xOf(0)), cands = [];
  for(const L of lineStartsCached()) cands.push([L, "lyric line", 0]);
  for(const w of S.P.words) cands.push([w.t, "word", 1]);
  if(S.snap){ const g = beatLen()/2, off = S.P.offset, b = off + Math.round((t-off)/g)*g; cands.push([b, "beat", 2]); }
  let best = null;
  for(const [ct, why, pr] of cands){ const d = Math.abs(ct - t); if(d <= px * (pr === 0 ? 1.4 : 1) && (!best || pr < best.pr || (pr === best.pr && d < best.d))) best = { t: ct, why, pr, d }; }
  return best ? { t: best.t, why: "on " + best.why } : { t, why: "" };
}
let _lsKey = "", _ls = [];
function lineStartsCached(){ const k = S.P.words.length + ":" + (S.P.words[0] ? S.P.words[0].t : 0); if(k !== _lsKey){ _lsKey = k; _ls = lineGroups().map(L => L[0].t); } return _ls; }
function snapTime(t, div=2){
  if(!S.snap) return t;
  const g = beatLen()/div, off = S.P.offset;
  return off + Math.round((t-off)/g)*g;
}
/* "Follow the song": the pace comes from the song's energy (js/vibe.js). Calm songs hold each picture for a whole
   lyric line or longer and blend softly; lively ones cut on every other beat; intense ones on every beat. */
const FEEL = {
  calm: { kind: "lines", gap: 3.2, tr: "crossfade", xf: 0.9 },
  steady: { kind: "lines", gap: 1.8, tr: "crossfade", xf: 0.45 },
  lively: { kind: "beat", every: 2, tr: "none", xf: 0.25 },
  intense: { kind: "beat", every: 1, tr: "flash", xf: 0.18 },
};
const songEnergy = () => (S.P.vibe && S.P.vibe.v && S.P.vibe.v.energy) || "steady";
const feelCuts = () => FEEL[songEnergy()] || FEEL.steady;
function segments(){
  const feel = S.P.cuts.mode === "feel" ? feelCuts() : null;
  const mode = feel ? feel.kind : S.P.cuts.mode, gap = feel && feel.gap ? feel.gap : 0.6;
  const {a,b} = S.P.section, every = feel && feel.every ? feel.every : S.P.cuts.every, pts = [a];
  if(S.P.cuts.mode === "manual" && Array.isArray(S.P.cuts.points)){
    S.P.cuts.points.filter(t => t > a + 0.1 && t < b - 0.1).sort((x,y)=>x-y).forEach(t => { if(t > pts[pts.length-1] + 0.1) pts.push(t); });
    pts.push(b); const segs = []; for(let i=0;i<pts.length-1;i++) segs.push({a:pts[i], b:pts[i+1], i}); return segs;
  }
  if(mode === "lines"){   // a new picture or clip on every lyric line
    const starts = [...new Set(S.P.words.map(w => w.l))].map(l => Math.min(...S.P.words.filter(w => w.l === l).map(w => w.t))).sort((x,y)=>x-y);
    const lead = 0.12;   // change just before the line is sung, so the picture lands with the words
    starts.forEach(t => { const p = Math.max(a, t - lead); if(p > a + 0.4 && p < b - 0.4 && p > pts[pts.length-1] + gap) pts.push(p); });
    pts.push(b); const segs = []; for(let i=0;i<pts.length-1;i++) segs.push({a:pts[i], b:pts[i+1], i}); return segs;
  }
  if(mode === "count"){
    const n = clamp(Math.round(S.P.cuts.count||8), 1, 60), beats = beatsIn(a,b).map(x=>x.t).filter(t => t > a + 0.15 && t < b - 0.15);
    for(let k=1;k<n;k++){ const target = a + (b-a)*k/n; let best = target, bd = Infinity; for(const t of beats){ const d = Math.abs(t-target); if(d < bd){ bd = d; best = t; } }
      if(bd > beatLen()) best = target; if(best > pts[pts.length-1] + 0.12) pts.push(best); }
    pts.push(b); const segs = []; for(let i=0;i<pts.length-1;i++) segs.push({a:pts[i], b:pts[i+1], i}); return segs;
  }
  for(const bt of beatsIn(a,b)){ if(((bt.k % every)+every)%every===0 && bt.t > a + 0.08 && bt.t < b - 0.08) pts.push(bt.t); }
  pts.push(b);
  const segs = []; for(let i=0;i<pts.length-1;i++) segs.push({a:pts[i], b:pts[i+1], i});
  return segs;
}
let segCache = {key:"", segs:[], order:[]};
function toManualCuts(){ if(S.P.cuts.mode === "manual") return; const {segs} = segInfo(); S.P.cuts.points = segs.slice(1).map(x => Math.round(x.a*1000)/1000); S.P.cuts.mode = "manual"; syncCutUI(); }
/* per-clip settings on the timeline: which clip, where it starts inside the source (in) and its speed (sp) */
function materializeSlots(){ const {segs, order} = segInfo(); if(!S.P.cuts.slots || S.P.cuts.slots.length !== segs.length) S.P.cuts.slots = order.map(id => ({c:id, in:null, sp:1})); return S.P.cuts.slots; }
function slotOf(i){ const sl = S.P.cuts.slots; return sl && sl[i] ? sl[i] : {c:null, in:null, sp:1}; }
function setSlot(i, patch){ const sl = materializeSlots(); if(sl[i]) Object.assign(sl[i], patch); tlDirty = true; saveDraft(); }
function resetSlots(){ S.P.cuts.slots = null; }
function defaultIn(i, v){ return (i*1.7) % Math.max(0.1, (v && v.duration ? v.duration : 2) - 1); }
function resolvedIn(i){ const {order} = segInfo(), clip = S.clips.find(c => c.id === order[i]); const sl = slotOf(i); if(sl.in != null) return sl.in; return clip && clip.kind === "video" ? defaultIn(i, clip.el) : 0; }
function segInfo(){
  const pool = S.clips.filter(c=>c.on);
  const key = [S.P.section.a,S.P.section.b,S.P.bpm,S.P.offset,JSON.stringify(S.P.cuts),pool.map(c=>c.id).join(","),S.P.cuts.mode === "lines" || S.P.cuts.mode === "feel" ? S.P.words.map(w=>w.l+":"+w.t.toFixed(2)).join(",") : "",S.P.cuts.mode === "feel" ? songEnergy() : ""].join("|");
  if(key === segCache.key) return segCache;
  const segs = segments(), r = rng(S.P.cuts.seed), order = [];
  if(S.P.cuts.slots && S.P.cuts.slots.length !== segs.length) S.P.cuts.slots = null;   // the cut layout changed: fall back to the automatic order
  const slots = S.P.cuts.slots;
  let bag = [], last = null;
  for(let i=0;i<segs.length;i++){
    if(!pool.length){ order.push(null); continue; }
    if(S.P.cuts.order === "inorder"){ let id = pool[i % pool.length].id; if(slots && slots[i] && slots[i].c && S.clips.find(c=>c.id===slots[i].c)) id = slots[i].c; order.push(id); last = id; continue; }
    if(!bag.length){ bag = pool.map(c=>c.id); for(let j=bag.length-1;j>0;j--){ const k=Math.floor(r()*(j+1)); [bag[j],bag[k]]=[bag[k],bag[j]]; } if(bag.length>1 && bag[0]===last) bag.push(bag.shift()); }
    let id = bag.shift();
    if(slots && slots[i] && slots[i].c && S.clips.find(c=>c.id===slots[i].c)) id = slots[i].c;
    order.push(id); last = id;
  }
  segCache = {key, segs, order};
  return segCache;
}

/* ============ lyrics ============ */
function parseLyrics(text){
  const out = [];
  text.split(/\n/).map(l=>l.trim()).filter(Boolean).forEach((line, li) => line.split(/\s+/).forEach(w => out.push({w, l:li, t:0, d:0.3})));
  return out;
}
function autoSpace(words){
  if(!words.length) return;
  const {a,b} = S.P.section, lines = Math.max(...words.map(w=>w.l))+1, span = (b-a)/lines;
  for(let li=0; li<lines; li++){
    const lw = words.filter(w=>w.l===li); if(!lw.length) continue;
    const la = a + li*span + span*0.04, lb = a + (li+1)*span - span*0.12, step = (lb-la)/lw.length;
    lw.forEach((w,k) => { w.t = snapTime(la + k*step, 2); w.d = Math.max(0.12, step*0.9); });
    lw.forEach((w,k) => { const n = lw[k+1]; if(n && w.t + w.d > n.t - 0.03) w.d = Math.max(0.08, n.t - w.t - 0.03); });
  }
  sortWords();
}
function sortWords(){ S.P.words.sort((x,y)=>x.t-y.t); }
function lyricState(t){
  const ws = S.P.words; if(!ws.length) return null;
  const lines = new Map();
  for(const w of ws){ if(!lines.has(w.l)) lines.set(w.l, []); lines.get(w.l).push(w); }
  const arr = [...lines.values()].map(l => l.sort((x,y)=>x.t-y.t)).sort((x,y)=>x[0].t-y[0].t);
  for(let k=arr.length-1;k>=0;k--){
    const L = arr[k], start = L[0].t;
    if(t < start) continue;
    const next = arr[k+1] ? arr[k+1][0].t : Infinity, last = L[L.length-1];
    const end = Math.min(next, last.t + last.d + 0.7);
    if(t >= end) return null;
    let rev = 0, act = -1;
    L.forEach((w,i) => { if(w.t <= t){ rev = i+1; if(t < w.t + w.d) act = i; } });
    return {words:L, start, end, rev, act, fade: clamp((end - t)/0.18, 0, 1) * clamp((t - start)/0.06 + .4, 0, 1)};
  }
  return null;
}

/* ============ text styles ============ */
const FONTS = {
  narrow:'"Archivo Narrow", "Arial Narrow", sans-serif', anton:'Anton, Impact, "Arial Narrow", sans-serif',
  sans:'"Instrument Sans", system-ui, sans-serif', serif:'"Instrument Serif", Georgia, serif',
  mono:'"JetBrains Mono", Menlo, monospace', round:'Unbounded, "Arial Black", sans-serif', black:'"Archivo Black", "Arial Black", sans-serif'
};
function caseOf(st, def, s){ const c = st.case === "auto" ? def : st.case; return c === "upper" ? s.toUpperCase() : c === "lower" ? s.toLowerCase() : s; }
function layoutWords(c, texts, maxW){
  const sp = c.measureText(" ").width, items = texts.map(s => ({s, w:c.measureText(s).width, x:0, line:0}));
  let line = 0, x = 0;
  for(const it of items){ if(x > 0 && x + it.w > maxW){ line++; x = 0; } it.x = x; it.line = line; x += it.w + sp; }
  const widths = []; for(const it of items) widths[it.line] = it.x + it.w;
  if(/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(texts.join(""))) for(const it of items) it.x = widths[it.line] - it.x - it.w;
  return {items, lines: line+1, widths};
}
function fitPx(c, font, px, texts, maxW){
  c.font = font(px); let mx = 0; for(const s of texts) mx = Math.max(mx, c.measureText(s).width);
  return mx > maxW ? px * maxW / mx : px;
}
const ease = x => 1 - Math.pow(1 - clamp(x,0,1), 3);

/* ============ lyric styles ============
   Every style draws at size 1, centred on (W/2, cy). renderFrame zooms it around that point, so Size never shifts the layout.
   o = {pf, sf, hi, tx, v}: primary font, secondary font, highlight colour, text colour, variation number. */
const FONTLIB = {
  sixcaps:{name:"Six Caps", css:'"Six Caps", "Arial Narrow", sans-serif', w:"400"},
  anton:{name:"Anton", css:'Anton, Impact, sans-serif', w:"400"},
  bebas:{name:"Bebas Neue", css:'"Bebas Neue", Impact, sans-serif', w:"400"},
  oswald:{name:"Oswald", css:'Oswald, "Arial Narrow", sans-serif', w:"600"},
  barlow:{name:"Barlow Condensed", css:'"Barlow Condensed", "Arial Narrow", sans-serif', w:"800"},
  barlowi:{name:"Barlow Condensed Italic", css:'"Barlow Condensed", "Arial Narrow", sans-serif', w:"800", i:"italic"},
  shoulders:{name:"Big Shoulders", css:'"Big Shoulders Display", Impact, sans-serif', w:"800"},
  narrow:{name:"Archivo Narrow", css:'"Archivo Narrow", "Arial Narrow", sans-serif', w:"500"},
  black:{name:"Archivo Black", css:'"Archivo Black", "Arial Black", sans-serif', w:"400"},
  poppins:{name:"Poppins Bold", css:'Poppins, system-ui, sans-serif', w:"700"},
  sans:{name:"Instrument Sans", css:'"Instrument Sans", system-ui, sans-serif', w:"700"},
  sansi:{name:"Instrument Sans Italic", css:'"Instrument Sans", system-ui, sans-serif', w:"600", i:"italic"},
  light:{name:"Inter Tight Light", css:'"Inter Tight", system-ui, sans-serif', w:"300"},
  doh:{name:"Do Hyeon", css:'"Do Hyeon", system-ui, sans-serif', w:"400"},
  unbounded:{name:"Unbounded", css:'Unbounded, "Arial Black", sans-serif', w:"800"},
  serif:{name:"Instrument Serif", css:'"Instrument Serif", Georgia, serif', w:"400"},
  serifi:{name:"Instrument Serif Italic", css:'"Instrument Serif", Georgia, serif', w:"400", i:"italic"},
  playfair:{name:"Playfair Italic", css:'"Playfair Display", Georgia, serif', w:"500", i:"italic"},
  mono:{name:"JetBrains Mono", css:'"JetBrains Mono", Menlo, monospace', w:"600"}
};
const fnt = (k, px) => { const f = FONTLIB[k] || FONTLIB.sans; return `${f.i || "normal"} ${f.w} ${Math.max(1, px).toFixed(1)}px ${f.css}`; };
const HI_SWATCHES = ["#ff2d3a", "#ffe14a", "#ff4f8b", "#38d6ff", "#ffffff"];
function fitK(c, k, texts, maxW, px){ c.font = fnt(k, px); let m = 0; for(const s of texts) m = Math.max(m, c.measureText(s).width); return m > maxW ? px*maxW/m : px; }
function curWord(s, t){ const i = Math.max(0, s.rev - 1), w = s.words[i]; return {i, w, age: t - w.t, prev: s.words[i-1], next: s.words[i+1]}; }
const pop = (age, dur=0.14, amt=0.2) => 1 + amt*(1 - ease(age/dur));
const overshoot = x => { x = clamp(x,0,1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3*Math.pow(x-1,3) + c1*Math.pow(x-1,2); };
function setLS(c, px){ if("letterSpacing" in c) c.letterSpacing = px.toFixed(1) + "px"; }
// lays out the whole line once so words never jump as they appear; each(it, i, x, y, px)
function lineLayout(c, W, H, s, st, o, opt){
  const texts = s.words.map(w => caseOf(st, opt.caseDef, w.w)), font = opt.font || o.pf, maxW = W*(opt.maxW || 0.84);
  const px = fitK(c, font, texts, maxW, H*opt.px); c.font = fnt(font, px);
  const lay = layoutWords(c, texts, maxW), lh = px*(opt.lh || 1.2), top = cy(H,st) - lay.lines*lh/2;
  lay.items.forEach((it, i) => { const x = opt.align === "left" ? (W - maxW)/2 + it.x : (W - lay.widths[it.line])/2 + it.x; opt.each(it, i, x, top + it.line*lh, px, lh); });
  return {px, lay};
}
let _off = null; const offCanvas = (w,h) => { if(!_off) _off = document.createElement("canvas"); if(_off.width < w || _off.height < h){ _off.width = Math.max(_off.width, w); _off.height = Math.max(_off.height, h); } const g = _off.getContext("2d"); g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,_off.width,_off.height); return [_off, g]; };

const PRESETS = [
  { id:"none", name:"None", cat:"minimal", demo:"", def:{pf:"sans", hi:"#ffffff"}, draw(){} },

  { id:"line", name:"Line", cat:"minimal", caseDef:"as", demo:"me ne sono andato", def:{pf:"sans", hi:"#f3ecb0"},
    draw(c,W,H,s,t,st,o){
      const txt = s.words.map(w => caseOf(st,"as",w.w)).join(" "), px = fitK(c, o.pf, [txt], W*0.86, Math.min(W,H)*0.058), k = ease((t - s.start)/0.18);
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha *= k; c.fillStyle = o.tx; c.fillText(txt, W/2, cy(H,st));
  }},

  { id:"stack", name:"Brat", cat:"minimal", caseDef:"lower", demo:"it's gorgeous she think i'm flying too high", def:{pf:"narrow", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      const texts = s.words.map(w => caseOf(st,"lower",w.w)), maxW = W*0.8, px = fitK(c, o.pf, texts, maxW, H*0.074); c.font = fnt(o.pf, px);
      const sp = c.measureText(" ").width, lay = layoutWords(c, texts, maxW), lh = px*1.02;
      const natural = Math.max(...lay.widths), blockW = lay.lines > 1 ? Math.max(natural, maxW*0.92) : natural, blockH = lay.lines*lh;
      for(let ln=0; ln<lay.lines; ln++){ const row = lay.items.filter(it => it.line === ln), used = row.reduce((a,it)=>a+it.w,0);
        const gap = row.length > 1 && lay.lines > 1 ? (blockW - used)/(row.length-1) : sp; let x = row.length === 1 && lay.lines > 1 ? (blockW - used)/2 : 0; row.forEach(it => { it.jx = x; x += it.w + gap; }); }
      const y0 = cy(H,st) - blockH/2, x0 = (W - blockW)/2;
      c.textBaseline = "top"; c.filter = `blur(${(px*0.012).toFixed(2)}px)`;
      lay.items.forEach((it,i) => { if(i >= s.rev) return; c.fillStyle = i === s.act ? o.tx : o.tx; c.save(); c.globalAlpha *= i === s.rev-1 ? 1 : 0.78; c.fillText(it.s, x0 + it.jx, y0 + it.line*lh); c.restore(); });
      c.filter = "none";
  }},

  { id:"whisper", name:"Whisper", cat:"minimal", caseDef:"lower", demo:"she never gave me a warning (warning)", def:{pf:"sansi", hi:"#ffe14a"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "top";
      lineLayout(c, W, H, s, st, o, {caseDef:"lower", px:0.03, maxW:0.7, lh:1.35, each(it,i,x,y){ if(i >= s.rev) return; const k = ease((t - s.words[i].t)/0.25);
        c.save(); c.globalAlpha *= k; c.fillStyle = o.hi; c.fillText(it.s, x, y + (1-k)*4); c.restore(); }});
  }},

  { id:"quiet", name:"Quiet", cat:"minimal", caseDef:"upper", demo:"warning", def:{pf:"poppins", hi:"#9a9a9a"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, ["(" + txt + ")"], W*0.8, H*0.055);
      const sp = px*0.45*(1 - ease(age/0.35)); c.font = fnt(o.pf, px); setLS(c, sp); c.textBaseline = "middle"; c.textAlign = "left";
      const pw = c.measureText("(").width, tw = c.measureText(txt).width, cw = c.measureText(")").width, total = pw + tw + cw + px*0.12, x = (W - total)/2, y = cy(H,st);
      c.globalAlpha *= ease(age/0.2);
      c.fillStyle = o.hi; c.fillText("(", x, y); c.fillText(")", x + pw + tw + px*0.12, y);
      c.fillStyle = o.tx; c.fillText(txt, x + pw + px*0.06, y); setLS(c, 0);
  }},

  { id:"afterglow", name:"Afterglow", cat:"minimal", caseDef:"lower", demo:"gorgeous", def:{pf:"light", hi:"#ffb48a"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "top";
      lineLayout(c, W, H, s, st, o, {caseDef:"lower", px:0.06, maxW:0.8, lh:1.15, each(it,i,x,y,px){ if(i >= s.rev) return; const k = ease((t - s.words[i].t)/0.5), on = i === s.rev-1;
        c.save(); c.globalAlpha *= k; c.shadowColor = o.hi; c.shadowBlur = px*(on ? 0.7 : 0.25);
        const g = c.createLinearGradient(x, y, x, y + px); g.addColorStop(0, o.tx); g.addColorStop(1, on ? o.hi : o.tx); c.fillStyle = g; c.fillText(it.s, x, y); c.restore(); }});
  }},

  { id:"soft", name:"Soft Spoken", cat:"minimal", caseDef:"lower", demo:"signs and ignored", def:{pf:"serifi", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "top"; c.shadowColor = "rgba(0,0,0,.35)";
      lineLayout(c, W, H, s, st, o, {caseDef:"lower", px:0.07, maxW:0.8, lh:1.12, each(it,i,x,y,px){ if(i >= s.rev) return; const k = ease((t - s.words[i].t)/0.4);
        c.save(); c.globalAlpha *= k; c.shadowBlur = px*0.3; c.fillStyle = o.tx; c.fillText(it.s, x, y + (1-k)*px*0.25); c.restore(); }});
      c.shadowBlur = 0;
  }},

  { id:"margin", name:"Margin", cat:"minimal", caseDef:"lower", demo:"warning", def:{pf:"oswald", hi:"#2f6bff"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "top";
      lineLayout(c, W, H, s, st, o, {caseDef:"lower", px:0.085, maxW:0.8, lh:1.0, align:"left", each(it,i,x,y,px){ if(i >= s.rev) return; const on = i === s.rev-1, k = ease((t - s.words[i].t)/0.18);
        c.save(); c.globalAlpha *= k; const g = c.createLinearGradient(0, y, 0, y + px*1.1); g.addColorStop(0, on ? "#cfe0ff" : o.tx); g.addColorStop(1, on ? o.hi : o.tx);
        c.fillStyle = g; c.globalAlpha *= on ? 1 : 0.55; c.fillText(it.s, x - (1-k)*px*0.3, y); c.restore(); }});
  }},

  { id:"relay", name:"Relay", cat:"minimal", caseDef:"upper", demo:"she never gave me a warning", def:{pf:"sans", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      const yc = cy(H,st), bh = H*0.2, k = ease((t - s.start)/0.35);
      c.save(); c.globalAlpha *= 0.92;
      bandFill(c, W, yc - bh*0.6, bh*1.2, k, (y0, y1) => { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, o.hi); g.addColorStop(0.55, o.hi); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; }); c.restore();
      c.textBaseline = "top"; setLS(c, H*0.002);
      lineLayout(c, W, H, s, st, o, {caseDef:"upper", px:0.022, maxW:0.8, lh:1.5, each(it,i,x,y){ if(i >= s.rev) return; c.fillStyle = i === s.rev-1 ? "#222" : "#777"; c.fillText(it.s, x, y - H*0.03); }});
      setLS(c, 0);
  }},

  { id:"airplay", name:"Airplay", cat:"minimal", caseDef:"upper", demo:"ignored", def:{pf:"bebas", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.86, H*0.13), k = ease(age/0.16);
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; const y = cy(H,st) + (1-k)*H*0.06;
      for(let g=3; g>=1; g--){ c.save(); c.globalAlpha *= 0.12*(1-k); c.fillStyle = o.tx; c.fillText(txt, W/2, y + g*H*0.012); c.restore(); }
      c.fillStyle = o.tx; c.globalAlpha *= 0.3 + 0.7*k; c.fillText(txt, W/2, y);
  }},

  { id:"karaoke", name:"Karaoke", cat:"minimal", caseDef:"as", demo:"neon on the water", def:{pf:"sans", hi:"#ffe14a"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "top";
      lineLayout(c, W, H, s, st, o, {caseDef:"as", px:0.052, maxW:0.84, lh:1.25, each(it,i,x,y,px){
        c.fillStyle = o.tx; c.save(); c.globalAlpha *= 0.38; c.fillText(it.s, x, y); c.restore();
        if(i < s.rev){ const w = s.words[i], p = i === s.act ? clamp((t-w.t)/Math.min(w.d,0.5),0,1) : 1;
          c.save(); c.beginPath(); c.rect(x-2, y-px*0.2, (it.w+4)*p, px*1.6); c.clip(); c.fillStyle = o.hi; c.fillText(it.s, x, y); c.restore(); } }});
  }},

  { id:"typewriter", name:"Typewriter", cat:"minimal", caseDef:"lower", demo:"under the city glow", def:{pf:"mono", hi:"#ffe14a"},
    draw(c,W,H,s,t,st,o){
      let cx = W/2, cyy = cy(H,st); c.textBaseline = "top";
      lineLayout(c, W, H, s, st, o, {caseDef:"lower", px:0.042, maxW:0.8, lh:1.45, each(it,i,x,y,px){ if(i >= s.rev) return; const w = s.words[i];
        const n = i === s.rev-1 ? Math.ceil(it.s.length * clamp((t-w.t)/Math.min(0.35, w.d), 0, 1)) : it.s.length, part = it.s.slice(0, Math.max(1,n));
        c.fillStyle = o.tx; c.fillText(part, x, y); cx = x + c.measureText(part).width; cyy = y; }});
      const px = H*0.042; if(Math.floor(t*2.5)%2===0){ c.fillStyle = o.hi; c.fillRect(cx + px*0.12, cyy, px*0.55, px*1.1); }
  }},

  { id:"redline", name:"Redline", cat:"bold", caseDef:"upper", demo:"'em", def:{pf:"anton", hi:"#ff2d3a"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.9, H*0.2), k = pop(age, 0.12, 0.18);
      c.save(); c.translate(W/2, cy(H,st)); c.scale(k,k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "rgba(0,0,0,.45)"; c.fillText(txt, px*0.03, px*0.05); c.fillStyle = o.hi; c.fillText(txt, 0, 0);
      c.globalAlpha *= 0.25; c.fillRect(-W*0.4, px*0.62, W*0.8*ease(age/0.3), Math.max(2, px*0.03)); c.restore();
  }},

  { id:"overdrive", name:"Overdrive", cat:"bold", caseDef:"upper", demo:"body", def:{pf:"black", hi:"#5cff7a"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.92, H*0.17), k = pop(age, 0.1, 0.12);
      c.save(); c.translate(W/2, cy(H,st)); c.scale(k,k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = o.tx; c.fillText(txt, 0, 0);
      const tw = c.measureText(txt).width, r = px*0.07;
      [[o.hi, -0.32], ["#ffffff", 0.48]].forEach(([col, f], j) => { const a = t*3 + j*2.2; c.fillStyle = col; c.beginPath(); c.arc(tw*f + Math.cos(a)*px*0.05, -px*0.72 + Math.sin(a)*px*0.05, r, 0, Math.PI*2); c.fill(); });
      c.restore();
  }},

  { id:"pop", name:"Pop", cat:"bold", caseDef:"upper", demo:"rewarded", def:{pf:"barlow", hi:"#ffe100"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.84, H*0.11), k = 0.6 + 0.4*overshoot(age/0.22);
      c.save(); c.translate(W/2, cy(H,st)); c.scale(k,k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
      c.fillStyle = "rgba(0,0,0,.55)"; c.fillText(txt, px*0.04, px*0.06); c.lineWidth = px*0.09; c.strokeStyle = "#151515"; c.strokeText(txt, 0, 0); c.fillStyle = o.hi; c.fillText(txt, 0, 0); c.restore();
  }},

  { id:"rails", name:"Rails", cat:"bold", caseDef:"upper", demo:"think", def:{pf:"sixcaps", sf:"doh", hi:"#ff2d3a"},
    draw(c,W,H,s,t,st,o){
      const {w, age, prev} = curWord(s,t), txt = caseOf(st,"upper",w.w), small = txt.replace(/[^\p{L}]/gu,"").length <= 2, font = small ? o.sf : o.pf;
      const px = fitK(c, font, [txt], W*0.86, H*(small ? 0.14 : 0.42)); c.textAlign = "center"; c.textBaseline = "middle"; const y = cy(H,st);
      if(prev){ const pt = caseOf(st,"upper",prev.w); c.font = fnt(o.pf, fitK(c, o.pf, [pt], W*0.86, H*0.42)); c.save(); c.globalAlpha *= 0.12*(1 - ease(age/0.4)); c.fillStyle = o.tx; c.fillText(pt, W/2, y); c.restore(); }
      c.font = fnt(font, px); const sy = 1 + 0.08*(1 - ease(age/0.18));
      c.save(); c.translate(W/2, y); c.scale(1, sy); if(age < 0.09){ c.fillStyle = o.hi; c.fillText(txt, 0, 0); } else { c.fillStyle = o.tx; c.fillText(txt, 0, 0); } c.restore();
  }},

  { id:"ladder", name:"Ladder", cat:"bold", caseDef:"upper", demo:"rewarded", def:{pf:"anton", hi:"#ff2d3a"},
    draw(c,W,H,s,t,st,o){
      const {i, w, age} = curWord(s,t), y = cy(H,st), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.86, H*0.12), k = ease(age/0.14);
      c.textAlign = "center"; c.textBaseline = "middle";
      for(let r=1; r<=2; r++){ const pw = s.words[i-r]; if(!pw) continue; const pt = caseOf(st,"upper",pw.w), ppx = fitK(c, o.pf, [pt], W*0.6, px*0.42);
        c.save(); c.font = fnt(o.pf, ppx); c.globalAlpha *= r === 1 ? 0.45 : 0.2; c.fillStyle = o.tx; c.fillText(pt, W/2, y - px*(0.62 + r*0.48) - (1-k)*px*0.15); c.restore(); }
      c.font = fnt(o.pf, px); c.fillStyle = o.hi; c.fillText(txt, W/2, y + (1-k)*px*0.25); c.fillStyle = o.tx; c.fillRect(W/2 - px*0.12, y - px*0.03, px*0.24, Math.max(2, px*0.06));
  }},

  { id:"bracket", name:"Bracket", cat:"bold", caseDef:"upper", demo:"warning", def:{pf:"bebas", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = "[" + caseOf(st,"upper",w.w) + "]", px = fitK(c, o.pf, [txt], W*0.86, H*0.12), k = ease(age/0.2);
      c.save(); c.translate(W/2 + (1-k)*W*0.35, cy(H,st)); c.transform(1, 0, -0.25*(1-k), 1, 0, 0); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = o.hi; c.globalAlpha *= 0.4 + 0.6*k; c.fillText(txt, 0, 0); c.restore();
  }},

  { id:"voltage", name:"Voltage", cat:"bold", caseDef:"upper", demo:"rewarded", def:{pf:"oswald", hi:"#38d6ff"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.84, H*0.1);
      const flick = age < 0.25 ? (Math.sin(age*90) > -0.2 ? 1 : 0.25) : 0.92 + 0.08*Math.sin(t*20);
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha *= flick;
      c.shadowColor = o.hi; c.shadowBlur = px*0.5; c.fillStyle = o.hi; c.fillText(txt, W/2, cy(H,st)); c.shadowBlur = px*0.15; c.fillStyle = "#eaffff"; c.globalAlpha *= 0.35; c.fillText(txt, W/2, cy(H,st)); c.shadowBlur = 0;
  }},

  { id:"pill", name:"Pill", cat:"bold", caseDef:"lower", demo:"it's gorgeous", def:{pf:"poppins", sf:"sans", hi:"#ff2d3a"},
    draw(c,W,H,s,t,st,o){
      const {w, age, prev} = curWord(s,t), txt = caseOf(st,"lower",w.w), px = fitK(c, o.pf, [txt], W*0.7, H*0.07), y = cy(H,st), k = 0.7 + 0.3*overshoot(age/0.2);
      c.font = fnt(o.pf, px); const tw = c.measureText(txt).width, ph = px*1.45, pw = tw + px*0.9;
      if(prev){ const pt = caseOf(st,"lower",prev.w); c.font = fnt(o.sf, px*0.42); c.textAlign = "center"; c.textBaseline = "bottom"; c.fillStyle = o.tx; c.fillText(pt, W/2, y - ph/2 - px*0.1); }
      c.save(); c.translate(W/2, y); c.scale(k, k*(1 + 0.05*Math.sin(age*14)*(1-ease(age/0.5)))); c.fillStyle = o.hi; roundRect(c, -pw/2, -ph/2, pw, ph, ph/2); c.fill();
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = o.tx; c.fillText(txt, 0, px*0.04); c.restore();
  }},

  { id:"hollow", name:"Hollow", cat:"bold", caseDef:"upper", demo:"neon on the water", def:{pf:"anton", hi:"#ffe14a"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "top"; c.lineJoin = "round";
      lineLayout(c, W, H, s, st, o, {caseDef:"upper", px:0.085, maxW:0.86, lh:1.08, each(it,i,x,y,px){ c.lineWidth = Math.max(1.5, px*0.025);
        if(i < s.rev){ c.fillStyle = i === s.rev-1 ? o.hi : o.tx; c.fillText(it.s, x, y); } else { c.strokeStyle = o.tx; c.save(); c.globalAlpha *= .7; c.strokeText(it.s, x, y); c.restore(); } }});
  }},

  { id:"label", name:"Label", cat:"bold", caseDef:"upper", demo:"neon on the", def:{pf:"black", hi:"#ffe14a"},
    draw(c,W,H,s,t,st,o){
      c.textBaseline = "middle";
      lineLayout(c, W, H, s, st, o, {caseDef:"upper", px:0.045, maxW:0.74, lh:1.55, each(it,i,x,y,px,lh){ if(i >= s.rev) return; const k = ease((t - s.words[i].t)/0.12), padX = px*0.32;
        c.save(); c.translate(x + it.w/2, y + lh/2); c.rotate((i%2?1:-1)*0.035); c.scale(0.7+0.3*k, 0.7+0.3*k);
        c.fillStyle = i === s.rev-1 ? o.hi : o.tx; c.fillRect(-it.w/2 - padX, -px*0.68, it.w + padX*2, px*1.36); c.fillStyle = "#111"; c.textAlign = "left"; c.fillText(it.s, -it.w/2, px*0.04); c.restore(); }});
  }},

  { id:"echo", name:"Echo", cat:"layered", caseDef:"upper", demo:"rewarded", variants:[3,5,2], def:{pf:"barlowi", hi:"#d6f53a"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), n = [3,5,2][o.v % 3], px = fitK(c, o.pf, [txt], W*0.84, H*(n > 3 ? 0.07 : 0.1)), lh = px*0.8, y0 = cy(H,st) - (n-1)*lh/2;
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round"; c.lineWidth = px*0.07; c.strokeStyle = "#1a1a10";
      for(let k=0;k<n;k++){ if(age < k*0.05) continue; const y = y0 + k*lh; c.strokeText(txt, W/2, y); c.fillStyle = o.hi; c.fillText(txt, W/2, y); }
  }},

  { id:"duet", name:"Duet", cat:"layered", caseDef:"upper", demo:"her body", def:{pf:"shoulders", sf:"playfair", hi:"#38d6ff"},
    draw(c,W,H,s,t,st,o){
      const {w, age, prev} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.8, H*0.13), y = cy(H,st), k = ease(age/0.16);
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = o.hi; c.globalAlpha *= 0.4 + 0.6*k; c.fillText(txt, W/2, y + (1-k)*px*0.15);
      if(prev){ const tw = c.measureText(txt).width; c.font = fnt(o.sf, px*0.38); c.fillStyle = o.tx; c.save(); c.translate(W/2 + tw*0.18, y - px*0.05); c.rotate(-0.08); c.fillText(caseOf(st,"lower",prev.w), 0, 0); c.restore(); }
  }},

  { id:"tiles", name:"Tiles", cat:"layered", caseDef:"upper", demo:"rewarded", variants:[3,2,4], def:{pf:"bebas", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      const {w} = curWord(s,t), txt = caseOf(st,"upper",w.w), n = [3,2,4][o.v % 3], cw = W*0.9/n, px = fitK(c, o.pf, [txt], cw*0.9, H*0.06), ch = px*1.25;
      const x0 = (W - cw*n)/2, y0 = cy(H,st) - ch*n/2; c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.lineWidth = Math.max(1, px*0.03);
      for(let r=0;r<n;r++) for(let q=0;q<n;q++){ const x = x0 + cw*(q+0.5), y = y0 + ch*(r+0.5) + Math.sin(t*4 + q*0.9 + r*0.4)*ch*0.12, mid = r === Math.floor(n/2) && q === Math.floor(n/2);
        if(mid){ c.fillStyle = o.hi; c.fillText(txt, x, y); } else { c.strokeStyle = o.tx; c.save(); c.globalAlpha *= 0.75; c.strokeText(txt, x, y); c.restore(); } }
  }},

  { id:"lift", name:"Lift", cat:"layered", caseDef:"upper", demo:"warning", def:{pf:"oswald", hi:"#ff4f8b"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.84, H*0.085), rise = Math.min(age, 1.2)*H*0.03, y = cy(H,st) - rise;
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = o.tx; c.globalAlpha *= ease(age/0.15); c.fillText(txt, W/2, y - px*0.5);
      const g = c.createLinearGradient(0, y + px*0.05, 0, y + px*1.05); g.addColorStop(0, o.tx); g.addColorStop(1, o.hi); c.fillStyle = g; c.fillText(txt, W/2, y + px*0.55);
  }},

  { id:"barcode", name:"Barcode", cat:"layered", caseDef:"upper", demo:"rewarded", def:{pf:"bebas", hi:"#38d6ff"},
    draw(c,W,H,s,t,st,o){
      const {w} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.9, H*0.12), lh = px*0.95, y0 = cy(H,st) - lh, bw = Math.max(2, W*0.012);
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
      for(let r=0;r<3;r++){ const y = y0 + r*lh, off = ((t*(r%2 ? -40 : 40)) % (bw*2) + bw*2) % (bw*2);
        c.save(); c.beginPath(); for(let x = -bw*2 + off; x < W; x += bw*2) c.rect(x, y - lh/2, bw*(r === 1 ? 1.4 : 1), lh); c.clip();
        c.fillStyle = r === 1 ? o.hi : o.tx; c.fillText(txt, W/2, y); c.restore(); }
  }},

  { id:"ticker", name:"Ticker", cat:"layered", caseDef:"upper", demo:"saws", variants:[0,1], def:{pf:"barlowi", hi:"#d6f53a"},
    draw(c,W,H,s,t,st,o){
      const {w} = curWord(s,t), txt = caseOf(st,"upper",w.w) + "  ", px = H*0.075, lh = px*0.92, n = 5, y0 = cy(H,st) - (n-1)*lh/2;
      c.font = fnt(o.pf, px); c.textBaseline = "middle"; c.textAlign = "left"; const tw = Math.max(10, c.measureText(txt).width);
      for(let r=0;r<n;r++){ const dir = (r%2 ? -1 : 1)*(o.v % 2 ? -1 : 1), off = ((t*W*0.18*dir) % tw + tw) % tw, y = y0 + r*lh;
        c.fillStyle = r === 2 ? o.tx : o.hi; c.save(); c.globalAlpha *= r === 2 ? 1 : 0.85; for(let x = -tw + off; x < W; x += tw) c.fillText(txt, x, y); c.restore(); }
  }},

  { id:"letterpress", name:"Letterpress", cat:"layered", caseDef:"lower", demo:"gorgeous", def:{pf:"shoulders", hi:"#ff8a3d"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"lower",w.w), px = fitK(c, o.pf, [txt], W*0.84, H*0.12), k = ease(age/0.2);
      const [cv, g] = offCanvas(Math.ceil(W), Math.ceil(px*1.6)); g.font = fnt(o.pf, px); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText(txt, W/2, px*0.8);
      g.globalCompositeOperation = "source-atop"; const gr = g.createLinearGradient(0, 0, 0, px*1.6); gr.addColorStop(0, "#ffd9b8"); gr.addColorStop(1, o.hi); g.fillStyle = gr; g.fillRect(0, 0, W, px*1.6);
      g.globalAlpha = 0.35; g.globalCompositeOperation = "source-atop"; g.fillStyle = g.createPattern(noise(), "repeat"); g.fillRect(0, 0, W, px*1.6); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
      c.globalAlpha *= k; c.drawImage(cv, 0, 0, Math.ceil(W), Math.ceil(px*1.6), 0, cy(H,st) - px*0.8 + (1-k)*px*0.1, Math.ceil(W), Math.ceil(px*1.6));
  }},

  { id:"focus", name:"Deep Focus", cat:"layered", caseDef:"upper", demo:"and ignored", def:{pf:"bebas", sf:"sans", hi:"#38d6ff"},
    draw(c,W,H,s,t,st,o){
      const {w, age, prev, next} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.8, H*0.11), y = cy(H,st);
      c.textAlign = "center"; c.textBaseline = "middle";
      if(next){ c.save(); c.font = fnt(o.pf, px*1.5); c.filter = `blur(${(px*0.08).toFixed(1)}px)`; c.globalAlpha *= 0.3; c.fillStyle = o.tx; c.fillText(caseOf(st,"upper",next.w), W/2, y + px*0.15); c.restore(); }
      const k = ease(age/0.25); c.save(); c.font = fnt(o.pf, px); c.filter = `blur(${((1-k)*px*0.08).toFixed(1)}px)`; c.fillStyle = o.hi; c.fillText(txt, W/2, y); c.restore();
      if(prev){ c.font = fnt(o.sf, px*0.22); c.fillStyle = o.tx; c.fillText(caseOf(st,"lower",prev.w), W/2 + c.measureText(txt).width*0 + px*1.1, y - px*0.62); }
  }},

  { id:"afterimage", name:"Afterimage", cat:"layered", caseDef:"upper", demo:"rewarded", def:{pf:"oswald", hi:"#9fe3ff"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.82, H*0.085), y = cy(H,st), spread = (1 - ease(age/0.5))*px*0.9 + px*0.06;
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
      for(let g=4; g>=1; g--){ c.save(); c.globalAlpha *= 0.13*(5-g)/4; c.fillStyle = o.hi; c.fillText(txt, W/2 - g*spread*0.4, y); c.restore(); }
      c.fillStyle = o.hi; c.fillText(txt, W/2, y);
  }},

  { id:"streak", name:"Streak", cat:"layered", caseDef:"upper", demo:"warning", def:{pf:"poppins", hi:"#ffffff"},
    draw(c,W,H,s,t,st,o){
      const {w, age} = curWord(s,t), txt = "(" + caseOf(st,"upper",w.w) + ")", px = fitK(c, o.pf, [txt], W*0.6, H*0.032), y = cy(H,st), k = ease(age/0.3);
      c.save(); const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, o.hi); g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.filter = `blur(${(px*0.35).toFixed(1)}px)`; c.globalAlpha *= 0.55 + 0.45*(1-k); c.fillRect(W*(0.5 - 0.5*k), y - px*0.75, W*k, px*1.5); c.restore();
      c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#151515"; c.fillText(txt, W/2, y);
  }},

  { id:"wave", name:"Wave", cat:"layered", caseDef:"upper", demo:"got rewarded", def:{pf:"oswald", sf:"sans", hi:"#38d6ff"},
    draw(c,W,H,s,t,st,o){
      const {w, age, prev} = curWord(s,t), txt = caseOf(st,"upper",w.w), px = fitK(c, o.pf, [txt], W*0.62, H*0.07), y = cy(H,st);
      c.textBaseline = "middle"; c.textAlign = "left"; c.font = fnt(o.pf, px); const tw = c.measureText(txt).width;
      let pt = "", pw = 0; if(prev){ pt = caseOf(st,"upper",prev.w); c.font = fnt(o.sf, px*0.45); pw = c.measureText(pt).width + px*0.2; }
      const x0 = (W - pw - tw)/2; if(pt){ c.fillStyle = o.tx; c.fillText(pt, x0, y + Math.sin(t*5)*px*0.06); }
      c.font = fnt(o.pf, px); c.fillStyle = o.hi; const k = ease(age/0.18); c.globalAlpha *= 0.3 + 0.7*k; c.fillText(txt, x0 + pw, y + Math.sin(t*5 + 1)*px*0.06 + (1-k)*px*0.3);
  }}
];
const cy = (H, st) => H*(0.18 + 0.64*st.y);
const styleDef = id => PRESETS.find(p => p.id === id) || PRESETS[1];
function styleOpts(st, pr){
  const f = (st.fonts && st.fonts[pr.id]) || {}, d = pr.def || {};
  return {pf: f.pf || d.pf || "sans", sf: f.sf || d.sf || d.pf || "sans", hi: (st.his && st.his[pr.id]) || d.hi || "#ffffff", tx: st.color || "#ffffff", v: (st.vars && st.vars[pr.id]) || 0};
}

/* ============ footage ============ */
/* Built-in backgrounds: solid colours with a slow, soft light moving over them. Royal (the Stellar blue) is the
   default; the others are a tap away in Clips. "glow": a soft light drifting around and breathing, "sweep": a wide
   band of light passing slowly across, "still": just the colour and a little film grain. */
const GEN = [
  {name:"Royal", pal:["#0626c7","#3a5cff"], kind:"glow"},
  {name:"Midnight", pal:["#07080f","#262a48"], kind:"glow"},
  {name:"Deep blue", pal:["#030b45","#0b35d6"], kind:"sweep"},
  {name:"Violet", pal:["#1f0d4a","#5a2fd0"], kind:"glow"},
  {name:"Crimson", pal:["#6e0b1b","#c8203c"], kind:"glow"},
  {name:"Forest", pal:["#08281d","#1b6b4d"], kind:"sweep"},
  {name:"Sunset", pal:["#a8370c","#f07a2a"], kind:"sweep"},
  {name:"Graphite", pal:["#1b1c20","#2c2e35"], kind:"still"}
];
let noiseCanvas = null;
function noise(){
  if(noiseCanvas) return noiseCanvas;
  noiseCanvas = document.createElement("canvas"); noiseCanvas.width = noiseCanvas.height = 256;
  const g = noiseCanvas.getContext("2d"), im = g.createImageData(256,256), r = rng(11);
  for(let i=0;i<im.data.length;i+=4){ const v = r()*255; im.data[i]=im.data[i+1]=im.data[i+2]=v; im.data[i+3]=255; }
  g.putImageData(im,0,0); return noiseCanvas;
}
function drawGen(c, W, H, g, lt, segI){
  lt = Math.max(0, lt || 0);
  const [base, light] = g.pal, M = Math.max(W, H);
  c.fillStyle = base; c.fillRect(0, 0, W, H);
  c.save();
  if(g.kind === "glow"){
    // one soft light, drifting slowly in a wide loop and breathing a little
    const x = W * (0.5 + 0.22 * Math.sin(lt * 0.21 + segI)), y = H * (0.42 + 0.16 * Math.cos(lt * 0.17 + segI * 0.7)), r = M * (0.62 + 0.04 * Math.sin(lt * 0.6));
    const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, light); rg.addColorStop(1, base);
    c.globalAlpha = 0.85; c.fillStyle = rg; c.fillRect(0, 0, W, H);
  } else if(g.kind === "sweep"){
    // a wide band of light crossing diagonally, about every 12 seconds
    const p = ((lt / 12) + segI * 0.37) % 1, cx = -0.6 * M + p * 2.2 * M;
    c.translate(W / 2, H / 2); c.rotate(-0.55); c.translate(-W / 2, -H / 2);
    const lg = c.createLinearGradient(cx - M * 0.5, 0, cx + M * 0.5, 0); lg.addColorStop(0, "rgba(0,0,0,0)"); lg.addColorStop(0.5, light); lg.addColorStop(1, "rgba(0,0,0,0)");
    c.globalAlpha = 0.55; c.fillStyle = lg; c.fillRect(-M, -M, M * 3, M * 3);
  }
  c.restore();
  // a soft darker edge, so the middle (where the lyrics are) reads best
  const vg = c.createRadialGradient(W / 2, H / 2, M * 0.25, W / 2, H / 2, M * 0.75); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.28)");
  c.fillStyle = vg; c.fillRect(0, 0, W, H);
  c.save(); c.globalAlpha = g.kind === "still" ? 0.09 : 0.05; c.globalCompositeOperation = "overlay";
  const n = noise(), ox = Math.floor(lt*24*37)%256, oy = Math.floor(lt*24*91)%256;
  c.fillStyle = c.createPattern(n, "repeat"); c.translate(-ox,-oy); c.fillRect(0,0,W+256,H+256); c.restore();
}
/* Transitions. Each cut can have its own; otherwise the one chosen for all ("Mix" picks a different one per cut). */
const TRANS_NAMES = { none: "None", crossfade: "Crossfade", slide: "Slide", push: "Push", zoom: "Zoom", wipe: "Wipe", blur: "Blur", spin: "Spin", flash: "Flash", dip: "Dip to black", mix: "Mix" };
const MIX = ["crossfade", "slide", "zoom", "push", "blur", "wipe", "flash"];
function transitionInto(i){
  const own = slotOf(i).tr; if(own) return own;
  const all = S.P.cuts.transition || "none";
  return all === "mix" ? MIX[(i * 3 + (S.P.cuts.seed || 0)) % MIX.length] : all;
}
/* How a photo or video sits in the frame. Per cut (slot.fx) or for all clips (cuts.fx):
   fit "fill" (crop to fill the frame) or "fit" (show the whole picture on a blurred copy of itself),
   z zoom (1 = as it fits, up to 3), x / y position (-1 to 1: from one edge of the picture to the other).
   Photos can also move (cuts.motion "zoom": the slow zoom and pan, "zoomin", "zoomout"; "still", the default: no movement). */
const FX0 = { fit: "fill", z: 1, x: 0, y: 0 };
const fxOf = i => ({ ...FX0, ...(S.P.cuts.fx || {}), ...(slotOf(i).fx || {}) });
const motionOf = i => slotOf(i).mo || S.P.cuts.motion || "still";
let _blurC = null;
/* Big photos stay sharp: a single drawImage that shrinks a picture a lot skips pixels and the video shimmers or looks
   soft. stepDown halves a picture step by step to the size wanted; sharpSrc keeps one such smaller copy per photo,
   at the size the frame draws it (with room for the slow zoom), so every frame starts from a clean picture. */
function stepDown(src, sw, sh, tw, th){
  let cur = src, w = sw, h = sh;
  do {
    const nw = Math.max(tw, Math.round(w / 2)), nh = Math.max(th, Math.round(h / 2));
    const cv = document.createElement("canvas"); cv.width = nw; cv.height = nh;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(cur, 0, 0, nw, nh);
    cur = cv; w = nw; h = nh;
  } while(w > tw || h > th);
  return cur;
}
function sharpSrc(el, iw, ih, w, h){
  if(!(typeof HTMLImageElement !== "undefined" && el instanceof HTMLImageElement) || !el.complete || !iw || !ih) return el;   // not loaded yet: no copy
  // halvings that still leave at least the drawn size (plus 25% so the slow zoom doesn't flip between two copies)
  let n = 0; while(iw / 2 ** (n + 1) >= w * 1.25 && ih / 2 ** (n + 1) >= h * 1.25 && n < 6) n++;
  if(!n) return el;
  const m = el._slsSharp; if(m && m.n === n && m.iw === iw) return m.c;
  try { const c = stepDown(el, iw, ih, Math.round(iw / 2 ** n), Math.round(ih / 2 ** n)); el._slsSharp = { n, iw, c }; return c; }
  catch { return el; }
}
function framedDraw(c, el, W, H, iw, ih, fx, kb){
  const z = clamp(fx.z || 1, 0.5, 4) * (kb ? kb.s : 1), px = clamp((fx.x || 0) + (kb ? kb.x : 0), -1, 1), py = clamp((fx.y || 0) + (kb ? kb.y : 0), -1, 1);
  // photos: the best smoothing and a clean smaller copy (video frames change every frame, so they're drawn as they come)
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = typeof HTMLImageElement !== "undefined" && el instanceof HTMLImageElement ? "high" : "low";
  { // the drawn size before the slow zoom, which only grows it a little: the smaller copy is picked from that
    const z0 = clamp(fx.z || 1, 0.5, 4), s0 = fx.fit === "fit" ? Math.min(W / iw, H / ih) * z0 : Math.max(W / iw, H / ih) * (z0 < 1 ? z0 : Math.max(1, z0) * (kb ? 1.16 : 1));
    el = sharpSrc(el, iw, ih, iw * s0, ih * s0);
  }
  if(fx.fit === "fit"){
    // a soft, dark copy fills the frame behind the whole picture (drawn tiny and stretched: a cheap blur)
    _blurC = _blurC || document.createElement("canvas"); _blurC.width = 24; _blurC.height = Math.max(8, Math.round(24 * H / W));
    const g = _blurC.getContext("2d"), bs = Math.max(_blurC.width / iw, _blurC.height / ih); g.drawImage(el, (_blurC.width - iw * bs) / 2, (_blurC.height - ih * bs) / 2, iw * bs, ih * bs);
    c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(_blurC, 0, 0, W, H); c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(0, 0, W, H); c.restore();
    const s = Math.min(W / iw, H / ih) * z, w = iw * s, h = ih * s;
    c.drawImage(el, (W - w) / 2 + px * W * 0.5, (H - h) / 2 + py * H * 0.5, w, h); return;
  }
  const s = Math.max(W / iw, H / ih) * Math.max(1, z), w = iw * s, h = ih * s;
  if(z < 1){ c.fillStyle = "#000"; c.fillRect(0, 0, W, H); const s2 = Math.max(W / iw, H / ih) * z, w2 = iw * s2, h2 = ih * s2; c.drawImage(el, (W - w2) / 2 + px * W * 0.5, (H - h2) / 2 + py * H * 0.5, w2, h2); return; }
  c.drawImage(el, (W - w) / 2 + px * (w - W) / 2, (H - h) / 2 + py * (h - H) / 2, w, h);
}
function coverDraw(c, el, W, H, iw, ih, scale, px, py){
  const s = Math.max(W/iw, H/ih) * scale, w = iw*s, h = ih*s;
  c.drawImage(el, (W-w)/2 + px*(w-W)/2, (H-h)/2 + py*(h-H)/2, w, h);
}
// returns false when a video frame isn't ready yet, so the previous frame stays on screen instead of a black flash
function drawClip(c, W, H, clip, lt, segDur, segI){
  if(!clip){ c.fillStyle = "#0b0a10"; c.fillRect(0,0,W,H); return true; }
  if(clip.kind === "gen"){ drawGen(c, W, H, clip.gen, lt + segI*3.1, segI); return true; }
  const fx = fxOf(segI);
  if(clip.kind === "img"){ const p = clamp(lt/Math.max(segDur,.1),0,1), dir = segI%4, mo = motionOf(segI);
    const kb = mo === "still" ? null : mo === "zoomout" ? { s: 1.16 - 0.1*p, x: 0, y: 0 } : mo === "zoomin" ? { s: 1.02 + 0.14*p, x: 0, y: 0 }
      : { s: 1.06 + 0.1*p, x: (dir===0?-1:dir===1?1:0)*(p-.5)*0.8, y: (dir===2?-1:dir===3?1:0)*(p-.5)*0.8 };
    framedDraw(c, clip.el, W, H, clip.el.naturalWidth, clip.el.naturalHeight, fx, kb); return true; }
  if(clip.kind === "video" && clip.xf){ framedDraw(c, clip.xf, W, H, clip.xf.width, clip.xf.height, fx, null); return true; }   // a frame decoded by the exporter
  if(clip.kind === "video"){ const v = vidFor(clip, segI); if(v.readyState >= 2 && !v.seeking && v.videoWidth){ framedDraw(c, v, W, H, v.videoWidth, v.videoHeight, fx, null); return true; } return false; }
  return true;
}
// two players per video clip: one plays the current cut while the other is already parked on the next cut's first frame
function vidFor(clip, segI){
  if(segI % 2 === 0) return clip.el;
  if(!clip.el2){ const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.loop = true; v.src = clip.url; v.load(); clip.el2 = v; }
  return clip.el2;
}
function wantTime(v, lt, segI){ const sl = slotOf(segI), base = sl.in ?? defaultIn(segI, v); return (base + Math.max(0, lt)*(sl.sp || 1)) % v.duration; }
function manageVideos(segs, order, si, t){
  const keep = new Set(), clipAt = i => segs[i] ? S.clips.find(c => c.id === order[i]) : null;
  const cur = clipAt(si);
  if(cur && cur.kind === "video"){ const v = vidFor(cur, si); keep.add(v);
    if(v.duration){ const want = wantTime(v, t - segs[si].a, si);
      const sp = slotOf(si).sp || 1; if(v.playbackRate !== sp) v.playbackRate = sp;
      const hear = !!cur.sound && S.playing; if(v.muted === hear) v.muted = !hear;
      if(S.playing){ if(Math.abs(v.currentTime - want) > 0.3 && !v.seeking) v.currentTime = want; if(v.paused) v.play().catch(()=>{}); }
      else { if(!v.paused) v.pause(); if(Math.abs(v.currentTime - want) > 0.04 && !v.seeking) v.currentTime = want; } } }
  const nx = si + 1, nc = clipAt(nx);
  if(nc && nc.kind === "video" && segs[nx].a - t < 1.2){ const v = vidFor(nc, nx); keep.add(v);
    if(!v.muted) v.muted = true;
    if(v.duration){ const want = wantTime(v, 0, nx); if(!v.paused) v.pause(); if(Math.abs(v.currentTime - want) > 0.04 && !v.seeking) v.currentTime = want; } }
  for(const c of S.clips) if(c.kind === "video") for(const v of [c.el, c.el2]) if(v && !keep.has(v) && !v.paused) v.pause();
  parkVideos(keep);
}
// The players in use sit, invisible, inside the preview. A player that isn't on the page, or is outside the part shown
// in full screen, can be paused or stop getting new frames (phones especially), which froze the background in full screen.
let vHold = null;
function parkVideos(keep){
  if(!vHold){ vHold = document.createElement("div"); vHold.className = "vid-hold"; vHold.setAttribute("aria-hidden", "true"); $(".stage").append(vHold); }
  for(const v of keep) if(v.parentNode !== vHold) vHold.append(v);
  for(const v of [...vHold.children]) if(!keep.has(v)) v.remove();
}
function pauseVideos(){ for(const c of S.clips) if(c.kind === "video") for(const v of [c.el, c.el2]) if(v) v.pause(); }
let footC = null, cutC = null, lastSi = -1;
function layer(cv, W, H){ if(!cv){ cv = document.createElement("canvas"); } if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; } return cv; }

/* ============ stage render ============ */
const stage = $("#stage"), sc = stage.getContext("2d");
function renderFrame(tr0){
  // tr0 is the real song time (lyrics follow it). Footage, cuts and the hook live inside the soundbite, so in
  // review mode their clock wraps around the soundbite while the lyrics keep going through the whole song.
  const rv = !!(S.review && S.audio), sb = S.P.section, sl = Math.max(0.5, sb.b - sb.a);
  const tl0 = rv ? clamp(tr0, 0, S.audio.duration) : clamp(tr0, sb.a, sb.b);
  const t = rv ? sb.a + (((tl0 - sb.a) % sl) + sl) % sl : tl0;
  const W = stage.width, H = stage.height, P = S.P, st = P.style;
  const {segs, order} = segInfo();
  let si = segs.findIndex(s => t >= s.a && t < s.b); if(si < 0) si = Math.max(0, segs.length-1);
  const seg = segs[si], clip = seg ? S.clips.find(c=>c.id===order[si]) : null;
  manageVideos(segs, order, si, t);
  footC = layer(footC, W, H); cutC = layer(cutC, W, H); const fc = footC.getContext("2d"), lt = seg ? t - seg.a : 0, tr = transitionInto(si);
  if(si !== lastSi){ const cc = cutC.getContext("2d"); cc.clearRect(0,0,W,H); cc.drawImage(footC, 0, 0); lastSi = si; }   // keep the outgoing frame for crossfades
  const spd = slotOf(si).sp || 1; fc.save(); drawClip(fc, W, H, clip, lt*spd, seg ? (seg.b - seg.a)*spd : 1, si); fc.restore();          // not ready? the last good frame stays
  const XF = clamp(P.cuts.xf ?? 0.35, 0.05, 3);
  const tk = si > 0 && lt < XF ? ease(lt/XF) : 1;
  if(tk >= 1 || !["crossfade","slide","push","zoom","wipe","blur","spin"].includes(tr)) sc.drawImage(footC, 0, 0);
  else if(tr === "crossfade"){ sc.drawImage(cutC, 0, 0); sc.save(); sc.globalAlpha = tk; sc.drawImage(footC, 0, 0); sc.restore(); }
  else if(tr === "slide"){ sc.drawImage(cutC, 0, 0); sc.drawImage(footC, W*(1 - tk), 0); }
  else if(tr === "push"){ sc.drawImage(cutC, -W*tk, 0); sc.drawImage(footC, W*(1 - tk), 0); }
  else if(tr === "zoom"){ sc.save(); const z = 1 + 0.25*tk; sc.translate(W/2, H/2); sc.scale(z, z); sc.translate(-W/2, -H/2); sc.drawImage(cutC, 0, 0); sc.restore();
    sc.save(); sc.globalAlpha = tk; const z2 = 1.18 - 0.18*tk; sc.translate(W/2, H/2); sc.scale(z2, z2); sc.translate(-W/2, -H/2); sc.drawImage(footC, 0, 0); sc.restore(); }
  else if(tr === "wipe"){ sc.drawImage(cutC, 0, 0); sc.save(); sc.beginPath(); sc.moveTo(0,0); sc.lineTo(W*tk*1.35,0); sc.lineTo(W*tk*1.35 - W*0.35,H); sc.lineTo(0,H); sc.closePath(); sc.clip(); sc.drawImage(footC, 0, 0); sc.restore(); }
  else if(tr === "blur"){ const bl = Math.sin(tk*Math.PI)*Math.max(W,H)*0.02; sc.save(); if("filter" in sc) sc.filter = `blur(${bl.toFixed(1)}px)`; sc.drawImage(cutC, 0, 0); sc.globalAlpha = tk; sc.drawImage(footC, 0, 0); sc.restore(); }
  else if(tr === "spin"){ sc.fillStyle = "#000"; sc.fillRect(0,0,W,H); sc.save(); sc.translate(W/2, H/2); const half = tk < 0.5, k2 = half ? tk*2 : (tk - 0.5)*2;
    sc.rotate((half ? k2 : k2 - 1)*0.5); const z = half ? 1 + k2*0.6 : 1.6 - k2*0.6; sc.scale(z, z); sc.translate(-W/2, -H/2); sc.drawImage(half ? cutC : footC, 0, 0); sc.restore(); }
  if(tr === "flash" && si > 0 && lt < XF){ sc.fillStyle = `rgba(255,255,255,${0.55*(1 - lt/XF)})`; sc.fillRect(0,0,W,H); }
  if(tr === "dip" && si > 0 && lt < XF){ sc.fillStyle = `rgba(0,0,0,${0.85*(1 - lt/XF)})`; sc.fillRect(0,0,W,H); }
  if(st.scrim > 0){ sc.fillStyle = `rgba(6,5,10,${st.scrim})`; sc.fillRect(0,0,W,H);
    const vg = sc.createRadialGradient(W/2,H/2,Math.min(W,H)*0.3,W/2,H/2,Math.max(W,H)*0.75); vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,`rgba(0,0,0,${st.scrim*0.9})`); sc.fillStyle = vg; sc.fillRect(0,0,W,H); }
  // hook
  if(!rv) drawHook(sc, W, H, P, t);
  // lyrics
  let ls = lyricState(tl0);
  /* "Lyrics on screen": Full line shows the whole line from its first word; a chosen transition replaces the
     template's own entrance (its words are handed over as if they came in a while ago, so nothing animates in)
     and then moves the whole line in its own way. */
  const show = st.show || "words", trans = st.trans || "template";
  let lineK = 1;
  if(ls && (show === "line" || trans !== "template")){
    const back = trans !== "template" ? 5 : 0;
    ls = { ...ls, words: ls.words.map(w => ({ ...w, t: (show === "line" ? ls.start : w.t) - back })), start: ls.start - back,
      rev: show === "line" ? ls.words.length : ls.rev, fade: trans !== "template" ? clamp((ls.end - tl0) / 0.12, 0, 1) : ls.fade, _start: ls.start };
    if(trans !== "template" && trans !== "none") lineK = ease(clamp((tl0 - ls._start) / 0.32, 0, 1));
  }
  if(ls && ls.rev > 0){
    const pr = styleDef(st.preset);
    // horizontal position: lyrics live in a column that narrows as it moves toward an edge, so they never leave the frame
    const xp = st.x ?? 0.5, Wn = W*(1 - Math.abs(xp - 0.5)*0.9), left = xp*(W - Wn);
    const yc = cy(H,st), k = st.size || 1;
    LYRF = { m: sc.getTransform(), W, H };
    sc.save(); sc.globalAlpha = ls.fade;
    if(lineK < 1){ sc.globalAlpha *= trans === "pop" ? Math.min(1, lineK * 1.6) : lineK;
      if(trans === "slide") sc.translate(0, (1 - lineK) * H * 0.035);
      if(trans === "pop"){ const z = 0.82 + 0.18 * lineK + Math.sin(lineK * Math.PI) * 0.05; sc.translate(left + Wn/2, yc); sc.scale(z, z); sc.translate(-(left + Wn/2), -yc); }
      if(trans === "blur" && "filter" in sc) sc.filter = `blur(${((1 - lineK) * Math.min(W, H) * 0.012).toFixed(1)}px)`; }
    sc.translate(left + Wn/2, yc); sc.scale(k, k); sc.translate(-Wn/2, -yc);
    try { pr.draw(sc, Wn, H, ls, tl0, st, styleOpts(st, pr)); } finally { sc.restore(); LYRF = null; }
  }
}
/* Lyric size and position only move the words. Parts of a template that belong to the frame (cinema bars, a
   band across the screen) are drawn through these, so they keep covering the whole frame whatever the size. */
let LYRF = null;   // the frame under the lyrics while they're drawn: { m: transform, W, H }
function onFrame(c, W, H, fn){ if(!LYRF){ fn(W, H); return; } c.save(); c.setTransform(LYRF.m); fn(LYRF.W, LYRF.H); c.restore(); }
/* a band across the full frame width at the words' height (y and h in the template's own units) */
function bandFill(c, W, y, h, frac = 1, paint){
  if(!LYRF){ if(paint) paint(y, y + h); c.fillRect(0, y, W * frac, h); return; }
  const m = LYRF.m.inverse().multiply(c.getTransform()), a = m.transformPoint(new DOMPoint(0, y)), b = m.transformPoint(new DOMPoint(0, y + h));
  c.save(); c.setTransform(LYRF.m); if(paint) paint(a.y, b.y); c.fillRect(0, a.y, LYRF.W * frac, b.y - a.y); c.restore();
}
const HOOK_LOOKS = {plain:["#ffffff","#000000"], glow:["#ffffff","#ffd400"], pill:["#ffffff","#0a090e"], box:["#111111","#ffffff"], caption:["#ffffff","#000000"], outline:["#ffffff","#000000"], sticker:["#111111","#ffffff"], banner:["#ffffff","#ff2d3a"]};
function rgba(hex, a){ const n = parseInt((hex||"#000").slice(1), 16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
function drawHook(c, W, H, P, t){
  S.hookBox = null; const h = P.hook;
  if(h.on && h.text && !(P.tTracks || [{}])[0]?.hide){ const ht = t - P.section.a - (h.start || 0); if(ht >= 0 && ht <= h.dur) S.hookBox = drawOverlay(c, W, H, h, ht); }
  S.textBoxes = [];
  const TT = P.tTracks || [{}];
  (P.texts || []).map((x, k) => [x, k]).sort((p, q) => ((p[0].tr || 0) - (q[0].tr || 0)) || p[1] - q[1]).map(p => p[0]).forEach(x => { if(!x.text || TT[x.tr || 0]?.hide) return; const ht = t - P.section.a - (x.start || 0); if(ht < 0 || ht > x.dur) return; const box = drawOverlay(c, W, H, x, ht); if(box) S.textBoxes.push({id:x.id, box}); });
}
function caseText(t, mode){ if(mode === "upper") return t.toUpperCase(); if(mode === "lower") return t.toLowerCase(); if(mode === "title") return t.toLowerCase().replace(/(^|[\s\n])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); return t; }
function drawOverlay(c, W, H, h, ht){
  const inK = h.anim === "none" ? 1 : clamp(ht/0.28, 0, 1), outK = clamp((h.dur - ht)/0.25, 0, 1);
  const px = Math.min(W,H)*0.042*(h.size || 1), F = FONTLIB[h.font || "sans"] || FONTLIB.sans;
  const font = `${h.italic ? "italic" : (F.i || "normal")} ${h.bold ? "800" : F.w} ${px.toFixed(1)}px ${F.css}`; c.save(); c.font = font;
  if("letterSpacing" in c) c.letterSpacing = ((h.ls || 0)*px*0.01).toFixed(2) + "px";
  let text = caseText(h.text, h.tcase); if(h.anim === "type") text = text.slice(0, Math.max(1, Math.ceil(ht*28)));
  // wrap into lines that fit the frame (typed line breaks are kept)
  const maxW = W*0.82, lines = [];
  for(const para of String(text).split("\n")){ const words = para.split(/\s+/).filter(Boolean); let cur = "";
    for(const w of words){ const tryL = cur ? cur + " " + w : w; if(cur && c.measureText(tryL).width > maxW){ lines.push(cur); cur = w; } else cur = tryL; } lines.push(cur); }
  while(lines.length > 1 && !lines[lines.length-1]) lines.pop();
  const lh = px*(1.3 + (h.lsp || 0)*0.01), padX = px*0.7, padY = px*0.45, widths = lines.map(l => c.measureText(l).width), bw = Math.max(...widths) + padX*2, bh = lines.length*lh + padY*2;
  const full = h.look === "banner", boxW = full ? W : bw, cx = full ? W/2 : clamp(W*(h.x ?? 0.5), boxW/2 + W*0.03, W - boxW/2 - W*0.03), cyy = clamp(H*(h.y ?? 0.09), bh/2 + H*0.02, H - bh/2 - H*0.02);
  const hitBox = {x: cx - boxW/2, y: cyy - bh/2, w: boxW, h: bh};
  c.globalAlpha *= h.anim === "fade" || h.anim === "slide" || h.anim === "type" ? inK*outK : outK*(h.anim === "pop" ? Math.min(1, inK*3) : 1);
  c.translate(cx, cyy + (h.anim === "slide" ? (1 - ease(inK))*px*1.6 : 0));
  if(h.anim === "pop"){ const k = 0.6 + 0.4*overshoot(ht/0.3); c.scale(k, k); }
  if(h.look === "sticker") c.rotate(-0.045);
  if(h.rot) c.rotate(h.rot*Math.PI/180);
  const col = h.color || "#fff", bg = h.bg || "#000";
  if(h.look === "pill"){ c.fillStyle = rgba(bg, 0.78); roundRect(c, -bw/2, -bh/2, bw, bh, lines.length > 1 ? px*0.6 : bh/2); c.fill(); }
  if(h.look === "sticker"){ c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = px*0.5; c.shadowOffsetY = px*0.15; c.fillStyle = bg; roundRect(c, -bw/2, -bh/2, bw, bh, px*0.3); c.fill(); c.shadowColor = "transparent"; }
  if(h.look === "banner"){ c.fillStyle = bg; c.fillRect(-W/2, -bh/2, W, bh); }
  const al = h.align || "center"; c.textAlign = al; c.textBaseline = "middle";
  const ax = al === "left" ? -bw/2 + padX : al === "right" ? bw/2 - padX : 0;
  lines.forEach((l, i) => { const y = -bh/2 + padY + lh*(i + 0.5), lw0 = widths[i], lx = al === "left" ? ax : al === "right" ? ax - lw0 : -lw0/2;
    if(h.look === "box"){ const lw = lw0 + px*0.7; c.fillStyle = bg; roundRect(c, lx - px*0.35, y - lh/2 - px*0.02, lw, lh + px*0.04, px*0.28); c.fill(); }
    if(h.look === "caption"){ c.shadowColor = "rgba(0,0,0,.65)"; c.shadowBlur = px*0.3; c.shadowOffsetY = px*0.05; }
    if(h.look === "glow"){ c.shadowColor = bg; c.shadowBlur = px*0.6; }
    if(h.look === "outline"){ c.lineJoin = "round"; c.lineWidth = px*0.16; c.strokeStyle = bg; c.strokeText(l, ax, y + px*0.03); }
    c.fillStyle = col; c.fillText(l, ax, y + px*0.03); if(h.look === "glow") c.fillText(l, ax, y + px*0.03); c.shadowColor = "transparent";
    if(h.underline && l){ c.fillStyle = col; c.fillRect(lx, y + px*0.52, lw0, Math.max(1.5, px*0.06)); } });
  c.restore();
  return hitBox;
}
function roundRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

/* drag the lyrics on the preview */
let stDrag = null;
stage.addEventListener("pointerdown", e => { if(S.exporting) return; stage.setPointerCapture(e.pointerId); const r = stage.getBoundingClientRect(), px = (e.clientX - r.left)/r.width*stage.width, py = (e.clientY - r.top)/r.height*stage.height, hb = S.hookBox;
  const inBox = bx => bx && px >= bx.x && px <= bx.x + bx.w && py >= bx.y && py <= bx.y + bx.h;
  const tb = [...(S.textBoxes || [])].reverse().find(q => inBox(q.box));
  if(tb){ if(textLocked(textById(tb.id))){ stDrag = null; toast("That text track is locked"); return; } const it = textById(tb.id); selectText(it.id);
    stDrag = {text: it, x0:e.clientX, y0:e.clientY, w:r.width, h:r.height, sx: it.x ?? 0.5, sy: it.y ?? 0.5}; stage.style.cursor = "grabbing"; return; }
  const onHook = hb && px >= hb.x && px <= hb.x + hb.w && py >= hb.y && py <= hb.y + hb.h;
  if(onHook && S.locks.hook){ stDrag = null; toast("The hook track is locked"); return; }
  stDrag = {hook:onHook, x0:e.clientX, y0:e.clientY, w:r.width, h:r.height, sx: onHook ? (S.P.hook.x ?? 0.5) : (S.P.style.x ?? 0.5), sy: onHook ? (S.P.hook.y ?? 0.09) : S.P.style.y}; stage.style.cursor = "grabbing"; });
stage.addEventListener("pointermove", e => { if(!stDrag){ stage.style.cursor = "grab"; return; }
  if(stDrag.text){ const it = stDrag.text; it.x = clamp(stDrag.sx + (e.clientX - stDrag.x0)/stDrag.w, 0, 1); it.y = clamp(stDrag.sy + (e.clientY - stDrag.y0)/stDrag.h, 0, 1);
    setVQuiet("#txtPX", Math.round((it.x - 0.5)*200)); setVQuiet("#txtPY", Math.round((0.5 - it.y)*200)); return; }
  if(stDrag.hook){ const h = S.P.hook; h.x = clamp(stDrag.sx + (e.clientX - stDrag.x0)/stDrag.w, 0, 1); h.y = clamp(stDrag.sy + (e.clientY - stDrag.y0)/stDrag.h, 0, 1); $("#hX").value = h.x; $("#hY").value = h.y; return; }
  const st = S.P.style;
  st.x = clamp(stDrag.sx + (e.clientX - stDrag.x0)/stDrag.w/0.45, 0, 1); st.y = clamp(stDrag.sy + (e.clientY - stDrag.y0)/stDrag.h/0.64, 0, 1);
  $("#sX").value = st.x; $("#sY").value = st.y; });
stage.addEventListener("pointerup", () => { if(stDrag){ stDrag = null; stage.style.cursor = "grab"; saveDraft(); } });

/* preset thumbnails */
function demoState(pr, t){
  const ws = (pr.demo || "").split(/\s+/).filter(Boolean).map((w,i) => ({w, l:0, t:i*0.38, d:0.34}));
  if(!ws.length) return null; let rev = 0, act = -1; ws.forEach((w,i) => { if(w.t <= t){ rev = i+1; if(t < w.t + w.d) act = i; } });
  return {words:ws, start:0, end:ws.length*0.38 + 1, rev, act, fade:1};
}
function drawStyleCard(c, W, H, pr, t, bgA){
  const g = c.createLinearGradient(0,0,W,H); g.addColorStop(0, bgA ? "#1d1a28" : "#24202f"); g.addColorStop(1, "#121019"); c.fillStyle = g; c.fillRect(0,0,W,H);
  const st = {...S.P.style, preset:pr.id, size:1, x:0.5, y:0.5, case:"auto"}, s = demoState(pr, t);
  if(!s){ c.strokeStyle = "#38d6ff"; c.lineWidth = 2; const m = Math.min(W,H)*0.07; c.beginPath(); c.moveTo(W/2-m,H/2-m); c.lineTo(W/2+m,H/2+m); c.moveTo(W/2+m,H/2-m); c.lineTo(W/2-m,H/2+m); c.stroke(); return; }
  if(!s.rev) return; c.save(); pr.draw(c, W, H, s, t, st, styleOpts(st, pr)); c.restore();
}
/* 128 little previews: only drawn while the template grid can be seen (the start page and the other tabs skip
   it), and drawn as soon as it shows up (the observer in boot()) */
let thumbsStale = false;
function renderPresetThumbs(){
  const box = $("#presets"); if(box && !box.getClientRects().length){ thumbsStale = true; return; }
  thumbsStale = false;
  $$("#presets canvas").forEach(cv => { const pr = styleDef(cv.dataset.id), c = cv.getContext("2d"), s = demoState(pr, 99);
    const t = s ? s.words[s.words.length-1].t + 0.6 : 0; c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,cv.width,cv.height); drawStyleCard(c, cv.width, cv.height, pr, t, false); });
}
let hoverStyle = null;
function drawStylePreview(now){
  const cv = $("#stylePrev"); if(!cv || cv.offsetParent === null) return; const pr = styleDef(hoverStyle || S.P.style.preset), c = cv.getContext("2d");
  const n = Math.max(1, (pr.demo || "x").split(/\s+/).length), loop = n*0.38 + 1.4, t = (now/1000) % loop;
  const vh = cv.width*16/9; c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,cv.width,cv.height); c.save(); c.translate(0, (cv.height - vh)/2); drawStyleCard(c, cv.width, vh, pr, t, true); c.restore();
}
const FAVKEY = "sls-favs"; let favs = new Set(store.get(FAVKEY) || []), styleCat = "all";
let styleRecs = new Set();   // styles that suit the current song (js/styles-more.js fills this)
function renderPresetGrid(){
  const list = PRESETS.filter(p => styleCat === "all" || (styleCat === "fav" ? favs.has(p.id) : p.cat === styleCat));
  $("#presets").innerHTML = list.length ? list.map(p => `<button class="preset" data-id="${p.id}" aria-pressed="${p.id === S.P.style.preset}"><canvas data-id="${p.id}" width="150" height="200"></canvas><span>${p.name}</span>${favs.has(p.id) ? '<i class="fav">★</i>' : ""}${styleRecs.has(p.id) ? `<i class="rec" title="Suits this song${window.SLSStyleRecs && SLSStyleRecs.why ? " (" + SLSStyleRecs.why + ")" : ""}">✦</i>` : ""}</button>`).join("")
    : `<div class="empty" style="grid-column:1/-1">No favourites yet. Pick a style and tap the star.</div>`;
  $$("#styleCats button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === styleCat)));
  renderPresetThumbs();
}
/* font pickers: TikTok's own fonts first, then all the others A to Z. Rebuilt when more fonts are added. */
function fillFonts(sel){
  const el = $(sel), keys = Object.keys(FONTLIB); if(!el || el.options.length === keys.length) return;
  const v = el.value, opt = k => `<option value="${k}">${esc(FONTLIB[k].name)}</option>`, tt = keys.filter(k => /^tiktok/.test(k)), rest = keys.filter(k => !/^tiktok/.test(k)).sort((a, b) => FONTLIB[a].name.localeCompare(FONTLIB[b].name));
  el.innerHTML = (tt.length ? `<optgroup label="TikTok">${tt.map(opt).join("")}</optgroup>` : "") + `<optgroup label="All fonts">${rest.map(opt).join("")}</optgroup>`;
  if(v) el.value = v;
}
function syncStylePanel(){
  const st = S.P.style, pr = styleDef(st.preset), o = styleOpts(st, pr);
  $("#styleName").textContent = pr.name; $("#ssTitle").textContent = "Text for " + pr.name;
  const fav = favs.has(pr.id); $("#styleFav").textContent = fav ? "★" : "☆"; $("#styleFav").setAttribute("aria-pressed", String(fav)); $("#styleFav").title = fav ? "Remove from favourites" : "Add to favourites";
  $("#styleVar").hidden = !pr.variants;
  fillFonts("#sPf"); fillFonts("#sSf");
  $("#sPf").value = o.pf; $("#sSf").value = o.sf; $("#sSfRow").hidden = !pr.def?.sf;
  const cur = o.hi.toLowerCase();
  $("#hiSw").innerHTML = HI_SWATCHES.map(h => `<button class="sw" data-c="${h}" style="background:${h}" aria-label="Highlight ${h}" aria-pressed="${h === cur}"></button>`).join("") + `<input type="color" id="hiCustom" title="Custom highlight" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : "#ffffff"}">`;
}
function setStyleOpt(kind, val){ const st = S.P.style, id = st.preset; st.fonts = st.fonts || {}; st.his = st.his || {};
  if(kind === "pf" || kind === "sf"){ st.fonts[id] = {...(st.fonts[id] || {}), [kind]: val}; const f = FONTLIB[val]; document.fonts.load(fnt(val, 40)).then(() => renderPresetThumbs()).catch(()=>{}); }
  if(kind === "hi") st.his[id] = val;
  syncStylePanel(); renderPresetThumbs(); saveDraft(); }

/* ============ timeline ============ */
const tl = $("#tl"), tlc = tl.getContext("2d"), tlScroll = $("#tlScroll");
const ROWS = {ruler:[0,20], hook:[20,42], words:[42,76], cuts:[76,132], wave:[132,172], texts:[[20,42]], aux:[], end:172, sig:""};
const CUT_H = 56;   // height of the clips track: big enough to see the pictures and grab the edges
function tTracks(){ if(!Array.isArray(S.P.tTracks) || !S.P.tTracks.length) S.P.tTracks = [{}]; return S.P.tTracks; }
function layoutRows(){ if(!S.P) return; const T = tTracks(), A = S.P.aux || (S.P.aux = []); let y = 20; ROWS.texts = [];
  for(let i = T.length - 1; i >= 0; i--){ ROWS.texts[i] = [y, y + 22]; y += 22; }   // newest text track sits on top, like CapCut
  ROWS.hook = [20, y]; ROWS.words = [y, y + 34]; y += 34; ROWS.cuts = [y, y + CUT_H]; y += CUT_H; ROWS.wave = [y, y + 40]; y += 40;
  ROWS.aux = A.map(() => { const r = [y, y + 30]; y += 30; return r; }); ROWS.end = y; ROWS.sig = T.length + "|" + A.length; }
const trackSig = () => !S.P ? ROWS.sig : (S.P.tTracks?.length || 1) + "|" + (S.P.aux?.length || 0);
const textTrackAt = y => ROWS.texts.findIndex(r => r && y >= r[0] && y < r[1]);
const auxAt = y => ROWS.aux.findIndex(r => y >= r[0] && y < r[1]);
function lockState(k){ if(/^t\d+$/.test(k)) return !!tTracks()[+k.slice(1)]?.lock; if(/^a\d+$/.test(k)) return !!(S.P.aux || [])[+k.slice(1)]?.lock; return !!S.locks[k]; }
const textTrackLocked = i => i ? lockState("t" + i) : !!S.locks.hook;
const textLocked = it => textTrackLocked(it?.tr || 0);
function refreshTracks(){ layoutRows(); renderHeads(); sizeTimeline(); }
let tlStatic = document.createElement("canvas"), tlDirty = true, tlW = 0;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
function sizeTimeline(){
  const w = Math.max(200, tlScroll.clientWidth * S.zoom);
  tl.style.width = w + "px"; tlW = w;
  layoutRows(); tl.style.height = ROWS.end + "px";
  tl.width = Math.floor(w*dpr()); tl.height = Math.floor(ROWS.end*dpr());
  tlStatic.width = tl.width; tlStatic.height = tl.height; tlDirty = true;
}
function setZoom(z, anchorX){
  z = clamp(Math.round(z*100)/100, 1, 16); if(z === S.zoom) return;
  const ax = anchorX ?? tlScroll.clientWidth/2, frac = (tlScroll.scrollLeft + ax)/Math.max(1, tlW);
  S.zoom = z; $("#zoom").value = z; sizeTimeline(); tlScroll.scrollLeft = Math.max(0, frac*tlW - ax);
}
const xOf = t => (t - S.P.section.a) / (S.P.section.b - S.P.section.a) * tlW;
const tOf = x => S.P.section.a + x / tlW * (S.P.section.b - S.P.section.a);
// the word cut short with "…" to fit a block on the timeline, or nothing when not even two letters fit
function fitWord(c, w, room){
  const ch = [...w]; for(let n = ch.length - 1; n >= 2; n--){ const t = ch.slice(0, n).join("") + "…"; if(c.measureText(t).width <= room) return t; }
  return ch.length <= 2 && c.measureText(w).width <= room ? w : "";
}
function drawTimelineStatic(){
  const c = tlStatic.getContext("2d"), k = dpr(); c.setTransform(k,0,0,k,0,0); c.clearRect(0,0,tlW,ROWS.end); const T0 = ROWS.texts[0][0], W0 = ROWS.words[0], C0 = ROWS.cuts[0];
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
  const {a,b} = S.P.section;
  // row backgrounds
  c.fillStyle = col("--ink"); c.fillRect(0, ROWS.hook[0], tlW, ROWS.end-ROWS.hook[0]);
  c.fillStyle = col("--stripe") || "rgba(255,255,255,.035)"; ROWS.texts.forEach((r, i) => { if(i % 2) c.fillRect(0, r[0], tlW, r[1] - r[0]); }); ROWS.aux.forEach((r, i) => { if(!(i % 2)) c.fillRect(0, r[0], tlW, r[1] - r[0]); });
  // beat grid
  const beats = beatsIn(a,b), first = beats.length ? beats[0].k : 0;
  c.font = `600 10px ${FONTS.mono}`; c.textBaseline = "middle";
  for(const bt of beats){ const x = Math.round(xOf(bt.t)) + .5, bar = ((bt.k%4)+4)%4 === 0;
    c.strokeStyle = bar ? col("--line-2") : col("--line"); c.globalAlpha = bar ? 1 : .55; c.beginPath(); c.moveTo(x, bar ? 4 : 12); c.lineTo(x, ROWS.end); c.stroke(); c.globalAlpha = 1;
    if(bar){ c.fillStyle = col("--muted"); c.fillText(String(Math.floor((bt.k - first)/4) + 1), x + 4, 10); } }
  // markers
  (S.P.markers || []).forEach((m, i) => { const x = xOf(m); if(x < -8 || x > tlW + 8) return; c.fillStyle = col("--hook"); c.globalAlpha = S.selMarker === i ? 1 : .85;
    c.beginPath(); c.moveTo(x-5, 2); c.lineTo(x+5, 2); c.lineTo(x+5, 11); c.lineTo(x, 16); c.lineTo(x-5, 11); c.closePath(); c.fill(); c.globalAlpha = .35; c.fillRect(x - .5, 16, 1, ROWS.end - 16); c.globalAlpha = 1; });
  // hook
  if(S.P.hook.on && S.P.hook.text){ const hs = a + (S.P.hook.start || 0), x2 = xOf(Math.min(b, hs + S.P.hook.dur)), x1h = xOf(hs); c.fillStyle = col("--hook"); c.globalAlpha = .22; c.fillRect(x1h, T0 + 4, x2 - x1h, 14); c.globalAlpha = 1;
    c.fillStyle = col("--hook"); c.font = `600 11px ${FONTS.sans}`; c.save(); c.beginPath(); c.rect(x1h,T0,x2 - x1h,22); c.clip(); c.fillText(S.P.hook.text, x1h + 6, T0 + 11); c.restore(); }
  (S.P.texts || []).forEach(it => { const ty = (ROWS.texts[it.tr || 0] || ROWS.texts[0])[0], xs = xOf(a + (it.start || 0)), xe = xOf(Math.min(b, a + (it.start || 0) + it.dur)), sel = S.sel && S.sel.type === "text" && S.sel.id === it.id;
    c.fillStyle = col("--hook"); c.globalAlpha = sel ? 1 : .75; roundRect(c, xs, ty + 3, Math.max(6, xe - xs - 1), 16, 4); c.fill(); c.globalAlpha = 1;
    if(sel){ c.strokeStyle = "#fff"; c.lineWidth = 1.5; roundRect(c, xs, ty + 3, Math.max(6, xe - xs - 1), 16, 4); c.stroke(); }
    c.fillStyle = "#fff"; c.font = `600 10.5px ${FONTS.sans}`; c.textBaseline = "middle"; c.save(); c.beginPath(); c.rect(xs, ty + 2, Math.max(4, xe - xs - 4), 18); c.clip(); c.fillText("T  " + it.text.replace(/\n/g, " "), xs + 5, ty + 11.5); c.restore(); });
  // words: like a subtitle track. Words sung together in a line form one bar with the line written across it and a
  // thin mark between words; a pause splits the bar. The selected word gets its own outline.
  c.font = `600 11px ${FONTS.sans}`;
  { const ws = S.P.words, runs = []; let cur = null;
    ws.forEach((w, i) => { const prev = ws[i - 1];
      if(cur && prev && prev.l === w.l && w.t - (prev.t + prev.d) < 0.2) cur.push(i); else runs.push(cur = [i]); });
    for(const run of runs){
      const w0 = ws[run[0]], w1 = ws[run[run.length - 1]], x = xOf(w0.t), x2 = xOf(w1.t + w1.d); if(x2 < 0 || x > tlW) continue;
      const cw = Math.max(3, x2 - x - 2), r = Math.min(6, cw / 2);
      c.fillStyle = col("--lyric"); c.globalAlpha = .9; roundRect(c, x, W0 + 4, cw, 26, r); c.fill(); c.globalAlpha = 1;
      c.fillStyle = "rgba(255,255,255,.28)"; for(let k = 1; k < run.length; k++){ const xb = Math.round(xOf(ws[run[k]].t)) - 1; if(xb > x + 3 && xb < x + cw - 3) c.fillRect(xb, W0 + 23, 1, 5); }
      const text = run.map(i => ws[i].w).join(" "), label = c.measureText(text).width + 12 <= cw ? text : fitWord(c, text, cw - 10);
      if(label){ c.fillStyle = "#ffffff"; c.save(); c.beginPath(); c.rect(x, W0 + 4, cw, 26); c.clip(); c.fillText(label, x + 6, W0 + 17); c.restore(); }
    }
    ws.forEach((w, i) => { const sel = isSel(w), tapNext = S.tap && S.tap.i === i; if(!sel && !tapNext) return;
      const x = xOf(w.t), x2 = xOf(w.t + w.d); if(x2 < 0 || x > tlW) return; const cw = Math.max(3, x2 - x - 2);
      c.fillStyle = "rgba(255,255,255,.18)"; roundRect(c, x, W0 + 4, cw, 26, Math.min(6, cw / 2)); c.fill();
      c.strokeStyle = tapNext ? col("--tape") : col("--text"); c.lineWidth = 1.5; roundRect(c, x, W0 + 4, cw, 26, Math.min(6, cw / 2)); c.stroke(); }); }
  // cuts
  const {segs, order} = segInfo();
  segs.forEach((s,i) => { const x = xOf(s.a), x2 = xOf(s.b), clip = S.clips.find(cl=>cl.id===order[i]); const sel = S.sel && S.sel.type==="seg" && S.sel.i===i;
    const CH = CUT_H - 8;
    if(clip && clip.thumb){ c.save(); c.beginPath(); roundRect(c, x+1, C0 + 4, x2-x-2, CH, 5); c.clip(); const im = clip.thumbImg; if(im && im.complete){ const sw = x2-x-2, s2 = Math.max(sw/im.width, CH/im.height); c.globalAlpha = .9; c.drawImage(im, x+1 + (sw - im.width*s2)/2, C0 + 4 + (CH-im.height*s2)/2, im.width*s2, im.height*s2); } c.restore(); }
    else { c.fillStyle = col("--raise"); roundRect(c, x+1, C0 + 4, x2-x-2, CH, 5); c.fill(); }
    c.strokeStyle = sel ? col("--tape") : col("--clip"); c.lineWidth = sel ? 2 : 1; c.globalAlpha = sel ? 1 : .6; roundRect(c, x+1, C0 + 4, x2-x-2, CH, 5); c.stroke(); c.globalAlpha = 1;
    // how long this clip is on screen, and its transition in, at the bottom of the tile
    if(x2 - x > 30){ const dl = (s.b - s.a).toFixed(1) + "s", trn = slotOf(i).tr; c.font = `700 10px ${FONTS.sans}`; const tw = c.measureText(dl).width;
      c.fillStyle = "rgba(0,0,0,.62)"; roundRect(c, x2 - tw - 12, C0 + CH - 12, tw + 8, 13, 4); c.fill(); c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(dl, x2 - tw - 8, C0 + CH - 5.5);
      if(trn && i > 0 && x2 - x > tw + 40){ const tl2 = TRANS_NAMES[trn] || trn, w2 = c.measureText(tl2).width; c.fillStyle = "rgba(0,0,0,.62)"; roundRect(c, x + 5, C0 + CH - 12, w2 + 8, 13, 4); c.fill(); c.fillStyle = "#fff"; c.fillText(tl2, x + 9, C0 + CH - 5.5); } }
    if(i > 0){ c.fillStyle = col("--clip"); c.beginPath(); c.moveTo(x, C0 + 1); c.lineTo(x+4, C0 + 5); c.lineTo(x, C0 + 9); c.lineTo(x-4, C0 + 5); c.fill(); }
    const sp = slotOf(i).sp || 1; if(Math.abs(sp - 1) > 0.01 && x2 - x > 26){ c.font = `700 10px ${FONTS.sans}`; const label = sp.toFixed(2).replace(/0+$/,"").replace(/\.$/,"") + "×", tw = c.measureText(label).width;
      c.fillStyle = "rgba(0,0,0,.65)"; roundRect(c, x+4, C0 + 7, tw+8, 13, 4); c.fill(); c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(label, x+8, C0 + 14); }
    if(sel){ c.fillStyle = col("--tape"); if(i > 0) c.fillRect(x+1, C0 + 6, 4, CH - 4); if(i < segs.length-1) c.fillRect(x2-5, C0 + 6, 4, CH - 4); } });
  // waveform
  if(S.audio){ const d = S.audio.getChannelData(0), sr = S.audio.sampleRate, mid = ROWS.wave[0] + 20, hh = 18; c.fillStyle = col("--audio"); c.globalAlpha = S.P.mainMute ? .3 : .9;
    const px = Math.floor(tlW); for(let x=0;x<px;x+=2){ const t0 = tOf(x), t1 = tOf(x+2); const i0 = Math.max(0, Math.floor(t0*sr)), i1 = Math.min(d.length, Math.floor(t1*sr)), st = Math.max(1, Math.floor((i1-i0)/40)); let m = 0; for(let j=i0;j<i1;j+=st) m = Math.max(m, Math.abs(d[j])); const h = Math.max(1, m*hh); c.fillRect(x, mid-h, 1.5, h*2); } c.globalAlpha = 1; }
  // tap sync marker
  // locked tracks are dimmed
  // extra audio tracks
  (S.P.aux || []).forEach((au, j) => { const [y0] = ROWS.aux[j], buf = S.auxBuf[au.id], sel = S.sel?.type === "aux" && S.sel.j === j;
    if(!buf){ c.fillStyle = "rgba(61,126,214,.18)"; roundRect(c, 4, y0 + 4, Math.min(tlW - 8, 260), 22, 5); c.fill(); c.fillStyle = "#9cc2f5"; c.font = `600 10.5px ${FONTS.sans}`; c.textBaseline = "middle"; c.fillText("↻  Click to re-add “" + au.name + "”", 12, y0 + 15); return; }
    const xs = xOf(a + (au.start || 0)), xe = xOf(a + (au.start || 0) + buf.duration), x1 = Math.max(0, xs), x2 = Math.min(tlW, xe); if(x2 <= x1) return;
    c.fillStyle = col("--audio"); c.globalAlpha = au.mute ? .12 : .28; roundRect(c, x1, y0 + 3, x2 - x1, 24, 5); c.fill(); c.globalAlpha = 1;
    const pk = auxPeaks(au.id), n = pk.length, mid2 = y0 + 15; c.fillStyle = "#6fa6ec"; c.globalAlpha = au.mute ? .3 : .9;
    for(let x = Math.ceil(x1); x < x2; x += 2){ const tt = tOf(x) - a - (au.start || 0), p = pk[Math.floor(tt / buf.duration * n)] || 0, h = Math.max(1, p * 10); c.fillRect(x, mid2 - h, 1.4, h * 2); } c.globalAlpha = 1;
    c.strokeStyle = sel ? "#fff" : "rgba(111,166,236,.7)"; c.lineWidth = sel ? 1.5 : 1; roundRect(c, x1 + .5, y0 + 3.5, x2 - x1 - 1, 23, 5); c.stroke();
    c.fillStyle = "#dbe8fb"; c.font = `600 10px ${FONTS.sans}`; c.textBaseline = "middle"; c.save(); c.beginPath(); c.rect(x1, y0, x2 - x1 - 4, 30); c.clip(); c.fillText(au.name + (au.mute ? "  (muted)" : ""), x1 + 6, y0 + 9); c.restore(); });
  // hidden text tracks are faded
  tTracks().forEach((tk, i) => { if(!tk.hide || !ROWS.texts[i]) return; const [y0, y1] = ROWS.texts[i]; c.globalAlpha = .6; c.fillStyle = col("--panel"); c.fillRect(0, y0, tlW, y1 - y0); c.globalAlpha = 1; });
  [...ROWS.texts.map((r, i) => [i ? "t" + i : "hook", r]), ["lyrics", ROWS.words], ["cuts", ROWS.cuts], ["audio", ROWS.wave], ...ROWS.aux.map((r, j) => ["a" + j, r])].forEach(([k, [y0, y1]]) => { if(!lockState(k)) return; c.fillStyle = "rgba(0,0,0,.45)"; c.fillRect(0, y0, tlW, y1 - y0);
    c.save(); c.beginPath(); c.rect(0, y0, tlW, y1 - y0); c.clip(); c.strokeStyle = "rgba(255,255,255,.07)"; c.lineWidth = 5; c.beginPath(); for(let xx = -60; xx < tlW + 60; xx += 16){ c.moveTo(xx, y1); c.lineTo(xx + (y1 - y0), y0); } c.stroke(); c.restore(); });
  tlDirty = false;
}
function drawTimeline(){
  if(trackSig() !== ROWS.sig) refreshTracks();
  if(tlDirty) drawTimelineStatic();
  const k = dpr(); tlc.setTransform(1,0,0,1,0,0); tlc.clearRect(0,0,tl.width,tl.height); tlc.drawImage(tlStatic,0,0);
  tlc.setTransform(k,0,0,k,0,0);
  const x = xOf(songTime()); tlc.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--tape"); tlc.fillRect(Math.round(x)-1, 0, 2, ROWS.end);
  tlc.beginPath(); tlc.moveTo(x-6,0); tlc.lineTo(x+6,0); tlc.lineTo(x,8); tlc.fill();
  if(drag && drag.kind === "slot" && drag.moved){ const {segs} = segInfo(), src = segs[drag.i], tg = segs[drag.j], col = getComputedStyle(document.documentElement).getPropertyValue("--tape"), w = xOf(src.b) - xOf(src.a);
    tlc.save(); tlc.strokeStyle = col; tlc.lineWidth = 2; tlc.setLineDash([5,3]); roundRect(tlc, xOf(tg.a)+1, ROWS.cuts[0] + 3, xOf(tg.b)-xOf(tg.a)-2, CUT_H - 6, 5); tlc.stroke();
    tlc.setLineDash([]); tlc.globalAlpha = .55; tlc.fillStyle = col; roundRect(tlc, drag.xNow - w/2, ROWS.cuts[0] + 6, w, CUT_H - 12, 5); tlc.fill(); tlc.restore(); }
  // while a cut edge is dragged: where it is and how long the two clips around it are
  if(drag && drag.kind === "cut"){ const {segs} = segInfo(), a = segs[drag.k], b = segs[drag.k + 1]; if(a && b){ const x = xOf(b.a), txt = `${fmt(b.a)}  ·  ${(a.b - a.a).toFixed(2)}s | ${(b.b - b.a).toFixed(2)}s${drag.snapped ? "  ·  " + drag.snapped : ""}`;
    tlc.save(); tlc.font = `600 11px ${FONTS.sans}`; const tw = tlc.measureText(txt).width, bx = clamp(x - tw/2 - 6, 2, tlW - tw - 14); tlc.fillStyle = "rgba(10,10,14,.88)"; roundRect(tlc, bx, ROWS.cuts[0] - 20, tw + 12, 18, 5); tlc.fill();
    tlc.fillStyle = "#fff"; tlc.textBaseline = "middle"; tlc.fillText(txt, bx + 6, ROWS.cuts[0] - 11); tlc.restore(); } }
  if(drag && drag.kind === "marquee" && drag.moved){ const xa = Math.min(drag.x0, drag.x1), ya = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    tlc.save(); tlc.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--tape"); tlc.globalAlpha = 0.14; tlc.fillRect(xa, ya, w, h); tlc.globalAlpha = 0.9; tlc.strokeStyle = tlc.fillStyle; tlc.lineWidth = 1; tlc.setLineDash([4,3]); tlc.strokeRect(xa + .5, ya + .5, w, h); tlc.restore(); }
  if(S.playing && S.zoom > 1){ const vx = x - tlScroll.scrollLeft; if(vx > tlScroll.clientWidth*0.85 || vx < 0) tlScroll.scrollLeft = x - tlScroll.clientWidth*0.2; }
}
function dirty(){ tlDirty = true; saveDraft(); slsEmit("change"); }

/* timeline interaction */
let drag = null;
tl.addEventListener("pointerdown", e => {
  if(S.tap) return;
  const r = tl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = tOf(x);
  tl.setPointerCapture(e.pointerId);
  const touch = e.pointerType === "touch", L = S.locks, boxOK = !L.lyrics && !touch;
  if(S.tool === "split" && y >= ROWS.hook[0]){ addCutAt(t); return; }
  if(y >= ROWS.hook[0] && y < ROWS.hook[1] && S.P.texts?.length){ const a0 = S.P.section.a, ti = textTrackAt(y), hit = [...S.P.texts].reverse().find(it => (it.tr || 0) === ti && x >= xOf(a0 + it.start) - 2 && x <= xOf(a0 + it.start + it.dur) + 2);
    if(hit){ selectText(hit.id); if(textLocked(hit)){ toast("That text track is locked"); return; } const edge = x > xOf(a0 + hit.start + hit.dur) - 7;
      drag = {kind: edge ? "tresize" : "tmove", it: hit, x0: x, s0: hit.start, d0: hit.dur}; return; } }
  if(y < ROWS.ruler[1] && S.P.markers?.length){ const mi = S.P.markers.findIndex(m => Math.abs(xOf(m) - x) <= 6); if(mi >= 0){ if(e.detail === 2){ S.P.markers.splice(mi, 1); S.selMarker = null; dirty(); toast("Marker removed"); return; } S.selMarker = mi; seek(S.P.markers[mi]); tlDirty = true; return; } }
  if(S.tool === "select" && boxOK && y >= ROWS.hook[0] && y < ROWS.cuts[0]){ const hitW = y >= ROWS.words[0] && S.P.words.some(w => x >= xOf(w.t) - 2 && x <= xOf(w.t + w.d) + 2); if(!hitW){ startMarquee(e, x, y, t); return; } }
  if(y >= ROWS.words[0] && y < ROWS.words[1] && L.lyrics){ startSeekOrPan(e, t); return; }
  if(y >= ROWS.words[0] && y < ROWS.words[1]){
    let i = S.P.words.findLastIndex(w => x >= xOf(w.t) && x <= xOf(w.t + w.d)); if(i < 0) i = S.P.words.findIndex(w => x >= xOf(w.t) - 2 && x <= xOf(w.t + w.d) + 2);
    if(i >= 0){ const w = S.P.words[i], edge = x > xOf(w.t + w.d) - 7 && xOf(w.t+w.d) - xOf(w.t) > 14;
      if(e.shiftKey || e.metaKey || e.ctrlKey){ selectWord(i, true); return; }
      if(!isSel(w) || edge) selectWord(i);
      const group = [...selWords()].map(x => ({w:x, t0:x.t}));
      drag = {kind: edge ? "resize" : "move", i, x0:x, t0:w.t, d0:w.d, w, group, lim: moveLimits(group.map(g => g.w))}; return; }
    if(boxOK){ startMarquee(e, x, y, t); return; }
    if(!(e.shiftKey || e.metaKey)) selectNone(); startSeekOrPan(e, t); return;
  }
  if(y >= ROWS.cuts[0] && y < ROWS.cuts[1] && L.cuts){ startSeekOrPan(e, t); return; }
  if(y >= ROWS.cuts[0] && y < ROWS.cuts[1]){
    const {segs} = segInfo();
    const bi = segs.findIndex((sg,k) => k > 0 && Math.abs(xOf(sg.a) - x) <= 9);
    if(bi > 0){ toManualCuts(); materializeSlots(); const pts = segInfo().segs.slice(1).map(sg => sg.a); S.P.cuts.points = pts; const sl = S.P.cuts.slots;
      drag = {kind:"cut", k: bi-1, p0: pts[bi-1], in0: resolvedIn(bi), sp: (sl[bi] && sl[bi].sp) || 1, vid: (() => { const c = S.clips.find(c => c.id === segInfo().order[bi]); return c && c.kind === "video"; })()}; selectSeg(bi); return; }
    const i = segs.findIndex(s => t >= s.a && t < s.b);
    if(i >= 0){ selectSeg(i); if(e.detail === 2){ cycleSeg(i); seek(segs[i].a + 0.001); return; } drag = {kind:"slot", i, j:i, x0:x, xNow:x, moved:false}; }
    return;
  }
  if(y >= ROWS.wave[1]){ const j = auxAt(y), au = (S.P.aux || [])[j]; if(!au){ startSeekOrPan(e, t); return; }
    if(!S.auxBuf[au.id]){ pickAuxFile(j); return; }
    const a0 = S.P.section.a, buf = S.auxBuf[au.id], on = x >= xOf(a0 + (au.start || 0)) - 2 && x <= xOf(a0 + (au.start || 0) + buf.duration) + 2;
    if(!on){ startSeekOrPan(e, t); return; } S.sel = {type:"aux", j}; tlDirty = true; syncWordCard(); syncSegCard();
    if(lockState("a" + j)){ toast("That audio track is locked"); return; } drag = {kind:"amove", j, x0:x, s0: au.start || 0}; tl.style.cursor = "grabbing"; return; }
  if(y >= ROWS.wave[0] && !L.audio){ drag = {kind:"slide", x0:x, a0:S.P.section.a}; tl.style.cursor = "grabbing"; return; }
  startSeekOrPan(e, t);
});
tl.addEventListener("pointermove", e => {
  const r = tl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if(!drag){ let cur = "default"; if(y >= ROWS.words[0] && y < ROWS.words[1]){ const w = S.P.words.find(w => x >= xOf(w.t) && x <= xOf(w.t+w.d)); if(w) cur = x > xOf(w.t+w.d) - 7 ? "ew-resize" : "grab"; } else if(y >= ROWS.wave[0]) cur = y >= ROWS.wave[1] && (S.P.aux || [])[auxAt(y)] && !S.auxBuf[S.P.aux[auxAt(y)].id] ? "pointer" : "grab"; else if(y < ROWS.cuts[0]) cur = "text"; else cur = segInfo().segs.some((sg,k) => k > 0 && Math.abs(xOf(sg.a) - x) <= 9) ? "ew-resize" : "pointer"; tl.style.cursor = cur; return; }
  const t = tOf(x);
  if(drag.kind === "seek"){ seek(t); return; }
  if(drag.kind === "tmove" || drag.kind === "tresize"){ const len = S.P.section.b - S.P.section.a, d = (x - drag.x0)/tlW*len, it = drag.it;
    if(drag.kind === "tmove"){ it.start = clamp(+(drag.s0 + d).toFixed(3), 0, Math.max(0, len - 0.1)); const ti = textTrackAt(y); if(ti >= 0 && ti !== (it.tr || 0) && !textTrackLocked(ti) && !S.P.texts.some(o => o !== it && (o.tr || 0) === ti && o.start < it.start + it.dur && o.start + o.dur > it.start)) it.tr = ti; } else it.dur = clamp(+(drag.d0 + d).toFixed(3), 0.2, len - it.start);
    tlDirty = true; syncTextEditor(); return; }
  if(drag.kind === "marquee"){ drag.x1 = x; drag.y1 = y; if(Math.hypot(x - drag.x0, y - drag.y0) > 4) drag.moved = true;
    if(drag.moved){ const xa = Math.min(drag.x0, x), xb = Math.max(drag.x0, x), ya = Math.min(drag.y0, y), yb = Math.max(drag.y0, y), set = new Set(drag.base);
      if(yb >= ROWS.words[0] + 4 && ya <= ROWS.words[1] - 4) S.P.words.forEach(w => { if(xOf(w.t + w.d) >= xa && xOf(w.t) <= xb) set.add(w); });
      S.sel = set.size ? {type:"words", set} : null; tlDirty = true; }
    return; }
  if(drag.kind === "amove"){ const len = S.P.section.b - S.P.section.a, au = S.P.aux[drag.j], buf = S.auxBuf[au.id], d = (x - drag.x0)/tlW*len;
    let st = drag.s0 + d; if(S.snap && !e.altKey){ const sn = snapTime(S.P.section.a + st, 2) - S.P.section.a; if(Math.abs(sn - st) < len/tlW*8) st = sn; }
    au.start = clamp(+st.toFixed(3), -(buf.duration - 0.1), len - 0.1); tlDirty = true; return; }
  if(drag.kind === "pan"){ const dx = e.clientX - drag.x0; if(Math.abs(dx) > 5) drag.moved = true; if(drag.moved) tlScroll.scrollLeft = drag.sl - dx; return; }
  const dt = (x - drag.x0) / tlW * (S.P.section.b - S.P.section.a);
  if(drag.kind === "cut"){ const pts = S.P.cuts.points, k = drag.k, lo = (k > 0 ? pts[k-1] : S.P.section.a) + 0.15, hi = (k < pts.length-1 ? pts[k+1] : S.P.section.b) - 0.15;
    const sn = e.altKey ? { t, why: "" } : snapCut(t); drag.snapped = sn.why;
    pts[k] = clamp(sn.t, lo, hi); const sl = S.P.cuts.slots; if(drag.vid && sl && sl[k+1]) sl[k+1].in = Math.max(0, drag.in0 + (pts[k] - drag.p0)*drag.sp);
    tlDirty = true; if(!S.playing) S.t = pts[k] + 0.001; return; }
  if(drag.kind === "slot"){ drag.xNow = x; if(Math.abs(x - drag.x0) > 6) drag.moved = true;
    if(drag.moved){ const {segs} = segInfo(), tt = tOf(x); let j = segs.findIndex(g => tt >= g.a && tt < g.b); if(j < 0) j = tt < S.P.section.a ? 0 : segs.length - 1; drag.j = j; } return; }
  if(drag.kind === "slide"){ const len = S.P.section.b - S.P.section.a, dur = S.audio ? S.audio.duration : len, sdt = (x - drag.x0)/tlW*len, na = clamp(drag.a0 - sdt, 0, Math.max(0, dur - len));
    S.P.section = {a: Math.round(na*100)/100, b: Math.round((na+len)*100)/100}; S.t = S.P.section.a; tlDirty = true; updateMeta(); return; }
  const wsnap = tt => e.altKey ? snapTime(tt, 4) : tt;   // lyrics move freely; Option/Alt snaps them to the beat
  if(drag.kind === "move"){ let delta = wsnap(drag.t0 + dt) - drag.t0; const minT = Math.min(...drag.group.map(g=>g.t0)); if(minT + delta < 0) delta = -minT;
    if(S.noOverlap) delta = clamp(delta, drag.lim.lo, drag.lim.hi); drag.group.forEach(g => g.w.t = g.t0 + delta); }
  else { let d = Math.max(0.06, wsnap(drag.t0 + drag.d0 + dt) - drag.t0); if(S.noOverlap){ const n = drag.lim.next(drag.w); if(n) d = Math.min(d, Math.max(0.06, n.t - 0.02 - drag.w.t)); } drag.w.d = d; }
  tlDirty = true; syncWordCard();
});
// touch: one finger on an empty spot pans the timeline (a tap moves the playhead), two fingers pinch to zoom
function startMarquee(e, x, y, t){ const add = e.shiftKey || e.metaKey || e.ctrlKey; drag = {kind:"marquee", x0:x, y0:y, x1:x, y1:y, t, add, moved:false, base: add && selWords() ? new Set(selWords()) : new Set()}; if(!add) selectNone(); }
function startSeekOrPan(e, t){ if(e.pointerType === "touch"){ drag = {kind:"pan", x0:e.clientX, sl:tlScroll.scrollLeft, t, moved:false}; } else { drag = {kind:"seek"}; seek(t); } }
const touches = new Map(); let pinch = null;
tl.addEventListener("pointerdown", e => { if(e.pointerType !== "touch") return; touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(touches.size === 2){ const [a,b] = [...touches.values()], r = tlScroll.getBoundingClientRect(); pinch = {d0: Math.hypot(a.x-b.x, a.y-b.y) || 1, z0: S.zoom, ax: (a.x+b.x)/2 - r.left}; drag = null; e.stopImmediatePropagation(); } }, {capture:true});
tl.addEventListener("pointermove", e => { if(!touches.has(e.pointerId)) return; touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(pinch && touches.size >= 2){ const [a,b] = [...touches.values()]; setZoom(pinch.z0 * Math.hypot(a.x-b.x, a.y-b.y)/pinch.d0, pinch.ax); e.stopImmediatePropagation(); } }, {capture:true});
const endTouch = e => { touches.delete(e.pointerId); if(touches.size < 2) pinch = null; };
tl.addEventListener("pointerup", endTouch, {capture:true}); tl.addEventListener("pointercancel", endTouch, {capture:true});
tl.addEventListener("pointerup", () => { if(drag && drag.kind === "pan" && !drag.moved) seek(drag.t);
  if(drag && drag.kind === "marquee"){ if(!drag.moved){ if(!drag.add) selectNone(); seek(drag.t); } else { tlDirty = true; showTab("lyrics"); syncWordCard(); } } if(drag && (drag.kind === "move" || drag.kind === "resize")){ sortWords(); dirty(); syncWordCard(); }
  if(drag && drag.kind === "cut"){ dirty(); syncSegCard(); }
  if(drag && (drag.kind === "tmove" || drag.kind === "tresize")) dirty();
  if(drag && drag.kind === "amove"){ dirty(); restartAudio(); }
  if(drag && drag.kind === "slot"){ const {segs} = segInfo();
    if(!drag.moved) seek(segs[drag.i].a + 0.001);
    else if(drag.j !== drag.i){ if(S.locks.cuts){ toast("The cuts track is locked"); } else { const sl = materializeSlots(), m = sl.splice(drag.i, 1)[0]; sl.splice(drag.j, 0, m); dirty(); selectSeg(drag.j); seek(segs[drag.j].a + 0.001); } }
    tlDirty = true; }
  if(drag && drag.kind === "slide"){ if(S.playing && !S.exporting) play({}); dirty(); } drag = null; });

/* overview: full song with section window */
const ov = $("#overview"), ovc = ov.getContext("2d");
let ovDrag = null;
function drawOverview(){
  const k = dpr(), w = ov.clientWidth, h = ov.clientHeight;
  if(ov.width !== Math.floor(w*k)){ ov.width = Math.floor(w*k); ov.height = Math.floor(h*k); }
  ovc.setTransform(k,0,0,k,0,0); ovc.clearRect(0,0,w,h);
  const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
  ovc.fillStyle = col("--ink"); ovc.fillRect(0,0,w,h);
  if(!S.audio || !S.peaks) return;
  const dur = S.audio.duration, {a,b} = S.P.section, xa = a/dur*w, xb = b/dur*w;
  ovc.fillStyle = col("--dim"); const n = S.peaks.length;
  for(let x=0;x<w;x+=2){ const p = S.peaks[Math.floor(x/w*n)] || 0; const hh = Math.max(1,p*(h/2-3)); ovc.fillRect(x, h/2-hh, 1.4, hh*2); }
  ovc.fillStyle = col("--tape"); ovc.globalAlpha = .14; ovc.fillRect(xa, 0, xb-xa, h); ovc.globalAlpha = 1;
  ovc.save(); ovc.beginPath(); ovc.rect(xa,0,xb-xa,h); ovc.clip(); ovc.fillStyle = col("--text");
  for(let x=Math.floor(xa);x<xb;x+=2){ const p = S.peaks[Math.floor(x/w*n)] || 0; const hh = Math.max(1,p*(h/2-3)); ovc.fillRect(x, h/2-hh, 1.4, hh*2); } ovc.restore();
  // the suggested best parts: a numbered mark along the top
  (S.P.bites || []).forEach((p, i) => { const x0 = p.a/dur*w, x1 = Math.min(p.b, p.a + 60)/dur*w; ovc.fillStyle = col("--muted"); ovc.globalAlpha = .55; ovc.fillRect(x0, 0, Math.max(2, x1-x0), 3); ovc.globalAlpha = 1;
    ovc.font = "600 9px system-ui, sans-serif"; ovc.fillText(String(i+1), x0 + 2, 12); });
  ovc.strokeStyle = col("--tape"); ovc.lineWidth = 2; ovc.strokeRect(xa+1, 1, xb-xa-2, h-2);
  ovc.fillStyle = col("--tape"); ovc.fillRect(xa, 0, 5, h); ovc.fillRect(xb-5, 0, 5, h);
  ovc.fillRect(songTime()/dur*w - 1, 0, 2, h);
}
ov.addEventListener("pointerdown", e => {
  if(!S.audio || S.tap) return; if(S.locks.audio){ toast("The audio track is locked"); return; } ov.setPointerCapture(e.pointerId);
  const r = ov.getBoundingClientRect(), x = e.clientX - r.left, dur = S.audio.duration, w = r.width;
  const xa = S.P.section.a/dur*w, xb = S.P.section.b/dur*w;
  let kind = Math.abs(x-xa) < 9 ? "a" : Math.abs(x-xb) < 9 ? "b" : (x > xa && x < xb) ? "move" : "jump";
  if(kind === "jump"){ const len = S.P.section.b - S.P.section.a; setSection(clamp(x/w*dur - len/2, 0, dur-len), null); kind = "move"; }
  // while a handle is dragged the preview shows that edge of the video (playback pauses and picks up after)
  const resume = S.playing && !S.exporting; if(resume) pause();
  ovDrag = {kind, x0:x, a0:S.P.section.a, b0:S.P.section.b, w, dur, resume};
});
ov.addEventListener("pointermove", e => {
  if(!ovDrag) { const r = ov.getBoundingClientRect(), x = e.clientX - r.left; if(S.audio){ const xa = S.P.section.a/S.audio.duration*r.width, xb = S.P.section.b/S.audio.duration*r.width; ov.style.cursor = (Math.abs(x-xa)<9||Math.abs(x-xb)<9) ? "ew-resize" : "grab"; } return; }
  const r = ov.getBoundingClientRect(), dx = (e.clientX - r.left - ovDrag.x0)/ovDrag.w*ovDrag.dur, d = ovDrag;
  if(d.kind === "move"){ const len = d.b0-d.a0, na = clamp(d.a0+dx, 0, d.dur-len); setSection(na, na+len, true); }
  else if(d.kind === "a"){ setSection(clamp(d.a0+dx, Math.max(0, d.b0-60), d.b0-2), d.b0, true); }
  else { setSection(d.a0, clamp(d.b0+dx, d.a0+2, Math.min(d.dur, d.a0+60)), true, "end"); }
});
const ovUp = () => { if(ovDrag){ const r = ovDrag.resume; ovDrag = null; dirty(); if(r){ S.t = S.P.section.a; play({}); } } };
ov.addEventListener("pointerup", ovUp); ov.addEventListener("pointercancel", ovUp);
// show: "end" puts the preview on the last frame of the section (so you see where the video stops)
function setSection(a, b, live, show){
  const len = b == null ? S.P.section.b - S.P.section.a : b - a;
  S.P.section = {a: Math.round(a*100)/100, b: Math.round((a+len)*100)/100};
  S.t = show === "end" ? S.P.section.b - 0.04 : S.P.section.a;
  if(S.playing && !S.exporting && show !== "end") play({});
  tlDirty = true; updateMeta(); if(!live) saveDraft();
}

/* ============ selection panels ============ */
const selWords = () => S.sel && S.sel.type === "words" ? S.sel.set : null;
const isSel = w => !!selWords()?.has(w);
// how far a set of words can move (or the last one stretch) without touching a neighbour that isn't selected
function moveLimits(ws){
  const gap = 0.02, sel = new Set(ws), others = S.P.words.filter(w => !sel.has(w)).sort((a,b) => a.t - b.t);
  let lo = -Infinity, hi = Infinity;
  for(const w of ws){
    const prev = others.filter(o => o.t <= w.t).pop(), next = others.find(o => o.t > w.t);
    if(prev) lo = Math.max(lo, prev.t + prev.d + gap - w.t);
    if(next) hi = Math.min(hi, next.t - gap - (w.t + w.d));
  }
  const first = Math.min(...ws.map(w => w.t)); lo = Math.max(lo, -first);
  return {lo: Math.min(lo, 0), hi: Math.max(hi, 0), next: (w => others.find(o => o.t > w.t))};
}
function selectWord(i, add){ const w = S.P.words[i]; if(!w) return; if(add && selWords()){ const st = selWords(); st.has(w) ? st.delete(w) : st.add(w); if(!st.size) return selectNone(); } else S.sel = {type:"words", set:new Set([w])}; tlDirty = true; showTab("lyrics"); syncWordCard(); }
function selectAllWords(){ if(!S.P.words.length) return; S.sel = {type:"words", set:new Set(S.P.words)}; tlDirty = true; showTab("lyrics"); syncWordCard(); }
function selectSeg(i){ S.sel = {type:"seg", i}; tlDirty = true; if(!sheetOpen){ showTab("clips"); const c = $("#segCard"); if(c) setTimeout(() => c.scrollIntoView({ block: "nearest" }), 30); } syncSegCard(); }
function selectNone(){ setTimeout(syncTextEditor, 0); S.sel = null; tlDirty = true; syncWordCard(); syncSegCard(); }
function syncWordCard(){
  const st = selWords(); [...(st||[])].forEach(w => { if(!S.P.words.includes(w)) st.delete(w); });
  const on = st && st.size; $("#wordCard").hidden = !on; if(!on) return;
  const multi = st.size > 1; $("#wSingle").hidden = multi; $("#wMultiLbl").textContent = multi ? `${st.size} words selected` : "Selected word";
  if(multi) return;
  const w = [...st][0];
  if(document.activeElement !== $("#wText")) $("#wText").value = w.w;
  if(document.activeElement !== $("#wStart")) $("#wStart").value = w.t.toFixed(2);
  if(document.activeElement !== $("#wDur")) $("#wDur").value = w.d.toFixed(2);
}
function syncSegCard(){
  const on = S.sel && S.sel.type === "seg"; $("#segCard").hidden = !on; if(!on) return;
  const {segs, order} = segInfo(), s = segs[S.sel.i]; if(!s){ $("#segCard").hidden = true; return; }
  $("#segLabel").textContent = `Cut ${S.sel.i+1} of ${segs.length} · ${(s.b-s.a).toFixed(2)}s`;
  const clip = S.clips.find(c => c.id === order[S.sel.i]), vid = clip && clip.kind === "video" ? clip.el : null;
  $("#segVid").hidden = !vid;
  const sl = slotOf(S.sel.i), sp = sl.sp || 1; $("#segSpeed").value = sp; $("#segSpeedVal").textContent = sp.toFixed(2).replace(/0$/,"") + "×";
  $$("#segSpeedP button").forEach(b => b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.v - sp) < 0.01)));
  if(vid){ const segLen = (s.b - s.a)*sp, max = Math.max(0, (vid.duration||0) - Math.min(segLen, vid.duration||0)), cur = clamp(sl.in ?? defaultIn(S.sel.i, vid), 0, max);
    const r = $("#segStart"); r.max = max.toFixed(2); r.value = cur; $("#segStartVal").textContent = `${fmt(cur)} of ${fmt(vid.duration||0)}`; }
  const selEl = $("#segClip"); selEl.innerHTML = S.clips.map(c => `<option value="${c.id}">${esc(c.name)}${c.on?"":" (off)"}</option>`).join(""); selEl.value = order[S.sel.i] || "";
  if(document.activeElement !== $("#segLen")) $("#segLen").value = (s.b - s.a).toFixed(2);
  $("#segMerge").disabled = S.sel.i >= segs.length - 1;
  $("#segTr").value = sl.tr || ""; $("#segTr").disabled = S.sel.i === 0; $("#segTr").title = S.sel.i === 0 ? "The first clip has nothing to transition from" : "";
  $("#segMoRow").hidden = !(clip && clip.kind === "img"); $("#segMo").value = sl.mo || "";
  const fx = fxOf(S.sel.i); $$("#segFit button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === fx.fit)));
  if(document.activeElement !== $("#segZoom")){ $("#segZoom").value = Math.round(fx.z * 100); $("#segZoomVal").textContent = Math.round(fx.z * 100) + "%"; }
  if(document.activeElement !== $("#segX")) $("#segX").value = fx.x; if(document.activeElement !== $("#segY")) $("#segY").value = fx.y;
  $("#segFxReset").disabled = !sl.fx;
  $("#segCard").classList.toggle("gen-clip", !!(clip && clip.kind === "gen"));
}
function cycleSeg(i){ const {order} = segInfo(), pool = S.clips.filter(c=>c.on); if(!pool.length) return; const k = pool.findIndex(c=>c.id===order[i]); setSlot(i, {c: pool[(k+1)%pool.length].id, in: null}); syncSegCard(); }
const esc = s => String(s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));

/* ============ tap sync ============ */
let tapBackup = null;
function startTap(){
  if(!S.P.words.length){ toast("Add lyrics first, then press Apply lyrics"); return; }
  tapBackup = JSON.stringify(S.P.words); S.tap = {i:0}; selectNone();
  S.t = S.P.section.a; play({}); updateTapPad(); tlDirty = true;
}
function tapNow(){
  if(!S.tap) return;
  const now = songTime(), ws = S.P.words, i = S.tap.i; if(i >= ws.length) return;
  ws[i].t = now; ws[i].d = 0.45;
  if(i > 0){ const p = ws[i-1], gap = now - p.t; p.d = clamp(p.l !== ws[i].l ? Math.min(gap, 0.9) : gap, 0.06, 2.5); }
  S.tap.i++; tlDirty = true;
  if(S.tap.i >= ws.length){ endTap(true); } else updateTapPad();
}
function endTap(done){
  if(!done && tapBackup){ S.P.words = JSON.parse(tapBackup); }
  S.tap = null; tapBackup = null; sortWords(); dirty(); updateTapPad(); if(done) toast("Lyrics synced. Fine-tune by dragging words on the timeline.");
}
function updateTapPad(){
  const on = !!S.tap; $("#tapStart").hidden = on; $("#tapCancel").hidden = !on;
  $("#tapLabel").textContent = on ? `Word ${S.tap.i+1} of ${S.P.words.length}` : "Tap sync";
  if(on){ const ws = S.P.words; $("#tapNext").textContent = ws[S.tap.i]?.w || ""; $("#tapAfter").textContent = ws.slice(S.tap.i+1, S.tap.i+5).map(w=>w.w).join(" ") || "last word"; }
  else { $("#tapNext").textContent = "Press start, then tap each word"; $("#tapAfter").textContent = "Space bar or tap here as each word is sung"; }
}
$("#tapStart").onclick = startTap;
// "Do the timing by hand": to the tap pad, ready to start
$("#toTap").onclick = () => { const p = $("#tapPad"); p.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => $("#tapStart").focus({ preventScroll: true }), 350); };
$("#tapCancel").onclick = () => { pause(); endTap(false); };
$("#tapPad").addEventListener("pointerdown", e => { if(S.tap && !e.target.closest("button")){ e.preventDefault(); tapNow(); } });

/* ============ project <-> UI ============ */
function updateMeta(){
  const P = S.P, curLen = P.section.b - P.section.a;
  const setIn = (id, v) => { const el = $(id); if(el && document.activeElement !== el) el.value = (Math.round(v*10)/10).toString(); };
  setIn("#secLenIn", curLen); setIn("#secStartIn", P.section.a); setIn("#secEndIn", P.section.b); $$("#secLen button").forEach(b => b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.v - curLen) < 0.05))); $("#songName").textContent = S.songName === "Demo track" ? SLS_DEMO.label : S.songName;
  $("#songMeta").textContent = S.audio ? `${fmt(S.audio.duration)} · section ${fmt(P.section.a)} to ${fmt(P.section.b)} (${(P.section.b-P.section.a).toFixed(1)}s)` : "";
}
function syncCutUI(){ const m = S.P.cuts.mode;
  $$("#cutOrder button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (S.P.cuts.order || "shuffle"))));
  $$("#cutTrans button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (S.P.cuts.transition || "none"))));
  const fxA = {...FX0, ...(S.P.cuts.fx || {})};
  $$("#cutMotion button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (S.P.cuts.motion || "still"))));
  $$("#cutFit button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === fxA.fit)));
  if(document.activeElement !== $("#cutZoom")){ $("#cutZoom").value = Math.round(fxA.z * 100); $("#cutZoomVal").textContent = Math.round(fxA.z * 100) + "%"; }
  $("#xfField").hidden = (S.P.cuts.transition || "none") === "none" && !(S.P.cuts.slots || []).some(sl => sl && sl.tr && sl.tr !== "none"); $("#xfDur").value = S.P.cuts.xf ?? 0.35; $("#xfDurVal").textContent = (+(S.P.cuts.xf ?? 0.35)).toFixed(2) + "s";
  $$("#cutMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === m)));
  $("#cutCountField").hidden = m !== "count"; $("#cutEveryField").hidden = m !== "beat"; $("#cutManualField").hidden = m !== "manual";
}
function syncHookUI(){ const h = S.P.hook, len = S.P.section.b - S.P.section.a;
  fillFonts("#hFont");
  $$("#hLook button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (h.look || "pill"))));
  $("#hFont").value = h.font || "sans"; $("#hSize").value = h.size || 1; $("#hColor").value = h.color || "#ffffff"; $("#hBg").value = h.bg || "#000000"; $("#hAnim").value = h.anim || "fade";
  $("#hX").value = h.x ?? 0.5; $("#hY").value = h.y ?? 0.09;
  $("#hStart").max = Math.max(0, len - 0.5); $("#hStart").value = h.start || 0; $("#hStartVal").textContent = (+(h.start||0)).toFixed(2) + "s";
  $("#hDur").max = Math.max(0.5, len); $("#hDur").value = h.dur; $("#hDurVal").textContent = (+h.dur).toFixed(2) + "s";
  $("#hBg").parentElement.style.opacity = (h.look === "caption") ? 0.4 : 1;
}
function syncUI(){ setTimeout(syncTextEditor, 0);
  const P = S.P, st = P.style;
  $("#lyricsText").value = P.lyrics; $("#bpm").value = P.bpm;
  $("#sX").value = st.x ?? 0.5; paintSizePx(); $("#sY").value = st.y; $("#sScrim").value = st.scrim;
  $("#sCase").value = st.case; $("#sColor").value = st.color; syncStylePanel(); syncShift();
  $$("#sShow button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (st.show || "words")))); $("#sTrans").value = st.trans || "template";
  $$("#hookSeg button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.v === "on") === !!P.hook.on))); $("#hFields").hidden = !P.hook.on; $("#hOffHint").hidden = !!P.hook.on; syncHookUI(); $("#hText").value = P.hook.text; $("#hDur").value = P.hook.dur; $("#hDurVal").textContent = (+P.hook.dur).toFixed(1) + "s";
  $$("#presets .preset").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === st.preset)));
  $$("#cutEvery button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === P.cuts.every)));
  $$("#cutMode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === P.cuts.mode)));
  syncCutUI();
  $("#cutCount").value = P.cuts.count; $("#cutCountVal").textContent = P.cuts.count;
  syncFrameUI();
  const [W,H] = frameSize(P.aspect); if(stage.width !== W || stage.height !== H){ stage.width = W; stage.height = H; fitStage(); }
  const own = customSize(P.aspect); $("#stageHint").textContent = own ? `${own[0]}×${own[1]}` : `${W}×${H}`;
  updateMeta(); updateTapPad(); syncWordCard(); syncSegCard(); tlDirty = true; slsEmit("change");
}
let draftTimer;
function saveDraft(){ busyAt = performance.now(); clearTimeout(draftTimer); draftTimer = setTimeout(() => store.set("sls-draft", {songName:S.songName, P:S.P}), 400); queueHistory(); }

/* undo / redo: every change settles into a snapshot of the project (lyrics, timing, cuts, style, hook, soundbite) */
const HIST = {undo:[], redo:[], last:null, timer:null, max:120};
function queueHistory(){ clearTimeout(HIST.timer); HIST.timer = setTimeout(recordHistory, 300); }
function recordHistory(){ if(!S.P) return; const j = JSON.stringify(S.P); if(j === HIST.last) return;
  if(HIST.last != null){ HIST.undo.push(HIST.last); if(HIST.undo.length > HIST.max) HIST.undo.shift(); HIST.redo = []; }
  HIST.last = j; syncUndoUI(); }
function restoreSnapshot(j){
  S.P = JSON.parse(j); HIST.last = j;
  if(S.audio){ const d = S.audio.duration; S.P.section.b = Math.min(S.P.section.b, d); S.P.section.a = clamp(S.P.section.a, 0, Math.max(0, S.P.section.b - 1)); }
  S.t = clamp(S.t, S.P.section.a, S.P.section.b); S.sel = null;
  sortWords(); syncUI(); $("#lyricsText").value = S.P.lyrics || ""; renderPresetThumbs(); tlDirty = true;
  clearTimeout(draftTimer); draftTimer = setTimeout(() => store.set("sls-draft", {songName:S.songName, P:S.P}), 400); syncUndoUI();
}
function undo(){ clearTimeout(HIST.timer); recordHistory(); const j = HIST.undo.pop(); if(j == null){ toast("Nothing to undo"); return; } HIST.redo.push(HIST.last); restoreSnapshot(j); toast("Undone"); }
function redo(){ const j = HIST.redo.pop(); if(j == null){ toast("Nothing to redo"); return; } HIST.undo.push(HIST.last); restoreSnapshot(j); toast("Redone"); }
function syncUndoUI(){ const u = $("#undoBtn"), r = $("#redoBtn"); if(u) u.disabled = !HIST.undo.length && JSON.stringify(S.P) === HIST.last; if(r) r.disabled = !HIST.redo.length; }

function applyProject(p, keepSong){
  const base = defaultProject();
  S.P = {...base, ...p, style:{...base.style, ...(p.style||{})}, hook:{...base.hook, ...(p.hook||{})}, cuts:{...base.cuts, ...(p.cuts||{})}, section:{...base.section, ...(p.section||{})}};
  // photos stand still unless you pick a movement (since 26 Nov); projects saved before that keep the slow zoom they had
  if(p.cuts && !p.cuts.motion) S.P.cuts.motion = "zoom";
  S.P.words = (p.words || []).map(w => { const o = {w:String(w.w), l:+w.l||0, t:+w.t||0, d:+w.d||0.3}; if(w.u) o.u = 1; if(w.g) o.g = 1; if(w.alt) o.alt = String(w.alt); return o; });
  if(S.audio){ const dur = S.audio.duration; S.P.section.b = Math.min(S.P.section.b, dur); S.P.section.a = clamp(S.P.section.a, 0, Math.max(0, S.P.section.b - 1)); }
  if(!aspectOK(S.P.aspect)) S.P.aspect = "9:16";
  const OLD = {punch:"redline", outline:"hollow", glow:"voltage", type:"typewriter"}; if(OLD[S.P.style.preset]) S.P.style.preset = OLD[S.P.style.preset];
  if(!PRESETS.some(p => p.id === S.P.style.preset)) S.P.style.preset = "stack";
  S.t = S.P.section.a; S.sel = null; sortWords(); syncUI(); saveDraft();
}

/* ============ controls ============ */
// play continues from wherever the playhead is (back to the start once it reaches the end)
function playFromStart(){ play({}); }
$("#playBtn").onclick = () => { if(S.tap) return; S.playing ? pause() : play({}); };
$("#toStart").onclick = () => { S.t = bounds().a; if(S.playing) play({}); };
$("#applyLyrics").onclick = () => {
  const txt = $("#lyricsText").value, nw = parseLyrics(txt), old = S.P.words;
  S.P.lyrics = txt;
  if(nw.length === old.length && old.length){ nw.forEach((w,i) => { w.t = old[i].t; w.d = old[i].d; }); S.P.words = nw; }
  else { S.P.words = nw; autoSpace(S.P.words); }
  sortWords(); selectNone(); dirty(); toast(`${nw.length} words ready. Use tap sync to time them to the vocal.`);
};
$("#autoSpace").onclick = () => { S.P.lyrics = $("#lyricsText").value; S.P.words = parseLyrics(S.P.lyrics); autoSpace(S.P.words); selectNone(); dirty(); };
$("#lyricsText").addEventListener("input", () => { S.P.lyrics = $("#lyricsText").value; saveDraft(); });
const oneSel = () => { const st = selWords(); return st && st.size === 1 ? [...st][0] : null; };
$("#wText").oninput = e => { const w = oneSel(); if(w){ w.w = e.target.value.trim() || w.w; dirty(); } };
$("#wStart").onchange = e => { const w = oneSel(); if(w){ w.t = Math.max(0, +e.target.value); sortWords(); dirty(); } };
$("#wDur").onchange = e => { const w = oneSel(); if(w){ w.d = Math.max(0.05, +e.target.value); dirty(); } };
$("#wDelete").onclick = () => { const st = selWords(); if(st){ S.P.words = S.P.words.filter(w => !st.has(w)); selectNone(); dirty(); } };
$("#wNone").onclick = () => selectNone();
$("#selAll").onclick = () => selectAllWords();

$$(".tabs [data-tab]").forEach(b => b.onclick = () => showTab(b.dataset.tab));
/* phone sheets: move the existing panels into a bottom sheet, put them back when it closes */
const SHEETS = {
  lyrics: ["Lyrics", () => [$('[data-pane="lyrics"]')]],
  style: ["Templates", () => [$('[data-rpane="looks"]')]],
  font: ["Lyric text", () => [$('[data-rpane="type"]')]],
  clips: ["Clips", () => [$('[data-pane="clips"]')]],
  cuts: ["Transitions", () => [$('[data-pane="cuts"]')]],
  effects: ["Effects", () => [$('[data-pane="framing"]')]],
  hook: ["Hook", () => [$("#hookSeg").closest(".card")]],
  text: ["Text boxes", () => [$("#textCard")]],
  audio: ["Audio", () => [$("#vocalMode"), $(".tlbar")]],
  format: ["Format", () => [$(".stagebar"), $("#secRow")]]
};
let sheetOpen = null, sheetMoved = [];
const isPhone = () => window.matchMedia("(max-width:700px) and (pointer:coarse)").matches;
function closeSheet(){
  sheetMoved.reverse().forEach(m => { if(m.next && m.next.parentNode === m.parent) m.parent.insertBefore(m.el, m.next); else m.parent.appendChild(m.el); if(m.wasHidden != null) m.el.hidden = m.wasHidden; });
  sheetMoved = []; sheetOpen = null; $("#msheet").hidden = true; $("#msheet").classList.remove("tall"); $$("#mtools button").forEach(b => b.setAttribute("aria-pressed", "false"));
}
function openSheet(name){
  if(sheetOpen === name){ closeSheet(); return; } closeSheet();
  const [title, get] = SHEETS[name]; sheetOpen = name; $("#msheetTitle").textContent = title;
  get().filter(Boolean).forEach(el => { sheetMoved.push({el, parent: el.parentNode, next: el.nextSibling, wasHidden: el.hasAttribute("hidden") ? true : (el.dataset.pane ? false : null)}); el.hidden = false; $("#msheetBody").appendChild(el); });
  if(name === "style") renderPresetThumbs();
  if(name === "lyrics") syncWordCard();
  $("#msheet").style.bottom = $("#mtools").offsetHeight + "px"; $("#msheet").hidden = false; $("#msheetBody").scrollTop = 0;
  $$("#mtools button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sheet === name)));
}
$("#mtools").onclick = e => { const b = e.target.closest("[data-sheet]"); if(b) openSheet(b.dataset.sheet); };
$("#msheetDone").onclick = closeSheet;
$("#msheetPlay").onclick = () => $("#playBtn").click();   // the sheet covers the transport, so it has its own play button
/* the handle: tap for a taller panel, swipe down to close it */
{ let y0 = null, moved = 0; const sh = $("#msheet");
  $("#msheetGrab").onclick = () => { if(Math.abs(moved) < 8) sh.classList.toggle("tall"); moved = 0; };
  const down = e => { moved = 0; if(!e.target.closest(".msheet-grab, .msheet-h") || e.target.closest("button:not(.msheet-grab)")) return; y0 = e.clientY; };
  sh.addEventListener("pointerdown", down);
  addEventListener("pointermove", e => { if(y0 == null) return; moved = e.clientY - y0; if(moved > 0) sh.style.transform = `translateY(${moved}px)`; });
  addEventListener("pointerup", () => { if(y0 == null) return; y0 = null; sh.style.transform = "";
    if(moved > 70){ if(sh.classList.contains("tall")) sh.classList.remove("tall"); else closeSheet(); } else if(moved < -40) sh.classList.add("tall"); });
  addEventListener("pointercancel", () => { y0 = null; sh.style.transform = ""; }); }
window.matchMedia("(max-width:700px) and (pointer:coarse)").addEventListener("change", ev => { if(!ev.matches) closeSheet(); sizeTimeline(); fitStage(); });
/* the editing menu (left, CapCut style): Lyrics, Clips, Transitions (data-pane "cuts"), Effects ("framing"),
   Templates ("looks"), Text ("text": how the lyrics look, then the hook and text boxes) */
function showTab(name){ if(name === "style") name = "looks";
  document.body.dataset.mtab = name; $$(".tabs [data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".side > [data-pane]").forEach(p => p.hidden = p.dataset.pane !== name);
  if(name === "looks") renderPresetThumbs();
  if(name === "clips" || name === "cuts") openTimelineOnce(); }
// the clip timings are edited on the timeline, so it opens (once per visit) when you go to Clips
let tlOpenedForClips = false;
function openTimelineOnce(){ if(tlOpenedForClips || isPhone()) return; tlOpenedForClips = true; if(document.body.dataset.tl !== "open" && $("#tlToggle")) $("#tlToggle").click(); }
/* what used to be the right-hand panel lives in the menu now: Templates, and Text (with the text boxes under it) */
function showRTab(name){
  if(isPhone()) return;
  showTab(name === "looks" ? "looks" : "text");
  if(name === "titles"){ const t = $('[data-rpane="titles"]'); if(t) setTimeout(() => t.scrollIntoView({ block: "start", behavior: "smooth" }), 30); }
}

const bindStyle = (id, key, num) => $(id).addEventListener("input", e => { S.P.style[key] = num ? +e.target.value : e.target.value; saveDraft(); });
bindStyle("#sTrans", "trans");
$("#sShow").onclick = e => { const b = e.target.closest("button[data-v]"); if(!b) return; S.P.style.show = b.dataset.v; syncUI(); saveDraft(); };
/* Lyric size on a 0 to 100 scale. 50 is the template's own size; every step is the same visible change, so
   the low end goes far smaller (0 is 4% of normal) and the top end three times bigger. Stored as a multiplier. */
const SIZE_LO = 0.04, SIZE_HI = 3;
const sizeFromV = v => { v = clamp(+v || 0, 0, 100); return v <= 50 ? SIZE_LO * Math.pow(1 / SIZE_LO, v / 50) : Math.pow(SIZE_HI, (v - 50) / 50); };
const vFromSize = k => { k = clamp(+k || 1, SIZE_LO, SIZE_HI); return k <= 1 ? 50 * Math.log(k / SIZE_LO) / Math.log(1 / SIZE_LO) : 50 + 50 * Math.log(k) / Math.log(SIZE_HI); };
function paintSizePx(){
  const v = vFromSize(S.P.style.size || 1);
  if(document.activeElement !== $("#sSize")) $("#sSize").value = v.toFixed(1);
  if(document.activeElement !== $("#sizeNum")) $("#sizeNum").value = Math.round(v);
}
$("#sSize").addEventListener("input", e => { S.P.style.size = +sizeFromV(e.target.value).toFixed(4); $("#sizeNum").value = Math.round(+e.target.value); saveDraft(); });
$("#sizeNum").addEventListener("input", e => { const v = e.target.value; if(v === "" || isNaN(+v)) return; S.P.style.size = +sizeFromV(v).toFixed(4); $("#sSize").value = clamp(+v, 0, 100); saveDraft(); });
$("#sizeNum").addEventListener("change", e => { e.target.value = Math.round(clamp(+e.target.value || 0, 0, 100)); paintSizePx(); });
$("#sizeNum").addEventListener("keydown", e => { if(e.key === "Enter") e.target.blur(); });
bindStyle("#sX","x",true); bindStyle("#sY","y",true);
$("#sCenter").onclick = () => { S.P.style.x = 0.5; S.P.style.y = 0.5; syncUI(); saveDraft(); }; bindStyle("#sScrim","scrim",true); bindStyle("#sCase","case"); bindStyle("#sColor","color"); $("#sColor").addEventListener("change", renderPresetThumbs);
$("#sPf").onchange = e => setStyleOpt("pf", e.target.value);
$("#sSf").onchange = e => setStyleOpt("sf", e.target.value);
$("#hiSw").addEventListener("click", e => { const b = e.target.closest(".sw"); if(b) setStyleOpt("hi", b.dataset.c); });
$("#hiSw").addEventListener("change", e => { if(e.target.id === "hiCustom") setStyleOpt("hi", e.target.value); });
$("#styleFav").onclick = () => { const id = S.P.style.preset; favs.has(id) ? favs.delete(id) : favs.add(id); store.set(FAVKEY, [...favs]); syncStylePanel(); renderPresetGrid(); };
$("#styleVar").onclick = () => { const st = S.P.style, id = st.preset; st.vars = st.vars || {}; st.vars[id] = ((st.vars[id] || 0) + 1) % 12; renderPresetThumbs(); saveDraft(); };
$("#styleCats").onclick = e => { const b = e.target.closest("button"); if(!b) return; styleCat = b.dataset.v; renderPresetGrid(); };
$("#hLook").onclick = e => { const b = e.target.closest("button"); if(!b) return; const h = S.P.hook, [fc, bc] = HOOK_LOOKS[b.dataset.v]; h.look = b.dataset.v; h.color = fc; h.bg = bc; syncHookUI(); dirty(); };
const bindHook = (id, key, num, label) => $(id).addEventListener("input", e => { S.P.hook[key] = num ? +e.target.value : e.target.value; if(label) $(label).textContent = (+e.target.value).toFixed(2) + "s"; tlDirty = true; saveDraft(); });
bindHook("#hFont","font"); bindHook("#hSize","size",true); bindHook("#hColor","color"); bindHook("#hBg","bg"); bindHook("#hAnim","anim"); bindHook("#hX","x",true); bindHook("#hY","y",true);
bindHook("#hStart","start",true,"#hStartVal");
$("#hFont").addEventListener("change", e => document.fonts.load(fnt(e.target.value, 40)).catch(()=>{}));
["#hStart","#hDur","#hAnim"].forEach(id => $(id).addEventListener("change", () => { if(!S.playing){ S.t = S.P.section.a + (S.P.hook.start || 0) + 0.05; } }));
$("#hookSeg").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.P.hook.on = b.dataset.v === "on"; syncUI(); dirty(); };
$("#hText").oninput = e => { S.P.hook.text = e.target.value; dirty(); };
$("#hDur").oninput = e => { S.P.hook.dur = +e.target.value; $("#hDurVal").textContent = (+e.target.value).toFixed(2)+"s"; dirty(); };
$("#cutEvery").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.P.cuts.every = +b.dataset.v; resetSlots(); selectNone(); syncUI(); dirty(); };
$("#cutMode").onclick = async e => { const b = e.target.closest("button"); if(!b) return; if(b.dataset.v === "manual"){ toManualCuts(); dirty(); return; }
  if(b.dataset.v === "feel"){
    if(window.SLSVibe && !SLSVibe.cached()){ toast("Listening to the song…"); await SLSVibe.get(); }
    const f = feelCuts(); S.P.cuts.mode = "feel"; S.P.cuts.transition = f.tr; S.P.cuts.xf = f.xf; resetSlots(); selectNone(); syncUI(); dirty(); return; } S.P.cuts.mode = b.dataset.v; selectNone(); syncUI(); dirty(); };
$("#cutCount").oninput = e => { S.P.cuts.count = +e.target.value; resetSlots(); $("#cutCountVal").textContent = e.target.value; tlDirty = true; saveDraft(); };
$("#secLen").onclick = e => { const b = e.target.closest("button"); if(!b || !S.audio) return; const len = Math.min(+b.dataset.v, S.audio.duration), a = clamp(S.P.section.a, 0, S.audio.duration - len); setSection(a, a + len); syncUI(); };
const secMax = () => S.audio ? S.audio.duration : 60;
$("#secLenIn").onchange = e => { const len = clamp(+e.target.value || 15, 2, Math.min(60, secMax())), a = clamp(S.P.section.a, 0, secMax() - len); setSection(a, a + len); syncUI(); };
$("#secStartIn").onchange = e => { const len = S.P.section.b - S.P.section.a, a = clamp(+e.target.value || 0, 0, Math.max(0, secMax() - len)); setSection(a, a + len); syncUI(); };
$("#secEndIn").onchange = e => { const b = clamp(+e.target.value || 0, S.P.section.a + 2, Math.min(secMax(), S.P.section.a + 60)); if(S.playing) pause(); setSection(S.P.section.a, b, false, "end"); syncUI(); };
$("#secLenIn").oninput = e => { const v = +e.target.value; if(!(v >= 2) || S.playing) return; S.t = Math.min(S.P.section.a + Math.min(v, 60), secMax()) - 0.04; };
// hook timing: the preview follows the slider (start shows the hook appearing, length shows its last moment)
$("#hStart").addEventListener("input", () => { if(!S.playing) S.t = S.P.section.a + (S.P.hook.start || 0) + 0.05; });
$("#hDur").addEventListener("input", () => { if(!S.playing) S.t = Math.min(S.P.section.b - 0.04, S.P.section.a + (S.P.hook.start || 0) + S.P.hook.dur - 0.05); });
slsOn("vibe", () => { if(S.P.cuts.mode === "feel") syncCutUI(); });
$("#cutOrder").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.P.cuts.order = b.dataset.v; S.P.cuts.slots = null; syncCutUI(); dirty(); };
$("#cutTrans").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.P.cuts.transition = b.dataset.v; syncCutUI(); saveDraft(); if(!S.playing){ const {segs} = segInfo(); const k = segs.findIndex(x => x.a > S.t); if(k > 0){ S.t = segs[k].a - 0.6; play({}); } } };
function addCutAt(t0){ if(S.locks.cuts){ toast("The cuts track is locked"); return false; } toManualCuts(); const t = snapTime(t0, 2), {a,b} = S.P.section; if(t <= a + 0.15 || t >= b - 0.15){ toast("Move the playhead inside the soundbite first"); return false; }
  if(S.P.cuts.points.some(p => Math.abs(p - t) < 0.15)){ toast("There's already a cut there"); return false; }
  { const {segs} = segInfo(), i = segs.findIndex(g => t > g.a && t < g.b), sl = materializeSlots(); if(i >= 0 && sl[i]){ const sp = sl[i].sp || 1; sl.splice(i + 1, 0, {c: sl[i].c, in: resolvedIn(i) + (t - segs[i].a)*sp, sp}); } }
  S.P.cuts.points.push(t); S.P.cuts.points.sort((x,y)=>x-y); dirty(); toast("Split at " + fmt(t - a)); return true; }
function removeCutNear(dir){ if(S.locks.cuts){ toast("The cuts track is locked"); return; } toManualCuts(); const t = songTime(), pts = S.P.cuts.points.slice().sort((x,y)=>x-y);
  const p = dir < 0 ? pts.filter(x => x <= t + 0.001).pop() : pts.find(x => x > t + 0.001); if(p == null){ toast(`No cut ${dir < 0 ? "left" : "right"} of the playhead`); return; }
  { const k = pts.indexOf(p), sl = materializeSlots(); if(k >= 0 && sl[k+1]) sl.splice(k+1, 1); }
  S.P.cuts.points = pts.filter(x => x !== p); selectNone(); dirty(); toast("Cut removed"); }
function deleteSelection(){ if(S.sel?.type === "text"){ deleteText(S.sel.id); return; } if(S.sel?.type === "aux"){ removeAux(S.sel.j); return; } if(selWords()){ if(S.locks.lyrics){ toast("The lyrics track is locked"); return; } $("#wDelete").click(); return; }
  if(S.sel?.type === "seg"){ $("#cutRemove").click(); return; }
  if(S.selMarker != null){ S.P.markers = (S.P.markers||[]).filter((m,i) => i !== S.selMarker); S.selMarker = null; dirty(); return; } toast("Select some lyrics or a clip first"); }
function selectSide(dir){ if(S.locks.lyrics){ toast("The lyrics track is locked"); return; } const t = songTime(), ws = S.P.words.filter(w => dir < 0 ? w.t + w.d <= t + 0.001 : w.t >= t - 0.001);
  if(!ws.length){ toast(`No lyrics ${dir < 0 ? "left" : "right"} of the playhead`); selectNone(); return; } S.sel = {type:"words", set:new Set(ws)}; tlDirty = true; showTab("lyrics"); syncWordCard(); toast(`${ws.length} words selected`); }
function addMarker(){ const t = songTime(); S.P.markers = S.P.markers || []; if(S.P.markers.some(m => Math.abs(m - t) < 0.05)) return; S.P.markers.push(+t.toFixed(3)); S.P.markers.sort((x,y)=>x-y); dirty(); toast("Marker added. Double-click it on the bar ruler to remove."); }
function setTool(name){ S.tool = name; const item = $(`#toolMenu [data-tool="${name}"]`); if(item) $("#toolIco").innerHTML = item.querySelector("svg").outerHTML;
  $$("#toolMenu [data-tool]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.tool === name))); $("#toolBtn").dataset.tip = name === "split" ? "Split tool: click the timeline to cut (B)" : "Select tool: drag to box-select (A)"; tl.style.cursor = name === "split" ? "crosshair" : ""; }
$("#toolBtn").onclick = e => { e.stopPropagation(); const m = $("#toolMenu"); m.hidden = !m.hidden; $("#toolBtn").setAttribute("aria-expanded", String(!m.hidden)); };
$("#toolMenu").onclick = e => { const b = e.target.closest("[data-tool]"); if(!b) return; const k = b.dataset.tool; $("#toolMenu").hidden = true; $("#toolBtn").setAttribute("aria-expanded","false");
  if(k === "selLeft") selectSide(-1); else if(k === "selRight") selectSide(1); else setTool(k); };
document.addEventListener("click", e => { if(!e.target.closest(".tmenu-wrap")){ $("#toolMenu").hidden = true; $("#toolBtn").setAttribute("aria-expanded","false"); } });
$("#splitBtn").onclick = () => addCutAt(songTime());
$("#delLeftBtn").onclick = () => removeCutNear(-1);
$("#delRightBtn").onclick = () => removeCutNear(1);
$("#deleteBtn").onclick = deleteSelection;
$("#markerBtn").onclick = addMarker;
$("#cutAdd").onclick = () => addCutAt(songTime());
$("#cutReset").onclick = () => { S.P.cuts.mode = "beat"; delete S.P.cuts.points; resetSlots(); selectNone(); syncCutUI(); dirty(); };
function deleteClip(i){
  if(S.locks.cuts){ toast("The cuts track is locked"); return; } const {segs} = segInfo(); if(segs.length < 2){ toast("This is the only clip"); return; }
  toManualCuts(); const sl = materializeSlots(), pts = S.P.cuts.points.slice().sort((a,b) => a-b);
  if(i > 0){ const t = segs[i].a; S.P.cuts.points = pts.filter(p => Math.abs(p - t) > 0.001); sl.splice(i, 1); }
  else { const t = segs[1].a, len0 = segs[0].b - segs[0].a, n = sl[1]; if(n){ const r = resolvedIn(1); n.in = Math.max(0, r - len0*(n.sp || 1)); }
    S.P.cuts.points = pts.filter(p => Math.abs(p - t) > 0.001); sl.splice(0, 1); }
  S.P.cuts.slots = sl; selectNone(); dirty(); toast("Clip deleted"); }
$("#cutRemove").onclick = () => { if(S.sel?.type === "seg") deleteClip(S.sel.i); };
$("#vocalMode").onclick = e => { const b = e.target.closest("button"); if(!b || S.exporting) return; if(b.dataset.v === "inst" && e.shiftKey){ $("#instFile").click(); return; } setVocal(b.dataset.v); };
$("#instFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  try {
    const buf = await ctx().decodeAudioData(await f.arrayBuffer());
    S.inst = buf; S.instName = f.name.replace(/\.[^.]+$/, ""); const diff = Math.abs(buf.duration - S.audio.duration);
    await setVocal("inst");
    toast(diff > 1.5 ? `Instrumental loaded, but it's ${diff.toFixed(1)}s ${buf.duration > S.audio.duration ? "longer" : "shorter"} than the song. Check the timing still lines up.` : "Instrumental loaded. Your lyric timing stays the same.");
  } catch { toast("That file couldn't be decoded. Try an MP3, WAV or M4A."); }
};
$("#lrcFile").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  const r = parseTimed(await f.text()); if(!r.words.length){ toast("No timed lines found in that file"); return; }
  S.P.words = r.words; S.P.lyrics = r.lyrics; $("#lyricsText").value = r.lyrics; sortWords();
  const first = r.words[0].t, last = r.words[r.words.length-1].t, {a,b} = S.P.section;
  if(first > b || last < a){ const len = b - a; setSection(Math.max(0, first - 0.3), Math.max(0, first - 0.3) + len); }
  selectNone(); syncUI(); dirty(); toast(`${r.words.length} words imported from ${f.name}`); };
$("#lrcOut").onclick = async () => { if(!S.P.words.length) return toast("No timed lyrics yet"); const ok = await saveFile(`${(S.songName||"lyrics").replace(/[^\w\- ]+/g,"").trim()}.lrc`, toLRC()); if(ok === false) toast("Saving files isn't available in this view"); };
$("#srtOut").onclick = async () => { if(!S.P.words.length) return toast("No timed lyrics yet"); const ok = await saveFile(`${(S.songName||"lyrics").replace(/[^\w\- ]+/g,"").trim()}.srt`, toSRT()); if(ok === false) toast("Saving files isn't available in this view"); };
/* Frame: Vertical / Horizontal, then the shape (9:16, 4:5, 1:1 or the same turned on its side), or Custom: your own size */
let framePref = null, ownOpen = false;   // framePref: "v" or "h" for a square frame; ownOpen: the size box is showing
const familyOf = a => customSize(a) ? "own" : a === "9:16" || a === "16:9" ? "tall" : a === "4:5" || a === "5:4" ? "mid" : "sq";
const orientOf = a => { const [w, h] = frameSize(a); return w > h ? "h" : h > w ? "v" : (framePref || "v"); };
function syncFrameUI(){
  const a = S.P.aspect, o = orientOf(a), fam = familyOf(a), h = o === "h";
  $$("#orient button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === o)));
  const lab = { tall: h ? "16:9" : "9:16", mid: h ? "5:4" : "4:5", sq: "1:1", own: "Custom" };
  $$("#aspect button").forEach(b => { b.textContent = lab[b.dataset.v]; b.setAttribute("aria-pressed", String(b.dataset.v === (ownOpen ? "own" : fam))); });
  $("#ownSize").hidden = !(ownOpen || fam === "own");
  if(fam === "own" && !ownOpen && !$("#ownSize").contains(document.activeElement)) fillOwn();   // a project opened with your own size shows it
}
function setFrame(a){ if(!aspectOK(a) || a === S.P.aspect){ syncFrameUI(); return; } S.P.aspect = a; syncUI(); saveDraft(); }
function fillOwn(){   // the size box starts from the frame you have: your own size, or the shape at 1080 px on its short side
  const c = customSize(S.P.aspect), [w, h] = c || (([fw, fh]) => { const k = 1080 / Math.min(fw, fh); return [evenPx(fw * k), evenPx(fh * k)]; })(frameSize());
  $("#ownW").value = w; $("#ownH").value = h; $("#ownErr").textContent = "";
}
$("#orient").onclick = e => {
  const b = e.target.closest("button[data-v]"); if(!b) return; const want = b.dataset.v, a = S.P.aspect;
  framePref = want;
  if(orientOf(a) === want && familyOf(a) !== "sq"){ syncFrameUI(); return; }
  const c = customSize(a);
  if(c){ if(c[0] !== c[1]) setFrame(`${c[1]}x${c[0]}`); else syncFrameUI(); }   // your own size, turned on its side
  else setFrame(MIRROR[a] || a);
  if(!$("#ownSize").hidden) fillOwn();   // the size box shows the frame you now have
};
$("#aspect").onclick = e => {
  const b = e.target.closest("button[data-v]"); if(!b) return; const fam = b.dataset.v, h = orientOf(S.P.aspect) === "h";
  if(fam === "own"){ ownOpen = true; fillOwn(); syncFrameUI(); setTimeout(() => $("#ownW").focus(), 0); return; }
  ownOpen = false;
  setFrame(fam === "tall" ? (h ? "16:9" : "9:16") : fam === "mid" ? (h ? "5:4" : "4:5") : "1:1");
};
$("#ownSize").onsubmit = e => {
  e.preventDefault();
  const w = evenPx(+$("#ownW").value), h = evenPx(+$("#ownH").value), bad = sizeProblem(+$("#ownW").value, +$("#ownH").value);
  if(bad){ $("#ownErr").textContent = bad; return; }
  $("#ownErr").textContent = ""; $("#ownW").value = w; $("#ownH").value = h;
  framePref = w > h ? "h" : h > w ? "v" : framePref; ownOpen = false;
  setFrame(`${w}x${h}`); toast(`Frame: ${w}×${h} px. The video is exported at exactly this size.`);
};
/* Shuffle: a new random order on every press, as often as you like. It always differs from the order on screen
   (when there's more than one possible order), and clips kept "in the order added" (a photo slideshow) switch to
   shuffled, or the press would do nothing. */
$("#shuffleBtn").onclick = () => {
  if(S.clips.filter(c => c.on).length < 2){ toast("Add another clip or photo to shuffle"); return; }
  const before = segInfo().order.join(",");
  if(S.P.cuts.order === "inorder"){ S.P.cuts.order = "shuffle"; toast("Clips now play in a random order"); }
  resetSlots();
  for(let k = 0; k < 40; k++){
    S.P.cuts.seed = 1 + Math.floor(Math.random() * 999999);
    if(segInfo().order.join(",") !== before) break;
  }
  syncCutUI(); syncSegCard(); dirty();
};
$("#segStart").oninput = e => { if(S.sel?.type !== "seg") return; const i = S.sel.i, v = +e.target.value; setSlot(i, {in: v}); const inf = segInfo(); if(!S.playing) S.t = inf.segs[i].a + 0.001;
  const clip = S.clips.find(c => c.id === inf.order[i]); $("#segStartVal").textContent = `${fmt(v)} of ${fmt(clip?.el?.duration||0)}`; };
$("#segClip").onchange = e => { if(S.sel?.type === "seg"){ setSlot(S.sel.i, {c: e.target.value, in: null}); syncSegCard(); } };
/* ---- timing of the selected clip: its length, split, join ---- */
function setSegLength(i, L){
  if(S.locks.cuts){ toast("The cuts track is locked"); return; }
  toManualCuts(); materializeSlots();
  const {segs} = segInfo(), g = segs[i]; if(!g) return; const pts = S.P.cuts.points.slice().sort((a, b) => a - b), MIN = 0.2;
  if(i < segs.length - 1){ const nx = segs[i + 1]; pts[i] = +clamp(g.a + L, g.a + MIN, nx.b - MIN).toFixed(3); }
  else if(i > 0){ const pv = segs[i - 1]; pts[i - 1] = +clamp(g.b - L, pv.a + MIN, g.b - MIN).toFixed(3); }
  else { toast("Add a cut first: this clip fills the whole soundbite."); return; }
  S.P.cuts.points = pts; dirty(); syncSegCard();
}
$("#segLen").onchange = e => { if(S.sel?.type === "seg") setSegLength(S.sel.i, +e.target.value || 0.2); };
$("#segLen").onkeydown = e => { if(e.key === "Enter") e.target.blur(); };
$("#segShorter").onclick = () => { if(S.sel?.type !== "seg") return; const g = segInfo().segs[S.sel.i]; if(g) setSegLength(S.sel.i, g.b - g.a - 0.1); };
$("#segLonger").onclick = () => { if(S.sel?.type !== "seg") return; const g = segInfo().segs[S.sel.i]; if(g) setSegLength(S.sel.i, g.b - g.a + 0.1); };
$("#segSplit").onclick = () => { const t = songTime(); if(addCutAt(t)){ const {segs} = segInfo(), i = segs.findIndex(g => t >= g.a - 0.01 && t < g.b); if(i >= 0) selectSeg(i); } };
$("#segMerge").onclick = () => { if(S.sel?.type !== "seg") return; const i = S.sel.i, {segs} = segInfo(); if(i >= segs.length - 1){ toast("This is the last clip"); return; } deleteClip(i + 1); selectSeg(i); };
/* ---- transition and framing of the selected clip ---- */
$("#segTr").onchange = e => { if(S.sel?.type !== "seg") return; setSlot(S.sel.i, {tr: e.target.value || undefined}); syncSegCard(); const g = segInfo().segs[S.sel.i]; if(g && !S.playing && S.sel.i > 0){ S.t = Math.max(S.P.section.a, g.a - 0.5); play({}); } };
$("#segMo").onchange = e => { if(S.sel?.type !== "seg") return; setSlot(S.sel.i, {mo: e.target.value || undefined}); syncSegCard(); };
function setSegFx(patch){ if(S.sel?.type !== "seg") return; const i = S.sel.i, own = slotOf(i).fx || {}; setSlot(i, {fx: {...fxOf(i), ...own, ...patch}}); if(!S.playing){ const g = segInfo().segs[i]; if(g && (S.t < g.a || S.t >= g.b)) S.t = g.a + Math.min(0.4, (g.b - g.a)/2); } syncSegCard(); }
$("#segFit").onclick = e => { const b = e.target.closest("button"); if(b) setSegFx({fit: b.dataset.v}); };
$("#segZoom").oninput = e => { $("#segZoomVal").textContent = e.target.value + "%"; setSegFx({z: +e.target.value / 100}); };
$("#segX").oninput = e => setSegFx({x: +e.target.value});
$("#segY").oninput = e => setSegFx({y: +e.target.value});
$("#segFxReset").onclick = () => { if(S.sel?.type !== "seg") return; setSlot(S.sel.i, {fx: undefined}); syncSegCard(); };
$("#segFxAll").onclick = () => { if(S.sel?.type !== "seg") return; S.P.cuts.fx = fxOf(S.sel.i); (S.P.cuts.slots || []).forEach(sl => { if(sl) delete sl.fx; }); syncCutUI(); syncSegCard(); dirty(); toast("Every cut now uses this framing"); };
/* ---- for all clips: photo movement and framing ---- */
$("#cutMotion").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.P.cuts.motion = b.dataset.v; syncCutUI(); saveDraft(); };
$("#cutFit").onclick = e => { const b = e.target.closest("button"); if(!b) return; S.P.cuts.fx = {...FX0, ...(S.P.cuts.fx || {}), fit: b.dataset.v}; syncCutUI(); saveDraft(); };
$("#cutZoom").oninput = e => { S.P.cuts.fx = {...FX0, ...(S.P.cuts.fx || {}), z: +e.target.value / 100}; $("#cutZoomVal").textContent = e.target.value + "%"; saveDraft(); };
const setSpeed = v => { if(S.sel?.type !== "seg") return; v = clamp(+v, 0.25, 4); setSlot(S.sel.i, {sp: v}); syncSegCard(); };
$("#segSpeed").oninput = e => setSpeed(e.target.value);
$("#segSpeedP").onclick = e => { const b = e.target.closest("button"); if(b) setSpeed(b.dataset.v); };
$("#xfDur").oninput = e => { S.P.cuts.xf = +e.target.value; $("#xfDurVal").textContent = (+e.target.value).toFixed(2) + "s"; saveDraft(); };
$("#bpm").onchange = e => { S.P.bpm = clamp(+e.target.value || 120, 40, 240); e.target.value = S.P.bpm; dirty(); };
$("#setDownbeat").onclick = () => { S.P.offset = Math.round(songTime()*1000)/1000; dirty(); toast("Beat 1 set at " + fmt(S.P.offset)); };
$("#snapBtn").onclick = () => toggleSnap();
function toggleSnap(){ S.snap = !S.snap; const b = $("#snapBtn"); b.classList.toggle("on", S.snap); b.setAttribute("aria-pressed", String(S.snap)); b.dataset.tip = `Turn ${S.snap ? "off" : "on"} auto snapping (N)`; b.setAttribute("aria-label", b.dataset.tip); }
$("#zoom").oninput = e => setZoom(+e.target.value);
$("#zoomIn").onclick = () => setZoom(S.zoom*1.5, xOf(songTime()) - tlScroll.scrollLeft);
$("#zoomOut").onclick = () => setZoom(S.zoom/1.5, xOf(songTime()) - tlScroll.scrollLeft);
$("#zoomFit").onclick = () => setZoom(1);
try { Object.assign(S.locks, JSON.parse(localStorage.getItem("sls-locks") || "{}")); } catch {}
const ICONS = {
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1"/></svg>',
  spk:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  more:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
};
const lkBtn = (k, label) => `<button class="lk" data-lock="${k}" aria-pressed="false" title="Lock ${label}" aria-label="Lock ${label}">${ICONS.lock}</button>`;
const actBtn = (act, i, icon, title, on) => `<button class="lk${on ? " off" : ""}" data-act="${act}" data-i="${i}" title="${title}" aria-label="${title}">${icon}</button>`;
function renderHeads(){ const h = $("#tlHeads"); if(!h || !S.P) return; const T = tTracks(), A = S.P.aux || [], out = [];
  out.push(`<div><button class="addtrk" id="addTrack" title="Add a text or audio track" aria-label="Add a track" aria-haspopup="menu">${ICONS.plus}Track</button></div>`);
  for(let i = T.length - 1; i >= 0; i--) out.push(`<div style="color:var(--hook)"><span>${i ? "Text " + (i + 1) : "Text"}</span><span class="tb">${actBtn("hide", i, T[i].hide ? ICONS.eyeOff : ICONS.eye, T[i].hide ? "Show this text track" : "Hide this text track", T[i].hide)}${lkBtn(i ? "t" + i : "hook", i ? "text track " + (i + 1) : "the text track (hook and text boxes)")}${i ? actBtn("deltext", i, ICONS.x, "Delete this text track") : ""}</span></div>`);
  out.push(`<div style="color:var(--lyric)"><span>Lyrics</span><span class="tb">${lkBtn("lyrics", "the lyrics track")}</span></div>`);
  out.push(`<div style="color:var(--clip)"><span>Cuts</span><span class="tb">${lkBtn("cuts", "the cuts track")}</span></div>`);
  out.push(`<div><span>Audio</span><span class="tb">${actBtn("mute", -1, S.P.mainMute ? ICONS.mute : ICONS.spk, S.P.mainMute ? "Unmute the song" : "Mute the song", S.P.mainMute)}${lkBtn("audio", "the audio track")}${actBtn("more", -1, ICONS.more, "Song volume")}</span></div>`);
  A.forEach((a, j) => out.push(`<div class="th-aux" title="${esc(a.name)}"><span>${esc(a.name)}</span><span class="tb">${actBtn("mute", j, a.mute ? ICONS.mute : ICONS.spk, a.mute ? "Unmute this track" : "Mute this track", a.mute)}${lkBtn("a" + j, "this audio track")}${actBtn("more", j, ICONS.more, "Volume, rename, replace or delete")}</span></div>`));
  h.innerHTML = out.join("");
  h.style.gridTemplateRows = [20, ...T.map(() => 22), 34, 40, 40, ...A.map(() => 30)].map(v => v + "px").join(" ");
  syncLocks(); }
function syncLocks(){ $$("#tlHeads .lk[data-lock]").forEach(b => b.setAttribute("aria-pressed", String(lockState(b.dataset.lock)))); tlDirty = true; }
function setLock(k){ let on;
  if(/^t\d+$/.test(k)){ const tk = tTracks()[+k.slice(1)]; tk.lock = on = !tk.lock; dirty(); }
  else if(/^a\d+$/.test(k)){ const au = S.P.aux[+k.slice(1)]; au.lock = on = !au.lock; dirty(); }
  else { S.locks[k] = on = !S.locks[k]; if(k === "lyrics" && on) selectNone(); try { localStorage.setItem("sls-locks", JSON.stringify(S.locks)); } catch {} }
  syncLocks(); const nm = {hook:"Text", lyrics:"Lyrics", cuts:"Cuts", audio:"Audio"}[k] || (k[0] === "t" ? "Text " + (+k.slice(1) + 1) : "Audio");
  toast(`${nm} track ${on ? "locked" : "unlocked"}`); }
function addTextTrack(){ const T = tTracks(); T.push({}); dirty(); refreshTracks(); toast(`Text ${T.length} track added. New text goes on the lowest free track.`); }
function deleteTextTrack(i){ const T = tTracks(); if(!i || i >= T.length) return; if(textTrackLocked(i)){ toast("That text track is locked"); return; }
  const n = (S.P.texts || []).filter(o => (o.tr || 0) === i).length;
  S.P.texts = (S.P.texts || []).filter(o => (o.tr || 0) !== i); S.P.texts.forEach(o => { if((o.tr || 0) > i) o.tr--; }); T.splice(i, 1);
  if(S.sel?.type === "text" && !textById(S.sel.id)) S.sel = null; syncTextEditor(); dirty(); refreshTracks(); toast(n ? `Track deleted with ${n} text${n > 1 ? "s" : ""}. ⌘Z brings it back.` : "Text track deleted"); }
function auxPeaks(id){ if(S.auxPk[id]) return S.auxPk[id]; const buf = S.auxBuf[id], d = buf.getChannelData(0), n = Math.min(4000, Math.max(200, Math.ceil(buf.duration * 50))), pk = new Float32Array(n), st = Math.max(1, Math.floor(d.length / n / 40));
  let mx = 0; for(let i = 0; i < n; i++){ const i0 = Math.floor(i * d.length / n), i1 = Math.floor((i + 1) * d.length / n); let m = 0; for(let k = i0; k < i1; k += st) m = Math.max(m, Math.abs(d[k])); pk[i] = m; mx = Math.max(mx, m); }
  if(mx > 0) for(let i = 0; i < n; i++) pk[i] /= mx; return S.auxPk[id] = pk; }
let auxTarget = null;
function pickAuxFile(j){ auxTarget = j ?? null; const f = $("#auxFile"); f.value = ""; f.click(); }
$("#auxFile").addEventListener("change", async e => { const f = e.target.files[0]; if(!f) return;
  try { const buf = await ctx().decodeAudioData(await f.arrayBuffer()); const nm = f.name.replace(/\.[^.]+$/, "");
    let au = auxTarget != null ? S.P.aux[auxTarget] : null;
    if(au){ S.auxBuf[au.id] = buf; delete S.auxPk[au.id]; if(!au.name || au.name === "Audio") au.name = nm; }
    else { const len = S.P.section.b - S.P.section.a; au = {id: "a" + Date.now().toString(36), name: nm, start: clamp(+(songTime() - S.P.section.a).toFixed(2), 0, Math.max(0, len - 0.5)), vol: 1, mute: false};
      S.P.aux = S.P.aux || []; S.P.aux.push(au); S.auxBuf[au.id] = buf; S.sel = {type:"aux", j: S.P.aux.length - 1}; }
    dirty(); refreshTracks(); restartAudio(); toast(`“${nm}” added as an audio track. Drag it to place it.`);
  } catch(err){ toast("Couldn't read that audio file"); } auxTarget = null; });
function removeAux(j){ const A = S.P.aux || []; if(!A[j]) return; if(lockState("a" + j)){ toast("That audio track is locked"); return; }
  const [au] = A.splice(j, 1); if(S.sel?.type === "aux") S.sel = null; closeAuxPop(); dirty(); refreshTracks(); restartAudio(); toast(`“${au.name}” removed. ⌘Z brings it back.`); }
function closeAuxPop(){ $("#auxPop").hidden = true; }
function openAuxPop(j, anchor){ const p = $("#auxPop"), main = j < 0, au = main ? null : S.P.aux[j], vol = main ? (S.P.mainVol ?? 1) : (au.vol ?? 1);
  p.innerHTML = (main ? `<b>Song volume</b>` : `<input type="text" id="apName" value="${esc(au.name)}" aria-label="Track name">`) +
    `<label><span>Volume</span><input type="range" id="apVol" min="0" max="2" step="0.05" value="${vol}"><output id="apVolV">${Math.round(vol * 100)}%</output></label>` +
    (main ? "" : `<div class="row"><button class="btn small" id="apReplace">Replace file</button><button class="btn small" id="apStart">Move to playhead</button><button class="btn small" id="apDel">Delete track</button></div>`);
  const wr = $(".tlwrap").getBoundingClientRect(), r = anchor.getBoundingClientRect(); p.style.top = Math.max(0, r.bottom - wr.top + 4) + "px"; p.hidden = false;
  if(p.getBoundingClientRect().bottom > innerHeight) p.style.top = Math.max(0, r.top - wr.top - p.offsetHeight - 4) + "px";
  $("#apVol").oninput = e => { const v = +e.target.value; $("#apVolV").textContent = Math.round(v * 100) + "%"; if(main){ S.P.mainVol = v; if(mainG && !S.P.mainMute) mainG.gain.value = v; } else au.vol = v; saveDraft(); };
  $("#apVol").onchange = () => { dirty(); if(!main) restartAudio(); };
  if(!main){ $("#apName").oninput = e => { au.name = e.target.value || "Audio"; tlDirty = true; saveDraft(); }; $("#apName").onchange = () => { renderHeads(); dirty(); };
    $("#apReplace").onclick = () => { closeAuxPop(); pickAuxFile(j); };
    $("#apStart").onclick = () => { if(lockState("a" + j)){ toast("That audio track is locked"); return; } au.start = +(songTime() - S.P.section.a).toFixed(3); dirty(); restartAudio(); };
    $("#apDel").onclick = () => removeAux(j); } }
document.addEventListener("pointerdown", e => { const p = $("#auxPop"), m = $("#trackMenu");
  if(!p.hidden && !p.contains(e.target) && !e.target.closest('[data-act="more"]')) closeAuxPop();
  if(!m.hidden && !m.contains(e.target) && !e.target.closest("#addTrack")) m.hidden = true; });
$("#trackMenu").addEventListener("click", e => { const b = e.target.closest("button[data-add]"); if(!b) return; $("#trackMenu").hidden = true; if(b.dataset.add === "text") addTextTrack(); else pickAuxFile(null); });
$("#tlHeads").addEventListener("click", e => {
  if(e.target.closest("#addTrack")){ const m = $("#trackMenu"); m.hidden = !m.hidden; return; }
  const lk = e.target.closest(".lk[data-lock]"); if(lk){ setLock(lk.dataset.lock); return; }
  const b = e.target.closest("[data-act]"); if(!b) return; const i = +b.dataset.i, act = b.dataset.act;
  if(act === "hide"){ const tk = tTracks()[i]; tk.hide = !tk.hide; dirty(); renderHeads(); toast(`Text ${i ? i + 1 + " " : ""}track ${tk.hide ? "hidden" : "shown"}`); }
  else if(act === "deltext") deleteTextTrack(i);
  else if(act === "mute"){ if(i < 0){ S.P.mainMute = !S.P.mainMute; if(mainG) mainG.gain.value = S.P.mainMute ? 0 : (S.P.mainVol ?? 1); } else { S.P.aux[i].mute = !S.P.aux[i].mute; restartAudio(); } dirty(); renderHeads(); }
  else if(act === "more"){ const p = $("#auxPop"); if(!p.hidden && p.dataset.j === String(i)){ closeAuxPop(); return; } p.dataset.j = i; openAuxPop(i, b); } });
renderHeads();
syncLocks(); setTool("select");
$("#undoBtn").onclick = undo; $("#redoBtn").onclick = redo;
$("#overlapBtn").onclick = e => { S.noOverlap = !S.noOverlap; e.currentTarget.classList.toggle("on", S.noOverlap); e.currentTarget.setAttribute("aria-pressed", String(S.noOverlap)); e.currentTarget.dataset.tip = `Turn ${S.noOverlap ? "off" : "on"} overlap protection`; toast(S.noOverlap ? "Lyric blocks can't overlap" : "Lyric blocks can overlap"); };
// trackpad pinch and Ctrl/Cmd + scroll zoom around the pointer
tlScroll.addEventListener("wheel", e => { if(!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = tlScroll.getBoundingClientRect(); setZoom(S.zoom*Math.exp(-e.deltaY*(Math.abs(e.deltaY) < 40 ? 0.012 : 0.003)), e.clientX - r.left); }, {passive:false});
let taps = [];
$("#tapTempo").onclick = () => { const n = performance.now(); taps = taps.filter(x => n - x < 3000); taps.push(n);
  if(taps.length >= 3){ const iv = (taps[taps.length-1] - taps[0])/(taps.length-1); S.P.bpm = Math.round(60000/iv*10)/10; $("#bpm").value = S.P.bpm; dirty(); }
  $("#tlHint").textContent = taps.length < 3 ? `Keep tapping (${taps.length})` : `${S.P.bpm} BPM from ${taps.length} taps`; };
$("#detectBpm").onclick = () => { if(!S.audio) return; const r = detectTempo(S.audio, Math.max(0, S.P.section.a - 5), Math.min(40, S.audio.duration));
  if(!r){ toast("Couldn't find a steady beat. Try Tap tempo instead."); return; }
  S.P.bpm = r.bpm; S.P.offset = r.offset; $("#bpm").value = r.bpm; dirty(); toast(`Detected ${r.bpm} BPM. Use Beat 1 here if the bars look shifted.`); };

/* keyboard */
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "range" && document.activeElement.type !== "checkbox";
  if(S.tap){ if(e.code === "Space" || e.code === "Enter"){ e.preventDefault(); tapNow(); } else if(e.code === "Escape"){ pause(); endTap(false); } return; }
  if(typing) return;
  if(document.body.dataset.step !== "design"){
    if(document.body.dataset.step !== "lyrics" || !$("#home").hidden) return;
    if(e.code === "Space" && document.activeElement.tagName !== "BUTTON"){ e.preventDefault(); S.playing ? pause() : play({}); }
    else if((e.metaKey || e.ctrlKey) && e.code === "KeyZ"){ e.preventDefault(); e.shiftKey ? redo() : undo(); }
    return;
  }
  if((e.metaKey || e.ctrlKey) && e.code === "KeyZ"){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if((e.metaKey || e.ctrlKey) && e.code === "KeyY"){ e.preventDefault(); redo(); return; }
  if((e.metaKey || e.ctrlKey) && e.code === "KeyB"){ e.preventDefault(); addCutAt(songTime()); return; }
  if(e.code === "Enter" || e.code === "NumpadEnter"){ e.preventDefault(); S.t = S.P.section.a; if(S.playing) play({}); tlScroll.scrollLeft = 0; return; }
  if(!e.metaKey && !e.ctrlKey && !e.altKey){
    if(e.code === "KeyA"){ setTool("select"); return; }
    if(e.code === "KeyB"){ setTool("split"); return; }
    if(e.code === "BracketLeft"){ selectSide(-1); return; }
    if(e.code === "BracketRight"){ selectSide(1); return; }
    if(e.code === "KeyN"){ toggleSnap(); toast(`Auto snapping ${S.snap ? "on" : "off"}`); return; }
    if(e.code === "KeyM"){ addMarker(); return; }
    if(e.code === "KeyT"){ e.preventDefault(); addText(); return; }
    if(e.code === "KeyQ"){ removeCutNear(-1); return; }
    if(e.code === "KeyW"){ removeCutNear(1); return; }
    if((e.code === "Delete" || e.code === "Backspace") && !selWords()){ e.preventDefault(); deleteSelection(); return; }
  }
  if(e.code === "Space"){ e.preventDefault(); S.playing ? pause() : playFromStart(); }
  if((e.metaKey || e.ctrlKey) && e.code === "KeyA"){ e.preventDefault(); if(S.locks.lyrics){ toast("The lyrics track is locked"); return; } selectAllWords(); return; }
  if(e.code === "Escape" && selWords()){ selectNone(); return; }
  const st = S.locks.lyrics ? null : selWords();
  if(st && (e.code === "ArrowLeft" || e.code === "ArrowRight")){ e.preventDefault(); const step = (e.shiftKey ? beatLen()/4 : 0.02) * (e.code === "ArrowLeft" ? -1 : 1), ws = [...st], minT = Math.min(...ws.map(w=>w.t)), lim = moveLimits(ws); let d = Math.max(step, -minT); if(S.noOverlap) d = clamp(d, lim.lo, lim.hi); ws.forEach(w => w.t += d); sortWords(); dirty(); syncWordCard(); }
  if(st && (e.code === "Delete" || e.code === "Backspace")){ e.preventDefault(); $("#wDelete").click(); }
});

/* ============ footage UI ============ */
let clipId = 0;
function genThumb(g){ const cv = document.createElement("canvas"); cv.width = 120; cv.height = 160; drawGen(cv.getContext("2d"), 120, 160, g, 1.3, 0); return cv.toDataURL("image/jpeg", .8); }
function addThumb(c, url){ c.thumb = url; c.thumbImg = new Image(); c.thumbImg.onload = () => tlDirty = true; c.thumbImg.src = url; }
const SPK_OFF = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>', SPK_ON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
function renderClips(){
  $("#clipGrid").innerHTML = S.clips.map(c => `<button class="clipt${c.on?"":" off"}" data-id="${c.id}" aria-pressed="${c.on}" draggable="true" title="${c.on?"In":"Out of"} the shuffle. Drag onto a clip on the timeline to put it there.">
    <img alt="" src="${esc(c.thumb||"")}"><span class="cap"><span>${esc(c.name)}</span><span class="kind">${c.kind==="gen"?"Built-in":c.src&&c.src.kind==="ai"?"AI":c.src&&c.src.kind==="stock"?"Stock":c.src&&c.src.kind==="tiktok"?"TikTok":c.src&&c.src.kind==="photo"&&c.src.source==="Pinterest"?"Pinterest":c.src&&c.src.kind==="board"?"Moodboard":c.kind==="img"?"Photo":"Video"}</span></span>
    ${c.kind!=="gen"?`<span class="x" data-rm="${c.id}" role="button" aria-label="Remove ${esc(c.name)}">×</span>`:""}${c.kind==="video" && (c.src&&c.src.kind==="tiktok" || c.sound) ? `<span class="snd${c.sound?" on":""}" data-snd="${c.id}" role="button" aria-pressed="${!!c.sound}" aria-label="${c.sound?"Mute":"Unmute"} ${esc(c.name)}" title="${c.sound?"Sound on: tap to mute":"Muted: tap to hear it"}">${c.sound?SPK_ON:SPK_OFF}</span>` : ""}</button>`).join("");
}
$("#clipGrid").onclick = e => {
  const snd = e.target.closest("[data-snd]");
  if(snd){ const c = S.clips.find(x => x.id === snd.dataset.snd); if(c){ c.sound = !c.sound; renderClips(); saveDraft(); toast(c.sound ? `${c.name}: sound on` : `${c.name}: muted`); } return; }
  const rm = e.target.closest("[data-rm]");
  if(rm){ const i = S.clips.findIndex(c => c.id === rm.dataset.rm); if(i>=0){ const c = S.clips[i]; if(c.url) URL.revokeObjectURL(c.url); S.clips.splice(i,1); } renderClips(); tlDirty = true; return; }
  const b = e.target.closest(".clipt"); if(!b) return; const c = S.clips.find(c => c.id === b.dataset.id);
  if(c.on && S.clips.filter(x=>x.on).length === 1){ toast("Keep at least one clip in the shuffle"); return; }
  c.on = !c.on; renderClips(); tlDirty = true; syncSegCard();
};
/* drag a tile from the pool onto a clip on the timeline to use it there */
$("#clipGrid").addEventListener("dragstart", e => { const b = e.target.closest(".clipt"); if(!b) return; e.dataTransfer.setData("text/sls-clip", b.dataset.id); e.dataTransfer.effectAllowed = "copy"; if(document.body.dataset.tl !== "open" && $("#tlToggle")) $("#tlToggle").click(); document.body.classList.add("tl-drop"); });
$("#clipGrid").addEventListener("dragend", () => document.body.classList.remove("tl-drop"));
tl.addEventListener("dragover", e => { if(![...e.dataTransfer.types].includes("text/sls-clip")) return; const r = tl.getBoundingClientRect(), y = e.clientY - r.top; if(y >= ROWS.cuts[0] && y < ROWS.cuts[1]){ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
tl.addEventListener("drop", e => { const id = e.dataTransfer.getData("text/sls-clip"); if(!id) return; e.preventDefault(); document.body.classList.remove("tl-drop");
  if(S.locks.cuts){ toast("The cuts track is locked"); return; }
  const r = tl.getBoundingClientRect(), t = tOf(e.clientX - r.left), {segs} = segInfo(), i = segs.findIndex(g => t >= g.a && t < g.b); if(i < 0) return;
  const c = S.clips.find(x => x.id === id); if(!c) return; if(!c.on){ c.on = true; renderClips(); }
  setSlot(i, {c: id, in: null}); selectSeg(i); if(!S.playing) S.t = segs[i].a + 0.001; dirty(); });
$("#clipFiles").onchange = async e => { const files = [...e.target.files]; e.target.value = ""; await addFootage(files); };
/* Adds photos and videos to the footage pool. files: File or Blob objects; meta (optional, per file):
   {name, credit, src} where src describes where it came from so a template can fetch it again. */
async function addFootage(files, metas = [], { quiet = false } = {}){
  let added = 0; const ids = [];
  for(const [fi, f] of files.entries()){
    const meta = metas[fi] || {};
    const url = URL.createObjectURL(f), id = "u" + (++clipId), name = (meta.name || f.name || "Clip").replace(/\.[^.]+$/, "").slice(0, 28);
    const type = f.type || (meta.kind === "video" ? "video/mp4" : "");
    if(type.startsWith("image/")){
      const img = new Image(); img.src = url; try { await img.decode(); } catch { continue; }
      const c = {id, name, kind:"img", el:img, url, blob:f, on:true, credit:meta.credit, src:meta.src}; const cv = document.createElement("canvas"); cv.width = 120; cv.height = 160; coverDraw(cv.getContext("2d"), img, 120, 160, img.naturalWidth, img.naturalHeight, 1, 0, 0); addThumb(c, cv.toDataURL("image/jpeg",.8));
      S.clips.push(c); added++; ids.push(id);
    } else if(type.startsWith("video/") || type === "application/octet-stream" || type === "binary/octet-stream"){
      const v = document.createElement("video"); v.src = url; v.muted = true; v.playsInline = true; v.loop = true; v.preload = "auto"; v.crossOrigin = "anonymous";
      const ok = await new Promise(res => { v.onloadeddata = () => res(true); v.onerror = () => res(false); setTimeout(() => res(v.readyState >= 2), 8000); });
      if(!ok){ toast(`Couldn't read ${name}. Try an MP4 (H.264).`); continue; }
      await new Promise(res => { v.onseeked = res; v.currentTime = Math.min(0.5, (v.duration||1)/2); setTimeout(res, 1500); });
      const c = {id, name, kind:"video", el:v, url, blob:f, on:true, credit:meta.credit, src:meta.src}; const cv = document.createElement("canvas"); cv.width = 120; cv.height = 160; coverDraw(cv.getContext("2d"), v, 120, 160, v.videoWidth, v.videoHeight, 1, 0, 0); addThumb(c, cv.toDataURL("image/jpeg",.8));
      S.clips.push(c); added++; ids.push(id);
    }
  }
  if(added && S.clips.some(c=>c.kind==="gen" && c.on) && S.clips.filter(c=>c.kind!=="gen").length === added){
    S.clips.forEach(c => { if(c.kind === "gen") c.on = false; }); if(!quiet) toast(`${added} clip${added>1?"s":""} added. Built-in visuals switched off; tap them to bring them back.`);
  } else if(added && !quiet) toast(`${added} clip${added>1?"s":""} added to the pool`);
  // several photos make a slideshow: a new photo on every lyric line, in the order they were picked
  const pics = ids.filter(id => S.clips.find(c => c.id === id)?.kind === "img").length;
  if(pics >= 2 && pics === ids.length && S.P.words.length && S.P.cuts.mode === "beat"){ S.P.cuts.mode = "lines"; S.P.cuts.order = "inorder"; S.P.cuts.slots = null; syncUI(); if(!quiet) toast(`${pics} photos added as a slideshow: a new photo on every lyric line. Change it under "How cuts are chosen".`); }
  renderClips(); tlDirty = true; syncSegCard(); slsEmit("change");
  return ids;
}

/* ============ song loading ============ */
$("#songFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if(f) slsEmit("pick", f); };
/* Decodes the file and sets up the project. Returns {restored} (true when an earlier edit of this song came back) or throws if the file can't be read. */
async function loadSong(f, {useDraft = true} = {}){
  pause();
  const buf = await ctx().decodeAudioData(await f.arrayBuffer());
  const wasDemo = S.songName === "Demo track";
  S.audio = buf; S.peaks = computePeaks(buf); S.songName = f.name.replace(/\.[^.]+$/, ""); S.reduced = null; S.inst = null; S.instName = ""; S.vocal = "on"; syncVocalUI();
  const draft = useDraft ? store.get("sls-draft") : null;
  let restored = false;
  if(pendingBuiltin && useBuiltin(pendingBuiltin, true)){ renderBuiltins(); restored = true; }
  else if(draft && draft.songName === S.songName && draft.P){ applyProject(draft.P);
    const sl = S.P.section.b - S.P.section.a; if(buf.duration <= 60 && Math.abs(sl - 15) < 0.01 && buf.duration > 15.5){ setSection(0, buf.duration); syncUI(); }
    restored = true; }
  else {
    // a soundbite file (up to a minute) is used whole; a full song starts at its beginning with a 30s window
    const len = buf.duration <= 60 ? buf.duration : 30, a = 0;
    const p = {...S.P, song:{name:S.songName, duration:buf.duration}, section:{a, b:a+len}, words:[], lyrics:"", markers:[], texts:[], aux:[]};
    p.cuts = {...p.cuts, mode: p.cuts.mode === "manual" ? "beat" : p.cuts.mode, points:null, slots:null};
    if(wasDemo) p.hook = {...p.hook, on:false};
    const tempo = detectTempo(buf, Math.max(0,a-5), Math.min(40, buf.duration)); if(tempo){ p.bpm = tempo.bpm; p.offset = tempo.offset; }
    applyProject(p); dirty();
  }
  S.P.song = {name:S.songName, duration:buf.duration}; S.t = S.P.section.a; updateMeta(); tlDirty = true;
  return {restored};
}

/* ============ timing from an example video ============ */
function onsetEnv(buf, fps){
  const sr = buf.sampleRate, d = buf.getChannelData(0), hop = Math.floor(sr/fps), out = new Float32Array(Math.floor(d.length/hop)); let prev = 0;
  for(let i=0;i<out.length;i++){ let e=0; const a=i*hop; for(let k=a;k<a+hop;k+=2) e+=d[k]*d[k]; e=Math.log(1e-6+Math.sqrt(e/(hop/2))); out[i]=Math.max(0,e-prev); prev=e; }
  return out;
}
function alignAudio(songBuf, vidBuf, near){ return alignEnvs(onsetEnv(songBuf, 100), onsetEnv(vidBuf, 100), 100, near); }
function alignEnvs(es, ev, fps, near){
  if(ev.length < fps*2 || ev.length > es.length + fps/2) return null;
  const n = Math.min(ev.length, fps*30), sq = new Float64Array(es.length+1);
  for(let i=0;i<es.length;i++) sq[i+1] = sq[i] + es[i]*es[i];
  let evn = 0; for(let i=0;i<n;i++) evn += ev[i]*ev[i]; evn = Math.sqrt(evn) || 1;
  const scores = [], maxLag = Math.max(0, es.length - n);
  let best = -1, bestLag = 0;
  for(let lag=0; lag<=maxLag; lag++){
    let s = 0; for(let i=0;i<n;i++) s += es[lag+i]*ev[i];
    const sn = Math.sqrt(sq[lag+n]-sq[lag]) || 1, v = s/(sn*evn); scores.push(v);
    if(v > best){ best = v; bestLag = lag; }
  }
  const sorted = scores.slice().sort((a,b)=>a-b), med = sorted[Math.floor(sorted.length/2)] || 0;
  if(maxLag > fps/2 && best < med*1.5 + 0.05) return null;
  if(best < 0.25) return null;
  // repeated choruses match equally well: among near-best matches, take the one closest to the current section
  if(near != null){ let pick = bestLag, pd = Infinity; scores.forEach((v,lag) => { if(v >= best*0.97){ const dd = Math.abs(lag/fps - near); if(dd < pd){ pd = dd; pick = lag; } } }); bestLag = pick; }
  return {offset: bestLag/fps, score: best};
}
function linesFromReadings(changes){
  const norm = w => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const lines = []; let cur = null, lastT = 0;
  const close = endT => { if(!cur) return; const L = cur; // fill unknown times between known ones
    const known = L.map((x,i) => x.t != null ? i : -1).filter(i => i >= 0);
    L.forEach((x,i) => { if(x.t != null) return; const p = known.filter(k => k < i).pop(), n = known.find(k => k > i);
      const tp = p != null ? L[p].t : L[0].t ?? endT, tn = n != null ? L[n].t : endT, ip = p != null ? p : 0, inx = n != null ? n : L.length;
      x.t = tp + (tn - tp) * (i - ip) / Math.max(1, inx - ip); });
    lines.push(L.map(x => ({w:x.w, t:x.t}))); cur = null; };
  for(const r of changes){
    const toks = r.text ? r.text.split(/\s+/).filter(Boolean) : [];
    if(!toks.length){ close(r.t); lastT = r.t; continue; }
    const same = cur && toks.length >= cur.length && cur.every((x,i) => norm(x.w) === norm(toks[i]));
    if(!same){ close(r.t); cur = toks.map((w,i) => ({w, t: i === 0 ? r.t : null})); }
    else { toks.slice(cur.length).forEach((w,k) => cur.push({w, t: k === 0 ? r.t : null})); }
    if(r.active){ const k = cur.findIndex(x => norm(x.w) === norm(r.active) && x.t == null); if(k >= 0) cur[k].t = r.t; }
    lastT = r.t;
  }
  close(lastT + 1.5);
  return lines;
}
const seekTo = (v,t) => new Promise(res => { let done = false; const fin = () => { if(done) return; done = true; v.removeEventListener("seeked", fin); res(); }; v.addEventListener("seeked", fin); v.currentTime = t; setTimeout(fin, 2000); });
let vidAbort = null;
function vidUI(running, status, pct){
  $("#vidRun").hidden = !running && !status; $("#vidBtn").hidden = running; $("#vidStop").hidden = !running;
  if(status != null) $("#vidStatus").textContent = status; if(pct != null) $("#vidBar").style.width = (pct*100).toFixed(1)+"%";
}
$("#vidStop").onclick = () => vidAbort?.abort();
$("#vidFile").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  const sample = window.claude?.use ? await window.claude.use("sample") : null;
  const lim = sample ? await sample.limits().catch(()=>null) : null;
  if(!sample || !lim?.images){ toast("Reading video frames needs this page open in Claude with permission to ask Claude"); return; }
  pause(); vidAbort = new AbortController(); const signal = vidAbort.signal;
  const url = URL.createObjectURL(f), v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    vidUI(true, "Opening video…", 0);
    const ok = await new Promise(res => { v.onloadeddata = () => res(true); v.onerror = () => res(false); setTimeout(() => res(v.readyState >= 2), 10000); });
    if(!ok) throw {code:"video", message:"That video couldn't be read. Try an MP4."};
    if(!isFinite(v.duration)){ await seekTo(v, 1e7); await seekTo(v, 0); }
    if(!isFinite(v.duration) || !v.duration) throw {code:"video", message:"That video's length couldn't be read. Try an MP4."};
    const dur = v.duration;
    // 1. line the video's audio up with the loaded song
    vidUI(true, "Matching the video's audio to your song…", 0.02);
    let align = null;
    try { const vb = await ctx().decodeAudioData(await f.arrayBuffer()); if(S.audio) align = alignAudio(S.audio, vb, S.P.section.a); } catch {}
    // 2. sample frames, keeping the ones where something changed
    const step = Math.max(dur <= 20 ? 0.15 : dur <= 45 ? 0.2 : 0.3, dur/360);
    const vw = v.videoWidth, vh = v.videoHeight, port = vh >= vw, cw = port ? 225 : 400, ch = port ? 400 : 225;
    const cell = document.createElement("canvas"); cell.width = cw; cell.height = ch; const cc = cell.getContext("2d");
    const tiny = document.createElement("canvas"); tiny.width = 40; tiny.height = 40; const tc = tiny.getContext("2d", {willReadFrequently:true});
    const frames = []; let lastPix = null, lastKeptT = -9;
    for(let t = 0.04; t < dur - 0.02; t += step){
      if(signal.aborted) throw {code:"cancelled"};
      await seekTo(v, t); cc.drawImage(v, 0, 0, cw, ch); tc.drawImage(cell, 0, 0, 40, 40);
      const pix = tc.getImageData(0,0,40,40).data; let diff = 0;
      if(lastPix){ for(let i=0;i<pix.length;i+=4) diff += Math.abs(pix[i]-lastPix[i]) + Math.abs(pix[i+1]-lastPix[i+1]); diff /= 3200; } else diff = 999;
      if(diff > 1.2 || t - lastKeptT > 0.9){ frames.push({t: Math.round(t*100)/100, bmp: await createImageBitmap(cell)}); lastPix = pix; lastKeptT = t; }
      vidUI(true, `Scanning frames ${fmt(t)} of ${fmt(dur)}`, 0.02 + 0.28*(t/dur));
    }
    // 3. contact sheets with labelled timestamps
    const cols = port ? 4 : 3, rows = port ? 3 : 4, per = cols*rows, sheets = [];
    for(let i=0;i<frames.length;i+=per){
      const sh = document.createElement("canvas"); sh.width = cols*cw; sh.height = rows*ch; const sc2 = sh.getContext("2d"); sc2.fillStyle = "#000"; sc2.fillRect(0,0,sh.width,sh.height);
      frames.slice(i,i+per).forEach((fr,k) => { const x = (k%cols)*cw, y = Math.floor(k/cols)*ch; sc2.drawImage(fr.bmp, x, y);
        sc2.strokeStyle = "#000"; sc2.lineWidth = 2; sc2.strokeRect(x+1,y+1,cw-2,ch-2);
        sc2.fillStyle = "#ffd400"; sc2.fillRect(x+3, y+3, 104, 22); sc2.fillStyle = "#000"; sc2.font = "bold 14px monospace"; sc2.textBaseline = "middle"; sc2.fillText(`#${i+k} ${fr.t.toFixed(2)}s`, x+7, y+14); });
      sheets.push({from:i, blob: await new Promise(r => sh.toBlob(r, "image/jpeg", 0.82))});
    }
    // 4. Claude reads the sheets (retry smaller on a bad reply, skip what still fails)
    const CONTEXT = `Context: a music management team is making an official lyric video for their artist's own release and needs the on-screen captions of a reference video read back so they can time their captions to it. This is caption timing work, so read every caption exactly.\n`;
    const batch = Math.max(1, Math.min(lim.images.maxCount || 4, 4)), readings = []; let failed = 0, lastReply = "";
    const readGroup = async group => {
      const first = group[0].from, last = Math.min(frames.length, group[group.length-1].from + per) - 1;
      const res = await sample.json(CONTEXT +
        `These images are contact sheets of frames from a lyric video, in time order. Each cell has a yellow label "#N T s" with its frame number and time in seconds. Frames #${first} to #${last} are included.\n` +
        `For EVERY labelled cell, read the caption text visible in that frame exactly as written. Keep the original language, script and spelling. Ignore watermarks, usernames, app interface and promotional banners such as "out now".\n` +
        `If one word is visibly emphasized (highlighted, a different colour, larger, or the newest word to appear), give it as "active".\n` +
        `Reply with ONLY a JSON array, no other text, one object per cell in frame order, like [{"f":12,"text":"words on screen","active":"word"}]. Use "" for text and null for active when no caption is visible.`,
        {images: group.map(g=>g.blob), signal, modelTier:"default"});
      if(!Array.isArray(res)) throw {code:"invalid_json", text: JSON.stringify(res).slice(0,200)};
      for(const r of res){ const fr = frames[+r.f]; if(fr) readings.push({t: fr.t, text: String(r.text||"").trim(), active: r.active ? String(r.active) : ""}); }
    };
    for(let i=0;i<sheets.length;i+=batch){
      if(signal.aborted) throw {code:"cancelled"};
      const group = sheets.slice(i, i+batch);
      vidUI(true, `Claude is reading frames (${Math.min(sheets.length, i+batch)} of ${sheets.length} sheets)…`, 0.3 + 0.55*(i/sheets.length));
      try { await readGroup(group); }
      catch(err){
        if(err.code === "cancelled" || err.code === "not_granted" || err.code === "rate_limited") throw err;
        lastReply = err.text || err.message || ""; 
        for(const one of group){ try { await readGroup([one]); } catch(e2){ if(e2.code === "cancelled" || e2.code === "not_granted") throw e2; failed++; lastReply = e2.text || e2.message || lastReply; } }
      }
    }
    readings.sort((a,b)=>a.t-b.t);
    const changes = []; for(const r of readings){ const p = changes[changes.length-1]; if(!p || p.text !== r.text || p.active !== r.active) changes.push(r); }
    if(!changes.some(c => c.text)) throw {code:"empty", message: failed ? `Claude didn't return the captions. Its reply began: "${String(lastReply).replace(/\s+/g," ").slice(0,160)}"` : "No lyrics were found on screen in that video."};
    // 5. Claude turns the readings into timed words and lines (falls back to a built-in method)
    vidUI(true, "Working out when each word is sung…", 0.88);
    const ref = $("#lyricsText").value.trim();
    let out = null;
    try {
      out = await sample.json(CONTEXT +
        `Below are timestamped readings of the captions shown on screen in a lyric video. Each line is "time in seconds | text on screen | emphasized word". A reading lasts until the next one.\n` +
        `Work out when each word is sung: the moment it first appears on screen, or the moment it becomes emphasized if whole lines appear at once. If a whole line appears at once with no emphasis changes, spread its words evenly across the time the line is on screen.\n` +
        `Group the words into the lines as they are displayed. Keep the original language and script. Also name the language.\n` +
        (ref ? `Reference lyrics typed by the user. Where they match what is on screen, use their spelling:\n${ref.slice(0,4000)}\n\n` : "") +
        `Reply with ONLY JSON, no other text, like {"language":"Italian","lines":[[{"w":"word","t":1.23},{"w":"next","t":1.6}]]}. Every sung word appears exactly once, in order, with increasing times.\n\nReadings:\n` +
        changes.map(c => `${c.t.toFixed(2)} | ${c.text || "(none)"} | ${c.active || "-"}`).join("\n"),
        {signal, modelTier:"default"});
    } catch(err){ if(err.code === "cancelled" || err.code === "not_granted") throw err; }
    let lines = (out && Array.isArray(out.lines)) ? out.lines.filter(l => Array.isArray(l) && l.length) : [];
    if(!lines.length){ lines = linesFromReadings(changes); out = {language:""}; }
    if(!lines.length) throw {code:"empty", message:"The captions couldn't be turned into timed lyrics. Try a clearer video."};
    // 6. apply to the project
    const shift = align ? align.offset : S.P.section.a;
    const words = [];
    lines.forEach((ln, li) => ln.forEach(x => { if(x && x.w != null && isFinite(+x.t)) words.push({w:String(x.w), l:li, t:Math.max(0, +x.t + shift), d:0.3}); }));
    words.sort((a,b)=>a.t-b.t);
    words.forEach((w,i) => { const n = words[i+1]; w.d = n ? (n.l === w.l ? clamp(n.t - w.t, 0.06, 1.5) : clamp(n.t - w.t - 0.05, 0.2, 1)) : 0.6; });
    if(align && S.audio){ const a = Math.max(0, align.offset), b = Math.min(S.audio.duration, align.offset + dur); if(b - a > 2) S.P.section = {a: Math.round(a*100)/100, b: Math.round(b*100)/100}; }
    S.P.words = words; S.P.lyrics = lines.map(l => l.map(x => x.w).join(" ")).join("\n");
    S.t = S.P.section.a; selectNone(); syncUI(); dirty();
    vidUI(false, `${words.length} words placed${out.language ? ` · ${out.language}` : ""}${failed ? ` · ${failed} sheet${failed>1?"s":""} skipped` : ""}${align ? " · lined up with your song" : " · placed from the section start"}`, 1);
    toast(align ? "Timing imported and lined up with the song" : "Timing imported. The video's audio didn't match the loaded song, so words start at the section start. Use Shift all words to adjust.");
  } catch(err){
    const msg = err.code === "cancelled" ? "Stopped." : err.code === "not_granted" ? "Claude wasn't allowed to read the video. Allow it when asked to use this feature." : err.code === "rate_limited" ? "Too many requests at once. Wait a minute and try again." : (err.message || "Something went wrong reading the video.");
    vidUI(false, msg, 0);
  } finally { URL.revokeObjectURL(url); vidAbort = null; }
};
/* Shift all words: one offset in seconds (kept with the project as wordShift), set by typing, the − / + steps or the slider */
function setShift(v, commit = true){
  v = clamp(Math.round((+v || 0) * 100) / 100, -10, 10); const d = v - (S.P.wordShift || 0); if(!d && !commit) return;
  S.P.words.forEach(w => w.t = +Math.max(0, w.t + d).toFixed(3)); S.P.wordShift = v; syncShift(); tlDirty = true;
  if(commit) dirty(); else saveDraft();
}
function syncShift(){ const v = S.P.wordShift || 0, n = $("#shiftNum"); if(document.activeElement !== n) n.value = v.toFixed(2); $("#shiftRange").value = clamp(v, -2, 2); }
$("#shiftNum").addEventListener("change", e => setShift(e.target.value));
$("#shiftNum").addEventListener("keydown", e => { if(e.key === "Enter") setShift(e.target.value); });
$("#shiftRange").addEventListener("input", e => setShift(e.target.value, false));
$("#shiftRange").addEventListener("change", () => dirty());
$("#shiftDown").onclick = () => setShift((S.P.wordShift || 0) - 0.05);
$("#shiftUp").onclick = () => setShift((S.P.wordShift || 0) + 0.05);
$("#shiftReset").onclick = () => setShift(0);

/* ============ built-in Stellar templates ============ */
const FP_AL = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BUILTINS = [
  { id:"fuorisede", name:"Fuorisede", artist:"GiacomoChi6", data:{"lines":[{"text":"me ne sono andato","start":0.0,"end":1.36,"words":[{"w":"me","l":0,"t":0.14,"d":0.16},{"w":"ne","l":0,"t":0.32,"d":0.16},{"w":"sono","l":0,"t":0.5,"d":0.34},{"w":"andato","l":0,"t":0.86,"d":0.25}]},{"text":"e ho fatto","start":1.41,"end":2.32,"words":[{"w":"e","l":1,"t":1.41,"d":0.31},{"w":"ho","l":1,"t":1.74,"d":0.13},{"w":"fatto","l":1,"t":1.89,"d":0.25}]},{"text":"bene","start":2.37,"end":4.82,"words":[{"w":"bene","l":2,"t":2.37,"d":1.75}]},{"text":"ooooh","start":4.88,"end":6.49,"words":[{"w":"ooooh","l":3,"t":4.88,"d":0.91}]},{"text":"non me lo","start":6.55,"end":7.36,"words":[{"w":"non","l":4,"t":6.55,"d":0.38},{"w":"me","l":4,"t":6.95,"d":0.13},{"w":"lo","l":4,"t":7.1,"d":0.25}]},{"text":"non me lo ripetere","start":7.42,"end":9.29,"words":[{"w":"non","l":5,"t":7.42,"d":0.26},{"w":"me","l":5,"t":7.7,"d":0.22},{"w":"lo","l":5,"t":7.94,"d":0.26},{"w":"ripetere","l":5,"t":8.22,"d":0.37}]},{"text":"io non me lo ripeto","start":9.35,"end":10.74,"words":[{"w":"io","l":6,"t":9.35,"d":0.17},{"w":"non","l":6,"t":9.54,"d":0.18},{"w":"me","l":6,"t":9.74,"d":0.17},{"w":"lo","l":6,"t":9.93,"d":0.18},{"w":"ripeto","l":6,"t":10.13,"d":0.25}]},{"text":"ho fatto","start":10.8,"end":12.06,"words":[{"w":"ho","l":7,"t":10.8,"d":0.22},{"w":"fatto","l":7,"t":11.04,"d":0.32}]},{"text":"bene","start":12.12,"end":14.36,"words":[{"w":"bene","l":8,"t":12.12,"d":1.54}]},{"text":"ooooh","start":14.41,"end":15.95,"words":[{"w":"ooooh","l":9,"t":14.49,"d":0.76}]},{"text":"non me lo ripetere","start":16.01,"end":19.29,"words":[{"w":"non","l":10,"t":16.01,"d":0.3},{"w":"me","l":10,"t":16.33,"d":0.23},{"w":"lo","l":10,"t":16.58,"d":0.33},{"w":"ripetere","l":10,"t":16.93,"d":1.66}]},{"text":"non me lo ripeto più","start":19.35,"end":25.08,"words":[{"w":"non","l":11,"t":19.35,"d":0.44},{"w":"me","l":11,"t":19.81,"d":0.32},{"w":"lo","l":11,"t":20.15,"d":0.59},{"w":"ripeto","l":11,"t":20.76,"d":1.42},{"w":"più","l":11,"t":22.2,"d":2.18}]}],"title":["'Fuorisede'",25.14,27.73],"fp":"0u000zzalBD00000he0503000902Dj00000VR0100JA300KG000O00000iXH7D00LD0300050000J037000003LzJ0000000000000IG0IPbQS000000001b0K0A67DzfB0000N000100090080D04G0400801080009010Yb0800035700000C010B070Q0050105B0000B000Zy0J000f0F00040109005S00000622000131000PQ84003A0AC0N5100000B000Y0000TB00A00E200MLM9D0000J06061500090057009200A000A600F52aB000A0000B9E053200065005454600M050000A3eJ0G0B0400G0LVJ0200040F60E01005403157073mY0Y002003D1083000B2600000A040000D460KW0DXL00900G3003420300A0040K50C000UH0E00S0NI70100070G40502032436070090000U0G900000UUL2E070800A0X00F09908099000000C00B00A00As0700000F0104500C10000z0O0800U0Q00AC0F00rTG7020H000C05700504W202G0H20D00E050180GOD00M00309509000701A040006000260D0323503Vc0H000F00D5B0G00G053000060640800000C0DPz8070000N60M005090QAV0000000801N0MD31040bP09000000970402B00500070080DF080130A0A0JD08005830540000610070TG00006045B300003CoF18000I0050255003036004A4820F07L0002710CO090009720202D700013705N0607084000A1000od64000Y01003040040905800608A0035100650LNG0070010N7000200D0A972000004009E0D00F00ZVD9000L001B40I700B50D2709000V0W7D5010400F00L028070D000003000FC00034220400400090WXO00I00S00009906008CE00800700900960B003f400000067000A00D00C40600G00B0D00B5004007tBA0X0C08D0054014078308B200D00D00600240hQ000023031103D0B700C4000D0092H0000H0008FL2000050GE0E02G00B00C070000004E1B0400000z317100260050010080500300042043220010000z0F550000003000500100000030570070004000WW58060040900403A0010","fps":50,"len":27.77},
    project(d){ return {
      song:{name:"Fuorisede", duration:d.len}, section:{a:0, b:d.len}, bpm:75, offset:0.15,
      lyrics: d.lines.map(l => l.text).join("\n"), words: d.lines.flatMap(l => l.words.map(w => ({...w}))),
      style:{preset:"line", size:1, x:0.5, y:0.5, scrim:0.08, color:"#f3ecb0", case:"as", fonts:{}, his:{}, vars:{}},
      hook:{on:true, text:d.title[0], start:d.title[1], dur:Math.max(0.5, d.len - d.title[1]), look:"caption", font:"sans", size:3.4, x:0.5, y:0.5, color:"#f3ecb0", bg:"#000000", anim:"fade"},
      cuts:{mode:"manual", points:[2.37, 14.41, 17.4, 23.2], every:2, seed:7, count:8, transition:"none", motion:"still"}, aspect:"16:9" }; } }
];
let pendingBuiltin = null;
function shiftProject(p, dt){ p.section = {a:+(p.section.a+dt).toFixed(3), b:+(p.section.b+dt).toFixed(3)}; p.offset = +(p.offset+dt).toFixed(3); p.words.forEach(w => w.t = +(w.t+dt).toFixed(3)); if(p.cuts.points) p.cuts.points = p.cuts.points.map(x => +(x+dt).toFixed(3)); return p; }
function locateBuiltin(b, buf){ const d = b.data, ev = Float32Array.from(d.fp, ch => FP_AL.indexOf(ch)); return alignEnvs(onsetEnv(buf, d.fps), ev, d.fps, null); }
function useBuiltin(b, quiet){
  pause(); const p = b.project(b.data), real = S.audio && S.songName !== "Demo track";
  if(real){ const r = locateBuiltin(b, S.audio);
    if(r){ applyProject(shiftProject(p, r.offset)); S.P.song = {name:S.songName, duration:S.audio.duration}; pendingBuiltin = null; dirty(); toast(`${b.name} placed at ${fmt(r.offset)} in "${S.songName}". Lyrics, cuts and title are in sync.`); return true; }
    if(!quiet) toast(`Couldn't find the ${b.name} section in "${S.songName}". Load the ${b.name} master and it lines up automatically.`); }
  pendingBuiltin = b; applyProject(p); dirty(); if(!real) toast(`${b.name} template ready. Now load the ${b.name} song and it lines up automatically.`); return false;
}
function renderBuiltins(){
  $("#builtinList").innerHTML = BUILTINS.map(b => `<div class="titem"><b>${esc(b.name)}</b><span class="sub">${esc(b.artist)} · ${b.data.len.toFixed(1)}s · ${b.data.lines.length} lyric lines timed · Line style · 16:9</span>
    <div class="row"><button class="btn small" data-builtin="${b.id}">Use template</button>${pendingBuiltin === b ? '<span class="hint">Waiting for the song…</span>' : ""}</div></div>`).join("");
}

/* ============ LRC / SRT ============ */
const tsLRC = t => { t = Math.max(0, t); const m = Math.floor(t/60); return `${String(m).padStart(2,"0")}:${(t - m*60).toFixed(2).padStart(5,"0")}`; };
const tsSRT = t => { t = Math.max(0, t); const h = Math.floor(t/3600), m = Math.floor(t/60)%60, s2 = Math.floor(t)%60, ms = Math.round((t - Math.floor(t))*1000); return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s2).padStart(2,"0")},${String(Math.min(999,ms)).padStart(3,"0")}`; };
function lineGroups(){ const g = new Map(); S.P.words.forEach(w => { if(!g.has(w.l)) g.set(w.l, []); g.get(w.l).push(w); }); return [...g.values()].map(L => L.sort((a,b) => a.t - b.t)).sort((a,b) => a[0].t - b[0].t); }
function toLRC(){ return [`[ti:${S.songName}]`, ...lineGroups().map(L => `[${tsLRC(L[0].t)}] ` + L.map(w => `<${tsLRC(w.t)}>${w.w}`).join(" "))].join("\n") + "\n"; }
function toSRT(){ const G = lineGroups(); return G.map((L, i) => { const last = L[L.length-1], nx = G[i+1], end = Math.min(nx ? nx[0].t - 0.02 : Infinity, last.t + last.d + 0.7);
  return `${i+1}\n${tsSRT(L[0].t)} --> ${tsSRT(end)}\n${L.map(w => w.w).join(" ")}\n`; }).join("\n"); }
function parseTimed(text){
  const lines = [], toSec = (m, s2) => (+m)*60 + parseFloat(String(s2).replace(",", "."));
  if(/-->/.test(text)){ // SRT
    for(const block of text.replace(/\r/g,"").split(/\n\s*\n/)){ const m = block.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/); if(!m) continue;
      const a = (+m[1])*3600 + (+m[2])*60 + (+m[3]) + (+m[4])/1000, b = (+m[5])*3600 + (+m[6])*60 + (+m[7]) + (+m[8])/1000;
      const txt = block.split("\n").slice(block.split("\n").findIndex(x => x.includes("-->")) + 1).join(" ").replace(/<[^>]+>/g, "").trim(); if(txt) lines.push({a, b, txt, words:null}); }
  } else { // LRC (plain or with <mm:ss.xx> word tags)
    for(const raw of text.replace(/\r/g,"").split("\n")){ const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)]; if(!tags.length) continue;
      let body = raw.replace(/\[[^\]]*\]/g, "").trim(); if(!body) continue; let words = null;
      if(/<\d+:\d+/.test(body)){ words = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>\s*([^<]+)/g)].map(m => ({t: toSec(m[1], m[2]), w: m[3].trim()})).filter(x => x.w); body = words.map(x => x.w).join(" "); }
      for(const tg of tags) lines.push({a: toSec(tg[1], tg[2].replace(":", ".")), b: null, txt: body, words}); }
    lines.sort((x,y) => x.a - y.a); lines.forEach((L,i) => L.b = L.b ?? (lines[i+1] ? lines[i+1].a : L.a + 4)); }
  const out = [];
  lines.forEach((L, li) => {
    if(L.words && L.words.length){ L.words.forEach((x, k) => { const n = L.words[k+1]; out.push({w:x.w, l:li, t:x.t, d: n ? Math.max(0.06, n.t - x.t - 0.02) : Math.max(0.25, Math.min(1.2, L.b - x.t - 0.3))}); }); return; }
    const ws = L.txt.split(/\s+/).filter(Boolean), syl = w => Math.max(1, (w.toLowerCase().match(/[aeiouyàèéìòùáíóú]+/g) || []).length), tot = ws.reduce((a,w) => a + syl(w), 0);
    const span = Math.min(L.b - L.a - 0.05, tot*0.24 + 0.2); let acc = 0;
    ws.forEach(w => { const t = L.a + span*acc/tot; acc += syl(w); out.push({w, l:li, t:+t.toFixed(3), d:0.3}); });
    const mine = out.filter(x => x.l === li); mine.forEach((x,k) => { const n = mine[k+1]; x.d = n ? Math.max(0.06, n.t - x.t - 0.02) : Math.max(0.25, Math.min(1.2, L.b - x.t - 0.3)); });
  });
  return {words: out, lyrics: lines.map(L => L.txt).join("\n")};
}

/* ============ free text boxes ============ */
const TEXT_PRESETS = [
  {look:"plain", color:"#ffffff", bg:"#000000"}, {look:"outline", color:"#ffffff", bg:"#000000"}, {look:"outline", color:"#000000", bg:"#ffffff"}, {look:"caption", color:"#ffffff", bg:"#000000"},
  {look:"outline", color:"#ffe14a", bg:"#000000"}, {look:"outline", color:"#ff3b3b", bg:"#ffffff"}, {look:"outline", color:"#ff8a1f", bg:"#ffffff"}, {look:"outline", color:"#3b8cff", bg:"#ffffff"},
  {look:"outline", color:"#3ddc4a", bg:"#000000"}, {look:"box", color:"#111111", bg:"#a3a3a3"}, {look:"box", color:"#ffffff", bg:"#8a8a8a"}, {look:"box", color:"#111111", bg:"#ffd400"},
  {look:"box", color:"#ffffff", bg:"#7b2cff"}, {look:"box", color:"#111111", bg:"#ffffff"}, {look:"box", color:"#ffffff", bg:"#000000"}, {look:"box", color:"#3ddc4a", bg:"#000000"},
  {look:"glow", color:"#ffffff", bg:"#ffd400"}, {look:"glow", color:"#ffffff", bg:"#ff2d6f"}, {look:"glow", color:"#eaffff", bg:"#22d3dd"}, {look:"pill", color:"#ffffff", bg:"#0a090e"},
  {look:"sticker", color:"#111111", bg:"#ffffff"}, {look:"banner", color:"#ffffff", bg:"#ff2d3a"}
];
function presetSwatch(pr, i){
  let st = `color:${pr.color};`;
  if(pr.look === "outline") st += `-webkit-text-stroke:3px ${pr.bg};paint-order:stroke fill;`;
  if(pr.look === "caption") st += "text-shadow:0 2px 6px rgba(0,0,0,.8);";
  if(pr.look === "glow") st += `text-shadow:0 0 8px ${pr.bg},0 0 14px ${pr.bg};`;
  const bgc = ["box","pill","sticker","banner"].includes(pr.look) ? pr.bg : "#2a2a2a";
  return `<button class="aa" data-i="${i}" title="${pr.look}" style="background:${bgc}"><span style="${st}">${pr.look === "plain" && i === 0 ? "Aa" : "Aa"}</span></button>`;
}
const textById = id => (S.P.texts || []).find(x => x.id === id);
function selectText(id){ S.sel = {type:"text", id}; tlDirty = true; syncTextEditor(); if(isPhone() && sheetOpen !== "text") openSheet("text"); }
function addText(trackIdx){ S.P.texts = S.P.texts || [];
  // like TikTok: on for the whole video, in the middle, in the TikTok font, no animation (all easy to change)
  const len = S.P.section.b - S.P.section.a, start = 0, dur = +len.toFixed(2), T = tTracks();
  // like CapCut: use the lowest unlocked text track with room at the playhead, otherwise open a new track
  const free = i => !textTrackLocked(i) && !S.P.texts.some(o => (o.tr || 0) === i && o.start < start + dur && o.start + o.dur > start) && !(i === 0 && S.P.hook.on && S.P.hook.text && (S.P.hook.start || 0) < start + dur && (S.P.hook.start || 0) + S.P.hook.dur > start);
  let tr = trackIdx ?? T.findIndex((_, i) => free(i)); if(tr == null || tr < 0){ T.push({}); tr = T.length - 1; }
  if(textTrackLocked(tr)){ toast("That text track is locked"); return; }
  const it = {id: "t" + Date.now().toString(36), tr, text: "Your text", start, dur, look: "plain", font: FONTLIB.tiktokb ? "tiktokb" : "sans", size: 1.4, x: 0.5, y: 0.5, color: "#ffffff", bg: "#000000", anim: "none", align: "center", tcase: "", ls: 0, lsp: 0, rot: 0};
  S.P.texts.push(it); selectText(it.id); dirty(); setTimeout(() => { const ta = $("#txtText"); if(ta && !isPhone()){ ta.focus(); ta.select(); } }, 50); }
function deleteText(id){ if(textLocked(textById(id))){ toast("That text track is locked"); return; } S.P.texts = (S.P.texts || []).filter(x => x.id !== id); if(S.sel?.type === "text") S.sel = null; syncTextEditor(); dirty(); toast("Text deleted"); }
function syncTextEditor(){
  const list = S.P.texts || [], cur = S.sel?.type === "text" ? textById(S.sel.id) : null;
  $("#txtList").innerHTML = list.map((x, i) => `<button data-id="${x.id}" aria-pressed="${cur && cur.id === x.id}">${esc((x.text || "Text").split("\n")[0].slice(0, 18) || "Text " + (i+1))}</button>`).join("");
  $("#txtEmpty").hidden = list.length > 0; $("#txtEdit").hidden = !cur; if(!cur) return;
  fillFonts("#txtFont");
  const setV = (id, v) => { const el = $(id); if(document.activeElement !== el) el.value = v; };
  setV("#txtText", cur.text); setV("#txtFont", cur.font); setV("#txtSize", cur.size); setV("#txtColor", cur.color); setV("#txtBg", cur.bg); setV("#txtAnim", cur.anim);
  setV("#txtStart", (+cur.start).toFixed(2)); setV("#txtEnd", (+cur.start + +cur.dur).toFixed(2)); setV("#txtLs", cur.ls || 0); setV("#txtLsp", cur.lsp || 0);
  const sc = Math.round((cur.size || 1)/1.4*100); setV("#txtScale", sc); $("#txtScaleVal").textContent = sc + "%";
  setV("#txtPX", Math.round(((cur.x ?? .5) - 0.5)*200)); setV("#txtPY", Math.round((0.5 - (cur.y ?? .5))*200)); setV("#txtRot", cur.rot || 0); setV("#txtRotN", cur.rot || 0);
  $("#txtB").setAttribute("aria-pressed", String(!!cur.bold)); $("#txtU").setAttribute("aria-pressed", String(!!cur.underline)); $("#txtI").setAttribute("aria-pressed", String(!!cur.italic));
  $$("#txtCase button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (cur.tcase || ""))));
  $$("#txtAlign button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === (cur.align || "center"))));
  if(!$("#txtPresets").children.length) $("#txtPresets").innerHTML = TEXT_PRESETS.map(presetSwatch).join("");
  $$("#txtPresets .aa").forEach(b => { const pr = TEXT_PRESETS[+b.dataset.i]; b.setAttribute("aria-pressed", String(pr.look === cur.look && pr.color === cur.color && pr.bg === cur.bg)); });
}
$("#txtAdd").onclick = () => addText(); $("#textBtn").onclick = () => addText();
$("#txtList").onclick = e => { const b = e.target.closest("[data-id]"); if(!b) return; const it = textById(b.dataset.id); selectText(it.id); if(!S.playing) S.t = S.P.section.a + it.start + 0.05; };
const curText = () => S.sel?.type === "text" && textById(S.sel.id);
const textSet = patch => { const it = curText(); if(!it) return; Object.assign(it, patch); syncTextEditor(); tlDirty = true; saveDraft(); };
$("#txtPresets").onclick = e => { const b = e.target.closest(".aa"); if(!b) return; const pr = TEXT_PRESETS[+b.dataset.i]; textSet({look: pr.look, color: pr.color, bg: pr.bg}); };
$("#txtB").onclick = () => { const it = curText(); if(it) textSet({bold: !it.bold}); };
$("#txtU").onclick = () => { const it = curText(); if(it) textSet({underline: !it.underline}); };
$("#txtI").onclick = () => { const it = curText(); if(it) textSet({italic: !it.italic}); };
$("#txtCase").onclick = e => { const b = e.target.closest("button"); if(b) textSet({tcase: b.dataset.v}); };
$("#txtAlign").onclick = e => { const b = e.target.closest("button"); if(b) textSet({align: b.dataset.v}); };
$("#txtScale").oninput = e => { const it = curText(); if(!it) return; it.size = +e.target.value/100*1.4; $("#txtScaleVal").textContent = e.target.value + "%"; setVQuiet("#txtSize", it.size); tlDirty = true; saveDraft(); };
$("#txtPX").oninput = e => textSet({x: clamp(0.5 + (+e.target.value || 0)/200, 0, 1)});
$("#txtPY").oninput = e => textSet({y: clamp(0.5 - (+e.target.value || 0)/200, 0, 1)});
$("#txtRot").oninput = e => { const it = curText(); if(!it) return; it.rot = +e.target.value; $("#txtRotN").value = it.rot; saveDraft(); };
$("#txtRotN").oninput = e => { const it = curText(); if(!it) return; it.rot = clamp(+e.target.value || 0, -180, 180); $("#txtRot").value = it.rot; saveDraft(); };
function setVQuiet(id, v){ const el = $(id); if(el && document.activeElement !== el) el.value = v; }
[["#txtText","text"],["#txtFont","font"],["#txtSize","size",1],["#txtColor","color"],["#txtBg","bg"],["#txtAnim","anim"],["#txtLs","ls",1],["#txtLsp","lsp",1],["#txtStart","start",1]].forEach(([id, key, num]) =>
  $(id).addEventListener("input", e => { const it = S.sel?.type === "text" && textById(S.sel.id); if(!it) return; let v = num ? +e.target.value : e.target.value;
    if(key === "start") v = clamp(v, 0, S.P.section.b - S.P.section.a - 0.1); if(key === "dur") v = Math.max(0.2, v);
    it[key] = v; if(key === "font") document.fonts.load(fnt(v, 40)).catch(()=>{}); if(key === "text") $("#txtList").querySelector(`[data-id="${it.id}"]`)?.replaceChildren(document.createTextNode((v.split("\n")[0] || "Text").slice(0, 18)));
    if(key === "size"){ const sc = Math.round(v/1.4*100); setVQuiet("#txtScale", sc); $("#txtScaleVal").textContent = sc + "%"; }
    tlDirty = true; saveDraft(); }));
/* when a text box is on screen: from / until, with Now (the playhead) and Whole video */
const curT = () => S.sel?.type === "text" && textById(S.sel.id);
const secLen = () => S.P.section.b - S.P.section.a;
function setTextTime(it, a, b){ a = clamp(a, 0, secLen() - 0.2); b = clamp(b, a + 0.2, secLen()); it.start = +a.toFixed(2); it.dur = +(b - a).toFixed(2); tlDirty = true; syncTextEditor(); saveDraft(); }
$("#txtEnd").addEventListener("input", e => { const it = curT(); if(!it) return; it.dur = Math.max(0.2, Math.min(secLen() - it.start, +e.target.value - it.start)); tlDirty = true; saveDraft(); });
$("#txtEnd").addEventListener("change", () => syncTextEditor());
$("#txtStartNow").onclick = () => { const it = curT(); if(!it) return; const now = songTime() - S.P.section.a; setTextTime(it, now, Math.max(now + 0.2, it.start + it.dur)); };
$("#txtEndNow").onclick = () => { const it = curT(); if(!it) return; setTextTime(it, it.start, songTime() - S.P.section.a); };
$("#txtWhole").onclick = () => { const it = curT(); if(!it) return; setTextTime(it, 0, secLen()); };
$("#txtDel").onclick = () => { if(S.sel?.type === "text") deleteText(S.sel.id); };
$("#txtDup").onclick = () => { const it = S.sel?.type === "text" && textById(S.sel.id); if(!it) return; const c = {...it, id: "t" + Date.now().toString(36), y: clamp((it.y ?? .5) + 0.08, 0, 1)}; S.P.texts.push(c); selectText(c.id); dirty(); };

/* ============ templates ============ */
let DB = null, templates = [], localMode = true, tplUnsub = null, pendingDelete = null;
function tplPayload(){ const {lyrics, words, section, bpm, offset, style, hook, cuts, aspect, song} = S.P; return {v:1, song, section, bpm, offset, lyrics, words, style, hook, cuts, aspect}; }
function renderTemplates(){
  const el = $("#tplList");
  if(!templates.length){ el.innerHTML = `<div class="empty">No templates yet. Time a section, pick a style, then save it here so the next version starts halfway done.</div>`; return; }
  el.innerHTML = templates.map(t => `<div class="titem"><b>${esc(t.name)}</b><span class="sub">${esc(t.project?.song?.name || "")} · ${((t.project?.section?.b||0)-(t.project?.section?.a||0)).toFixed(1)}s · ${esc((PRESETS.find(p=>p.id===t.project?.style?.preset)||{}).name||"")} · ${new Date(t.savedAt).toLocaleDateString()}</span>
    <div class="row"><button class="btn small" data-load="${t.id}">Load</button><button class="btn small ghost" data-del="${t.id}">${pendingDelete===t.id?"Confirm delete":"Delete"}</button></div></div>`).join("");
}
$("#builtinList").onclick = e => { const b = e.target.closest("[data-builtin]"); if(!b) return; const t = BUILTINS.find(x => x.id === b.dataset.builtin); useBuiltin(t); renderBuiltins(); };
$("#tplList").onclick = async e => {
  const ld = e.target.closest("[data-load]"), dl = e.target.closest("[data-del]");
  if(ld){ const t = templates.find(x => x.id === ld.dataset.load); if(t){ pause(); applyProject(t.project); if(S.audio && t.project.song?.name && t.project.song.name !== S.songName) toast(`Loaded. This template was made on "${t.project.song.name}". Load that song to match the timing.`); else toast("Template loaded"); } }
  if(dl){ const id = dl.dataset.del; if(pendingDelete !== id){ pendingDelete = id; renderTemplates(); return; }
    pendingDelete = null;
    if(localMode){ templates = templates.filter(x => x.id !== id); store.set("sls-templates", templates); renderTemplates(); }
    else { try { await DB.collection("templates").doc(id).delete(); } catch(err){ toast("Couldn't delete: " + (err.message||err.code)); } } }
};
$("#tplSave").onclick = async () => {
  const name = $("#tplName").value.trim() || `${S.songName} · ${(S.P.section.b-S.P.section.a).toFixed(0)}s`;
  const doc = {name, savedAt: Date.now(), project: tplPayload()};
  if(localMode){ doc.id = "l" + Date.now(); templates.unshift(doc); store.set("sls-templates", templates); renderTemplates(); toast("Template saved in this browser"); }
  else { try { await DB.collection("templates").add(doc); toast("Template saved for the team"); } catch(err){ toast(err.code === "invalid_argument" ? "You can view templates but not save them. Ask for Contributor access." : "Couldn't save: " + (err.message || err.code)); } }
  $("#tplName").value = "";
};
async function saveFile(filename, data){
  const dl = window.claude?.use ? await window.claude.use("downloads") : null;
  if(!dl){
    if(window.claude) return false;
    // hosted outside Claude: a normal browser download works
    const a = document.createElement("a"), u = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); a.href = u; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return true;
  }
  try { await dl.save({filename, data}); return true; } catch(err){ if(err.code !== "declined") toast("Couldn't save the file (" + err.code + ")"); return null; }
}
$("#tplDownload").onclick = async () => {
  const ok = await saveFile(`${(S.songName||"template").replace(/[^\w\- ]+/g,"")}-template.json`, JSON.stringify({name:S.songName, savedAt:Date.now(), project:tplPayload()}, null, 2));
  if(ok === false) toast("Saving files isn't available in this view");
};
$("#tplOpen").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  try { const j = JSON.parse(await f.text()), p = j.project || j; if(!Array.isArray(p.words)) throw 0; pause(); applyProject(p); toast("Template opened"); } catch { toast("That file isn't a Lyric Studio template"); } };
function initTemplates(){
  templates = store.get("sls-templates") || []; renderTemplates(); renderBuiltins();
  const source = window.claude?.use ? window.claude.use("db") : (window.SLSBackend ? window.SLSBackend.db() : null);
  if(!source) return; if(tplUnsub){ try { tplUnsub(); } catch {} tplUnsub = null; }
  Promise.resolve(source).then(db => {
    if(!db) return; DB = db; localMode = false;
    { const l = $("#tplMineLbl"); if(l) l.dataset.tip = "Templates are shared with everyone who has this page. They keep the section, lyric timing, beat grid, cuts, style and hook. Footage isn't stored, so you can swap visuals for each new version."; }
    tplUnsub = db.collection("templates").orderBy("savedAt","desc").limit(200).onSnapshot(snap => {
      templates = snap.docs.map(d => ({id:d.id, ...d.data()})); renderTemplates();
    }, err => { toast("Shared templates unavailable (" + err.code + "). Saving in this browser instead."); localMode = true; templates = store.get("sls-templates") || []; renderTemplates(); });
  }).catch(()=>{});
}

/* ============ export ============ */
let exBlob = null, exExt = "webm", exUrl = null;
function pickMime(){
  const opts = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2","video/mp4;codecs=avc1,mp4a.40.2","video/mp4","video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
  return opts.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
}
$("#exportBtn").onclick = () => {
  if(S.tap) return; pause();
  const m = pickMime(), [W,H] = frameSize(), len = S.P.section.b - S.P.section.a;
  $("#exInfo").textContent = m ? `${aspectLabel()} · ${W}×${H} · ${len.toFixed(1)}s · ${m.startsWith("video/mp4") ? "MP4" : "WebM"}` : "This browser can't record video. Use a recent Chrome, Edge or Safari.";
  $("#exStart").disabled = !m;
  $("#exSetup").hidden = false; $("#exRun").hidden = true; $("#exDone").hidden = true; $("#exportModal").hidden = false;
};
$("#exClose").onclick = $("#exDone2").onclick = () => { $("#exportModal").hidden = true; const v = $("#exVideo"); v.pause(); };
$("#exStart").onclick = async () => {
  const mime = pickMime(); if(!mime) return;
  exExt = mime.startsWith("video/mp4") ? "mp4" : "webm";
  const c = ctx(); await c.resume();
  const dest = c.createMediaStreamDestination(), vstream = stage.captureStream(30);
  const stream = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const chunks = [], rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond: 9_000_000, audioBitsPerSecond: 192_000});
  rec.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    vstream.getTracks().forEach(t => t.stop());
    exBlob = new Blob(chunks, {type: mime.split(";")[0]});
    if(exUrl) URL.revokeObjectURL(exUrl); exUrl = URL.createObjectURL(exBlob);
    $("#exVideo").src = exUrl; $("#exRun").hidden = true; $("#exDone").hidden = false;
    $("#exNote").textContent = `${(exBlob.size/1048576).toFixed(1)} MB ${exExt.toUpperCase()}. Check it plays well before posting.` + (exExt === "webm" ? " TikTok and Instagram prefer MP4, so convert WebM files or record in Chrome." : "");
  };
  $("#exSetup").hidden = true; $("#exRun").hidden = false; $("#exBar").style.width = "0%";
  S.selBackup = S.sel; S.sel = null; tlDirty = true;
  S.t = S.P.section.a;
  S.exporting = {rec};
  renderFrame(S.t);
  rec.start(250);
  play({dest});
};
function finishExport(){
  const ex = S.exporting; S.exporting = null; pause(); S.t = S.P.section.a; S.sel = S.selBackup || null; tlDirty = true;
  if(ex && ex.rec.state !== "inactive") ex.rec.stop();
}
$("#exSave").onclick = async () => {
  if(!exBlob) return;
  const ok = await saveFile(`${(S.songName||"lyric-video").replace(/[^\w\- ]+/g,"").trim() || "lyric-video"}-${S.P.aspect.replace(":","x")}.${exExt}`, exBlob);
  if(ok) toast("Video saved");
  else if(ok === false) $("#exNote").textContent = "Saving isn't available in this view. Open this page in claude.ai, or right-click the video and choose Save video as.";
};

/* ============ main loop ============ */
let lastTC = "";
/* Paused, the picture only changes when someone does something, so it isn't redrawn 60 times a second:
   every frame for 1.5 s after any click, key, drag or scroll, then 4 times a second (videos finishing a seek,
   photos and fonts arriving), and not at all behind the start page. Playing and exporting draw every frame. */
var busyAt = 0, stillAt = 0, stillKey = "";   // var: saveDraft() (earlier in this file) marks changes too
["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "input", "change", "drop", "resize"].forEach(ev => addEventListener(ev, () => { busyAt = performance.now(); }, { capture: true, passive: true }));
const homeShown = () => { const h = document.getElementById("home"); return !!h && !h.hidden; };
function stillDue(){
  const now = performance.now(), key = S.t + "|" + stage.width + "x" + stage.height + "|" + tlDirty;
  const due = key !== stillKey || (homeShown() ? now - stillAt > 2000 : now - busyAt < 1500 || now - stillAt > 250);
  if(due){ stillAt = now; stillKey = key; }
  return due;
}
function loop(){
  try { loopBody(); } catch(err){ if(!loop.warned){ loop.warned = true; console.error(err); } }
  requestAnimationFrame(loop);
}
function loopBody(){
  if(S.exporting && S.exporting.offline) return;   // js/export.js is drawing frames itself
  const sec = bounds();
  if(S.playing){
    let t = songTime();
    if(t >= sec.b){
      if(S.exporting){ renderFrame(sec.b - 0.001); finishExport(); }
      else if(S.tap){ pause(); endTap(S.tap.i > 0); }
      else if(S.review){ pause(); S.t = sec.a; }
      else { S.t = sec.a; play({}); }
      t = S.t;
    }
    if(S.exporting){ $("#exBar").style.width = (clamp((t - sec.a)/(sec.b - sec.a),0,1)*100).toFixed(1) + "%"; $("#exStatus").textContent = `Recording ${fmt(t - sec.a)} of ${fmt(sec.b - sec.a)}`; }
    renderFrame(t);
  } else if(stillDue()) renderFrame(S.t);
  else if(homeShown()) return;
  drawTimeline(); drawOverview(); drawStylePreview(performance.now());
  const tc = `<b>${fmt(songTime() - sec.a)}</b> / ${fmt(sec.b - sec.a)}`; if(tc !== lastTC){ $("#tc").innerHTML = tc; lastTC = tc; }
}
document.addEventListener("visibilitychange", () => { if(document.hidden && S.exporting){ $("#exStatus").textContent = "This tab went to the background, so the recording may stutter. Keep it in front."; } });

/* ============ boot ============ */
function boot(){
  $("#presets").onclick = e => { const b = e.target.closest(".preset"); if(!b) return; S.P.style.preset = b.dataset.id; S.P.style.case = "auto"; syncUI(); saveDraft(); };
  $("#presets").addEventListener("pointerover", e => { const b = e.target.closest(".preset"); hoverStyle = b ? b.dataset.id : null; });
  $("#presets").addEventListener("pointerleave", () => hoverStyle = null);
  S.clips = GEN.map((g,i) => ({id:"g"+i, name:g.name, kind:"gen", gen:g, on:i === 0}));   // Royal blue on its own to start
  addThumbsForGen();
  S.audio = silentDemo(); S.peaks = computePeaks(S.audio); S.songName = "Demo track";   // "Demo track": the sample song, see js/demo-song.js
  const p = defaultProject();
  p.lyrics = SLS_DEMO.lyrics; p.words = SLS_DEMO.words.map(w => ({ ...w }));
  p.song = {name:"Demo track", duration:S.audio.duration}; p.section = { ...SLS_DEMO.section }; p.bpm = SLS_DEMO.bpm; p.offset = SLS_DEMO.offset;
  S.P = p;
  demoPending = { buf: S.audio };   // the real audio: see ensureDemo()
  applyProject(S.P);
  setTimeout(() => { HIST.last = JSON.stringify(S.P); syncUndoUI(); }, 0);
  if(window.matchMedia("(max-width:700px) and (pointer:coarse)").matches){ S.zoom = 2.5; $("#zoom").value = 2.5; }
  document.body.dataset.mtab = "lyrics";
  renderPresetGrid(); renderClips(); sizeTimeline(); initTemplates();
  document.fonts.ready.then(() => { renderPresetThumbs(); tlDirty = true; });
  // every template font (30 or so): fetched once the page is up and quiet, so they don't slow down the first load
  (window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 2500 }) : f => setTimeout(f, 1200))(() =>
    Promise.all(Object.keys(FONTLIB).map(k => document.fonts.load(fnt(k, 40)).catch(()=>{}))).then(() => { renderPresetThumbs(); tlDirty = true; }));
  renderPresetThumbs();
  if(window.IntersectionObserver) new IntersectionObserver(es => { if(thumbsStale && es.some(e => e.isIntersecting)) renderPresetThumbs(); }).observe($("#presets"));
  new ResizeObserver(() => sizeTimeline()).observe(tlScroll);
  new ResizeObserver(fitStage).observe($(".viewport"));
  requestAnimationFrame(loop);
}
function fitStage(){
  const vp = $(".viewport"), cs = getComputedStyle(vp), aw = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = vp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  // keep the same spot in the middle when zooming
  const cx = vp.scrollWidth > vp.clientWidth ? (vp.scrollLeft + vp.clientWidth/2) / vp.scrollWidth : 0.5, cyf = vp.scrollHeight > vp.clientHeight ? (vp.scrollTop + vp.clientHeight/2) / vp.scrollHeight : 0.5;
  const k = Math.max(0.05, Math.min(aw/stage.width, ah/stage.height)) * (S.viewZoom || 1);
  stage.style.width = Math.floor(stage.width*k) + "px"; stage.style.height = Math.floor(stage.height*k) + "px";
  if((S.viewZoom || 1) > 1){ vp.scrollLeft = cx * vp.scrollWidth - vp.clientWidth/2; vp.scrollTop = cyf * vp.scrollHeight - vp.clientHeight/2; }
}
/* ---------- preview zoom and full screen ---------- */
const VZ = [1, 1.25, 1.5, 2, 2.5, 3, 4];
function setViewZoom(z){
  S.viewZoom = clamp(z, 1, 4); $(".viewport").classList.toggle("zoomed", S.viewZoom > 1.001);
  fitStage(); $("#vzVal").textContent = S.viewZoom > 1.001 ? Math.round(S.viewZoom * 100) + "%" : "Fit";
}
const zoomStep = dir => { const z = S.viewZoom || 1; setViewZoom(dir > 0 ? (VZ.find(v => v > z + 0.01) || 4) : ([...VZ].reverse().find(v => v < z - 0.01) || 1)); };
$("#vzIn").onclick = () => zoomStep(1); $("#vzOut").onclick = () => zoomStep(-1); $("#vzVal").onclick = () => setViewZoom(1);
$(".viewport").addEventListener("wheel", e => { if(!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setViewZoom((S.viewZoom || 1) * Math.exp(-e.deltaY * (Math.abs(e.deltaY) < 40 ? 0.01 : 0.002))); }, { passive: false });
const isFull = () => document.fullscreenElement === $(".stage") || document.webkitFullscreenElement === $(".stage") || document.body.classList.contains("stage-full");
function toggleFull(){
  const el = $(".stage");
  if(isFull()){ if(document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else document.body.classList.remove("stage-full"); }
  else { const go = el.requestFullscreen || el.webkitRequestFullscreen; if(go) Promise.resolve(go.call(el)).catch(() => document.body.classList.add("stage-full")); else document.body.classList.add("stage-full"); }
  setTimeout(paintFull, 60);
}
function paintFull(){ const on = isFull(); $("#vFull").title = on ? "Leave full screen (F or Esc)" : "Full screen (F)"; $("#vFull").setAttribute("aria-label", on ? "Leave full screen" : "Full screen"); requestAnimationFrame(fitStage); }
$("#vFull").onclick = toggleFull;
document.addEventListener("fullscreenchange", paintFull); document.addEventListener("webkitfullscreenchange", paintFull);
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "range";
  if(typing || e.metaKey || e.ctrlKey || e.altKey || !$("#home").hidden) return;
  if(e.code === "Escape" && document.body.classList.contains("stage-full")){ document.body.classList.remove("stage-full"); paintFull(); return; }
  if(!["design", "lyrics"].includes(document.body.dataset.step)) return;
  if(e.code === "KeyF"){ e.preventDefault(); toggleFull(); }
  else if(e.key === "+" || e.key === "="){ e.preventDefault(); zoomStep(1); }
  else if(e.key === "-" || e.key === "_"){ e.preventDefault(); zoomStep(-1); }
  else if(e.key === "0"){ e.preventDefault(); setViewZoom(1); }
});
function addThumbsForGen(){ S.clips.forEach(c => { if(c.kind === "gen") addThumb(c, genThumb(c.gen)); }); }
boot();

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
  // the voice's range only (roughly 1 to 4 kHz), for telling a held note from a silence before a word
  async function voiceBand(buf){
    try {
      const oc = new OfflineAudioContext(1, Math.ceil(buf.duration * RATE), RATE), src = oc.createBufferSource(); src.buffer = buf;
      const bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2000; bp.Q.value = 0.6;
      src.connect(bp).connect(oc.destination); src.start();
      return (await oc.startRendering()).getChannelData(0);
    } catch { return null; }
  }
  // words "heard" where the song is all but silent (before it starts, after it ends, in a gap) were made up
  function dropSilent(list, env){
    if(!env || !list.length) return list;
    const sorted = Array.from(env).sort((x, y) => x - y), mid = sorted[Math.floor(sorted.length * 0.5)];
    if(!(mid > 0)) return list;
    return list.filter(w => { const l = level(env, w.s, Math.max(w.e, w.s + 0.1)); return l == null || l > mid * 0.003; });
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
  // Whisper was trained on subtitled video, so over music or silence it sometimes "hears" a subtitle credit
  const JUNK = /subtit|amara\.org|thanks? (you )?for watching|sottotitoli|untertitel|sous-titres|ondertitel|napisy|teksting|tekstet av|tekster(ne)? af|tekstning|undertekst|textning|svensktext|svenska undertexter|nicolai winther|www\.|https?:|\.com\b/i;

  /* ---------- one pass: stitch the pieces back together ---------- */
  function stitch(cuts, results, dur){
    const words = [];
    cuts.forEach((c, k) => {
      const r = results[k]; if(!r) return;
      const lo = k > 0 ? (c.s + cuts[k - 1].e) / 2 : -1, hi = k < cuts.length - 1 ? (cuts[k + 1].s + c.e) / 2 : Infinity;   // each overlap is split down the middle
      (r.segments || []).forEach((seg, si) => {
        if(JUNK.test(seg.text)) return;
        const nsp = seg.nsp ?? 0, lp = seg.lp ?? -0.5, cr = seg.cr ?? 1, ws = seg.words || [];
        if(nsp > 0.6 && lp < -1) return;                                 // the model itself thinks nobody is singing here
        if(lp < -1.4) return;                                            // a wild guess
        if(cr > 2.8 && lp < -0.5 && ws.length > 6) return;               // looping on itself, a known way it makes text up
        if(ws.length >= 4){ const d = ws.map(w => (w.e ?? 0) - (w.s ?? 0)).sort((x, y) => x - y)[Math.floor(ws.length / 2)]; if(d < 0.05) return; }   // words with no length: written, not heard
        ws.forEach((w, i) => {
          if(w.p != null && w.p < 0.12) return;
          const text = tidy(w.w); if(!text || !norm(text)) return;
          const s = c.s + (w.s ?? 0), e = c.s + Math.max(w.e ?? 0, (w.s ?? 0) + 0.04); if(s < lo || s >= hi || s > dur + 0.5) return;
          const edge = Math.min(c.s > 0 ? s - c.s : Infinity, c.e < dur - 0.05 ? c.e - s : Infinity);
          words.push({ w: text, n: norm(text), s, e, lp, edge, brk: i === 0, sg: k + ":" + si });
        });
      });
    });
    words.sort((a, b) => a.s - b.s);
    // the same word caught on both sides of a seam
    return words.filter((w, i) => !(i > 0 && w.n === words[i - 1].n && w.s - words[i - 1].s < 0.6 && w.edge < OVERLAP + 0.5 && words[i - 1].edge < OVERLAP + 0.5));
  }

  /* ---------- two passes into one transcript, with doubts marked ----------
     ctx (optional): { covB: [[s, e]] parts of the song the second pass really heard, cuts: [times] where either
     pass cut the song }. Words only one pass heard are the usual way the AI invents lyrics (over an intro, a beat
     break or an outro it "hears" a line that isn't there). They are kept only where that's believable: near a cut,
     where the other pass didn't listen, inside a phrase both passes heard, or tight between words both heard. */
  function reconcile(A, B, ctx = {}){
    const n = A.length, m = B.length;
    if(!m) return A.map(w => ({ ...w, u: w.lp < -0.7 ? 1 : 0 }));
    if(!n) return B.map(w => ({ ...w, u: 1 }));
    // longest common run of words that also agree roughly on when they were sung
    const W = m + 1, dp = new Uint16Array((n + 1) * W);
    const same = (i, j) => A[i].n === B[j].n && Math.abs(A[i].s - B[j].s) < 2.5;
    for(let i = n - 1; i >= 0; i--) for(let j = m - 1; j >= 0; j--)
      dp[i * W + j] = same(i, j) ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    const ops = []; let i = 0, j = 0, ra = [], rb = [];
    const push = () => { if(ra.length || rb.length) ops.push({ ra, rb }); ra = []; rb = []; };
    while(i < n && j < m){
      if(same(i, j)){ push(); ops.push({ a: A[i], b: B[j] }); i++; j++; }
      else if(dp[(i + 1) * W + j] >= dp[i * W + j + 1]) ra.push(A[i++]);
      else rb.push(B[j++]);
    }
    while(i < n) ra.push(A[i++]); while(j < m) rb.push(B[j++]);
    push();
    const agreedSeg = new Set(); ops.forEach(o => { if(o.a){ agreedSeg.add("A" + o.a.sg); agreedSeg.add("B" + o.b.sg); } });
    const covB = ctx.covB || null, cuts = ctx.cuts || [];
    const coveredByB = t => !covB || covB.some(([s, e]) => t >= s + 0.5 && t <= e - 0.5);
    const nearCut = t => cuts.some(c => Math.abs(c - t) < 2.5);
    const score = r => r.reduce((a, w) => a + w.lp - (w.edge < 1.2 ? 0.6 : 0), 0) / r.length;
    const agS = ops.filter(o => o.a).map(o => o.a.s), agE = ops.filter(o => o.a).map(o => o.a.e);
    const agreedBefore = t => { let x = -Infinity; for(const e of agE){ if(e <= t + 0.05) x = e; else break; } return x; };
    const agreedAfter = t => { for(const s of agS) if(s >= t - 0.05) return s; return Infinity; };
    const out = [];
    ops.forEach((o, k) => {
      if(o.a){ const a = o.a, b = o.b; out.push({ ...(a.edge >= b.edge ? a : b), w: a.w, brk: a.brk, u: 0 }); return; }
      const { ra, rb } = o;
      if(ra.length && rb.length){
        // both heard something here, but not the same thing: keep the more confident reading, offer the other
        const [keep, other] = score(ra) >= score(rb) ? [ra, rb] : [rb, ra], pair = keep.length === other.length;
        keep.forEach((w, q) => out.push({ ...w, u: 1, alt: pair ? (other[q].n !== w.n ? other[q].w : "") : (q === 0 ? other.map(x => x.w).join(" ") : "") }));
        return;
      }
      // only one pass heard these
      const fromA = ra.length > 0, run = fromA ? ra : rb;
      for(const w of run){
        if(w.lp < -1.1) continue;
        const before = agreedBefore(w.s), after = agreedAfter(w.e);
        const tight = (w.s - before < 3 && after - w.e < 3) || w.s - before < 1 || after - w.e < 1;
        const otherListened = fromA ? coveredByB(w.s) : true;
        const ok = !otherListened || nearCut(w.s) || agreedSeg.has((fromA ? "A" : "B") + w.sg) || tight;
        if(ok) out.push({ ...w, u: 1, alt: "" });
      }
    });
    return out.sort((a, b) => a.s - b.s);
  }

  /* ---------- timing and lines ---------- */
  // Whisper gives the silence before a word to that word, so a word after a pause seems to start far too early
  // (the hook comes in, but its first word has been lit up since the end of the last line). A word that runs much
  // longer than its length explains is pulled up to where it would really begin. A held note looks the same in
  // the timings, so the audio decides: if the part that would be cut is clearly quieter in the voice's range than
  // the rest of the word, nobody was singing there.
  const FR = 50;   // loudness frames per second
  function envelope(samples){
    if(!samples) return null;
    const hop = RATE / FR, n = Math.floor(samples.length / hop), env = new Float32Array(n);
    for(let f = 0; f < n; f++){ let e = 0; const a = f * hop; for(let i = 0; i < hop; i += 2){ const v = samples[a + i]; e += v * v; } env[f] = e / (hop / 2); }
    return env;
  }
  function level(env, s, e){
    if(!env) return null;
    const a = Math.max(0, Math.floor(s * FR)), b = Math.min(env.length, Math.max(a + 1, Math.ceil(e * FR)));
    if(b <= a) return null; let x = 0; for(let f = a; f < b; f++) x += env[f]; return x / (b - a);
  }
  const startCap = w => Math.min(1.2, Math.max(0.35, 0.18 + 0.075 * [...w.w].length));
  // how loud the part before the real start is, against the sung part (1 = same, 0 = silent); null without audio
  function leadRatio(env, w, cap){ const x = level(env, w.s, w.e - cap), y = level(env, w.e - cap, w.e); return x == null || !y ? null : x / y; }
  // where the voice clearly comes in inside a word: a rise in the voice's range that lasts (a drum hit doesn't)
  function onset(env, w){
    if(!env) return null;
    const a = Math.ceil((w.s + 0.2) * FR), b = Math.floor((w.e - 0.12) * FR), tail = level(env, w.e - Math.min(0.3, (w.e - w.s) / 3), w.e);
    let best = 0, at = -1;
    for(let f = Math.max(a, 15); f <= b && f + 10 <= env.length; f++){
      const pre = level(env, (f - 15) / FR, f / FR), post = level(env, f / FR, (f + 10) / FR), later = level(env, (f + 10) / FR, Math.min(w.e, (f + 20) / FR));
      if(pre > 0 && post / pre > best && post >= tail * 0.5 && (later == null || later >= pre * 1.5)){ best = post / pre; at = f; }
    }
    return best >= 2 ? at / FR : null;
  }
  // starts: the word opens a phrase (then it's moved unless the audio clearly says it's a held note).
  // loose: also check long words inside a phrase (moved only when the audio shows the voice coming in late).
  function trimStart(w, env, starts, loose){
    const cap = startCap(w), d = w.e - w.s; if(d <= cap * 1.35) return false;
    if(!starts && !loose) return false;
    const on = onset(env, w);
    if(on != null){ w.s = Math.min(on, w.e - 0.12); return true; }
    if(!starts) return env ? false : (([...w.w].length <= 4 && d > cap * 1.6) || d > cap * 2.4) ? (w.s = w.e - cap, true) : false;
    const r = leadRatio(env, w, cap);
    if(r == null || r < 0.85){ w.s = w.e - cap; return true; }
    return false;
  }
  function fixStarts(list, env = null, loose = false){
    list.sort((a, b) => a.s - b.s);
    list.forEach((w, k) => {
      const prev = list[k - 1], next = list[k + 1];
      const starts = !prev || w.brk || w.s - prev.e > 0.25, ends = !next || next.brk || next.s - w.e > 0.25;
      trimStart(w, env, starts, loose && !ends);
    });
    return list.sort((a, b) => a.s - b.s);
  }
  function finish(list, lang, env = null){
    if(!list.length) return { words: [], lyrics: "" };
    fixStarts(list, env, true);
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

  /* ---------- your lyrics, the AI's timing ----------
     When the lyrics are pasted in, the AI only has to find WHEN each word is sung. Both listening passes are
     matched word by word against the pasted text (allowing for small differences in spelling), and each pasted
     word takes the time of the word it matched. Where both passes agree, their timings are averaged. Words that
     couldn't be found in the vocal get a time estimated from their neighbours and are marked to check. */
  const CJK = /[぀-ヿ㐀-鿿가-힯฀-๿຀-໿က-႟ក-៿ༀ-࿿]/;
  /* ---------- cleaning pasted lyrics ----------
     Lyrics copied from Genius, Musixmatch, Apple Music or a notes app come with things that aren't sung:
     section labels ("[Verse 1: Artist]", "Vers 2", "Refreng", "Chorus x2"), singer names ("(Artist Name)",
     "Pop Smoke:"), page text ("12 Contributors", "GATTI Lyrics", "You might also like", "123Embed") and credits.
     Those are removed. "(x2)" after a line repeats it. Words in brackets inside a line are kept, but only if
     they are actually heard (backing vocals and ad-libs often aren't). */
  const LABEL = "intro|outro|verse|vers|verso|strofe|strofa|strophe|couplet|chorus|refrain|refreng|omkv[aæ]d|ritornello|estribillo|coro|kor|hook|pre[- ]?hook|post[- ]?hook|bridge|bro|broen|ponte|puente|pont|pre[- ]?chorus|post[- ]?chorus|pre[- ]?refreng|interlude|mellomspill|mellemspil|instrumental|break|drop|ad[- ]?libs?|spoken|skit|part|del|tekst|lyrics";
  const LABEL_LINE = new RegExp(`^[\\[({]?\\s*(?:${LABEL})\\b\\s*\\d*\\s*(?:[x×]\\s*\\d)?\\s*(?:[:\\-–—|]\\s*[^\\n]{0,60})?[\\])}]?\\s*:?\\s*$`, "i");
  const JUNK_LINE = [
    /^\d*\s*contributors?\b/i, /^translations?\b/i, /^you might also like/i, /^see .{0,40} live\b/i, /^get tickets/i,
    /^(produced|written|composed|mixed|mastered|arranged|performed) by\b/i, /^(songwriters?|writers?|producers?|composers?|lyricists?|source|album|label|release date|copyright|isrc)\b.{0,80}:/i,
    /^lyrics (powered|licensed|provided) by/i, /^\*+.*commercial use.*\*+$/i, /^\(?\d{6,}\)?$/, /^©/, /^℗/, /\bembed$/i,
  ];
  const INTERJECTION = /^(yeah|yea|yah|ya|yuh|oh|ooh|oooh|uh|huh|hey|hoo|woo|whoa|woah|ay|ayy|ayo|la|na|no|mm|mmm|hmm|baby|okay|ok|what|go|let's go|skrrt|brr|grr)$/i;
  function cleanLyrics(text){
    let lines = String(text || "").replace(/\r/g, "").replace(/[​-‏﻿]/g, "").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").split("\n");
    // a page title on the first line: "GATTI Lyrics", "12 ContributorsTranslationsGATTI Lyrics"
    const first = lines.findIndex(l => l.trim());
    if(first >= 0 && /contributors?|\blyrics\s*$/i.test(lines[first]) && lines[first].length < 160) lines.splice(first, 1);
    const out = [];
    for(let raw of lines){
      raw = raw.replace(/^you might also like/i, "").replace(/\d*\s*embed\s*$/i, "").replace(/\[[^\]]*\]/g, " ").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
      if(!raw) continue;
      if(LABEL_LINE.test(raw) || JUNK_LINE.some(r => r.test(raw))) continue;
      if(/:\s*$/.test(raw) && raw.split(" ").length <= 5) continue;                         // "Pop Smoke:"
      const only = raw.match(/^\(([^()]*)\)$/);                                              // "(Travis Scott)" alone on a line
      if(only){ const ws = only[1].trim().split(/\s+/);
        if(ws.length <= 4 && ws.every(w => /^[\p{Lu}\d$&]/u.test(w)) && !ws.every(w => INTERJECTION.test(norm(w)))) continue; }
      let times = 1; const rep = raw.match(/\s*[\[(]?\s*[x×]\s*(\d{1,2})\s*[\])]?\s*$/i) || raw.match(/\s*[\[(]\s*(\d{1,2})\s*[x×]\s*[\])]\s*$/i);
      if(rep){ times = Math.min(8, Math.max(1, +rep[1])); raw = raw.slice(0, rep.index).trim(); if(!raw) continue; }
      for(let k = 0; k < times; k++) out.push(raw);
    }
    return out;
  }
  /* Cleaned lines into tokens: [{w: as written, n: normalised, l: line, opt: in brackets, join: no spaces}]. */
  function tokenize(text){
    const out = []; let li = 0;
    for(const line of cleanLyrics(text)){
      const toks = [];
      for(const seg of line.split(/(\([^()]*\))/)){
        const opt = /^\(.*\)$/.test(seg);
        for(const part of seg.split(/\s+/).filter(Boolean)){
          if(CJK.test(part) && [...part].length > 1){ for(const ch of part){ const n = norm(ch); if(n) toks.push({ w: ch, n, l: li, join: true, opt }); } continue; }
          const n = norm(part);
          if(!n){ if(toks.length) toks[toks.length - 1].w += " " + part; continue; }   // a lone dash or symbol stays with the word before it
          toks.push({ w: part, n, l: li, opt });
        }
      }
      if(toks.length){ out.push(...toks); li++; }
    }
    return out;
  }
  function similar(a, b){
    if(a === b) return 1;
    const la = a.length, lb = b.length; if(!la || !lb) return 0;
    if(Math.min(la, lb) <= 2) return 0;                       // short words must match exactly
    if(Math.abs(la - lb) > Math.max(la, lb) * 0.5) return 0;
    let prev = Array.from({ length: lb + 1 }, (_, j) => j), cur = new Array(lb + 1);
    for(let i = 1; i <= la; i++){ cur[0] = i; for(let j = 1; j <= lb; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
    return 1 - prev[lb] / Math.max(la, lb);
  }
  /* For each pasted token, the index of the heard word it lines up with (or -1). Order is kept on both sides. */
  function matchUp(U, H){
    const n = U.length, m = H.length, W = m + 1;
    if(!n || !m) return new Int32Array(n).fill(-1);
    const GAP_U = -0.45, GAP_H = -0.2;                         // a missing pasted word costs more than an extra heard one (ad-libs)
    const score = new Float64Array((n + 1) * W), from = new Uint8Array((n + 1) * W);   // 1 match, 2 skip pasted, 3 skip heard
    for(let j = 1; j <= m; j++){ score[j] = j * GAP_H; from[j] = 3; }
    for(let i = 1; i <= n; i++){
      score[i * W] = i * GAP_U; from[i * W] = 2;
      const u = U[i - 1].n, gu = U[i - 1].opt ? -0.05 : GAP_U;   // a bracketed word that isn't heard costs almost nothing
      for(let j = 1; j <= m; j++){
        let best = score[(i - 1) * W + j] + gu, how = 2;
        const h = score[i * W + j - 1] + GAP_H; if(h > best){ best = h; how = 3; }
        const s = similar(u, H[j - 1].n);   // short words may differ by one letter at most
        if(s >= (Math.min(u.length, H[j - 1].n.length) <= 5 ? 0.78 : 0.68)){ const mt = score[(i - 1) * W + j - 1] + 1 + s + 1e-4 * (n - i) / n;   /* on a tie, the earlier copy of a repeated line wins */ if(mt > best){ best = mt; how = 1; } }
        score[i * W + j] = best; from[i * W + j] = how;
      }
    }
    const pick = new Int32Array(n).fill(-1);
    for(let i = n, j = m; i > 0 || j > 0;){
      const how = from[i * W + j];
      if(how === 1){ pick[i - 1] = j - 1; i--; j--; } else if(how === 2) i--; else j--;
    }
    return pick;
  }
  // heard words split into single characters when the pasted lyrics are matched character by character
  function splitChars(list){ return list.flatMap(w => { const cs = [...w.w]; if(cs.length < 2 || !CJK.test(w.w)) return [w]; const step = (w.e - w.s) / cs.length; return cs.map((ch, k) => ({ ...w, w: ch, n: norm(ch), s: w.s + k * step, e: w.s + (k + 1) * step })); }); }

  /* ctx (optional): { env: loudness envelope, covB: [[s, e]] parts the second pass heard, cuts: [times] } */
  function alignLyrics(text, passA, passB, ctx = {}){
    let U = tokenize(text);
    if(!U.length) return null;
    const env = ctx.env || null, covB = ctx.covB || null, cuts = ctx.cuts || [];
    const A = splitChars(fixStarts(passA.map(w => ({ ...w })), env)), B = splitChars(fixStarts(passB.map(w => ({ ...w })), env));
    const pa = matchUp(U, A), pb = B.length ? matchUp(U, B) : new Int32Array(U.length).fill(-1);
    // The first pass is given the lyrics as a hint, and over an instrumental part it can simply say them back.
    // A word only that pass found, where the second pass listened and heard nothing at all, is such an echo.
    const Bs = B.map(w => w.s);
    const heardByB = t => { let lo = 0, hi = Bs.length; while(lo < hi){ const mid = (lo + hi) >> 1; if(Bs[mid] < t - 1.5) lo = mid + 1; else hi = mid; } return lo < Bs.length && Bs[lo] <= t + 1.5; };
    const bListened = t => B.length > 0 && (!covB || covB.some(([s, e]) => t >= s + 0.5 && t <= e - 0.5)) && !cuts.some(c => Math.abs(c - t) < 2);
    // timing for each pasted word from the passes that heard it
    const T = U.map((u, i) => {
      const a = pa[i] >= 0 ? A[pa[i]] : null, b = pb[i] >= 0 ? B[pb[i]] : null;
      if(a && b && Math.abs(a.s - b.s) < 0.6) return { s: (a.s + b.s) / 2, e: (a.e + b.e) / 2, ok: 2 };
      if(a && b) return { s: a.s, e: a.e, ok: 1, alt: { s: b.s, e: b.e }, far: b.edge > a.edge + 1 };   // they disagree: settled below
      if(a && bListened(a.s) && !heardByB(a.s)) return null;
      if(a || b){ const x = a || b; return { s: x.s, e: x.e, ok: 1 }; }
      return null;
    });
    // where the passes disagree, take the reading that fits between the words around it
    const sure = T.map((t, i) => t && t.ok === 2 ? i : -1).filter(i => i >= 0);
    T.forEach((t, i) => {
      if(!t || !t.alt) return;
      let p = -1, q = -1; for(const k of sure){ if(k < i) p = k; else { q = k; break; } }
      const lo = p >= 0 ? T[p].s : -Infinity, hi = q >= 0 ? T[q].s : Infinity;
      const fits = x => x.s > lo - 0.05 && x.s < hi + 0.05, fa = fits(t), fb = fits(t.alt);
      const near = x => Math.min(Math.abs(x.s - lo), Math.abs(hi - x.s)), da = near(t), db = near(t.alt);
      const echo = bListened(t.s) && !heardByB(t.s);
      const useB = fb && !fa ? true : fa && !fb ? false : echo ? true : Math.abs(da - db) > 1 ? db < da : t.far;
      T[i] = useB ? { s: t.alt.s, e: t.alt.e, ok: 1 } : { s: t.s, e: t.e, ok: 1 };
    });
    // anything out of order: keep the longest run of words that are in order, weighting agreed words higher
    {
      const idx = T.map((t, i) => t ? i : -1).filter(i => i >= 0), L = idx.length;
      const best = new Float64Array(L), from = new Int32Array(L).fill(-1);
      for(let x = 0; x < L; x++){ const w = T[idx[x]].ok; best[x] = w;
        for(let y = 0; y < x; y++) if(T[idx[y]].s <= T[idx[x]].s + 0.05 && best[y] + w > best[x]){ best[x] = best[y] + w; from[x] = y; } }
      let end = -1; for(let x = 0; x < L; x++) if(end < 0 || best[x] > best[end]) end = x;
      const keepSet = new Set(); for(let x = end; x >= 0; x = from[x]) keepSet.add(idx[x]);
      idx.forEach(i => { if(!keepSet.has(i)) T[i] = null; });
    }
    // a line is sung in one go: matches scattered across the song (a line pasted twice but sung once picks up
    // stray similar words) don't count. Per line, only the tightest group of matches is kept, and only if it
    // covers a fair part of the line.
    const byLine = new Map(); U.forEach((u, i) => { if(!byLine.has(u.l)) byLine.set(u.l, []); byLine.get(u.l).push(i); });
    for(const idx of byLine.values()){
      const hit = idx.filter(i => T[i]); if(!hit.length) continue;
      const groups = [[hit[0]]];
      for(let k = 1; k < hit.length; k++){ const p = hit[k - 1], i = hit[k]; if(T[i].s - T[p].s > 4 + 1.5 * (i - p - 1)) groups.push([i]); else groups[groups.length - 1].push(i); }
      const best = groups.reduce((a, g) => g.length > a.length ? g : a, groups[0]);
      // a single matched word only anchors a line when it's a longer word (short ones match by chance)
      const real = idx.filter(i => !U[i].opt).length, need = real >= 3 ? Math.max(2, Math.ceil(real * 0.3)) : 1;
      const enough = best.length >= need || (best.length === 1 && [...U[best[0]].n].length >= 5);
      for(const i of hit) if(!enough || !best.includes(i)) T[i] = null;
      // the line's first found word, far ahead of the rest of the line, is a stray (an echo, an ad-lib, the same
      // little word sung earlier): it would sit lit up waiting for the line. Let it be placed from its neighbours.
      const left = idx.filter(i => T[i]);
      if(left.length >= 2){ const [i0, i1] = left, gap = T[i1].s - T[i0].e, short = [...U[i0].n].length <= 4;
        if(gap > (i1 - i0) * 0.7 + (short ? 0.9 : 1.8)) T[i0] = null; }
    }
    // Whole lines nobody sang. When most of the lyrics were found, a line with no word heard at all is almost
    // always one that isn't in this version (a chorus pasted once too often, a verse the song skips), and
    // squeezing it in between real lines puts words on screen that aren't sung. Those lines are left out.
    let dropped = 0, droppedWords = 0;
    {
      const hitShare = T.filter(Boolean).length / U.length;
      if(hitShare >= 0.45){
        const gone = new Set();
        for(const [l, idx] of byLine) if(idx.every(i => !T[i]) && idx.some(i => !U[i].opt)){ gone.add(l); dropped++; }
        if(gone.size){ const keepI = U.map((u, i) => !gone.has(u.l)); droppedWords = keepI.filter(k => !k).length; U = U.filter((_, i) => keepI[i]); const T1 = T.filter((_, i) => keepI[i]); T.length = 0; T.push(...T1); }
      }
    }
    // bracketed words (backing vocals, ad-libs) that weren't heard are left out; lines left empty go too
    const keep = U.map((u, i) => !(u.opt && !T[i]));
    const T2 = T.filter((_, i) => keep[i]); U = U.filter((_, i) => keep[i]);
    const lineMap = new Map(); U = U.map(u => { if(!lineMap.has(u.l)) lineMap.set(u.l, lineMap.size); return { ...u, l: lineMap.get(u.l) }; });
    const found = T2.filter(Boolean).length;
    if(!found) return { words: [], lyrics: "", matched: 0 };
    // the song's pace: typical time from one found word to the next found word in the same line
    const steps = []; for(let i = 1; i < U.length; i++) if(T2[i] && T2[i - 1] && U[i].l === U[i - 1].l) steps.push(T2[i].s - T2[i - 1].s);
    steps.sort((x, y) => x - y);
    const pace = steps.length ? Math.min(1.2, Math.max(0.22, steps[Math.floor(steps.length / 2)])) : 0.32;
    // words that weren't found: placed between the words around them, never past them
    for(let i = 0; i < U.length;){
      if(T2[i]){ i++; continue; }
      let j = i; while(j < U.length && !T2[j]) j++;
      const prev = T2[i - 1], next = T2[j], k = j - i, per = pace;
      const sameLinePrev = prev && U[i - 1].l === U[i].l, sameLineNext = next && U[j].l === U[j - 1].l;
      let from, step;
      if(prev && next){
        const lo = prev.e + 0.03, hi = next.s - 0.03, room = Math.max(0, hi - lo);
        if(room < k * per * 1.6){ step = Math.max(0.04, room / k); from = lo; }                    // tight: share the space evenly
        else if(sameLinePrev && !sameLineNext){ step = per; from = lo; }                           // ends a line: right after the line's last heard word
        else if(sameLineNext && !sameLinePrev){ step = per; from = hi - k * per; }                 // starts a line: right before its first heard word
        else { step = Math.min(0.6, room / k); from = lo + (room - k * step) / 2; }
      } else if(next){ const hi = next.s - 0.03; step = Math.max(0.04, Math.min(per, hi / k)); from = Math.max(0, hi - k * step); }
      else { step = per; from = prev.e + 0.05; }
      for(let q = 0; q < k; q++) T2[i + q] = { s: from + q * step, e: from + (q + 0.85) * step, ok: 0 };
      i = j;
    }
    // first words of lines (and, where the audio is clear, long words inside them) start when they're sung
    for(let i = 0; i < U.length; i++){
      if(!T2[i].ok) continue;
      const first = i === 0 || U[i].l !== U[i - 1].l, last = i === U.length - 1 || U[i + 1].l !== U[i].l;
      const w = { w: U[i].w, s: T2[i].s, e: T2[i].e };
      if(trimStart(w, env, first, !first && !last && !!env)) T2[i] = { ...T2[i], s: w.s };
    }
    // never let a word start before the one sung before it
    for(let i = 1; i < T2.length; i++) if(T2[i].s < T2[i - 1].s + 0.02){ T2[i] = { ...T2[i], s: T2[i - 1].s + 0.02, e: Math.max(T2[i].e, T2[i - 1].s + 0.08) }; }
    // words, lines as pasted, sensible lengths
    let words = U.map((u, i) => ({ w: u.w, l: u.l, t: Math.max(0, T2[i].s), e: Math.max(T2[i].s + 0.05, T2[i].e), join: u.join, g: T2[i].ok === 0 }));
    // characters of a language written without spaces are joined back into short phrases
    const merged = [];
    for(const w of words){ const p = merged[merged.length - 1];
      if(p && w.join && p.join && p.l === w.l && w.t - p.e < 0.3 && [...p.w].length < 6){ p.w += w.w; p.e = Math.max(p.e, w.e); p.g = p.g || w.g; }
      else merged.push({ ...w }); }
    words = merged;
    const out = words.map((w, k) => { const nx = words[k + 1], o = { w: w.w, l: w.l, t: +w.t.toFixed(3), d: +Math.max(0.06, Math.min(Math.max(w.e - w.t, 0.12), 2.5, nx ? nx.t - w.t - 0.02 : 9)).toFixed(3) }; if(w.g){ o.u = 1; o.g = 1; } return o; });
    const lines = []; out.forEach(w => { (lines[w.l] = lines[w.l] || []).push(w.w); });
    return { words: out, lyrics: lines.filter(Boolean).map(L => L.join(" ")).join("\n"), matched: found / (U.length + droppedWords), dropped };
  }
  /* Pasted lyrics that are only a part of the song (usually the hook): every place in the song where that part is
     sung, as [{a, b, cov}] in time order, or null when the paste is the whole song (or can't be placed).
     Each place is the best local match of the pasted words against the words heard (Smith-Waterman), and a
     match found is blanked out before looking for the next one. */
  function findParts(U, heard, dur){
    const real = U.filter(u => !u.opt), H = splitChars(heard).map(w => ({ ...w }));
    if(real.length < 3 || dur < 45 || real.length >= H.length * 0.55) return null;
    const n = real.length, m = H.length, Wd = m + 1, out = [];
    for(let round = 0; round < 6; round++){
      const sc = new Float32Array((n + 1) * Wd), from = new Uint8Array((n + 1) * Wd);
      let best = 0, bi = 0, bj = 0;
      for(let i = 1; i <= n; i++) for(let j = 1; j <= m; j++){
        const h = H[j - 1].n, sim = h ? similar(real[i - 1].n, h) : 0, ok = sim >= (Math.min(real[i - 1].n.length, h.length) <= 5 ? 0.78 : 0.68);
        let v = 0, f = 0;
        const d = sc[(i - 1) * Wd + j - 1] + (ok ? 1 + sim : -1); if(d > v){ v = d; f = 1; }
        const up = sc[(i - 1) * Wd + j] - 0.9; if(up > v){ v = up; f = 2; }      // a pasted word not heard
        const lf = sc[i * Wd + j - 1] - 0.4; if(lf > v){ v = lf; f = 3; }        // an extra word heard (ad-lib)
        sc[i * Wd + j] = v; from[i * Wd + j] = f; if(v > best){ best = v; bi = i; bj = j; }
      }
      if(best <= 0) break;
      let i = bi, j = bj, hits = 0, j0 = bj;
      while(i > 0 && j > 0 && sc[i * Wd + j] > 0){ const f = from[i * Wd + j]; if(f === 1){ if(H[j - 1].n && similar(real[i - 1].n, H[j - 1].n) >= 0.68) hits++; j0 = j; i--; j--; } else if(f === 2) i--; else if(f === 3){ j0 = j; j--; } else break; }
      const cov = hits / n, a = H[j0 - 1].s, b = H[bj - 1].e;
      if(cov < (out.length ? Math.max(0.35, out[0].cov * 0.5) : 0.3)) break;
      out.push({ a, b, cov });
      for(let k = j0 - 1; k < bj; k++) H[k].n = "";                                // blank it out, find the next time
    }
    if(!out.length) return null;
    if(out.some(o => o.b - o.a > dur * 0.6)) return null;                          // it covers most of the song: not a part
    return out.sort((x, y) => x.a - y.a);
  }
  // the part of the pasted lyrics most likely sung in a piece of the song, as a hint for the AI
  function promptFor(U, c, dur){
    if(!U.length) return "";
    const a = Math.max(0, Math.floor((c.s / dur - 0.2) * U.length)), b = Math.min(U.length, Math.ceil((c.e / dur + 0.2) * U.length));
    let s = U.slice(a, b).map(u => u.w).join(" ");
    if(s.length > 550) s = s.slice(0, 550).replace(/\s+\S*$/, "");
    return s;
  }

  /* ---------- the whole job ---------- */
  async function run(buf, { language = null, signal = null, onProgress = () => {}, lyrics = "" } = {}){
    const api = window.SLSBackend, stop = () => { if(signal && signal.aborted) throw new api.ApiError("cancelled", "Cancelled.", 0); };
    onProgress({ stage: "read", pct: 0.02 });
    const mono = await toMono16k(buf), dur = mono.length / RATE; stop();
    const loud = envelope(mono), voice = envelope(await voiceBand(buf)) || loud; stop();
    const given = lyrics && lyrics.trim() ? tokenize(lyrics) : [];
    // far fewer words than a whole song has: probably just the hook (a song sings about 2 words a second overall)
    const shortPaste = given.length > 0 && dur > 45 && given.length < dur * 0.9;
    const first = Math.min(CHUNK / 2 - 1, Math.max(4, dur / 2));
    const A = plan(dur, 0), B = dur > 6 ? plan(dur, first) : [];
    const jobs = [...A.map((c, k) => ({ c, k, pass: "A" })), ...B.map((c, k) => ({ c, k, pass: "B" }))], res = { A: [], B: [] };
    let done = 0;
    const tick = () => { const inA = done < A.length; onProgress({ stage: inA ? "listen" : "check", pct: 0.06 + 0.86 * done / jobs.length, done, total: jobs.length }); };
    const one = async (job, lang) => {
      const payload = { audio: wavBase64(mono, Math.floor(job.c.s * RATE), Math.floor(job.c.e * RATE)), at: +job.c.s.toFixed(2), len: +(job.c.e - job.c.s).toFixed(2) };
      if(lang) payload.language = lang;
      // the first pass gets the pasted lyrics as a hint; the second listens without, so a hint the AI
      // merely repeated back (it can, over instrumental parts) doesn't end up placing words
      if(given.length && job.pass === "A"){ const hint = shortPaste ? given.map(u => u.w).join(" ").slice(0, 550).replace(/\s+\S*$/, "") : promptFor(given, job.c, dur); if(hint) payload.prompt = hint; }
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
    const a = dropSilent(stitch(A, res.A, dur), loud), b = B.length && failedB < B.length ? dropSilent(stitch(B, res.B, dur), loud) : [];
    // a piece the second pass came back (nearly) empty on doesn't count as a second opinion
    const heardIn = (list, c) => list.filter(w => w.s >= c.s && w.s < c.e).length;
    const edges = P => P.flatMap((c, k) => [k > 0 ? c.s : null, k < P.length - 1 ? c.e : null]).filter(x => x != null);
    const ctx = { env: voice, covB: B.filter((c, k) => res.B[k] && heardIn(b, c) >= Math.max(1, 0.3 * heardIn(a, c))).map(c => [c.s, c.e]), cuts: [...edges(A), ...edges(B)] };
    if(given.length){
      // only part of the song pasted (the hook): find each time it's sung and time the lyrics there
      const occ = findParts(given, b.length >= a.length * 0.5 ? b : a, dur);
      if(occ){
        const near = (list, o) => list.filter(w => w.s >= o.a - 2.5 && w.s <= o.b + 2.5);
        const parts = occ.map(o => ({ o, al: alignLyrics(lyrics, near(a, o), near(b, o), ctx) })).filter(x => x.al && x.al.words.length && x.al.matched >= 0.3)
          .map(({ o, al }) => ({ a: al.words[0].t, b: Math.max(...al.words.map(w => w.t + w.d)), words: al.words, lyrics: al.lyrics, matched: al.matched, dropped: al.dropped, unsure: al.words.filter(w => w.u).length }));
        if(parts.length){
          parts.sort((x, y) => x.a - y.a);
          const best = parts.reduce((x, y) => y.matched > x.matched + 0.05 ? y : x, parts[0]);
          onProgress({ stage: "time", pct: 1 });
          return { words: best.words, lyrics: best.lyrics, matched: best.matched, dropped: best.dropped, mode: "aligned", part: true, occurrences: parts, language: lang || detected || null, unsure: best.unsure, doubleChecked: b.length > 0 };
        }
      }
      const al = alignLyrics(lyrics, a, b, ctx);
      onProgress({ stage: "time", pct: 1 });
      return { ...al, mode: "aligned", language: lang || detected || null, unsure: al.words.filter(w => w.u).length, doubleChecked: b.length > 0 };
    }
    const final = finish(reconcile(a, b, ctx), lang || detected, voice);
    onProgress({ stage: "time", pct: 1 });
    return { ...final, mode: "heard", language: lang || detected || null, unsure: final.words.filter(w => w.u).length, doubleChecked: b.length > 0 };
  }

  return { run, cleanLyrics, LANGUAGES, langName, _test: { plan, stitch, reconcile, finish, norm, tidy, tokenize, similar, matchUp, alignLyrics, envelope, dropSilent, fixStarts, findParts } };
})();

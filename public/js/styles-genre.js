"use strict";
/* 25 more lyric styles: 22 looks made for a genre (the Genres tab) and three more for the other tabs.
   Same contract as the other style files: draw(c, W, H, s, t, st, o) draws the current lyric line at size 1,
   centred on (W/2, cy(H, st)). s = {words, start, end, rev, act, fade}; o = {pf, sf, hi, tx, v}.
   tags = {e: energy, m: moods} feed the "Suits this song" recommender in styles-more.js.
   The demo lines are made up for the previews. Loaded after styles-trend.js. */
(() => {
  Object.assign(FONTLIB, {
    rye: { name: "Rye (western)", css: 'Rye, Georgia, serif', w: "400" },
    metalmania: { name: "Metal Mania", css: '"Metal Mania", Impact, serif', w: "400" },
    fraktur: { name: "UnifrakturMaguntia (blackletter)", css: 'UnifrakturMaguntia, "Old English Text MT", serif', w: "400" },
    orbitron: { name: "Orbitron", css: 'Orbitron, "Arial Black", sans-serif', w: "800" },
    righteous: { name: "Righteous", css: 'Righteous, "Arial Rounded MT Bold", sans-serif', w: "400" },
    shrikhand: { name: "Shrikhand", css: 'Shrikhand, "Arial Black", serif', w: "400" },
    abril: { name: "Abril Fatface", css: '"Abril Fatface", Didot, Georgia, serif', w: "400" },
    elite: { name: "Special Elite (typewriter)", css: '"Special Elite", "Courier New", monospace', w: "400" },
    glitch: { name: "Rubik Glitch", css: '"Rubik Glitch", "Arial Black", sans-serif', w: "400" },
    garamond: { name: "Cormorant Garamond", css: '"Cormorant Garamond", Georgia, serif', w: "600" },
    garamondi: { name: "Cormorant Garamond Italic", css: '"Cormorant Garamond", Georgia, serif', w: "500", i: "italic" },
    bowlby: { name: "Bowlby One", css: '"Bowlby One", "Arial Black", sans-serif', w: "400" },
    blackops: { name: "Black Ops One", css: '"Black Ops One", Impact, sans-serif', w: "400" },
  });
  const MINE = ["rye", "metalmania", "fraktur", "orbitron", "righteous", "shrikhand", "abril", "elite", "glitch", "garamond", "garamondi", "bowlby", "blackops"];
  Promise.all(MINE.map(k => document.fonts.load(fnt(k, 40)).catch(() => {}))).then(() => { renderPresetThumbs(); tlDirty = true; });

  const TAU = Math.PI * 2;
  const sung = (s, i) => i < s.rev;
  const ageOf = (s, i, t) => t - s.words[i].t;
  const isCur = (s, i) => i === s.rev - 1;
  // a number between 0 and 1 that stays the same for word i, so tilts and shakes don't flicker
  const hash = (i, k = 0) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  // how hard the beat hits right now: 1 on the beat, fading before the next one (the song's own tempo)
  function beat(t){ const bl = 60 / ((S.P && S.P.bpm) || 120), ph = (((t - ((S.P && S.P.offset) || 0)) % bl) + bl) % bl; return Math.exp(-ph / (bl * 0.22)); }
  function measure(c, W, H, s, st, o, opt){
    const r = lineLayout(c, W, H, s, st, o, { ...opt, each(){} }), lh = r.px * (opt.lh || 1.2);
    return { px: r.px, lay: r.lay, lh, top: cy(H, st) - r.lay.lines * lh / 2 };
  }
  // the word being sung, centred, at the size that fits
  function one(c, W, H, s, t, st, o, cs, size, maxW = 0.86, font){
    const { i, w, age } = curWord(s, t), txt = caseOf(st, cs, w.w), f = font || o.pf, px = fitK(c, f, [txt], W * maxW, H * size);
    c.font = fnt(f, px); c.textAlign = "center"; c.textBaseline = "middle";
    return { i, w, age, txt, px, yc: cy(H, st) };
  }
  function star(c, x, y, r, pts = 5, inner = 0.45){
    c.beginPath(); for(let k = 0; k < pts * 2; k++){ const a = -Math.PI / 2 + k * Math.PI / pts, rr = k % 2 ? r * inner : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill();
  }
  function heart(c, x, y, r){
    c.beginPath(); c.moveTo(x, y + r * 0.9); c.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.3, x, y - r * 0.45); c.bezierCurveTo(x + r * 0.7, y - r * 1.3, x + r * 1.6, y - r * 0.2, x, y + r * 0.9); c.fill();
  }
  function pill(c, x, y, w, h, r){ c.beginPath(); if(c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  const left = c => { c.textBaseline = "top"; c.textAlign = "left"; };

  const NEW = [
    /* ================= GENRES ================= */
    { id: "g-country", name: "Country", cat: "genre", caseDef: "upper", demo: "dust on my boots tonight", def: { pf: "rye", hi: "#e8b04a" }, tags: { e: "mid", m: ["summer", "romantic", "happy"] },
      draw(c, W, H, s, t, st, o){   // a western poster: a saloon face, double rules above and below that draw out as the line starts, a star at each end
        const opt = { caseDef: "upper", px: 0.05, maxW: 0.76, lh: 1.35 }, m = measure(c, W, H, s, st, o, opt), p = ease((t - s.start) / 0.5);
        const bw = Math.max(...m.lay.widths), yA = m.top - m.px * 0.4, yB = m.top + m.lay.lines * m.lh + m.px * 0.1, half = (bw / 2 + m.px * 0.3) * p;
        c.save(); c.strokeStyle = o.hi; c.fillStyle = o.hi;
        [[yA, 1], [yB, -1]].forEach(([y, d]) => {
          c.lineWidth = Math.max(1, m.px * 0.07); c.beginPath(); c.moveTo(W / 2 - half, y); c.lineTo(W / 2 + half, y); c.stroke();
          c.lineWidth = Math.max(1, m.px * 0.03); c.beginPath(); c.moveTo(W / 2 - half, y + d * m.px * 0.14); c.lineTo(W / 2 + half, y + d * m.px * 0.14); c.stroke(); });
        if(p > 0.85){ c.globalAlpha *= (p - 0.85) / 0.15; star(c, W / 2 - half - m.px * 0.45, (yA + yB) / 2, m.px * 0.26); star(c, W / 2 + half + m.px * 0.45, (yA + yB) / 2, m.px * 0.26); }
        c.restore();
        left(c);
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.28; c.fillStyle = isCur(s, i) ? o.hi : o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "g-metal", name: "Metal", cat: "genre", caseDef: "upper", demo: "burn it all down", def: { pf: "metalmania", hi: "#ff2a1f" }, tags: { e: "high", m: ["dark", "dramatic", "hype"] },
      draw(c, W, H, s, t, st, o){   // one word at a time in a metal face: brushed-steel letters, red heat behind them, a hard shake when each one hits
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.15, 0.88), hit = 1 - ease(age / 0.2), k = pop(age, 0.16, 0.22), fr = Math.floor(age * 40);
        c.save(); c.translate(W / 2 + (hash(i, fr) - 0.5) * px * 0.1 * hit, yc + (hash(i + 9, fr) - 0.5) * px * 0.1 * hit); c.scale(k, k);
        c.save(); c.shadowColor = o.hi; c.shadowBlur = px * (0.3 + 0.5 * hit); c.globalAlpha *= 0.85; c.fillStyle = o.hi; c.fillText(txt, 0, 0); c.restore();
        const g = c.createLinearGradient(0, -px * 0.5, 0, px * 0.5); g.addColorStop(0, "#ffffff"); g.addColorStop(0.46, "#a4a6ad"); g.addColorStop(0.54, "#55575e"); g.addColorStop(1, "#e8e9ec");
        c.fillStyle = g; c.fillText(txt, 0, 0); c.lineWidth = Math.max(1, px * 0.018); c.strokeStyle = "#0c0c0e"; c.strokeText(txt, 0, 0);
        c.restore();
    } },

    { id: "g-drill", name: "Drill", cat: "genre", caseDef: "lower", demo: "came up from the cold", def: { pf: "fraktur", hi: "#a8dcff" }, tags: { e: "high", m: ["dark", "hype", "night"] },
      draw(c, W, H, s, t, st, o){   // blackletter, word by word, sliding in from alternate sides with an icy glow; the line so far sits small underneath
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "lower", 0.13, 0.84), p = ease(age / 0.2), dir = i % 2 ? 1 : -1;
        c.save(); c.globalAlpha *= p; c.translate(W / 2 + dir * (1 - p) * px * 0.7, yc - px * 0.18);
        c.shadowColor = o.hi; c.shadowBlur = px * 0.4; c.fillStyle = o.hi; c.fillText(txt, 0, 0); c.shadowBlur = 0; c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
        const sofar = s.words.slice(0, s.rev).map(w => caseOf(st, "lower", w.w)).join(" "), spx = fitK(c, o.pf, [sofar], W * 0.8, px * 0.3);
        c.save(); c.font = fnt(o.pf, spx); c.globalAlpha *= 0.55; c.fillStyle = o.tx; c.fillText(sofar, W / 2, yc + px * 0.62); c.restore();
    } },

    { id: "g-trap", name: "Trap", cat: "genre", caseDef: "upper", demo: "count it up again", def: { pf: "blackops", hi: "#b26bff" }, tags: { e: "high", m: ["hype", "party", "night"] },
      draw(c, W, H, s, t, st, o){   // words stack up, each one tilted a little and knocked in, with a hard purple drop shadow
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.07, maxW: 0.8, lh: 1.14, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = ageOf(s, i, t), k = pop(age, 0.12, 0.35), r = (hash(i) - 0.5) * 0.14, d = px * 0.08;
          c.save(); c.translate(x + it.w / 2, y + px / 2); c.rotate(r); c.scale(k, k); c.globalAlpha *= isCur(s, i) ? 1 : 0.86;
          c.fillStyle = o.hi; c.fillText(it.s, -it.w / 2 + d, -px / 2 + d); c.fillStyle = o.tx; c.fillText(it.s, -it.w / 2, -px / 2); c.restore(); } });
    } },

    { id: "g-rnb", name: "R&B", cat: "genre", caseDef: "lower", demo: "stay a little longer", def: { pf: "garamondi", hi: "#ffa7c9" }, tags: { e: "low", m: ["romantic", "night", "calm"] },
      draw(c, W, H, s, t, st, o){   // soft italic words that rise and fade in slowly, the one being sung wrapped in a rose glow
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.068, maxW: 0.8, lh: 1.2, each(it, i, x, y, px){
          if(!sung(s, i)) return; const p = ease(ageOf(s, i, t) / 0.55);
          c.save(); c.globalAlpha *= p * (isCur(s, i) ? 1 : 0.8); if(isCur(s, i)){ c.shadowColor = o.hi; c.shadowBlur = px * 0.45; }
          c.fillStyle = isCur(s, i) ? o.hi : o.tx; c.fillText(it.s, x, y + (1 - p) * px * 0.35); c.restore(); } });
    } },

    { id: "g-lofi", name: "Lo-fi", cat: "genre", caseDef: "lower", demo: "rainy days and coffee", def: { pf: "courier", hi: "#f4d9a6" }, tags: { e: "low", m: ["calm", "dreamy", "sad"] },
      draw(c, W, H, s, t, st, o){   // a worn tape look: the line drifts gently, sung words in a warm tone with faint red and blue edges
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.055, maxW: 0.8, lh: 1.4, each(it, i, x, y, px){
          const yy = y + Math.sin(t * 1.6 + i * 0.8) * px * 0.05, on = sung(s, i), d = px * 0.035;
          c.save();
          if(on){ c.globalAlpha *= 0.35; c.fillStyle = "#ff5a5a"; c.fillText(it.s, x - d, yy); c.fillStyle = "#5ab4ff"; c.fillText(it.s, x + d, yy); c.globalAlpha /= 0.35; }
          c.globalAlpha *= on ? 1 : 0.22; c.fillStyle = on ? (isCur(s, i) ? o.hi : o.tx) : o.tx; c.fillText(it.s, x, yy); c.restore(); } });
    } },

    { id: "g-synthwave", name: "Synthwave", cat: "genre", caseDef: "upper", demo: "drive into the night", def: { pf: "orbitron", hi: "#ff4fd8" }, tags: { e: "mid", m: ["night", "dreamy", "party"] },
      draw(c, W, H, s, t, st, o){   // chrome letters from cyan to pink over a glowing grid that rolls towards you
        const opt = { caseDef: "upper", px: 0.052, maxW: 0.82, lh: 1.3 }, m = measure(c, W, H, s, st, o, opt), yH = m.top + m.lay.lines * m.lh + m.px * 0.35, yE = yH + m.px * 2.2;
        c.save(); c.strokeStyle = o.hi; c.lineWidth = Math.max(1, m.px * 0.04); c.shadowColor = o.hi; c.shadowBlur = m.px * 0.3;
        const fade = c.createLinearGradient(0, yH, 0, yE); fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(0.25, o.hi); fade.addColorStop(1, o.hi); c.strokeStyle = fade; c.globalAlpha *= 0.55;
        c.beginPath(); for(let j = -7; j <= 7; j++){ c.moveTo(W / 2 + j * W * 0.025, yH); c.lineTo(W / 2 + j * W * 0.11, yE); }
        for(let k = 0; k < 6; k++){ const f = (k + (t * 0.9) % 1) / 6, y = yH + (yE - yH) * f * f; c.moveTo(W * 0.04, y); c.lineTo(W * 0.96, y); } c.stroke(); c.restore();
        left(c);
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y, px){
          const g = c.createLinearGradient(0, y, 0, y + px); g.addColorStop(0, "#7ff6ff"); g.addColorStop(0.5, o.tx); g.addColorStop(0.52, o.hi); g.addColorStop(1, "#ffd0f4");
          c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.16; if(isCur(s, i)){ c.shadowColor = o.hi; c.shadowBlur = px * 0.5; } c.fillStyle = g; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "g-techno", name: "Techno", cat: "genre", caseDef: "upper", demo: "lose control tonight", def: { pf: "spacemono", hi: "#d4ff3a" }, tags: { e: "high", m: ["party", "night", "dark"] },
      draw(c, W, H, s, t, st, o){   // one word, spaced wide, that strobes in on the hit, with scan lines that pump on the beat and a counter above
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.09, 0.7), b = beat(t), flash = age < 0.09;
        c.save(); setLS(c, px * 0.22); c.fillStyle = flash ? o.hi : o.tx; c.fillText(txt, W / 2 + px * 0.11, yc); setLS(c, 0);
        c.fillStyle = o.hi; const lw = W * (0.25 + 0.5 * b), lh = Math.max(1, px * 0.05);
        c.fillRect((W - lw) / 2, yc - px * 0.95, lw, lh); c.fillRect((W - lw) / 2, yc + px * 0.9, lw, lh);
        c.font = fnt(o.pf, px * 0.28); c.globalAlpha *= 0.7; c.fillStyle = o.tx; c.fillText(`${String(i + 1).padStart(2, "0")} / ${String(s.words.length).padStart(2, "0")}`, W / 2, yc - px * 1.35); c.restore();
    } },

    { id: "g-house", name: "House", cat: "genre", caseDef: "lower", demo: "all night we move", def: { pf: "righteous", hi: "#ffd23f" }, tags: { e: "high", m: ["party", "happy", "summer"] },
      draw(c, W, H, s, t, st, o){   // rounded words in club colours that pump with the kick drum
        const COL = [o.hi, "#ff5fa2", "#4ff0d0", o.tx], b = beat(t);
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.07, maxW: 0.8, lh: 1.2, each(it, i, x, y, px){
          const on = sung(s, i), k = on ? pop(ageOf(s, i, t), 0.14, 0.2) * (1 + 0.06 * b) : 1;
          c.save(); c.translate(x + it.w / 2, y + px / 2); c.scale(k, k); c.globalAlpha *= on ? 1 : 0.18; c.fillStyle = on ? COL[i % COL.length] : o.tx; c.fillText(it.s, -it.w / 2, -px / 2); c.restore(); } });
    } },

    { id: "g-disco", name: "Disco", cat: "genre", caseDef: "lower", demo: "groove is in the air", def: { pf: "shrikhand", hi: "#ff7a2f" }, tags: { e: "high", m: ["party", "happy", "summer"] },
      draw(c, W, H, s, t, st, o){   // fat 70s letters with a stack of coloured shadows that fan out as each word lands
        const LAY = ["#ffd23f", "#ff4f8b", o.hi];
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.07, maxW: 0.8, lh: 1.25, each(it, i, x, y, px){
          if(!sung(s, i)) return; const p = ease(ageOf(s, i, t) / 0.3), d = px * 0.05 * p;
          c.save(); LAY.forEach((col, k) => { const n = LAY.length - k; c.fillStyle = col; c.fillText(it.s, x + d * n, y + d * n); }); c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "g-soul", name: "Soul", cat: "genre", caseDef: "as", demo: "you know I feel it", def: { pf: "abril", hi: "#e9b44c" }, tags: { e: "low", m: ["romantic", "calm", "sad"] },
      draw(c, W, H, s, t, st, o){   // a classic record-sleeve serif: the whole line fades in, and a gold rule grows under the word being sung
        const fin = ease((t - s.start) / 0.6);
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.062, maxW: 0.8, lh: 1.4, each(it, i, x, y, px){
          c.save(); c.globalAlpha *= fin * (sung(s, i) ? 1 : 0.34); c.fillStyle = o.tx; c.fillText(it.s, x, y);
          if(isCur(s, i)){ c.fillStyle = o.hi; c.fillRect(x, y + px * 1.1, it.w * ease(ageOf(s, i, t) / 0.35), Math.max(2, px * 0.07)); } c.restore(); } });
    } },

    { id: "g-jazz", name: "Jazz", cat: "genre", caseDef: "lower", demo: "smoke and a slow tune", def: { pf: "dmserifi", hi: "#e0a84a" }, tags: { e: "low", m: ["night", "romantic", "calm"] },
      draw(c, W, H, s, t, st, o){   // elegant italic words that sway gently, like they're moving to the band; the one being sung in brass
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.068, maxW: 0.8, lh: 1.3, each(it, i, x, y, px){
          if(!sung(s, i)) return; const p = ease(ageOf(s, i, t) / 0.4), sw = Math.sin(t * 1.4 + i * 0.9);
          c.save(); c.translate(x + it.w / 2, y + px / 2 + sw * px * 0.04); c.rotate(sw * 0.045); c.globalAlpha *= p;
          c.fillStyle = isCur(s, i) ? o.hi : o.tx; c.fillText(it.s, -it.w / 2, -px / 2); c.restore(); } });
    } },

    { id: "g-punk", name: "Punk", cat: "genre", caseDef: "upper", demo: "no rules no future", def: { pf: "black", hi: "#ff2d3a" }, tags: { e: "high", m: ["hype", "dark"] },
      draw(c, W, H, s, t, st, o){   // a ransom note: every word cut out on its own scrap of paper, tilted, in clashing colours
        const SCRAP = [["#f4f1ea", "#111111"], [o.hi, "#ffffff"], ["#111111", "#f4f1ea"], ["#ffe14a", "#111111"]];
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.058, maxW: 0.74, lh: 1.55, each(it, i, x, y, px){
          if(!sung(s, i)) return; const [bg, fg] = SCRAP[Math.floor(hash(i, 3) * 4)], k = pop(ageOf(s, i, t), 0.1, 0.25), pad = px * 0.16;
          c.save(); c.translate(x + it.w / 2, y + px / 2); c.rotate((hash(i) - 0.5) * 0.16); c.scale(k, k);
          c.fillStyle = bg; c.beginPath(); c.moveTo(-it.w / 2 - pad, -px * 0.62); c.lineTo(it.w / 2 + pad * 1.2, -px * 0.58); c.lineTo(it.w / 2 + pad, px * 0.6); c.lineTo(-it.w / 2 - pad * 1.1, px * 0.64); c.closePath(); c.fill();
          c.fillStyle = fg;
          if(i % 3 === 1){ c.font = fnt("elite", px); const sc = it.w / Math.max(1, c.measureText(it.s).width); c.font = fnt("elite", px * Math.min(1.25, sc)); c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(it.s, 0, 0); }   // every third word cut from a typewritten page
          else c.fillText(it.s, -it.w / 2, -px / 2);
          c.restore(); } });
    } },

    { id: "g-grunge", name: "Grunge", cat: "genre", caseDef: "lower", demo: "static in my head", def: { pf: "elite", hi: "#c9c2a7" }, tags: { e: "mid", m: ["dark", "sad"] },
      draw(c, W, H, s, t, st, o){   // a smudged typewriter on a bad photocopy: letters doubled and flickering, a scratch under the word being sung
        const fl = 0.86 + 0.14 * hash(Math.floor(t * 12), 5);
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.062, maxW: 0.8, lh: 1.35, each(it, i, x, y, px){
          if(!sung(s, i)) return;
          c.save(); c.globalAlpha *= fl;
          for(let k = 0; k < 3; k++){ c.save(); c.globalAlpha *= 0.22; c.fillStyle = o.hi; c.fillText(it.s, x + (hash(i, k) - 0.5) * px * 0.1, y + (hash(i, k + 4) - 0.5) * px * 0.08); c.restore(); }
          c.fillStyle = o.tx; c.fillText(it.s, x, y);
          if(isCur(s, i)){ const p = ease(ageOf(s, i, t) / 0.3); c.strokeStyle = o.hi; c.lineWidth = Math.max(1, px * 0.05); c.beginPath(); c.moveTo(x - px * 0.05, y + px * 1.05); c.lineTo(x + (it.w + px * 0.1) * p, y + px * 0.98); c.stroke(); }
          c.restore(); } });
    } },

    { id: "g-hyperpop", name: "Hyperpop", cat: "genre", caseDef: "lower", demo: "glitter in my veins", def: { pf: "glitch", hi: "#7cf7ff" }, tags: { e: "high", m: ["party", "happy", "dreamy"] },
      draw(c, W, H, s, t, st, o){   // one huge word that springs in, its colours sliding through the rainbow, with sparkles twinkling round it
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "lower", 0.15, 0.84), k = overshoot(age / 0.26), h = (t * 140 + i * 55) % 360, tw = c.measureText(txt).width;
        c.save(); c.translate(W / 2, yc); c.scale(k, k);
        const g = c.createLinearGradient(-tw / 2, 0, tw / 2, 0); g.addColorStop(0, `hsl(${h},100%,72%)`); g.addColorStop(0.5, o.hi); g.addColorStop(1, `hsl(${(h + 90) % 360},100%,74%)`);
        c.lineJoin = "round"; c.lineWidth = px * 0.12; c.strokeStyle = o.tx; c.strokeText(txt, 0, 0); c.fillStyle = g; c.fillText(txt, 0, 0); c.restore();
        c.save(); c.fillStyle = o.tx;
        for(let q = 0; q < 4; q++){ const a = hash(i, q) * TAU, r = tw * 0.5 + px * (0.2 + 0.4 * hash(i, q + 9)), tws = 0.5 + 0.5 * Math.sin(t * 6 + q * 2);
          star(c, W / 2 + Math.cos(a) * r, yc + Math.sin(a) * px * 0.8, px * 0.14 * tws * ease(age / 0.3), 4, 0.3); }
        c.restore();
    } },

    { id: "g-reggaeton", name: "Reggaeton", cat: "genre", caseDef: "upper", demo: "baila conmigo esta noche", def: { pf: "bowlby", hi: "#ffd23f" }, tags: { e: "high", m: ["party", "summer", "romantic"] },
      draw(c, W, H, s, t, st, o){   // heavy words that drop in from above and bounce, hot gradient fill inside a thick dark outline
        left(c); c.lineJoin = "round";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.062, maxW: 0.82, lh: 1.25, each(it, i, x, y, px){
          if(!sung(s, i)) return; const p = clamp(ageOf(s, i, t) / 0.32, 0, 1), yo = -(1 - overshoot(p)) * px * 0.8;
          const g = c.createLinearGradient(0, y + yo, 0, y + yo + px); g.addColorStop(0, o.hi); g.addColorStop(1, "#ff3d7f");
          c.save(); c.globalAlpha *= Math.min(1, p * 3); c.lineWidth = px * 0.16; c.strokeStyle = "#1a0b2e"; c.strokeText(it.s, x, y + yo); c.fillStyle = g; c.fillText(it.s, x, y + yo); c.restore(); } });
    } },

    { id: "g-afrobeats", name: "Afrobeats", cat: "genre", caseDef: "lower", demo: "feel the sunshine on me", def: { pf: "poppins", hi: "#3ddc84" }, tags: { e: "high", m: ["happy", "summer", "party"] },
      draw(c, W, H, s, t, st, o){   // bright pills in warm colours, one per word, popping in and nodding on the beat
        const COL = [o.hi, "#ffcc00", "#ff7a00", "#ffffff"], b = beat(t);
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.052, maxW: 0.76, lh: 1.65, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = pop(ageOf(s, i, t), 0.15, 0.3), ny = isCur(s, i) ? -b * px * 0.1 : 0, padX = px * 0.32, padY = px * 0.2;
          c.save(); c.translate(x + it.w / 2, y + px / 2 + ny); c.scale(k, k);
          c.fillStyle = COL[i % COL.length]; pill(c, -it.w / 2 - padX, -px / 2 - padY, it.w + padX * 2, px + padY * 2, px * 0.7); c.fill();
          c.fillStyle = "#141414"; c.fillText(it.s, -it.w / 2, -px / 2 + px * 0.04); c.restore(); } });
    } },

    { id: "g-kpop", name: "K-pop", cat: "genre", caseDef: "lower", demo: "you make my heart go", def: { pf: "unbounded", hi: "#ff8fd8" }, tags: { e: "high", m: ["happy", "romantic", "party"] },
      draw(c, W, H, s, t, st, o){   // sticker letters: pastel gradient inside a thick white edge, springing in, with little hearts floating up by the word being sung
        left(c); c.lineJoin = "round";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.058, maxW: 0.8, lh: 1.35, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = ageOf(s, i, t), k = overshoot(age / 0.25);
          const g = c.createLinearGradient(0, y, 0, y + px); g.addColorStop(0, o.hi); g.addColorStop(1, "#9fd4ff");
          c.save(); c.translate(x + it.w / 2, y + px / 2); c.scale(k, k);
          c.shadowColor = "rgba(0,0,0,0.3)"; c.shadowBlur = px * 0.2; c.shadowOffsetY = px * 0.06; c.lineWidth = px * 0.24; c.strokeStyle = "#ffffff"; c.strokeText(it.s, -it.w / 2, -px / 2);
          c.shadowColor = "transparent"; c.fillStyle = g; c.fillText(it.s, -it.w / 2, -px / 2); c.restore();
          if(isCur(s, i)){ c.save(); c.fillStyle = o.hi; for(let q = 0; q < 3; q++){ const f = ((age * 0.9 + q / 3) % 1); c.save(); c.globalAlpha *= 1 - f;
            heart(c, x + it.w + px * (0.15 + 0.25 * hash(i, q)), y - f * px * 1.2 + px * 0.2, px * 0.13); c.restore(); } c.restore(); } } });
    } },

    { id: "g-gospel", name: "Gospel", cat: "genre", caseDef: "upper", demo: "lift me higher", def: { pf: "garamond", hi: "#ffd77a" }, tags: { e: "mid", m: ["dreamy", "dramatic", "happy"] },
      draw(c, W, H, s, t, st, o){   // spaced serif capitals in a warm light that grows through the line, with slow turning rays behind
        const opt = { caseDef: "upper", px: 0.056, maxW: 0.78, lh: 1.45 }, prog = clamp((t - s.start) / Math.max(0.6, s.end - s.start), 0, 1);
        c.save(); setLS(c, H * 0.006); const m = measure(c, W, H, s, st, o, opt), yc = m.top + m.lay.lines * m.lh / 2, R = W * (0.22 + 0.22 * ease(prog));
        const g = c.createRadialGradient(W / 2, yc, 0, W / 2, yc, R); g.addColorStop(0, o.hi + "55"); g.addColorStop(1, o.hi + "00"); c.fillStyle = g; c.fillRect(0, yc - R, W, R * 2);
        c.globalAlpha *= 0.07; c.fillStyle = o.hi; c.beginPath();
        for(let k = 0; k < 12; k++){ const a = t * 0.15 + k * TAU / 12; c.moveTo(W / 2, yc); c.lineTo(W / 2 + Math.cos(a - 0.04) * R * 1.15, yc + Math.sin(a - 0.04) * R * 1.15); c.lineTo(W / 2 + Math.cos(a + 0.04) * R * 1.15, yc + Math.sin(a + 0.04) * R * 1.15); c.closePath(); }
        c.fill(); c.restore();
        c.save(); setLS(c, H * 0.006); left(c);
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ if(!sung(s, i)) return; c.save(); c.globalAlpha *= ease(ageOf(s, i, t) / 0.45); c.fillStyle = isCur(s, i) ? o.hi : o.tx; c.fillText(it.s, x, y); c.restore(); } });
        setLS(c, 0); c.restore();
    } },

    { id: "g-folk", name: "Folk", cat: "genre", caseDef: "lower", demo: "down by the river road", def: { pf: "caveat", hi: "#f2c48d" }, tags: { e: "low", m: ["calm", "romantic", "sad"] },
      draw(c, W, H, s, t, st, o){   // handwriting: each word is written in from left to right as it's sung, the newest in a warm ink
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.075, maxW: 0.8, lh: 1.15, each(it, i, x, y, px){
          if(!sung(s, i)) return; const p = ease(ageOf(s, i, t) / 0.4);
          c.save(); c.beginPath(); c.rect(x - px * 0.2, y - px * 0.5, (it.w + px * 0.4) * p, px * 2); c.clip(); c.fillStyle = isCur(s, i) ? o.hi : o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "g-phonk", name: "Phonk", cat: "genre", caseDef: "upper", demo: "drift on the cold road", def: { pf: "rubikmono", hi: "#ff1f3d" }, tags: { e: "high", m: ["dark", "hype", "night"] },
      draw(c, W, H, s, t, st, o){   // one stretched word in red that flashes white on the hit, with tape-style red and cyan ghosts and a shake on every beat
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.12, 0.62), b = beat(t), split = px * 0.08 * (1 - ease(age / 0.25)) + px * 0.015;
        c.save(); c.translate(W / 2 + (hash(Math.floor(t * 20), 2) - 0.5) * px * 0.08 * b, yc + (hash(Math.floor(t * 20), 6) - 0.5) * px * 0.06 * b); c.scale(1.35 * pop(age, 0.12, 0.18), 1);
        c.save(); c.globalAlpha *= 0.55; c.fillStyle = "#ff2b4a"; c.fillText(txt, -split, 0); c.fillStyle = "#2be8ff"; c.fillText(txt, split, 0); c.restore();
        c.fillStyle = age < 0.06 ? "#ffffff" : o.hi; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "g-emo", name: "Emo", cat: "genre", caseDef: "lower", demo: "i'm fine i swear", def: { pf: "courier", hi: "#ff2d55" }, tags: { e: "mid", m: ["sad", "dark"] },
      draw(c, W, H, s, t, st, o){   // a diary page: plain lowercase type, a red pen scribble under the word being sung, and one word crossed out
        const cross = s.words.length > 2 ? Math.floor(hash(s.words.length, Math.round(s.start)) * s.words.length) : -1;
        left(c);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.058, maxW: 0.8, lh: 1.45, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = ageOf(s, i, t);
          c.save(); c.fillStyle = o.tx; c.globalAlpha *= ease(age / 0.15); c.fillText(it.s, x, y);
          c.strokeStyle = o.hi; c.lineWidth = Math.max(1, px * 0.06); c.lineCap = "round";
          if(isCur(s, i)){ const p = ease(age / 0.35), n = 8; c.beginPath(); for(let q = 0; q <= n * p; q++){ const xx = x + it.w * q / n, yy = y + px * (1.08 + (q % 2 ? 0.07 : -0.03)); q ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke(); }
          if(i === cross && age > 0.3){ const p = ease((age - 0.3) / 0.25); c.beginPath(); c.moveTo(x - px * 0.05, y + px * 0.55); c.lineTo(x + (it.w + px * 0.1) * p, y + px * 0.48); c.stroke(); }
          c.restore(); } });
    } },

    /* ================= three more for the other tabs ================= */
    { id: "x-polaroid", name: "Polaroid", cat: "editorial", caseDef: "lower", demo: "summer of us", def: { pf: "caveat", hi: "#2a2622" }, tags: { e: "low", m: ["summer", "romantic", "happy"] },
      draw(c, W, H, s, t, st, o){   // a handwritten caption on a white instant-photo card, tilted a little, that pops in with the line
        const opt = { caseDef: "lower", px: 0.07, maxW: 0.7, lh: 1.1 }, m = measure(c, W, H, s, st, o, opt), p = ease((t - s.start) / 0.3), bw = Math.max(...m.lay.widths);
        const pad = m.px * 0.5, cw = bw + pad * 2, ch = m.lay.lines * m.lh + pad * 1.6, cyy = m.top + m.lay.lines * m.lh / 2;
        c.save(); c.translate(W / 2, cyy); c.rotate(-0.045); c.scale(0.9 + 0.1 * p, 0.9 + 0.1 * p); c.globalAlpha *= p;
        c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = m.px * 0.5; c.shadowOffsetY = m.px * 0.12; c.fillStyle = "#fbf8f1"; c.fillRect(-cw / 2, -ch / 2, cw, ch + pad * 0.6); c.restore();
        c.save(); c.translate(W / 2, cyy); c.rotate(-0.045); c.translate(-W / 2, -cyy); c.globalAlpha *= p; left(c);
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.2; c.fillStyle = o.hi; c.fillText(it.s, x, y - m.px * 0.08); c.restore(); } });
        c.restore();
    } },

    { id: "x-stage", name: "Stage Light", cat: "cinematic", caseDef: "upper", demo: "all eyes on me", def: { pf: "bebas", hi: "#fff3c4" }, tags: { e: "mid", m: ["dramatic", "night"] },
      draw(c, W, H, s, t, st, o){   // the frame dims, and a warm spotlight sits on the word being sung
        const opt = { caseDef: "upper", px: 0.085, maxW: 0.82, lh: 1.05 }; let spot = null;
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y, px){ if(isCur(s, i)) spot = { x: x + it.w / 2, y: y + px / 2, px }; } });
        if(spot){ const g = c.createRadialGradient(spot.x, spot.y, spot.px * 0.4, spot.x, spot.y, W * 0.75); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.35, "rgba(0,0,0,0.35)"); g.addColorStop(1, "rgba(0,0,0,0.65)");
          c.save(); c.globalAlpha *= ease((t - s.start) / 0.4); c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore(); }
        left(c);
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y, px){ c.save(); if(isCur(s, i)){ c.shadowColor = o.hi; c.shadowBlur = px * 0.35; c.fillStyle = o.hi; } else { c.globalAlpha *= sung(s, i) ? 0.5 : 0.15; c.fillStyle = o.tx; } c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "x-news", name: "Breaking News", cat: "bold", caseDef: "upper", demo: "this just in", def: { pf: "black", hi: "#e3122d" }, tags: { e: "mid", m: ["hype", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // a TV news bar slides in: a red LIVE tag, and the words appear on the white bar as they're sung (two rows for a long line)
        const texts = s.words.map(w => caseOf(st, "upper", w.w)), yc = cy(H, st), p = ease((t - s.start) / 0.3), x0 = W * 0.05 - (1 - p) * W, bw = W * 0.9;
        let px = H * 0.042, tagW = px * 3.1, lay;
        for(let k = 0; k < 6; k++){ tagW = px * 3.1; c.font = fnt(o.pf, px); lay = layoutWords(c, texts, bw - tagW - px * 1.0); if(lay.lines <= 2) break; px *= 0.88; }
        const lh = px * 1.15, bh = lay.lines * lh + px * 0.7, tx = x0 + tagW + px * 0.5, top = yc - bh / 2;
        c.save(); c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x0 + px * 0.12, top + px * 0.12, bw, bh);
        c.fillStyle = "#ffffff"; c.fillRect(x0, top, bw, bh); c.fillStyle = o.hi; c.fillRect(x0, top, tagW, bh);
        c.textBaseline = "middle"; c.textAlign = "center"; c.font = fnt(o.pf, px * 0.72); c.fillStyle = "#ffffff"; c.fillText("LIVE", x0 + tagW / 2, yc);
        c.textAlign = "left"; c.font = fnt(o.pf, px); c.fillStyle = "#111114";
        lay.items.forEach((it, i) => { if(sung(s, i)) c.fillText(it.s, tx + it.x, top + px * 0.35 + it.line * lh + lh / 2); });
        c.restore();
    } },
  ];

  for(const p of NEW) if(!PRESETS.some(x => x.id === p.id)) PRESETS.push(p);
  try { const d = store.get("sls-draft"); if(d && d.P && d.P.style && NEW.some(p => p.id === d.P.style.preset) && S.P && S.songName === d.songName){ S.P.style.preset = d.P.style.preset; syncUI(); } } catch {}
  renderPresetGrid();
})();

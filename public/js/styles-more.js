"use strict";
/* 45 more lyric styles, and the "recommended for this song" star.
   Same contract as studio.js and styles-extra.js: draw(c, W, H, s, t, st, o) draws the current lyric line at size 1,
   centred on (W/2, cy(H, st)). s = {words, start, end, rev, act, fade}; o = {pf, sf, hi, tx, v}.
   tags = {e: energy "low" | "mid" | "high", m: moods} feed the recommender at the bottom of this file.
   Loaded after styles-extra.js. */
(() => {
  Object.assign(FONTLIB, {
    syne: { name: "Syne ExtraBold", css: 'Syne, "Arial Black", sans-serif', w: "800" },
    dmserif: { name: "DM Serif Display", css: '"DM Serif Display", Georgia, serif', w: "400" },
    dmserifi: { name: "DM Serif Display Italic", css: '"DM Serif Display", Georgia, serif', w: "400", i: "italic" },
    bungee: { name: "Bungee", css: 'Bungee, Impact, sans-serif', w: "400" },
    monoton: { name: "Monoton", css: 'Monoton, Impact, sans-serif', w: "400" },
    rubikmono: { name: "Rubik Mono One", css: '"Rubik Mono One", "Arial Black", sans-serif', w: "400" },
    pacifico: { name: "Pacifico", css: 'Pacifico, "Segoe Script", cursive', w: "400" },
    spacemono: { name: "Space Mono Bold", css: '"Space Mono", Menlo, monospace', w: "700" },
    pixel: { name: "Silkscreen", css: 'Silkscreen, "Courier New", monospace', w: "400" },
  });
  Promise.all(["syne", "dmserif", "dmserifi", "bungee", "monoton", "rubikmono", "pacifico", "spacemono", "pixel"].map(k => document.fonts.load(fnt(k, 40)).catch(() => {})))
    .then(() => { renderPresetThumbs(); tlDirty = true; });

  const TAU = Math.PI * 2;
  const sung = (s, i) => i < s.rev;
  const ageOf = (s, i, t) => t - s.words[i].t;
  const shade = (hex, f) => { const n = parseInt((hex || "#888888").slice(1), 16); const ch = k => Math.round(clamp(((n >> k) & 255) * f, 0, 255)); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };
  const PARTY = ["#ffe14a", "#38d6ff", "#ff4f8b", "#7dff8a", "#b08cff"];
  /* the whole line's layout without drawing, for styles that paint something behind the words first */
  function measure(c, W, H, s, st, o, opt){
    const r = lineLayout(c, W, H, s, st, o, { ...opt, each(){} }), lh = r.px * (opt.lh || 1.2);
    return { px: r.px, lay: r.lay, lh, top: cy(H, st) - r.lay.lines * lh / 2, maxW: W * (opt.maxW || 0.84) };
  }
  /* the word being sung, centred, at the size that fits */
  function one(c, W, H, s, t, st, o, cs, size, maxW = 0.86, font){
    const { i, w, age } = curWord(s, t), txt = caseOf(st, cs, w.w), f = font || o.pf, px = fitK(c, f, [txt], W * maxW, H * size);
    c.font = fnt(f, px); c.textAlign = "center"; c.textBaseline = "middle";
    return { i, w, age, txt, px, yc: cy(H, st), tw: c.measureText(txt).width };
  }

  const NEW = [
    /* ================= MINIMAL ================= */
    { id: "hairline", name: "Hairline", cat: "minimal", caseDef: "lower", demo: "we don't have to go home", def: { pf: "light", hi: "#ffffff" }, tags: { e: "low", m: ["calm", "sad", "romantic"] },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.05, maxW: 0.82, lh: 1.45, each(it, i, x, y, px){
          const k = sung(s, i) ? ease(ageOf(s, i, t) / 0.35) : 0;
          c.save(); c.globalAlpha *= 0.2 + 0.8 * k; c.fillStyle = o.tx; c.fillText(it.s, x, y);
          if(i === s.rev - 1){ c.fillStyle = o.hi; c.fillRect(x, y + px * 1.14, it.w * ease(ageOf(s, i, t) / 0.45), Math.max(1, px * 0.035)); }
          c.restore(); } });
    } },

    { id: "breath", name: "Breath", cat: "minimal", caseDef: "upper", demo: "say it like you mean it", def: { pf: "sans", hi: "#ffffff" }, tags: { e: "low", m: ["calm", "dreamy", "sad"] },
      draw(c, W, H, s, t, st, o){   // the letters slowly breathe apart while the line is sung
        const p = clamp((t - s.start) / Math.max(0.6, s.end - s.start), 0, 1);
        c.textBaseline = "top"; setLS(c, H * 0.005 * ease(p));
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.032, maxW: 0.76, lh: 1.7, each(it, i, x, y){
          c.save(); c.globalAlpha *= sung(s, i) ? (i === s.rev - 1 ? 1 : 0.7) : 0.14; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
        setLS(c, 0);
    } },

    { id: "subtitle", name: "Subtitle", cat: "minimal", caseDef: "as", demo: "neon on the water", def: { pf: "sans", hi: "#ffe14a" }, tags: { e: "mid", m: ["calm", "dramatic", "night"] },
      draw(c, W, H, s, t, st, o){   // film subtitles: a soft box behind the words sung so far
        const opt = { caseDef: "as", px: 0.04, maxW: 0.8, lh: 1.42 }, m = measure(c, W, H, s, st, o, opt);
        c.save(); c.fillStyle = "rgba(0,0,0,.62)";
        for(let ln = 0; ln < m.lay.lines; ln++){ const row = m.lay.items.map((it, i) => ({ it, i })).filter(r => r.it.line === ln && sung(s, r.i)); if(!row.length) continue;
          const last = row[row.length - 1].it, w = last.x + last.w, x0 = (W - m.lay.widths[ln]) / 2, pad = m.px * 0.3;
          roundRect(c, x0 - pad, m.top + ln * m.lh - pad * 0.45, w + pad * 2, m.px * 1.2 + pad * 0.5, m.px * 0.18); c.fill(); }
        c.restore(); c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ if(!sung(s, i)) return; c.fillStyle = i === s.act ? o.hi : o.tx; c.fillText(it.s, x, y); } });
    } },

    { id: "floatup", name: "Float Up", cat: "minimal", caseDef: "lower", demo: "under all the city glow", def: { pf: "serifi", hi: "#dfe6ff" }, tags: { e: "low", m: ["dreamy", "romantic", "calm"] },
      draw(c, W, H, s, t, st, o){   // words float up out of a soft blur
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.066, maxW: 0.82, lh: 1.15, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = ease(ageOf(s, i, t) / 0.7);
          c.save(); c.globalAlpha *= k; if(k < 0.98) c.filter = `blur(${(px * 0.09 * (1 - k)).toFixed(2)}px)`;
          c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.5); c.restore(); } });
    } },

    { id: "rule", name: "Rule", cat: "minimal", caseDef: "upper", demo: "home", def: { pf: "sans", hi: "#ffffff" }, tags: { e: "mid", m: ["calm", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // one word between two thin rules that reach out to the edges
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.046, 0.6); setLS(c, px * 0.28);
        const tw = c.measureText(txt).width, k = ease(age / 0.5), gap = px * 0.7, L = (W * 0.44 - tw / 2 - gap) * k;
        c.save(); c.globalAlpha *= ease(age / 0.18); c.fillStyle = o.tx; c.fillText(txt, W / 2 + px * 0.14, yc); c.restore(); setLS(c, 0);
        if(L > 0){ c.fillStyle = o.hi; const h = Math.max(1, px * 0.04); c.fillRect(W / 2 - tw / 2 - gap - L, yc - h / 2, L, h); c.fillRect(W / 2 + tw / 2 + gap, yc - h / 2, L, h); }
    } },

    { id: "margin-dot", name: "Notes", cat: "minimal", caseDef: "lower", demo: "she never gave me a warning", def: { pf: "mono", hi: "#ff4f8b" }, tags: { e: "low", m: ["calm", "sad"] },
      draw(c, W, H, s, t, st, o){   // a notebook line with a dot that pulses beside the word being sung
        c.textBaseline = "top"; let dot = null;
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.036, maxW: 0.74, lh: 1.6, align: "left", each(it, i, x, y, px){
          c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.22; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); if(i === s.rev - 1) dot = { y: y + px * 0.55, px }; } });
        if(dot){ const x = W * 0.13 - dot.px * 0.9, r = dot.px * (0.16 + 0.05 * Math.sin(t * 8)); c.fillStyle = o.hi; c.beginPath(); c.arc(x, dot.y, r, 0, TAU); c.fill(); }
    } },

    /* ================= BOLD ================= */
    { id: "slam", name: "Slam", cat: "bold", caseDef: "upper", demo: "drop", def: { pf: "bebas", hi: "#ff2d3a" }, tags: { e: "high", m: ["hype", "party", "dark"] },
      draw(c, W, H, s, t, st, o){   // the word slams in from big, and the frame shakes for a moment
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.19, 0.92), k = age < 0.09 ? 1.75 - 0.75 * ease(age / 0.09) : 1;
        const sh = age < 0.28 ? (1 - age / 0.28) * px * 0.07 : 0, r = rng(Math.floor(t * 50) + 7);
        c.save(); c.translate(W / 2 + (r() - 0.5) * sh, yc + (r() - 0.5) * sh); c.scale(k, k);
        c.fillStyle = o.hi; c.fillText(txt, px * 0.035, px * 0.035); c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "rubber", name: "Rubber Stamp", cat: "bold", caseDef: "upper", demo: "approved", def: { pf: "rubikmono", hi: "#ff2d3a" }, tags: { e: "high", m: ["hype", "party"] },
      draw(c, W, H, s, t, st, o){   // a rubber stamp per word, each at its own angle
        const { i, txt, age, px, yc, tw } = one(c, W, H, s, t, st, o, "upper", 0.075, 0.62), r = rng(i * 31 + 5), a = (r() - 0.5) * 0.28, k = age < 0.12 ? 1.4 - 0.4 * ease(age / 0.12) : 1;
        c.save(); c.translate(W / 2, yc); c.rotate(a); c.scale(k, k); c.globalAlpha *= 0.88 + 0.12 * ease(age / 0.12);
        c.strokeStyle = o.hi; c.lineWidth = px * 0.09; roundRect(c, -tw / 2 - px * 0.4, -px * 0.75, tw + px * 0.8, px * 1.5, px * 0.18); c.stroke();
        c.lineWidth = px * 0.03; roundRect(c, -tw / 2 - px * 0.26, -px * 0.61, tw + px * 0.52, px * 1.22, px * 0.1); c.stroke();
        c.fillStyle = o.hi; c.fillText(txt, 0, px * 0.04);
        const g = rng(i * 7 + 1); c.fillStyle = "rgba(0,0,0,.22)"; for(let q = 0; q < 26; q++){ c.fillRect((g() - 0.5) * (tw + px * 0.8), (g() - 0.5) * px * 1.4, px * 0.05, px * 0.05); }   // worn ink
        c.restore();
    } },

    { id: "halves", name: "Halves", cat: "bold", caseDef: "upper", demo: "split second", def: { pf: "anton", hi: "#38d6ff" }, tags: { e: "high", m: ["hype", "dark", "night"] },
      draw(c, W, H, s, t, st, o){   // the top half slides in from the left, the bottom half from the right
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.17, 0.9), k = ease(age / 0.22), off = (1 - k) * W * 0.4;
        for(const [y0, dir, col] of [[-px, -1, o.tx], [0, 1, o.hi]]){ c.save(); c.beginPath(); c.rect(0, yc + y0, W, px); c.clip(); c.globalAlpha *= k; c.fillStyle = col; c.fillText(txt, W / 2 + dir * off, yc); c.restore(); }
        c.fillStyle = o.tx; c.globalAlpha *= 0.6 * k; c.fillRect(W / 2 - W * 0.3 * k, yc - 0.5, W * 0.6 * k, 1);
    } },

    { id: "blocks", name: "Blocks", cat: "bold", caseDef: "upper", demo: "we don't have to go home", def: { pf: "black", hi: "#ffe14a" }, tags: { e: "high", m: ["party", "happy", "hype"] },
      draw(c, W, H, s, t, st, o){   // each word lands on its own coloured block
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.052, maxW: 0.8, lh: 1.5, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = overshoot(ageOf(s, i, t) / 0.2), a = (i % 2 ? 1 : -1) * 0.035;
          c.save(); c.translate(x + it.w / 2, y + px * 0.5); c.rotate(a); c.scale(k, k);
          c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillRect(-it.w / 2 - px * 0.18, -px * 0.62, it.w + px * 0.36, px * 1.22);
          c.fillStyle = "#101014"; c.fillText(it.s, -it.w / 2, -px * 0.5); c.restore(); } });
    } },

    { id: "liquid", name: "Liquid", cat: "bold", caseDef: "upper", demo: "overflow", def: { pf: "anton", hi: "#2f6bff" }, tags: { e: "mid", m: ["hype", "night", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // an outline that fills up from the bottom while the word is sung
        const { w, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.17, 0.88), p = ease(clamp(age / Math.max(0.25, Math.min(w.d, 1.2)), 0, 1));
        c.save(); c.lineJoin = "round"; c.lineWidth = Math.max(1, px * 0.025); c.strokeStyle = o.tx; c.strokeText(txt, W / 2, yc);
        const top = yc + px * 0.5 - px * 1.05 * p, wave = px * 0.04;
        c.beginPath(); c.moveTo(0, H); for(let x = 0; x <= W; x += W / 24) c.lineTo(x, top + Math.sin(x / W * 12 + t * 7) * wave); c.lineTo(W, H); c.closePath(); c.clip();
        c.fillStyle = o.hi; c.fillText(txt, W / 2, yc); c.restore();
    } },

    { id: "zoom", name: "Megaphone", cat: "bold", caseDef: "upper", demo: "louder", def: { pf: "black", hi: "#ffe14a" }, tags: { e: "high", m: ["hype", "party"] },
      draw(c, W, H, s, t, st, o){   // the word rushes at you out of speed lines
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.14, 0.86), k = 0.25 + 0.75 * ease(age / 0.18), r = rng(i * 17 + 3);
        c.save(); c.strokeStyle = o.hi; c.lineCap = "round"; c.globalAlpha *= 0.55 * (1 - ease(age / 0.6));
        for(let q = 0; q < 16; q++){ const a = r() * TAU, r0 = px * (0.9 + r() * 0.4) + age * W * 0.6, r1 = r0 + px * (0.4 + r() * 0.8);
          c.lineWidth = Math.max(1, px * 0.03); c.beginPath(); c.moveTo(W / 2 + Math.cos(a) * r0, yc + Math.sin(a) * r0); c.lineTo(W / 2 + Math.cos(a) * r1, yc + Math.sin(a) * r1); c.stroke(); }
        c.restore(); c.save(); c.translate(W / 2, yc); c.scale(k, k); c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "chant", name: "Chant", cat: "bold", caseDef: "upper", demo: "again", def: { pf: "bebas", hi: "#ff4f8b" }, tags: { e: "high", m: ["hype", "party", "dark"] },
      draw(c, W, H, s, t, st, o){   // the word three times over, the outer two in outline, rolling upward
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.11, 0.86), lh = px * 0.92, roll = (1 - ease(age / 0.25)) * lh;
        c.save(); c.beginPath(); c.rect(0, yc - lh * 1.6, W, lh * 3.2); c.clip(); c.lineWidth = Math.max(1, px * 0.025);
        for(let k = -2; k <= 2; k++){ const y = yc + k * lh + roll; if(k === 0){ c.fillStyle = o.hi; c.fillText(txt, W / 2, y); } else { c.globalAlpha = s.fade * (k === 1 || k === -1 ? 0.75 : 0.25); c.strokeStyle = o.tx; c.strokeText(txt, W / 2, y); c.globalAlpha = s.fade; } }
        c.restore();
    } },

    /* ================= LAYERED ================= */
    { id: "extrude", name: "Extrude", cat: "layered", caseDef: "upper", demo: "deeper", def: { pf: "black", hi: "#ff4f8b" }, tags: { e: "high", m: ["party", "happy", "hype"] },
      draw(c, W, H, s, t, st, o){   // a deep 3D extrusion that grows out of the word
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.12, 0.8), n = Math.round(14 * ease(age / 0.35)), d = px * 0.012;
        for(let k = n; k >= 1; k--){ c.fillStyle = shade(o.hi, 0.35 + 0.45 * (1 - k / 14)); c.fillText(txt, W / 2 + k * d, yc + k * d); }
        c.fillStyle = o.tx; c.fillText(txt, W / 2, yc);
    } },

    { id: "tornsignal", name: "Torn Signal", cat: "layered", caseDef: "upper", demo: "system error", def: { pf: "spacemono", hi: "#ff2d3a" }, tags: { e: "high", m: ["dark", "night", "hype"] },
      draw(c, W, H, s, t, st, o){   // torn horizontal slices and split colour that settle into place
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.1, 0.86), amt = Math.max(0, 1 - age / 0.35) + (Math.sin(t * 13 + i) > 0.97 ? 0.4 : 0), r = rng(Math.floor(t * 24) + i * 11);
        const N = 7, top = yc - px * 0.6, sh = px * 1.2 / N;
        for(let q = 0; q < N; q++){ const dx = (r() - 0.5) * px * 0.6 * amt;
          c.save(); c.beginPath(); c.rect(0, top + q * sh, W, sh + 0.5); c.clip();
          if(amt > 0.02){ c.globalAlpha = s.fade * 0.8; c.fillStyle = o.hi; c.fillText(txt, W / 2 + dx - px * 0.05 * amt, yc); c.fillStyle = "#3ff0ff"; c.fillText(txt, W / 2 + dx + px * 0.05 * amt, yc); c.globalAlpha = s.fade; }
          c.fillStyle = o.tx; c.fillText(txt, W / 2 + dx, yc); c.restore(); }
    } },

    { id: "mirror", name: "Mirror", cat: "layered", caseDef: "upper", demo: "reflection", def: { pf: "syne", hi: "#9fe3ff" }, tags: { e: "mid", m: ["night", "dreamy", "calm"] },
      draw(c, W, H, s, t, st, o){   // the word on a glossy floor, with its reflection fading below
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.09, 0.82), k = ease(age / 0.3), base = yc + px * 0.42;
        c.save(); c.globalAlpha *= k; c.fillStyle = o.tx; c.fillText(txt, W / 2, yc - (1 - k) * px * 0.3); c.restore();
        c.save(); c.beginPath(); c.rect(0, base, W, px * 0.8); c.clip(); c.translate(0, base * 2); c.scale(1, -1);
        const g = c.createLinearGradient(0, base, 0, base - px * 0.8); g.addColorStop(0, o.hi); g.addColorStop(1, "rgba(0,0,0,0)");
        c.globalAlpha *= 0.32 * k; c.fillStyle = g; c.fillText(txt, W / 2, yc); c.restore();
        c.fillStyle = o.hi; c.globalAlpha *= 0.4 * k; c.fillRect(W / 2 - W * 0.3, base, W * 0.6, 1);
    } },

    { id: "trail", name: "Trail", cat: "layered", caseDef: "upper", demo: "one two three four", def: { pf: "oswald", hi: "#d6f53a" }, tags: { e: "high", m: ["hype", "party"] },
      draw(c, W, H, s, t, st, o){   // the words just sung step back as outlines behind the new one
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.13, 0.86);
        for(let b = 3; b >= 1; b--){ const j = i - b; if(j < 0) continue; const tx = caseOf(st, "upper", s.words[j].w), sc = 1 - b * 0.16, dy = -b * px * 0.62;
          c.save(); c.translate(W / 2, yc + dy); c.scale(sc, sc); c.globalAlpha *= 0.55 - b * 0.13; c.lineWidth = Math.max(1, px * 0.025); c.strokeStyle = o.hi; c.strokeText(tx, 0, 0); c.restore(); }
        const k = 0.85 + 0.15 * overshoot(age / 0.2); c.save(); c.translate(W / 2, yc); c.scale(k, k); c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "band", name: "Band", cat: "layered", caseDef: "upper", demo: "cut it out", def: { pf: "anton", hi: "#ffffff" }, tags: { e: "mid", m: ["hype", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // dark letters punched through a bright band that wipes across
        const opt = { caseDef: "upper", px: 0.07, maxW: 0.8, lh: 1.08 }, m = measure(c, W, H, s, st, o, opt), k = ease((t - s.start) / 0.3);
        c.fillStyle = o.hi; bandFill(c, W, m.top - m.px * 0.22, m.lay.lines * m.lh + m.px * 0.3, k);
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.fillStyle = "#0b0b10"; c.globalAlpha *= sung(s, i) ? 1 : 0.18; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "cells", name: "Cells", cat: "layered", caseDef: "upper", demo: "every word gets a room", def: { pf: "bebas", hi: "#38d6ff" }, tags: { e: "mid", m: ["hype", "happy"] },
      draw(c, W, H, s, t, st, o){   // a grid where each cell lights up as its word is sung
        const n = s.words.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), gw = W * 0.82, cw = gw / cols, ch = Math.min(cw * 0.5, H * 0.09), x0 = (W - gw) / 2, y0 = cy(H, st) - rows * ch / 2;
        const texts = s.words.map(w => caseOf(st, "upper", w.w)), px = fitK(c, o.pf, texts, cw * 0.84, ch * 0.62);
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.lineWidth = 1;
        texts.forEach((tx, i) => { const x = x0 + (i % cols) * cw, y = y0 + Math.floor(i / cols) * ch, on = sung(s, i), k = on ? ease(ageOf(s, i, t) / 0.2) : 0;
          c.save(); if(k){ c.globalAlpha *= (i === s.rev - 1 ? 0.95 : 0.35) * k; c.fillStyle = o.hi; c.fillRect(x + 2, y + 2, cw - 4, ch - 4); }
          c.restore(); c.save(); c.globalAlpha *= 0.35; c.strokeStyle = o.tx; c.strokeRect(x + 2, y + 2, cw - 4, ch - 4); c.restore();
          c.save(); c.globalAlpha *= on ? 1 : 0.25; c.fillStyle = on && i === s.rev - 1 ? "#0b0b10" : o.tx; c.fillText(tx, x + cw / 2, y + ch / 2 + px * 0.04); c.restore(); });
    } },

    { id: "marquee", name: "Marquee", cat: "layered", caseDef: "upper", demo: "round and round we go", def: { pf: "barlowi", hi: "#ffe14a" }, tags: { e: "mid", m: ["party", "happy", "summer"] },
      draw(c, W, H, s, t, st, o){   // the line runs past on an endless ticker band, the sung word lit up
        const yc = cy(H, st), px = H * 0.06, words = s.words.map(w => caseOf(st, "upper", w.w)); c.font = fnt(o.pf, px); c.textBaseline = "middle"; c.textAlign = "left";
        const sep = "  ✦  ", sw = c.measureText(sep).width, ws = words.map(w => c.measureText(w).width), total = ws.reduce((a, b) => a + b + sw, 0);
        c.fillStyle = "rgba(0,0,0,.55)"; bandFill(c, W, yc - px * 0.85, px * 1.7); c.fillStyle = o.hi; bandFill(c, W, yc - px * 0.85, Math.max(1, px * 0.04)); bandFill(c, W, yc + px * 0.81, Math.max(1, px * 0.04));
        let x = -((t * px * 2.2) % total); while(x < W){ words.forEach((w, i) => { c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.35; c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(w, x, yc); c.restore(); x += ws[i]; c.fillStyle = o.hi; c.fillText(sep, x, yc); x += sw; }); }
    } },

    /* ================= GLOW ================= */
    { id: "borealis", name: "Borealis", cat: "glow", caseDef: "lower", demo: "northern lights", def: { pf: "syne", hi: "#7dffcf" }, tags: { e: "mid", m: ["dreamy", "night", "romantic"] },
      draw(c, W, H, s, t, st, o){   // colours drift through the letters like northern lights
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.07, maxW: 0.84, lh: 1.12, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = ease(ageOf(s, i, t) / 0.5), g = c.createLinearGradient(x - W * 0.2, y, x + it.w + W * 0.2, y + px);
          for(let q = 0; q <= 4; q++) g.addColorStop(q / 4, `hsl(${(t * 40 + q * 55 + x * 0.3) % 360} 90% 70%)`);
          c.save(); c.globalAlpha *= k; c.shadowColor = o.hi; c.shadowBlur = px * 0.45; c.fillStyle = g; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "ember", name: "Ember", cat: "glow", caseDef: "upper", demo: "burning", def: { pf: "oswald", hi: "#ff6a1f" }, tags: { e: "mid", m: ["dramatic", "dark", "romantic"] },
      draw(c, W, H, s, t, st, o){   // hot letters giving off rising sparks
        const { i, txt, age, px, yc, tw } = one(c, W, H, s, t, st, o, "upper", 0.11, 0.84), g = c.createLinearGradient(0, yc - px * 0.5, 0, yc + px * 0.5);
        g.addColorStop(0, "#fff3c4"); g.addColorStop(0.5, "#ffc35a"); g.addColorStop(1, o.hi);
        c.save(); c.shadowColor = o.hi; c.shadowBlur = px * (0.35 + 0.1 * Math.sin(t * 9)); c.fillStyle = g; c.globalAlpha *= ease(age / 0.2); c.fillText(txt, W / 2, yc); c.restore();
        const r = rng(i * 13 + 2); c.save(); c.fillStyle = "#ffd27a"; c.shadowColor = o.hi; c.shadowBlur = px * 0.2;
        for(let q = 0; q < 18; q++){ const life = ((age * 0.8 + r()) % 1), x = W / 2 + (r() - 0.5) * tw + Math.sin(t * 3 + q) * px * 0.15, y = yc - px * 0.3 - life * px * 1.6;
          c.globalAlpha = s.fade * (1 - life) * 0.9; c.beginPath(); c.arc(x, y, px * 0.025 * (1 - life * 0.5), 0, TAU); c.fill(); }
        c.restore();
    } },

    { id: "laser", name: "Laser", cat: "glow", caseDef: "upper", demo: "light it up", def: { pf: "sans", hi: "#ff2d6f" }, tags: { e: "high", m: ["night", "party", "hype"] },
      draw(c, W, H, s, t, st, o){   // a laser writes each word left to right
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.058, maxW: 0.84, lh: 1.32, each(it, i, x, y, px){
          if(!sung(s, i)) return; const w = s.words[i], p = i === s.rev - 1 ? clamp((t - w.t) / Math.min(0.35, Math.max(0.15, w.d)), 0, 1) : 1;
          c.save(); c.beginPath(); c.rect(x - 2, y - px * 0.3, (it.w + 4) * p, px * 1.6); c.clip(); c.shadowColor = o.hi; c.shadowBlur = px * 0.35; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore();
          if(p < 1){ const lx = x + it.w * p; c.save(); c.fillStyle = "#fff"; c.shadowColor = o.hi; c.shadowBlur = px * 0.8; c.fillRect(lx - 1, y - px * 0.25, Math.max(2, px * 0.05), px * 1.5); c.restore(); } } });
    } },

    { id: "halo", name: "Halo", cat: "glow", caseDef: "lower", demo: "angel", def: { pf: "dmserifi", hi: "#ffe9a8" }, tags: { e: "low", m: ["romantic", "dreamy", "calm"] },
      draw(c, W, H, s, t, st, o){   // a soft ring of light breathes behind the word
        const { txt, age, px, yc, tw } = one(c, W, H, s, t, st, o, "lower", 0.11, 0.8), R = Math.max(tw * 0.62, px * 0.95) * (0.92 + 0.08 * Math.sin(t * 2.4)), k = ease(age / 0.5);
        const g = c.createRadialGradient(W / 2, yc, R * 0.55, W / 2, yc, R); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.82, rgba(o.hi, 0.55 * k)); g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g; c.beginPath(); c.arc(W / 2, yc, R, 0, TAU); c.fill();
        c.save(); c.globalAlpha *= k; c.shadowColor = o.hi; c.shadowBlur = px * 0.3; c.fillStyle = o.tx; c.fillText(txt, W / 2, yc); c.restore();
    } },

    { id: "candle", name: "Candlelight", cat: "glow", caseDef: "lower", demo: "stay with me tonight", def: { pf: "serifi", hi: "#ffb15c" }, tags: { e: "low", m: ["romantic", "sad", "calm"] },
      draw(c, W, H, s, t, st, o){   // warm words that flicker like a flame
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.068, maxW: 0.8, lh: 1.15, each(it, i, x, y, px){
          if(!sung(s, i)) return; const fl = 0.75 + 0.25 * (Math.sin(t * 11 + i) * 0.5 + Math.sin(t * 17.3 + i * 2) * 0.5), k = ease(ageOf(s, i, t) / 0.6);
          c.save(); c.globalAlpha *= k * (0.85 + 0.15 * fl); c.shadowColor = o.hi; c.shadowBlur = px * 0.55 * fl; c.fillStyle = i === s.rev - 1 ? "#fff1dc" : shade(o.hi, 1.1); c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "synthwave", name: "Synthwave", cat: "glow", caseDef: "upper", demo: "midnight drive", def: { pf: "archivoi", hi: "#ff3df2" }, tags: { e: "high", m: ["night", "party", "hype"] },
      draw(c, W, H, s, t, st, o){   // 80s chrome lettering above a glowing grid that rolls toward you
        const { txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.09, 0.86), k = 0.85 + 0.15 * overshoot(age / 0.25), base = yc + px * 0.9;
        c.save(); c.strokeStyle = o.hi; c.shadowColor = o.hi; c.shadowBlur = px * 0.3; c.lineWidth = 1; c.globalAlpha *= 0.7;
        for(let q = 0; q < 6; q++){ const f = ((q + (t * 1.5) % 1) / 6), y = base + f * f * px * 2.2; c.globalAlpha = s.fade * 0.7 * (1 - f * 0.6); c.beginPath(); c.moveTo(W * 0.1, y); c.lineTo(W * 0.9, y); c.stroke(); }
        for(let q = -5; q <= 5; q++){ c.globalAlpha = s.fade * 0.45; c.beginPath(); c.moveTo(W / 2 + q * W * 0.04, base); c.lineTo(W / 2 + q * W * 0.11, base + px * 2.2); c.stroke(); }
        c.restore();
        const g = c.createLinearGradient(0, yc - px * 0.5, 0, yc + px * 0.5); g.addColorStop(0, "#ffe76a"); g.addColorStop(0.5, "#ff6ad5"); g.addColorStop(0.52, "#4a1d8f"); g.addColorStop(1, "#7cf3ff");
        c.save(); c.translate(W / 2, yc); c.scale(k, k); c.lineJoin = "round"; c.lineWidth = px * 0.07; c.strokeStyle = "#16052b"; c.strokeText(txt, 0, 0); c.shadowColor = o.hi; c.shadowBlur = px * 0.4; c.fillStyle = g; c.fillText(txt, 0, 0); c.restore();
    } },

    /* ================= CINEMATIC ================= */
    { id: "titlecard", name: "Title Card", cat: "cinematic", caseDef: "upper", demo: "the last summer", def: { pf: "serif", hi: "#e8dcc0" }, tags: { e: "low", m: ["dramatic", "sad", "calm"] },
      draw(c, W, H, s, t, st, o){   // a film's opening title: wide letters between two fine rules
        const p = ease((t - s.start) / 1.2); c.textBaseline = "top"; setLS(c, H * 0.006);
        const opt = { caseDef: "upper", px: 0.04, maxW: 0.78, lh: 1.5 }, m = measure(c, W, H, s, st, o, opt), wR = W * 0.36 * p, h = Math.max(1, m.px * 0.03);
        c.fillStyle = o.hi; c.globalAlpha *= 0.8; c.fillRect(W / 2 - wR, m.top - m.px * 0.7, wR * 2, h); c.fillRect(W / 2 - wR, m.top + m.lay.lines * m.lh + m.px * 0.35, wR * 2, h); c.globalAlpha /= 0.8;
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ if(!sung(s, i)) return; c.save(); c.globalAlpha *= ease(ageOf(s, i, t) / 0.9); c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
        setLS(c, 0);
    } },

    { id: "credits", name: "Credits", cat: "cinematic", caseDef: "upper", demo: "written and performed by", def: { pf: "narrow", hi: "#ffffff" }, tags: { e: "low", m: ["calm", "sad", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // the line rolls slowly upward like end credits
        const p = clamp((t - s.start) / Math.max(1, s.end - s.start), 0, 1), dy = (0.5 - p) * H * 0.1;
        c.textBaseline = "top"; setLS(c, H * 0.003); c.save(); c.translate(0, dy);
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.03, maxW: 0.6, lh: 1.9, each(it, i, x, y){ c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.3; c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(it.s, x, y); c.restore(); } });
        c.restore(); setLS(c, 0);
    } },

    { id: "anamorphic", name: "Anamorphic", cat: "cinematic", caseDef: "upper", demo: "blue hour", def: { pf: "sans", hi: "#5aa9ff" }, tags: { e: "mid", m: ["night", "dramatic", "dreamy"] },
      draw(c, W, H, s, t, st, o){   // a blue lens flare streaks through the word being sung
        let fx = null; c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.05, maxW: 0.8, lh: 1.4, each(it, i, x, y, px){
          if(!sung(s, i)) return; c.save(); c.globalAlpha *= i === s.rev - 1 ? 1 : 0.75; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); if(i === s.rev - 1) fx = { x: x + it.w / 2, y: y + px * 0.5, px, age: ageOf(s, i, t) }; } });
        if(!fx) return; const k = 0.5 + 0.5 * Math.exp(-fx.age * 3), len = W * (0.45 + 0.1 * Math.sin(t * 2)), g = c.createLinearGradient(fx.x - len, 0, fx.x + len, 0);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, rgba(o.hi, 0.85 * k)); g.addColorStop(1, "rgba(0,0,0,0)");
        c.save(); c.globalCompositeOperation = "lighter"; c.fillStyle = g; c.fillRect(fx.x - len, fx.y - fx.px * 0.03, len * 2, Math.max(1.5, fx.px * 0.06));
        const r = c.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, fx.px * 0.6); r.addColorStop(0, rgba("#ffffff", 0.6 * k)); r.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = r; c.fillRect(fx.x - fx.px, fx.y - fx.px, fx.px * 2, fx.px * 2); c.restore();
    } },

    { id: "focuspull", name: "Focus Pull", cat: "cinematic", caseDef: "lower", demo: "everything comes into focus", def: { pf: "dmserif", hi: "#ffffff" }, tags: { e: "low", m: ["dreamy", "dramatic", "sad"] },
      draw(c, W, H, s, t, st, o){   // the lens racks focus onto each word as it's sung
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.064, maxW: 0.84, lh: 1.15, each(it, i, x, y, px){
          const k = sung(s, i) ? ease(ageOf(s, i, t) / 0.45) : 0, b = px * 0.14 * (1 - k);
          c.save(); c.globalAlpha *= 0.35 + 0.65 * k; if(b > 0.2) c.filter = `blur(${b.toFixed(2)}px)`; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "letterbox", name: "Letterbox", cat: "cinematic", caseDef: "as", demo: "in another life", def: { pf: "serif", hi: "#ffffff" }, tags: { e: "low", m: ["dramatic", "sad", "calm"] },
      draw(c, W, H, s, t, st, o){   // cinema bars close in while the line plays
        const k = ease((t - s.start) / 0.6), bar = H * 0.11 * k;
        c.save(); c.globalAlpha = Math.max(c.globalAlpha, 0.001) * 0.92; c.fillStyle = "#000"; onFrame(c, W, H, (FW, FH) => { const b = FH * 0.11 * k; c.fillRect(0, 0, FW, b); c.fillRect(0, FH - b, FW, b); }); c.restore();
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.046, maxW: 0.78, lh: 1.3, each(it, i, x, y){ if(!sung(s, i)) return; c.save(); c.globalAlpha *= ease(ageOf(s, i, t) / 0.5); c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "chapter", name: "Chapter", cat: "cinematic", caseDef: "lower", demo: "where it all began", def: { pf: "dmserif", sf: "mono", hi: "#ff6a3d" }, tags: { e: "low", m: ["dramatic", "calm", "sad"] },
      draw(c, W, H, s, t, st, o){   // a chapter number over each line, like a book or a film in parts
        const opt = { caseDef: "lower", px: 0.07, maxW: 0.8, lh: 1.1 }, m = measure(c, W, H, s, st, o, opt), n = String((s.words[0].l || 0) + 1).padStart(2, "0"), k = ease((t - s.start) / 0.5);
        c.save(); c.globalAlpha *= k; c.font = fnt(o.sf, m.px * 0.32); c.textAlign = "center"; c.textBaseline = "bottom"; setLS(c, m.px * 0.08); c.fillStyle = o.hi;
        c.fillText("— " + n + " —", W / 2, m.top - m.px * 0.3); setLS(c, 0); c.restore();
        c.textBaseline = "top"; lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ if(!sung(s, i)) return; c.save(); c.globalAlpha *= ease(ageOf(s, i, t) / 0.4); c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "dissolve", name: "Dissolve", cat: "cinematic", caseDef: "upper", demo: "stardust", def: { pf: "syne", hi: "#c9d4ff" }, tags: { e: "mid", m: ["dreamy", "night", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // the word gathers itself out of drifting dust
        const { i, txt, age, px, yc, tw } = one(c, W, H, s, t, st, o, "upper", 0.1, 0.82), k = ease(age / 0.6), r = rng(i * 19 + 9);
        c.save(); c.fillStyle = o.hi;
        for(let q = 0; q < 70; q++){ const tx = W / 2 + (r() - 0.5) * tw, ty = yc + (r() - 0.5) * px * 0.8, sx = tx + (r() - 0.5) * W * 0.7, sy = ty + (r() - 0.5) * H * 0.3;
          const x = sx + (tx - sx) * k, y = sy + (ty - sy) * k; c.globalAlpha = s.fade * (1 - k) * 0.9; c.fillRect(x, y, px * 0.04, px * 0.04); }
        c.restore(); c.save(); c.globalAlpha *= k; c.fillStyle = o.tx; c.fillText(txt, W / 2, yc); c.restore();
    } },

    /* ================= PLAYFUL ================= */
    { id: "textmsg", name: "Text Message", cat: "playful", caseDef: "as", demo: "u up?", def: { pf: "sans", hi: "#2f7bff" }, tags: { e: "mid", m: ["happy", "romantic"] },
      draw(c, W, H, s, t, st, o){   // each line pops up as a text message, sides alternating
        const opt = { caseDef: "as", px: 0.042, maxW: 0.62, lh: 1.3 }, m = measure(c, W, H, s, st, o, opt), side = (s.words[0].l || 0) % 2 ? 1 : -1;
        const bw = Math.max(...m.lay.widths) + m.px * 1.1, bh = m.lay.lines * m.lh + m.px * 0.7, bx = W / 2 - bw / 2 + side * W * 0.08, by = m.top - m.px * 0.35, k = overshoot((t - s.start) / 0.3);
        c.save(); c.translate(bx + (side < 0 ? 0 : bw), by + bh); c.scale(k, k); c.translate(-(bx + (side < 0 ? 0 : bw)), -(by + bh));
        c.fillStyle = side < 0 ? "#e9e9ef" : o.hi; roundRect(c, bx, by, bw, bh, m.px * 0.7); c.fill();
        c.beginPath(); const tx = side < 0 ? bx + m.px * 0.2 : bx + bw - m.px * 0.2; c.moveTo(tx, by + bh - m.px * 0.5); c.lineTo(tx - side * m.px * 0.5, by + bh + m.px * 0.12); c.lineTo(tx + side * m.px * 0.4, by + bh - m.px * 0.1); c.fill();
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { ...opt, align: "left", each(it, i, x, y){ if(!sung(s, i)) return; c.fillStyle = side < 0 ? "#121216" : "#ffffff"; c.fillText(it.s, bx + m.px * 0.55 + it.x, y); } });
        c.restore();
    } },

    { id: "diecut", name: "Die-Cut", cat: "playful", caseDef: "upper", demo: "yay", def: { pf: "black", hi: "#ff4f8b" }, tags: { e: "high", m: ["happy", "party", "summer"] },
      draw(c, W, H, s, t, st, o){   // die-cut stickers slapped on at a jaunty angle
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.13, 0.78), r = rng(i * 23 + 4), a = (r() - 0.5) * 0.3, k = overshoot(age / 0.24);
        c.save(); c.translate(W / 2, yc); c.rotate(a); c.scale(k, k); c.lineJoin = "round";
        c.shadowColor = "rgba(0,0,0,.45)"; c.shadowOffsetY = px * 0.06; c.shadowBlur = px * 0.12; c.lineWidth = px * 0.26; c.strokeStyle = "#ffffff"; c.strokeText(txt, 0, 0);
        c.shadowColor = "transparent"; c.fillStyle = PARTY.includes(o.hi) ? PARTY[i % PARTY.length] : o.hi; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "wobble", name: "Wobble", cat: "playful", caseDef: "lower", demo: "jelly legs", def: { pf: "unbounded", hi: "#7dff8a" }, tags: { e: "high", m: ["happy", "party"] },
      draw(c, W, H, s, t, st, o){   // letters jiggle on a wave
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.055, maxW: 0.84, lh: 1.35, each(it, i, x, y, px){
          if(!sung(s, i)) return; const on = i === s.rev - 1, amp = px * (on ? 0.12 : 0.04) * (0.5 + 0.5 * Math.exp(-ageOf(s, i, t) * 2)); let cx = x, n = 0;
          c.save(); c.fillStyle = on ? o.hi : o.tx; for(const ch of it.s){ c.fillText(ch, cx, y + Math.sin(t * 9 + n * 0.8 + i) * amp); cx += c.measureText(ch).width; n++; } c.restore(); } });
    } },

    { id: "confetti", name: "Confetti", cat: "playful", caseDef: "upper", demo: "celebrate", def: { pf: "poppins", hi: "#ffe14a" }, tags: { e: "high", m: ["party", "happy", "summer"] },
      draw(c, W, H, s, t, st, o){   // every word bursts out of a puff of confetti
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "upper", 0.1, 0.84), r = rng(i * 41 + 6);
        if(age < 1.4) for(let q = 0; q < 34; q++){ const a = r() * TAU, sp = (0.4 + r()) * px * 3.2, x = W / 2 + Math.cos(a) * sp * age, y = yc + Math.sin(a) * sp * age + 2.2 * px * age * age, rot = age * (4 + r() * 6);
          c.save(); c.globalAlpha *= clamp(1.4 - age, 0, 1); c.translate(x, y); c.rotate(rot); c.fillStyle = q % 3 ? PARTY[q % PARTY.length] : o.hi; c.fillRect(-px * 0.05, -px * 0.025, px * 0.1, px * 0.05); c.restore(); }
        const k = 0.7 + 0.3 * overshoot(age / 0.22); c.save(); c.translate(W / 2, yc); c.scale(k, k); c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "scribble", name: "Scribble", cat: "playful", caseDef: "lower", demo: "draw me a heart", def: { pf: "caveat", hi: "#ff4f8b" }, tags: { e: "mid", m: ["happy", "romantic", "summer"] },
      draw(c, W, H, s, t, st, o){   // handwriting, with a marker squiggle drawn under the word being sung
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.08, maxW: 0.84, lh: 1.15, each(it, i, x, y, px){
          if(!sung(s, i)) return; c.save(); c.globalAlpha *= ease(ageOf(s, i, t) / 0.25); c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore();
          if(i !== s.rev - 1) return; const p = ease(ageOf(s, i, t) / 0.5), yb = y + px * 1.02;
          c.save(); c.strokeStyle = o.hi; c.lineWidth = Math.max(1.5, px * 0.07); c.lineCap = "round"; c.lineJoin = "round"; c.globalAlpha *= 0.9; c.beginPath();
          for(let q = 0; q <= 24 * p; q++){ const f = q / 24, xx = x + f * it.w, yy = yb + Math.sin(f * TAU * 2.5) * px * 0.06; q ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke(); c.restore(); } });
    } },

    { id: "hop", name: "Hop", cat: "playful", caseDef: "upper", demo: "jump around", def: { pf: "bungee", hi: "#38d6ff" }, tags: { e: "high", m: ["party", "happy", "hype"] },
      draw(c, W, H, s, t, st, o){   // the letters of each word hop up one after another, in party colours
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.06, maxW: 0.84, lh: 1.35, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = ageOf(s, i, t); let cx = x, n = 0;
          for(const ch of it.s){ const f = clamp((age - n * 0.05) / 0.3, 0, 1), hop = Math.sin(f * Math.PI) * px * 0.35;
            c.save(); c.globalAlpha *= f > 0 ? 1 : 0; c.fillStyle = i === s.rev - 1 ? PARTY[(n + i) % PARTY.length] : o.tx; c.fillText(ch, cx, y - hop); c.restore(); cx += c.measureText(ch).width; n++; } } });
    } },

    /* ================= EDITORIAL ================= */
    { id: "magazine", name: "Magazine", cat: "editorial", caseDef: "as", demo: "the art of letting go", def: { pf: "black", sf: "dmserifi", hi: "#ff4f2d" }, tags: { e: "mid", m: ["calm", "romantic", "happy"] },
      draw(c, W, H, s, t, st, o){   // a magazine cover line: heavy capitals and italic serif, word by word
        const maxW = W * 0.8, base = H * 0.07, words = s.words.map((w, i) => ({ s: i % 2 ? w.w.toLowerCase() : w.w.toUpperCase(), f: i % 2 ? o.sf : o.pf }));
        let px = base; const lay = () => { const sp = px * 0.28; let x = 0, ln = 0; for(const w of words){ c.font = fnt(w.f, px); w.w = c.measureText(w.s).width; if(x > 0 && x + w.w > maxW){ ln++; x = 0; } w.x = x; w.ln = ln; x += w.w + sp; } return ln + 1; };
        let lines = lay(); const widest = Math.max(...words.map(w => w.w)); if(widest > maxW){ px *= maxW / widest; lines = lay(); }
        const lh = px * 1.05, top = cy(H, st) - lines * lh / 2, x0 = (W - maxW) / 2; c.textBaseline = "top"; c.textAlign = "left";
        words.forEach((w, i) => { if(!sung(s, i)) return; const k = ease(ageOf(s, i, t) / 0.25); c.save(); c.globalAlpha *= k; c.font = fnt(w.f, px); c.fillStyle = i === s.rev - 1 && i % 2 ? o.hi : o.tx; c.fillText(w.s, x0 + w.x, top + w.ln * lh + (1 - k) * px * 0.2); c.restore(); });
    } },

    { id: "pullquote", name: "Pull Quote", cat: "editorial", caseDef: "as", demo: "nothing lasts forever", def: { pf: "dmserif", sf: "mono", hi: "#ff6a3d" }, tags: { e: "low", m: ["romantic", "sad", "calm"] },
      draw(c, W, H, s, t, st, o){   // a pull quote: big quotation mark, the line, and the song as the source
        const opt = { caseDef: "as", px: 0.06, maxW: 0.72, lh: 1.18, align: "left" }, m = measure(c, W, H, s, st, o, opt), x0 = (W - m.maxW) / 2, k = ease((t - s.start) / 0.4);
        c.save(); c.globalAlpha *= k; c.font = fnt("dmserif", m.px * 2.6); c.textBaseline = "top"; c.textAlign = "left"; c.fillStyle = o.hi; c.fillText("“", x0 - m.px * 0.15, m.top - m.px * 1.6); c.restore();
        c.textBaseline = "top"; lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ if(!sung(s, i)) return; c.fillStyle = o.tx; c.fillText(it.s, x, y); } });
        c.save(); c.globalAlpha *= 0.7 * k; c.font = fnt(o.sf, m.px * 0.3); c.fillStyle = o.tx; c.textAlign = "left"; c.textBaseline = "top"; c.fillText("— " + (S.songName || "").toUpperCase().slice(0, 40), x0, m.top + m.lay.lines * m.lh + m.px * 0.4); c.restore();
    } },

    { id: "column", name: "Column", cat: "editorial", caseDef: "lower", demo: "a quiet sort of morning when you left", def: { pf: "serif", hi: "#ff2d3a" }, tags: { e: "low", m: ["calm", "sad", "romantic"] },
      draw(c, W, H, s, t, st, o){   // a narrow newspaper column with a red rule that grows down its side
        const opt = { caseDef: "lower", px: 0.05, maxW: 0.52, lh: 1.25, align: "left" }, m = measure(c, W, H, s, st, o, opt), x0 = (W - m.maxW) / 2, p = clamp((t - s.start) / Math.max(0.6, s.end - s.start), 0, 1);
        c.fillStyle = o.hi; c.fillRect(x0 - m.px * 0.5, m.top, Math.max(2, m.px * 0.06), m.lay.lines * m.lh * ease(p));
        c.textBaseline = "top"; lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.22; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "index", name: "Index", cat: "editorial", caseDef: "lower", demo: "one more time", def: { pf: "sans", sf: "mono", hi: "#38d6ff" }, tags: { e: "mid", m: ["calm", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // the words as a numbered list
        const n = s.words.length, texts = s.words.map(w => caseOf(st, "lower", w.w)), rowH = Math.min(H * 0.07, H * 0.5 / n), px = fitK(c, o.pf, texts, W * 0.56, rowH * 0.72), x0 = W * 0.26, top = cy(H, st) - n * rowH / 2;
        c.textBaseline = "middle"; c.textAlign = "left";
        texts.forEach((tx, i) => { const on = sung(s, i), cur = i === s.rev - 1, k = on ? ease(ageOf(s, i, t) / 0.25) : 0, y = top + i * rowH + rowH / 2;
          c.save(); c.globalAlpha *= 0.25 + 0.75 * k; c.font = fnt(o.sf, px * 0.42); c.fillStyle = cur ? o.hi : o.tx; c.fillText(String(i + 1).padStart(2, "0"), x0 - px * 1.3, y);
          c.font = fnt(o.pf, px); c.fillStyle = o.tx; c.fillText(tx, x0 + (1 - k) * px * 0.3, y); c.restore(); });
    } },

    { id: "headline", name: "Headline", cat: "editorial", caseDef: "upper", demo: "breaking: heart broken", def: { pf: "oswald", sf: "mono", hi: "#ff2d3a" }, tags: { e: "mid", m: ["dramatic", "hype"] },
      draw(c, W, H, s, t, st, o){   // a front-page headline under a red "now playing" tag
        const opt = { caseDef: "upper", px: 0.075, maxW: 0.84, lh: 1.02, align: "left" }, m = measure(c, W, H, s, st, o, opt), x0 = (W - m.maxW) / 2, k = ease((t - s.start) / 0.35);
        c.save(); c.font = fnt(o.sf, m.px * 0.26); const tag = "NOW PLAYING", tw = c.measureText(tag).width; c.globalAlpha *= k;
        c.fillStyle = o.hi; c.fillRect(x0, m.top - m.px * 0.75, tw + m.px * 0.4, m.px * 0.42); c.fillStyle = "#fff"; c.textBaseline = "middle"; c.textAlign = "left"; c.fillText(tag, x0 + m.px * 0.2, m.top - m.px * 0.54);
        c.fillStyle = o.tx; c.globalAlpha *= 0.6; c.fillRect(x0 + tw + m.px * 0.6, m.top - m.px * 0.55, (m.maxW - tw - m.px * 0.6) * k, 1); c.restore();
        c.textBaseline = "top"; lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.15; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "markerpen", name: "Marker Pen", cat: "editorial", caseDef: "lower", demo: "remember this part", def: { pf: "dmserif", hi: "#ffe14a" }, tags: { e: "mid", m: ["happy", "calm", "romantic"] },
      draw(c, W, H, s, t, st, o){   // a highlighter pen sweeps over each word as it's sung
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.06, maxW: 0.82, lh: 1.3, each(it, i, x, y, px){
          if(sung(s, i)){ const p = ease(ageOf(s, i, t) / 0.3); c.save(); c.globalAlpha *= i === s.rev - 1 ? 0.95 : 0.72; c.fillStyle = o.hi; c.beginPath(); c.moveTo(x - px * 0.08, y + px * 0.25); c.lineTo(x + (it.w + px * 0.16) * p, y + px * 0.2); c.lineTo(x + (it.w + px * 0.16) * p, y + px * 1.08); c.lineTo(x - px * 0.08, y + px * 1.12); c.fill(); c.restore(); }
          c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.3; c.fillStyle = sung(s, i) ? "#14141a" : o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    /* ================= a few more, to round out each family ================= */
    { id: "neonsign", name: "Neon Sign", cat: "glow", caseDef: "lower", demo: "open late", def: { pf: "monoton", hi: "#38d6ff" }, tags: { e: "mid", m: ["night", "party", "romantic"] },
      draw(c, W, H, s, t, st, o){   // a buzzing tube sign, one word at a time
        const { i, txt, age, px, yc } = one(c, W, H, s, t, st, o, "lower", 0.11, 0.84), buzz = age < 0.4 && Math.floor(age * 30 + i) % 4 === 0 ? 0.35 : 1;
        c.save(); c.globalAlpha *= buzz; c.shadowColor = o.hi; c.shadowBlur = px * 0.6; c.fillStyle = o.hi; c.fillText(txt, W / 2, yc); c.shadowBlur = px * 0.15; c.fillStyle = "#e9ffff"; c.globalAlpha *= 0.85; c.fillText(txt, W / 2, yc); c.restore();
    } },

    { id: "pixel", name: "8-Bit", cat: "playful", caseDef: "upper", demo: "level up", def: { pf: "pixel", hi: "#7dff8a" }, tags: { e: "high", m: ["happy", "party"] },
      draw(c, W, H, s, t, st, o){   // arcade text that blinks in, with a drop shadow in blocks
        c.textBaseline = "top"; c.imageSmoothingEnabled = false;
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.05, maxW: 0.84, lh: 1.5, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = ageOf(s, i, t); if(age < 0.2 && Math.floor(age * 20) % 2) return; const d = Math.max(1, Math.round(px * 0.08));
          c.fillStyle = "#000"; c.fillText(it.s, x + d, y + d); c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(it.s, x, y); } });
    } },

    { id: "brush", name: "Brushstroke", cat: "editorial", caseDef: "lower", demo: "paint it gold", def: { pf: "pacifico", hi: "#c8902a" }, tags: { e: "mid", m: ["summer", "romantic", "happy"] },
      draw(c, W, H, s, t, st, o){   // a painted brush stroke behind flowing script
        const opt = { caseDef: "lower", px: 0.055, maxW: 0.78, lh: 1.5 }, m = measure(c, W, H, s, st, o, opt), p = ease((t - s.start) / 0.45), bw = Math.max(...m.lay.widths) + m.px * 1.2, x0 = (W - bw) / 2;
        c.save(); c.fillStyle = o.hi; c.globalAlpha *= 0.9; c.beginPath(); const yA = m.top - m.px * 0.15, yB = m.top + m.lay.lines * m.lh + m.px * 0.1;
        c.moveTo(x0, yA + m.px * 0.2); for(let q = 0; q <= 10; q++){ c.lineTo(x0 + bw * p * q / 10, yA + Math.sin(q * 1.7) * m.px * 0.08); } for(let q = 10; q >= 0; q--){ c.lineTo(x0 + bw * p * q / 10, yB + Math.cos(q * 1.3) * m.px * 0.1); } c.closePath(); c.fill(); c.restore();
        c.textBaseline = "top"; lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ if(!sung(s, i)) return; c.save(); c.globalAlpha *= ease(ageOf(s, i, t) / 0.3); c.fillStyle = o.tx; c.fillText(it.s, x, y - m.px * 0.25); c.restore(); } });
    } },
  ];

  for(const p of NEW) if(!PRESETS.some(x => x.id === p.id)) PRESETS.push(p);
  try { const d = store.get("sls-draft"); if(d && d.P && d.P.style && NEW.some(p => p.id === d.P.style.preset) && S.P && S.songName === d.songName){ S.P.style.preset = d.P.style.preset; syncUI(); } } catch {}

  /* ============ which styles fit this song ============
     A quick read of the song: how fast it is, how quickly the words come, how long the lines are, and the moods its
     words suggest. Each style carries tags (energy and moods); the best few get a small star in the style grid. */
  const MOODS = {
    romantic: /\b(love|lover|heart|kiss|baby|babe|darling|honey|hold me|together|forever|amore|cuore|kærlighed|elsker|hjerte|amor|corazón|beso)\b/gi,
    sad: /\b(cry|crying|tears?|alone|lonely|goodbye|miss(ing)?|broken|hurt|pain|sorry|cold|lost|empty|never again|sad|ghost|grave|lacrime|triste|savner|ensom|tårer|llorar)\b/gi,
    night: /\b(night|tonight|midnight|city|neon|lights?|street|dark|moon|late|club|2am|3am|notte|nat|noche|luna)\b/gi,
    party: /\b(dance|dancing|party|club|drink|shots?|turn up|bounce|weekend|vibe|move|shake|celebrate|fest|ballare|danse|fiesta|bailar)\b/gi,
    hype: /\b(money|cash|drip|ice|boss|king|queen|fire|flex|grind|hustle|win|top|run it|go hard|gang|bitch|fuck|shit|soldi|penge)\b/gi,
    happy: /\b(happy|smile|sun(shine)?|good|alright|fun|laugh|free|yeah|joy|felice|glad|glæde|feliz)\b/gi,
    dreamy: /\b(dream|dreams|stars?|sky|heaven|fly|flying|float|clouds?|space|galaxy|angel|universe|sogno|stelle|drøm|stjerner|sueño|estrellas)\b/gi,
    summer: /\b(summer|beach|sea|ocean|waves?|sand|sunset|island|holiday|estate|mare|sommer|strand|verano|playa)\b/gi,
    dramatic: /\b(war|fight|fall|rise|blood|fate|destiny|kingdom|empire|storm|thunder|burn|fire|end|forever|world)\b/gi,
    dark: /\b(dark|demons?|devil|hell|shadow|poison|venom|knife|kill|dead|death|monster|sin|evil|morte|djævel)\b/gi,
    calm: /\b(slow|quiet|calm|easy|breathe|soft|gentle|still|morning|rain|home|piano|lento|stille|rolig)\b/gi,
  };
  const CAT_DEFAULTS = { minimal: { e: "low", m: ["calm", "sad"] }, bold: { e: "high", m: ["hype", "party"] }, layered: { e: "mid", m: ["hype", "night"] }, glow: { e: "mid", m: ["night", "dreamy"] },
    cinematic: { e: "low", m: ["dramatic", "sad"] }, playful: { e: "high", m: ["happy", "party"] }, editorial: { e: "mid", m: ["calm", "romantic"] } };
  const tagsOf = p => p.tags || CAT_DEFAULTS[p.cat] || { e: "mid", m: [] };
  const wordMode = p => { if(p._wm == null){ try { p._wm = /curWord\(|\bone\(/.test(String(p.draw)); } catch { p._wm = false; } } return p._wm; };   // shows one word at a time
  let lastKey = "", why = "";
  function profile(){
    const P = S.P; if(!P || !P.words.length) return null;
    const { a, b } = P.section, ws = P.words.filter(w => w.t >= a - 0.2 && w.t < b); if(ws.length < 3) return null;
    const last = ws[ws.length - 1], len = Math.max(1, Math.min(b, last.t + last.d) - Math.max(a, ws[0].t));   // the sung part, not the silences around it
    const text = ws.map(w => w.w).join(" ") + " " + (S.songName || ""), lines = new Set(ws.map(w => w.l)).size;
    const moods = {}; for(const [k, re] of Object.entries(MOODS)){ const n = (text.match(re) || []).length; if(n) moods[k] = Math.min(3, n); }
    const wps = ws.length / len, bpm = P.bpm || 100;
    const energy = (bpm >= 122 || wps >= 2.8) ? "high" : (bpm < 92 && wps < 1.8) || wps < 1.1 ? "low" : "mid";
    return { moods, wps, energy, perLine: ws.length / Math.max(1, lines), seed: [...(S.songName || "")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) };
  }
  function recommend(){
    const pr = profile(), key = pr ? JSON.stringify([pr.moods, pr.energy, Math.round(pr.wps * 2), Math.round(pr.perLine), pr.seed]) : "";
    if(key === lastKey) return; lastKey = key;
    if(!pr){ styleRecs = new Set(); why = ""; renderPresetGrid(); return; }
    const order = ["low", "mid", "high"], r = rng(pr.seed);
    const scored = PRESETS.filter(p => p.id !== "none").map(p => {
      const tg = tagsOf(p); let sc = 0;
      for(const m of tg.m) sc += (pr.moods[m] || 0) * 1.4;
      const d = Math.abs(order.indexOf(tg.e) - order.indexOf(pr.energy)); sc += d === 0 ? 2 : d === 1 ? 0.3 : -1.5;
      if(wordMode(p)){ if(pr.wps > 2.4) sc += 1.2; if(pr.perLine > 9) sc += 1; if(pr.wps < 1.2) sc -= 0.8; }
      else { if(pr.wps < 1.8) sc += 0.8; if(pr.perLine > 12) sc -= 0.8; }
      return { p, sc: sc + r() * 0.6 };   // a little variety between songs with the same profile
    }).sort((x, y) => y.sc - x.sc);
    styleRecs = new Set(scored.slice(0, 6).map(x => x.p.id));
    const top = Object.entries(pr.moods).sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => x[0]);
    why = [{ low: "slow", mid: "mid-tempo", high: "fast" }[pr.energy], ...top].join(", ");
    renderPresetGrid();
  }
  window.SLSStyleRecs = { recommend, get why(){ return why; } };
  let timer = 0; slsOn("change", () => { clearTimeout(timer); timer = setTimeout(recommend, 400); });
  recommend(); renderPresetGrid();
})();

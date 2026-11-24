"use strict";
/* Trending: templates modelled on the lyric looks that do well on TikTok and Instagram Reels right now, plus
   TikTok's own typeface. TikTok Sans is the font the TikTok app uses for its "Classic", "Bold" and "Oblique"
   text; TikTok made it open source (SIL Open Font License), so it can be used in the videos.
   Same contract as the other style files: draw(c, W, H, s, t, st, o) draws the current lyric line at size 1,
   centred on (W/2, cy(H, st)). s = {words, start, end, rev, act, fade}; o = {pf, sf, hi, tx, v}.
   Loaded after styles-more.js. */
(() => {
  Object.assign(FONTLIB, {
    tiktok: { name: "TikTok Sans (Classic)", css: '"TikTok Sans", "Instrument Sans", system-ui, sans-serif', w: "600" },
    tiktokb: { name: "TikTok Sans Bold", css: '"TikTok Sans", "Instrument Sans", system-ui, sans-serif', w: "800" },
    tiktokx: { name: "TikTok Sans Black", css: '"TikTok Sans", "Archivo Black", system-ui, sans-serif', w: "900" },
    tiktoki: { name: "TikTok Sans Oblique", css: '"TikTok Sans", "Instrument Sans", system-ui, sans-serif', w: "700", i: "italic" },
    tiktokl: { name: "TikTok Sans Light", css: '"TikTok Sans", "Inter Tight", system-ui, sans-serif', w: "400" },
    courier: { name: "Courier Prime (typewriter)", css: '"Courier Prime", "Courier New", monospace', w: "400" },
    script: { name: "Yesteryear (script)", css: 'Yesteryear, "Segoe Script", cursive', w: "400" },
  });
  Promise.all(["tiktok", "tiktokb", "tiktokx", "tiktoki", "tiktokl", "courier", "script"].map(k => document.fonts.load(fnt(k, 40)).catch(() => {})))
    .then(() => { renderPresetThumbs(); tlDirty = true; });

  const sung = (s, i) => i < s.rev;
  const ageOf = (s, i, t) => t - s.words[i].t;
  const lum = hex => { const n = parseInt((hex || "#ffffff").slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const on = hex => lum(hex) > 0.6 ? "#111114" : "#ffffff";
  function measure(c, W, H, s, st, o, opt){
    const r = lineLayout(c, W, H, s, st, o, { ...opt, each(){} }), lh = r.px * (opt.lh || 1.2);
    return { px: r.px, lay: r.lay, lh, top: cy(H, st) - r.lay.lines * lh / 2, maxW: W * (opt.maxW || 0.84) };
  }
  // the lines before and after this one (for the streaming look); cached per lyrics
  let lgKey = null, lgVal = [];
  function lines(){ const ws = S.P && S.P.words || []; const k = ws.length + ":" + (ws[0] && ws[0].t) + ":" + (ws[ws.length - 1] && ws[ws.length - 1].t); if(k !== lgKey){ lgKey = k; lgVal = typeof lineGroups === "function" ? lineGroups() : []; } return lgVal; }
  // text with a solid outline under the fill, the way TikTok draws captions
  function stroked(c, txt, x, y, px, fill, edge = "#000", k = 0.16){
    c.save(); c.lineJoin = "round"; c.miterLimit = 2; c.lineWidth = Math.max(1, px * k); c.strokeStyle = edge; c.strokeText(txt, x, y); c.fillStyle = fill; c.fillText(txt, x, y); c.restore();
  }

  const NEW = [
    { id: "tt-classic", name: "TikTok Classic", cat: "trend", caseDef: "as", demo: "i wish my life had a soundtrack", def: { pf: "tiktok", hi: "#ffffff" }, tags: { e: "mid", m: ["calm", "sad", "romantic", "happy"] },
      draw(c, W, H, s, t, st, o){   // TikTok's own "Classic" text: the whole line at once in TikTok Sans, white with a soft shadow, centred
        const k = ease((t - s.start) / 0.15);
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.062, maxW: 0.8, lh: 1.12, each(it, i, x, y, px){
          c.save(); c.globalAlpha *= k; c.shadowColor = "rgba(0,0,0,0.45)"; c.shadowBlur = px * 0.14; c.shadowOffsetY = px * 0.03;
          c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "tt-captions", name: "TikTok Captions", cat: "trend", caseDef: "as", demo: "we were dancing in the kitchen", def: { pf: "tiktokb", hi: "#ffffff" }, tags: { e: "mid", m: ["happy", "party", "calm"] },
      draw(c, W, H, s, t, st, o){   // the in-app caption: bold white words with a black outline, each one pops on as it's sung
        c.textBaseline = "middle";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.05, maxW: 0.84, lh: 1.22, each(it, i, x, y, px){
          if(!sung(s, i)) return; const a = ageOf(s, i, t), k = i === s.rev - 1 ? pop(a, 0.16, 0.12) : 1;
          c.save(); c.translate(x + it.w / 2, y + px * 0.6); c.scale(k, k); c.textAlign = "center";
          stroked(c, it.s, 0, 0, px, i === s.rev - 1 && o.hi.toLowerCase() !== "#ffffff" ? o.hi : o.tx); c.restore(); } });
    } },

    { id: "tt-textbox", name: "TikTok Text Box", cat: "trend", caseDef: "as", demo: "tell me that you want me", def: { pf: "tiktok", hi: "#ffffff" }, tags: { e: "mid", m: ["happy", "romantic", "calm"] },
      draw(c, W, H, s, t, st, o){   // TikTok's "background" text: each line on a rounded box, words filling in as they're sung
        const opt = { caseDef: "as", px: 0.042, maxW: 0.8, lh: 1.32 }, m = measure(c, W, H, s, st, o, opt), k = ease((t - s.start) / 0.2), padX = m.px * 0.42, padY = m.px * 0.2;
        c.save(); c.globalAlpha *= k; c.fillStyle = o.hi;
        for(let L = 0; L < m.lay.lines; L++){ const w = m.lay.widths[L], x = (W - w) / 2 - padX, y = m.top + L * m.lh - padY + m.px * 0.04; roundRect(c, x, y, w + padX * 2, m.px + padY * 2, m.px * 0.34); c.fill(); }
        c.restore();
        const ink = on(o.hi);
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= k * (sung(s, i) ? 1 : 0.32); c.fillStyle = ink; c.fillText(it.s, x, y + m.px * 0.08); c.restore(); } });
    } },

    { id: "hype-captions", name: "Hype Captions", cat: "trend", caseDef: "upper", demo: "run it up again", def: { pf: "tiktokx", hi: "#3cff6b" }, tags: { e: "high", m: ["hype", "party", "dramatic"] },
      draw(c, W, H, s, t, st, o){   // three words at a time, big and loud; the word being sung jumps in the highlight colour
        const { i } = curWord(s, t), from = Math.floor(i / 3) * 3, group = s.words.slice(from, from + 3), txts = group.map(w => caseOf(st, "upper", w.w));
        const px = fitK(c, o.pf, [txts.join(" ")], W * 0.88, H * 0.075); c.font = fnt(o.pf, px); c.textBaseline = "middle"; c.textAlign = "left";
        const sp = c.measureText(" ").width, ws = txts.map(x => c.measureText(x).width), total = ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
        let x = (W - total) / 2; const y = cy(H, st);
        txts.forEach((tx, k) => { const idx = from + k; if(idx > s.rev - 1){ x += ws[k] + sp; return; }
          const cur = idx === s.rev - 1, a = ageOf(s, idx, t), z = cur ? pop(a, 0.14, 0.22) : 1;
          c.save(); c.translate(x + ws[k] / 2, y); c.scale(z, z); c.rotate(cur ? -0.035 * (1 - ease(a / 0.2)) : 0); c.textAlign = "center";
          c.shadowColor = "rgba(0,0,0,.55)"; c.shadowBlur = px * 0.18; c.shadowOffsetY = px * 0.06;
          stroked(c, tx, 0, 0, px, cur ? o.hi : o.tx, "#000", 0.13); c.restore(); x += ws[k] + sp; });
    } },

    { id: "aesthetic", name: "Aesthetic Lowercase", cat: "trend", caseDef: "lower", demo: "and i still think about you", def: { pf: "light", hi: "#ffffff" }, tags: { e: "low", m: ["sad", "dreamy", "calm", "romantic"] },
      draw(c, W, H, s, t, st, o){   // small, airy, spaced-out lowercase with a soft glow, the "sped up" edit look
        c.textBaseline = "top"; setLS(c, H * 0.0025);
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.03, maxW: 0.76, lh: 1.6, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = ease(ageOf(s, i, t) / 0.6);
          c.save(); c.globalAlpha *= k; c.shadowColor = "rgba(255,255,255,.55)"; c.shadowBlur = px * 0.5; c.fillStyle = o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.25); c.restore(); } });
        setLS(c, 0);
    } },

    { id: "diary-typed", name: "Diary Typewriter", cat: "trend", caseDef: "lower", demo: "dear diary, it happened again", def: { pf: "courier", hi: "#ffffff" }, tags: { e: "low", m: ["sad", "calm", "romantic"] },
      draw(c, W, H, s, t, st, o){   // typed out letter by letter in time with the words, with a blinking cursor
        c.textBaseline = "top"; let caret = null;
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.04, maxW: 0.82, lh: 1.4, align: "left", each(it, i, x, y, px){
          if(!sung(s, i)) return; const w = s.words[i], dur = Math.max(0.12, Math.min(w.d || 0.3, 0.6)), n = Math.ceil(it.s.length * clamp((t - w.t) / dur, 0, 1));
          const part = it.s.slice(0, Math.max(1, n)); c.fillStyle = o.tx; c.fillText(part, x, y); caret = { x: x + c.measureText(part).width + px * 0.06, y, px }; } });
        if(caret && Math.floor(t * 2.2) % 2 === 0){ c.fillStyle = o.hi; c.fillRect(caret.x, caret.y + caret.px * 0.06, Math.max(1, caret.px * 0.09), caret.px * 0.95); }
    } },

    { id: "streaming", name: "Streaming Lyrics", cat: "trend", caseDef: "as", demo: "i know you're watching me", def: { pf: "tiktokb", hi: "#ffffff" }, tags: { e: "mid", m: ["romantic", "sad", "night", "happy"] },
      draw(c, W, H, s, t, st, o){   // like the lyrics screen in a music app: the current line bright and filling in, the lines around it dimmed
        const G = lines(), k0 = G.findIndex(L => L[0] === s.words[0]), prev = k0 > 0 ? G[k0 - 1] : null, next = k0 >= 0 ? G[k0 + 1] : null;
        const opt = { caseDef: "as", px: 0.05, maxW: 0.82, lh: 1.15, align: "left" }, m = measure(c, W, H, s, st, o, opt), gap = m.px * 0.75;
        c.textBaseline = "top"; c.textAlign = "left";
        const side = (L, y, up) => { if(!L) return; const txt = L.map(w => caseOf(st, "as", w.w)).join(" "); c.save(); c.font = fnt(o.pf, m.px * 0.86); c.globalAlpha *= 0.32;
          const words = txt.split(" "), maxW = m.maxW, sp = c.measureText(" ").width, rows = []; let row = "", rw = 0;
          for(const wd of words){ const ww = c.measureText(wd).width; if(row && rw + sp + ww > maxW){ rows.push(row); row = wd; rw = ww; } else { row = row ? row + " " + wd : wd; rw = row ? c.measureText(row).width : ww; } } if(row) rows.push(row);
          const lh = m.px * 0.86 * 1.15, use = up ? rows.slice(-2) : rows.slice(0, 2), y0 = up ? y - use.length * lh : y;
          use.forEach((r, n) => { c.fillStyle = o.tx; c.fillText(r, (W - maxW) / 2, y0 + n * lh); }); c.restore(); };
        side(prev, m.top - gap, true); side(next, m.top + m.lay.lines * m.lh + gap, false);
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= sung(s, i) ? 1 : 0.42; c.fillStyle = sung(s, i) ? o.hi : o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "notes-app", name: "Notes App", cat: "trend", caseDef: "lower", demo: "things i never told you", def: { pf: "tiktok", hi: "#e3b23c" }, tags: { e: "low", m: ["sad", "romantic", "calm"] },
      draw(c, W, H, s, t, st, o){   // the lyric written into a phone note: a white card, the yellow Notes header, the words typed in
        const opt = { caseDef: "lower", px: 0.04, maxW: 0.7, lh: 1.35, align: "left" }, m = measure(c, W, H, s, st, o, opt), k = ease((t - s.start) / 0.3);
        const pad = m.px * 0.9, head = m.px * 1.5, cw = m.maxW + pad * 2, ch = head + m.lay.lines * m.lh + pad * 1.3, x0 = (W - cw) / 2, y0 = m.top - head - pad * 0.4;
        c.save(); c.globalAlpha *= k; c.translate(0, (1 - k) * m.px * 0.6);
        c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = m.px * 0.9; c.shadowOffsetY = m.px * 0.2; c.fillStyle = "#fbfaf6"; roundRect(c, x0, y0, cw, ch, m.px * 0.55); c.fill(); c.shadowColor = "transparent";
        c.font = fnt("tiktok", m.px * 0.62); c.textBaseline = "middle"; c.textAlign = "left"; c.fillStyle = o.hi; c.fillText("‹ Notes", x0 + pad * 0.8, y0 + head * 0.5);
        c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(x0 + pad * 0.8, y0 + head - 1, cw - pad * 1.6, 1);
        c.restore();
        c.textBaseline = "top"; let last = null;
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y, px){ if(!sung(s, i)) return; c.save(); c.globalAlpha *= k; c.translate(0, (1 - k) * m.px * 0.6); c.fillStyle = "#1c1c1e"; c.fillText(it.s, x, y + m.px * 0.25); c.restore(); last = { x: x + it.w, y, px }; } });
        if(last && Math.floor(t * 2) % 2 === 0){ c.fillStyle = o.hi; c.fillRect(last.x + last.px * 0.08, last.y + last.px * 0.3, Math.max(1, last.px * 0.07), last.px * 1.0); }
    } },

    { id: "dreamy-blur", name: "Dreamy Blur", cat: "trend", caseDef: "lower", demo: "floating through the summer", def: { pf: "dmserifi", hi: "#ffd9ec" }, tags: { e: "low", m: ["dreamy", "romantic", "summer"] },
      draw(c, W, H, s, t, st, o){   // each word drifts up out of a soft blur into focus
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.056, maxW: 0.8, lh: 1.2, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = ease(ageOf(s, i, t) / 0.55), b = (1 - k) * px * 0.3;
          c.save(); c.globalAlpha *= k; if(b > 0.3) c.filter = `blur(${b.toFixed(1)}px)`; c.shadowColor = rgba(o.hi, 0.8); c.shadowBlur = px * 0.35;
          c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.35); c.restore(); } });
    } },

    { id: "echo-stack", name: "Echo Stack", cat: "trend", caseDef: "upper", demo: "louder", def: { pf: "tiktokx", hi: "#ffffff" }, tags: { e: "high", m: ["hype", "party", "night"] },
      draw(c, W, H, s, t, st, o){   // the sung word, outlined and repeated above and below, the middle one filled
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.86, H * 0.1), yc = cy(H, st), k = ease(age / 0.25);
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round"; c.lineWidth = Math.max(1, px * 0.035);
        for(let n = 3; n >= 1; n--) for(const d of [-1, 1]){ c.save(); c.globalAlpha *= (0.75 - n * 0.18) * k; c.strokeStyle = o.hi; c.strokeText(txt, W / 2, yc + d * n * px * 0.92 * (0.6 + 0.4 * k)); c.restore(); }
        c.save(); const z = pop(age, 0.14, 0.12); c.translate(W / 2, yc); c.scale(z, z); c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "bold-statement", name: "Bold Statement", cat: "trend", caseDef: "as", demo: "nobody knows me like you do", def: { pf: "tiktokx", hi: "#ff3d5a" }, tags: { e: "mid", m: ["dramatic", "hype", "romantic"] },
      draw(c, W, H, s, t, st, o){   // huge left-aligned words that snap in, the sung one in the highlight colour
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.075, maxW: 0.86, lh: 1.02, align: "left", each(it, i, x, y, px){
          if(!sung(s, i)) return; const a = ageOf(s, i, t), k = ease(a / 0.12);
          c.save(); c.globalAlpha *= k; c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.18); c.restore(); } });
    } },

    { id: "sticker-shadow", name: "Sticker Shadow", cat: "trend", caseDef: "as", demo: "best summer of my life", def: { pf: "tiktokb", hi: "#ff4fa3" }, tags: { e: "high", m: ["happy", "summer", "party"] },
      draw(c, W, H, s, t, st, o){   // chunky white words with a hard coloured shadow, tilted like a sticker
        const opt = { caseDef: "as", px: 0.06, maxW: 0.8, lh: 1.12 }, m = measure(c, W, H, s, st, o, opt), d = m.px * 0.085;
        c.save(); c.translate(W / 2, cy(H, st)); c.rotate(-0.045); c.translate(-W / 2, -cy(H, st)); c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y, px){ if(!sung(s, i)) return; const z = i === s.rev - 1 ? pop(ageOf(s, i, t), 0.16, 0.16) : 1;
          c.save(); c.translate(x + it.w / 2, y + px / 2); c.scale(z, z); c.textAlign = "center"; c.textBaseline = "middle";
          c.fillStyle = o.hi; c.fillText(it.s, d, d); c.lineJoin = "round"; c.lineWidth = px * 0.06; c.strokeStyle = o.hi; c.strokeText(it.s, 0, 0); c.fillStyle = o.tx; c.fillText(it.s, 0, 0); c.restore(); } });
        c.restore();
    } },

    { id: "gradient-pill", name: "Gradient Pill", cat: "trend", caseDef: "as", demo: "come a little closer", def: { pf: "tiktokb", hi: "#7b5cff" }, tags: { e: "mid", m: ["happy", "party", "night"] },
      draw(c, W, H, s, t, st, o){   // each line on a glossy gradient pill that slides in
        const opt = { caseDef: "as", px: 0.044, maxW: 0.78, lh: 1.5 }, m = measure(c, W, H, s, st, o, opt), k = ease((t - s.start) / 0.3);
        for(let L = 0; L < m.lay.lines; L++){ const w = m.lay.widths[L], padX = m.px * 0.7, h = m.px * 1.35, x = (W - w) / 2 - padX, y = m.top + L * m.lh - m.px * 0.18, kk = ease(clamp((t - s.start - L * 0.08) / 0.3, 0, 1));
          c.save(); c.globalAlpha *= kk; c.translate((1 - kk) * -W * 0.08, 0);
          const g = c.createLinearGradient(x, 0, x + w + padX * 2, 0); g.addColorStop(0, o.hi); g.addColorStop(1, "#ff5fa2"); c.fillStyle = g;
          c.shadowColor = rgba(o.hi, 0.5); c.shadowBlur = m.px * 0.6; roundRect(c, x, y, w + padX * 2, h, h / 2); c.fill(); c.restore(); }
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { ...opt, each(it, i, x, y){ c.save(); c.globalAlpha *= k * (sung(s, i) ? 1 : 0.45); c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },
  ];

  for(const p of NEW) if(!PRESETS.some(x => x.id === p.id)) PRESETS.push(p);
  try { const d = store.get("sls-draft"); if(d && d.P && d.P.style && NEW.some(p => p.id === d.P.style.preset) && S.P && S.songName === d.songName){ S.P.style.preset = d.P.style.preset; syncUI(); } } catch {}
  renderPresetGrid();
  ["#sPf", "#sSf", "#hFont", "#txtFont"].forEach(fillFonts);
  if(S.P) syncStylePanel();
})();

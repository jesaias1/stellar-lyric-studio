"use strict";
/* More lyric styles. Each one follows the same contract as the styles in studio.js:
   draw(c, W, H, s, t, st, o) draws the current lyric line at size 1, centred on (W/2, cy(H, st)).
   s = {words, start, end, rev (words sung so far), act (word being sung or -1), fade}
   o = {pf (primary font), sf (secondary font), hi (highlight colour), tx (text colour), v (variation)}
   Loaded after studio.js; uses its helpers (lineLayout, curWord, fitK, fnt, caseOf, ease, overshoot, pop, setLS, cy, rng, roundRect, clamp). */
(() => {
  Object.assign(FONTLIB, {
    caveat: { name: "Caveat (handwritten)", css: 'Caveat, "Segoe Print", cursive', w: "700" },
    marker: { name: "Permanent Marker", css: '"Permanent Marker", "Segoe Print", cursive', w: "400" },
    archivoi: { name: "Archivo Expanded Italic", css: 'Archivo, "Arial Black", sans-serif', w: "800", i: "italic" },
  });
  Promise.all(["caveat", "marker", "archivoi"].map(k => document.fonts.load(fnt(k, 40)).catch(() => {}))).then(() => { renderPresetThumbs(); tlDirty = true; });

  const TAU = Math.PI * 2;
  const bounceOut = x => { x = clamp(x, 0, 1); const n = 7.5625, d = 2.75; if(x < 1 / d) return n * x * x; if(x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if(x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; };
  const shade = (hex, f) => { const n = parseInt((hex || "#888888").slice(1), 16); const ch = s => Math.round(clamp(((n >> s) & 255) * f, 0, 255)); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; };
  const sparkle = (c, x, y, r) => { c.beginPath(); for(let k = 0; k < 8; k++){ const a = k * Math.PI / 4 - Math.PI / 2, rr = k % 2 ? r * 0.22 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); };
  const sung = (s, i) => i < s.rev;

  const NEW = [
    /* ---------- GLOW ---------- */
    { id: "neon", name: "Neon", cat: "glow", caseDef: "lower", demo: "neon on the water", def: { pf: "poppins", hi: "#ff3df2" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top"; c.lineJoin = "round";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.062, maxW: 0.84, lh: 1.3, each(it, i, x, y, px){
          c.save(); c.lineWidth = Math.max(1, px * 0.05);
          if(!sung(s, i)){ c.globalAlpha *= 0.13; c.strokeStyle = o.hi; c.strokeText(it.s, x, y); c.restore(); return; }
          const age = t - s.words[i].t; if(age < 0.32 && (Math.floor(age * 38 + i * 5) % 3 === 0)) c.globalAlpha *= 0.3;   // tube flickering on
          c.shadowColor = o.hi; c.shadowBlur = px * 0.7; c.strokeStyle = o.hi; c.strokeText(it.s, x, y);
          c.shadowBlur = px * 0.2; c.fillStyle = "#fff"; c.globalAlpha *= 0.92; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "starlight", name: "Starlight", cat: "glow", caseDef: "lower", demo: "under all the city glow", def: { pf: "serifi", hi: "#cdd6ff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.07, maxW: 0.82, lh: 1.15, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = t - s.words[i].t, k = ease(age / 0.45);
          c.save(); c.globalAlpha *= k; c.shadowColor = o.hi; c.shadowBlur = px * (0.15 + 0.5 * (1 - k)); c.fillStyle = o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.15); c.restore();
          if(i !== s.rev - 1) return;
          const r = rng(97 + i * 13); c.save(); c.fillStyle = o.hi; c.shadowColor = o.hi; c.shadowBlur = px * 0.3;
          for(let q = 0; q < 7; q++){ const sx = x + r() * it.w, sy = y + (r() - 0.25) * px * 1.4, ph = r() * TAU, life = clamp((age - q * 0.05) / 0.9, 0, 1);
            const tw = 0.5 + 0.5 * Math.sin(t * 7 + ph), sz = px * (0.05 + 0.09 * r()) * tw * Math.sin(life * Math.PI);
            if(sz > 0.3){ c.globalAlpha = 0.9 * tw; sparkle(c, sx, sy - life * px * 0.3, sz); } }
          c.restore(); } });
    } },

    { id: "orbit", name: "Orbit", cat: "glow", caseDef: "upper", demo: "stellar", def: { pf: "archivoi", hi: "#7088ff" },
      draw(c, W, H, s, t, st, o){
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.7, H * 0.09), yc = cy(H, st);
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        const tw = c.measureText(txt).width, rx = tw * 0.66 + px * 0.5, ry = px * 0.95, p = ease(age / 0.55);
        c.save(); c.translate(W / 2, yc); c.rotate(-0.3);
        c.strokeStyle = o.hi; c.lineWidth = Math.max(1.5, px * 0.05); c.lineCap = "round"; c.shadowColor = o.hi; c.shadowBlur = px * 0.25;
        const a0 = Math.PI * 0.85; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, a0 + TAU * 0.92 * p); c.stroke();
        const ah = a0 + TAU * 0.92 * p, hx = Math.cos(ah) * rx, hy = Math.sin(ah) * ry, tw2 = 1 + 0.25 * Math.sin(t * 6);
        c.fillStyle = "#fff"; c.shadowColor = "#fff"; c.shadowBlur = px * 0.5; sparkle(c, hx, hy, px * 0.22 * tw2 * (0.4 + 0.6 * p)); c.restore();
        const k = 0.85 + 0.15 * overshoot(age / 0.25); c.save(); c.translate(W / 2, yc); c.scale(k, k); c.fillStyle = o.tx; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "aurora", name: "Aurora", cat: "glow", caseDef: "lower", demo: "say it like you mean it", def: { pf: "poppins", hi: "#8a5cff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.06, maxW: 0.84, lh: 1.2, each(it, i, x, y, px){
          const k = sung(s, i) ? ease((t - s.words[i].t) / 0.3) : 0;
          const shift = (t * 0.35) % 1, g = c.createLinearGradient(x - W * shift, 0, x - W * shift + W * 2, 0);
          [o.hi, "#5ef0ff", "#ff79d6", o.hi, "#5ef0ff"].forEach((col, n, a) => g.addColorStop(n / (a.length - 1), col));
          c.save(); c.globalAlpha *= 0.16 + 0.84 * k; c.fillStyle = k ? g : o.tx; if(k){ c.shadowColor = o.hi; c.shadowBlur = px * 0.45 * k; } c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "lumen", name: "Lumen", cat: "glow", caseDef: "as", demo: "we don't have to go home", def: { pf: "serif", hi: "#ffd9a0" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.075, maxW: 0.8, lh: 1.1, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = t - s.words[i].t, k = ease(age / 0.7), on = i === s.rev - 1;
          c.save(); c.globalAlpha *= Math.min(1, age / 0.12);
          c.shadowColor = o.hi; c.shadowBlur = px * (on ? 1.1 - 0.6 * k : 0.35); c.fillStyle = on && k < 1 ? o.hi : o.tx; c.fillText(it.s, x, y);
          if(on){ c.globalAlpha *= 1 - k; c.fillStyle = "#fff"; c.fillText(it.s, x, y); } c.restore(); } });
    } },

    /* ---------- CINEMATIC ---------- */
    { id: "cinema", name: "Cinema", cat: "cinematic", caseDef: "upper", demo: "she never gave me a warning", def: { pf: "serif", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){
        const k = ease((t - s.start) / 0.6), bar = H * 0.11 * k;
        c.save(); c.globalAlpha = 1; c.fillStyle = "#000"; c.fillRect(0, 0, W, bar); c.fillRect(0, H - bar, W, bar); c.restore();
        const txt = s.words.slice(0, s.rev).map(w => caseOf(st, "upper", w.w)).join(" "), all = s.words.map(w => caseOf(st, "upper", w.w)).join(" ");
        const px = fitK(c, o.pf, [all], W * 0.82, H * 0.03); c.font = fnt(o.pf, px); setLS(c, px * (0.42 - 0.12 * k)); c.textAlign = "center"; c.textBaseline = "middle";
        c.globalAlpha *= k; c.fillStyle = o.tx; c.fillText(txt, W / 2, cy(H, st)); setLS(c, 0);
    } },

    { id: "velvet", name: "Velvet", cat: "cinematic", caseDef: "lower", demo: "gorgeous signs ignored", def: { pf: "playfair", hi: "#e8c99b" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.085, maxW: 0.82, lh: 1.05, each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = ease((t - s.words[i].t) / 0.6), on = i === s.rev - 1;
          c.save(); c.globalAlpha *= k; c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = px * 0.35; c.fillStyle = on ? o.hi : o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.35); c.restore(); } });
    } },

    { id: "monologue", name: "Monologue", cat: "cinematic", caseDef: "as", demo: "I left my heart in the back of your car", def: { pf: "serif", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.068, maxW: 0.8, lh: 1.12, align: "left", each(it, i, x, y){
          const k = sung(s, i) ? ease((t - s.words[i].t) / 0.25) : 0; c.save(); c.globalAlpha *= 0.18 + 0.82 * k; c.fillStyle = o.tx; c.fillText(it.s, x, y); c.restore(); } });
    } },

    { id: "drift", name: "Drift", cat: "cinematic", caseDef: "upper", demo: "under the city glow", def: { pf: "light", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){
        const life = t - s.start, inK = ease(life / 0.8), outK = clamp((s.end - t) / 0.5, 0, 1);
        const txt = s.words.map(w => caseOf(st, "upper", w.w)).join(" "), px = fitK(c, o.pf, [txt], W * 0.8, H * 0.032);
        c.font = fnt(o.pf, px); setLS(c, px * 0.5); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = o.tx;
        c.globalAlpha *= inK * outK; c.fillText(txt, W / 2, cy(H, st) + px * 1.2 - life * H * 0.012); setLS(c, 0);
    } },

    /* ---------- PLAYFUL ---------- */
    { id: "bounce", name: "Bounce", cat: "playful", caseDef: "lower", demo: "we don't have to go home", def: { pf: "round", hi: "#ffd23f" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.05, maxW: 0.84, lh: 1.35, each(it, i, x, y, px){
          if(!sung(s, i)) return; const p = (t - s.words[i].t) / 0.45, b = bounceOut(p), on = i === s.rev - 1;
          c.save(); c.globalAlpha *= clamp(p * 4, 0, 1); c.fillStyle = on ? o.hi : o.tx; c.fillText(it.s, x, y - (1 - b) * px * 2.2); c.restore(); } });
    } },

    { id: "chat", name: "Chat", cat: "playful", caseDef: "as", demo: "say it like you mean it", def: { pf: "sans", hi: "#2f6bff" },
      draw(c, W, H, s, t, st, o){
        const words = s.words.map(w => caseOf(st, "as", w.w)), maxW = W * 0.62, px = fitK(c, o.pf, words, maxW * 0.9, H * 0.042);
        c.font = fnt(o.pf, px); const lay = layoutWords(c, words.slice(0, Math.max(1, s.rev)), maxW), lh = px * 1.3;
        const bw = Math.max(...lay.widths) + px * 1.4, bh = lay.lines * lh + px * 0.9, k = overshoot(ease((t - s.start) / 0.25));
        const x0 = (W - bw) / 2, y0 = cy(H, st) - bh / 2;
        c.save(); c.translate(x0 + bw, y0 + bh); c.scale(k, k); c.translate(-(x0 + bw), -(y0 + bh));
        c.fillStyle = o.hi; roundRect(c, x0, y0, bw, bh, Math.min(px * 1.1, bh / 2)); c.fill();
        c.beginPath(); c.moveTo(x0 + bw - px * 0.7, y0 + bh - px * 0.5); c.quadraticCurveTo(x0 + bw + px * 0.1, y0 + bh + px * 0.1, x0 + bw + px * 0.45, y0 + bh + px * 0.15); c.quadraticCurveTo(x0 + bw - px * 0.1, y0 + bh - px * 0.05, x0 + bw - px * 0.15, y0 + bh - px * 0.6); c.fill();
        c.fillStyle = "#fff"; c.textBaseline = "top"; c.textAlign = "left";
        if(s.rev) lay.items.forEach(it => c.fillText(it.s, x0 + px * 0.7 + it.x, y0 + px * 0.45 + it.line * lh));
        else { for(let d = 0; d < 3; d++){ c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 8 - d); c.beginPath(); c.arc(x0 + px * (0.9 + d * 0.55), y0 + bh / 2, px * 0.14, 0, TAU); c.fill(); } }
        c.restore();
    } },

    { id: "stamp", name: "Stamp", cat: "playful", caseDef: "upper", demo: "warning", def: { pf: "marker", hi: "#ff2d3a" },
      draw(c, W, H, s, t, st, o){
        const { i, w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.8, H * 0.12), r = rng(31 + i * 7);
        const k = age < 0.12 ? 2.2 - 1.2 * (age / 0.12) : 1, shake = age < 0.25 ? (1 - age / 0.25) * px * 0.06 : 0;
        c.save(); c.translate(W / 2 + (r() - 0.5) * shake * 2, cy(H, st) + (r() - 0.5) * shake * 2); c.rotate((r() - 0.5) * 0.18); c.scale(k, k);
        c.globalAlpha *= clamp(age / 0.06, 0, 1); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        c.lineWidth = px * 0.06; c.strokeStyle = o.hi; c.lineJoin = "round"; const tw = c.measureText(txt).width;
        roundRect(c, -tw / 2 - px * 0.3, -px * 0.7, tw + px * 0.6, px * 1.4, px * 0.12); c.stroke();
        c.fillStyle = o.hi; c.fillText(txt, 0, px * 0.04); c.restore();
    } },

    { id: "highlighter", name: "Highlighter", cat: "playful", caseDef: "lower", demo: "she never gave me a warning", def: { pf: "sans", hi: "#ffe14a" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.05, maxW: 0.82, lh: 1.45, each(it, i, x, y, px){
          const p = sung(s, i) ? ease((t - s.words[i].t) / 0.22) : 0;
          if(p > 0){ c.save(); c.fillStyle = o.hi; c.globalAlpha *= 0.9; c.beginPath(); const hx = x - px * 0.12, hw = (it.w + px * 0.24) * p;
            c.moveTo(hx, y + px * 0.1); c.lineTo(hx + hw, y + px * 0.04); c.lineTo(hx + hw, y + px * 1.12); c.lineTo(hx, y + px * 1.18); c.closePath(); c.fill(); c.restore(); }
          c.save(); c.fillStyle = p > 0.5 ? "#141414" : o.tx; c.globalAlpha *= sung(s, i) ? 1 : 0.35; c.fillText(it.s, x, y + px * 0.1); c.restore(); } });
    } },

    { id: "ripple", name: "Ripple", cat: "playful", caseDef: "lower", demo: "neon on the water", def: { pf: "round", hi: "#5ef0ff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.052, maxW: 0.84, lh: 1.4, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = t - s.words[i].t, on = i === s.rev - 1; let cx = x, n = 0;
          c.save(); c.fillStyle = on ? o.hi : o.tx; c.globalAlpha *= clamp(age / 0.15, 0, 1);
          for(const ch of it.s){ const amp = px * (on ? 0.14 : 0.06) * (0.4 + 0.6 * Math.exp(-age * 1.5)); c.fillText(ch, cx, y + Math.sin(t * 6 - n * 0.6 - i) * amp); cx += c.measureText(ch).width; n++; }
          c.restore(); } });
    } },

    { id: "sticker", name: "Sticker", cat: "playful", caseDef: "lower", demo: "rewarded", def: { pf: "black", hi: "#ff4f8b" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "middle";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.07, maxW: 0.8, lh: 1.35, each(it, i, x, y, px, lh){
          if(!sung(s, i)) return; const k = overshoot(ease((t - s.words[i].t) / 0.22)), r = rng(5 + i * 11);
          c.save(); c.translate(x + it.w / 2, y + lh / 2); c.rotate((r() - 0.5) * 0.22); c.scale(k, k); c.textAlign = "center"; c.lineJoin = "round";
          c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = px * 0.25; c.shadowOffsetY = px * 0.08; c.lineWidth = px * 0.32; c.strokeStyle = "#fff"; c.strokeText(it.s, 0, 0);
          c.shadowColor = "transparent"; c.fillStyle = o.hi; c.fillText(it.s, 0, 0); c.restore(); } });
    } },

    { id: "diary", name: "Diary", cat: "playful", caseDef: "as", demo: "under all the city glow", def: { pf: "caveat", hi: "#ff6b8a" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.085, maxW: 0.82, lh: 1.05, each(it, i, x, y, px){
          if(!sung(s, i)) return; const w = s.words[i], p = i === s.rev - 1 ? clamp((t - w.t) / Math.max(0.15, Math.min(0.6, w.d)), 0, 1) : 1, r = rng(17 + i * 3);
          c.save(); c.beginPath(); c.rect(x - px * 0.2, y - px * 0.3, (it.w + px * 0.4) * p, px * 1.8); c.clip(); c.fillStyle = o.tx; c.fillText(it.s, x, y + (r() - 0.5) * px * 0.08); c.restore();
          if(i === s.rev - 1){ c.save(); c.strokeStyle = o.hi; c.lineWidth = px * 0.06; c.lineCap = "round"; c.beginPath();
            for(let q = 0; q <= 12; q++){ const qx = x + it.w * p * q / 12, qy = y + px * 1.02 + Math.sin(q * 1.3 + i) * px * 0.04; q ? c.lineTo(qx, qy) : c.moveTo(qx, qy); } c.stroke(); c.restore(); } } });
    } },

    /* ---------- BOLD ---------- */
    { id: "spotlight", name: "Spotlight", cat: "bold", caseDef: "upper", demo: "she never gave me", def: { pf: "anton", hi: "#ffe14a" },
      draw(c, W, H, s, t, st, o){
        const { w, age, prev, next } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.84, H * 0.13), yc = cy(H, st), k = 0.75 + 0.25 * overshoot(age / 0.2);
        c.textAlign = "center"; c.textBaseline = "middle";
        if(prev){ c.save(); c.font = fnt(o.pf, px * 0.38); c.globalAlpha *= 0.4; c.fillStyle = o.tx; c.fillText(caseOf(st, "upper", prev.w), W / 2, yc - px * 0.95); c.restore(); }
        if(next && next.t - t < 1.2){ c.save(); c.font = fnt(o.pf, px * 0.38); c.globalAlpha *= 0.22; c.fillStyle = o.tx; c.fillText(caseOf(st, "upper", next.w), W / 2, yc + px * 0.95); c.restore(); }
        c.save(); c.translate(W / 2, yc); c.scale(k, k); c.font = fnt(o.pf, px); c.shadowColor = o.hi; c.shadowBlur = px * 0.25; c.fillStyle = o.hi; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "impact", name: "Impact", cat: "bold", caseDef: "upper", demo: "body", def: { pf: "black", hi: "#ffd23f" },
      draw(c, W, H, s, t, st, o){
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.78, H * 0.15), k = 0.7 + 0.3 * overshoot(age / 0.2), depth = Math.round(px * 0.14);
        c.save(); c.translate(W / 2, cy(H, st)); c.scale(k, k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        for(let d = depth; d > 0; d--){ c.fillStyle = shade(o.hi, 0.35 + 0.25 * (1 - d / depth)); c.fillText(txt, d * 0.7, d); }
        c.fillStyle = o.hi; c.fillText(txt, 0, 0); c.restore();
    } },

    /* ---------- LAYERED ---------- */
    { id: "glitch", name: "Glitch", cat: "layered", caseDef: "upper", demo: "ignored", def: { pf: "black", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){
        const { i, w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.82, H * 0.11), yc = cy(H, st);
        const hot = age < 0.35, f = Math.floor(t * 24), r = rng(f * 7 + i), amt = px * (hot ? 0.09 * (1 - age / 0.35) + 0.02 : 0.015 + 0.01 * Math.sin(t * 3));
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        c.save(); c.globalCompositeOperation = "lighter";
        c.fillStyle = "rgba(255,40,80,.85)"; c.fillText(txt, W / 2 - amt, yc + (r() - 0.5) * amt * 0.5);
        c.fillStyle = "rgba(40,230,255,.85)"; c.fillText(txt, W / 2 + amt, yc + (r() - 0.5) * amt * 0.5); c.restore();
        c.fillStyle = o.tx; c.fillText(txt, W / 2, yc);
        if(hot) for(let b = 0; b < 3; b++){ const by = yc - px * 0.6 + r() * px * 1.2, bh = px * (0.05 + r() * 0.12), dx = (r() - 0.5) * px * 0.5;
          c.save(); c.beginPath(); c.rect(0, by, W, bh); c.clip(); c.fillStyle = o.hi; c.fillText(txt, W / 2 + dx, yc); c.restore(); }
    } },

    { id: "fillup", name: "Fill Up", cat: "layered", caseDef: "upper", demo: "neon on the water", def: { pf: "anton", hi: "#38d6ff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top"; c.lineJoin = "round";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.075, maxW: 0.84, lh: 1.08, each(it, i, x, y, px){
          const w = s.words[i], p = sung(s, i) ? (i === s.act ? clamp((t - w.t) / Math.max(0.12, w.d), 0, 1) : 1) : 0;
          c.save(); c.lineWidth = Math.max(1, px * 0.03); c.strokeStyle = o.tx; c.globalAlpha *= 0.8; c.strokeText(it.s, x, y); c.restore();
          if(p > 0){ c.save(); c.beginPath(); c.rect(x - 2, y + px * (1.05 - 1.1 * p), it.w + 4, px * 1.2); c.clip(); c.fillStyle = o.hi; c.fillText(it.s, x, y); c.restore(); } } });
    } },

    { id: "shine", name: "Shine", cat: "layered", caseDef: "upper", demo: "rewarded", def: { pf: "barlow", hi: "#ffd59a" },
      draw(c, W, H, s, t, st, o){
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.82, H * 0.12), yc = cy(H, st), k = 0.85 + 0.15 * overshoot(age / 0.2);
        c.save(); c.translate(W / 2, yc); c.scale(k, k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        const tw = c.measureText(txt).width, sx = -tw / 2 - px + ((age * 1.4) % 1.6) * (tw + px * 2) / 1.2;
        const g = c.createLinearGradient(sx - px * 0.6, -px, sx + px * 0.6, px); g.addColorStop(0, o.hi); g.addColorStop(0.5, "#ffffff"); g.addColorStop(1, o.hi);
        c.fillStyle = g; c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = px * 0.15; c.fillText(txt, 0, 0); c.restore();
    } },

    { id: "split", name: "Split", cat: "layered", caseDef: "upper", demo: "warning", def: { pf: "bebas", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.84, H * 0.16), yc = cy(H, st), k = ease(age / 0.22), off = (1 - k) * W * 0.25;
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = o.tx; c.globalAlpha *= 0.3 + 0.7 * k;
        c.save(); c.beginPath(); c.rect(0, 0, W, yc); c.clip(); c.fillText(txt, W / 2 - off, yc); c.restore();
        c.save(); c.beginPath(); c.rect(0, yc, W, H); c.clip(); c.fillText(txt, W / 2 + off, yc); c.restore();
        if(k < 1){ c.fillStyle = o.hi; c.globalAlpha = 0.6 * (1 - k); c.fillRect(W * 0.1, yc - 1, W * 0.8, 2); }
    } },
  ];

  /* ---------- second batch: Editorial (the Stellar Music look) and more ---------- */
  Object.assign(FONTLIB, {
    grotesk: { name: "Inter Tight Medium", css: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', w: "500" },
    groteski: { name: "Inter Tight Light Italic", css: '"Inter Tight", "Helvetica Neue", Arial, sans-serif', w: "300", i: "italic" },
    pixel: { name: "Silkscreen (pixel)", css: 'Silkscreen, "Courier New", monospace', w: "400" },
  });
  Promise.all(["grotesk", "groteski", "pixel"].map(k => document.fonts.load(fnt(k, 40)).catch(() => {}))).then(() => { renderPresetThumbs(); tlDirty = true; });
  const MORE = [
    { id: "statement", name: "Statement", cat: "editorial", caseDef: "as", demo: "We create innovative music", def: { pf: "grotesk", sf: "groteski", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){   // big left-aligned sentence, like the Stellar Music front page
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.072, maxW: 0.84, lh: 1.0, align: "left", each(it, i, x, y, px){
          if(!sung(s, i)) return; const k = ease((t - s.words[i].t) / 0.3); setLS(c, -px * 0.035);
          c.save(); c.globalAlpha *= k; c.fillStyle = o.tx; c.fillText(it.s, x, y + (1 - k) * px * 0.2); c.restore(); setLS(c, 0); } });
    } },
    { id: "editorial", name: "Editorial", cat: "editorial", caseDef: "as", demo: "authentic music for our artists", def: { pf: "grotesk", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "as", px: 0.05, maxW: 0.82, lh: 1.35, each(it, i, x, y, px){
          const k = sung(s, i) ? ease((t - s.words[i].t) / 0.25) : 0; c.save(); c.fillStyle = o.tx; c.globalAlpha *= 0.3 + 0.7 * k; c.fillText(it.s, x, y); c.restore();
          if(i === s.rev - 1){ c.fillStyle = o.hi; c.fillRect(x, y + px * 1.12, it.w * ease((t - s.words[i].t) / 0.3), Math.max(1.5, px * 0.05)); } } });
    } },
    { id: "runline", name: "Running Line", cat: "editorial", caseDef: "as", demo: "We create innovative music * authentic management", def: { pf: "grotesk", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){   // the line runs sideways like a news ticker, the sung word lit
        const words = s.words.map(w => caseOf(st, "as", w.w)), px = H * 0.05; c.font = fnt(o.pf, px); c.textBaseline = "middle"; c.textAlign = "left";
        const sp = c.measureText(" ").width, ws = words.map(w => c.measureText(w).width), total = ws.reduce((a, b) => a + b + sp, 0), yc = cy(H, st);
        const p = clamp((t - s.start) / Math.max(1, s.end - s.start), 0, 1), x0 = W * 0.9 - p * (total + W * 0.1);
        c.strokeStyle = o.tx; c.globalAlpha *= 0.6; c.lineWidth = 1; c.beginPath(); c.moveTo(0, yc - px * 0.9); c.lineTo(W, yc - px * 0.9); c.moveTo(0, yc + px * 0.9); c.lineTo(W, yc + px * 0.9); c.stroke(); c.globalAlpha /= 0.6;
        let x = x0; words.forEach((w, i) => { c.fillStyle = o.tx; c.globalAlpha = (i < s.rev ? 1 : 0.35) * s.fade; c.fillText(w, x, yc); x += ws[i] + sp; });
    } },
    { id: "viewfinder", name: "Viewfinder", cat: "editorial", caseDef: "upper", demo: "warning", def: { pf: "grotesk", hi: "#ff3b30" },
      draw(c, W, H, s, t, st, o){
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.66, H * 0.08), yc = cy(H, st);
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle"; const tw = c.measureText(txt).width, k = ease(age / 0.25);
        const bw = tw + px * (1.6 - 0.4 * k), bh = px * (2.2 - 0.4 * k), l = px * 0.4; c.strokeStyle = o.tx; c.lineWidth = Math.max(1.5, px * 0.04);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => { const x = W / 2 + sx * bw / 2, y = yc + sy * bh / 2; c.beginPath(); c.moveTo(x - sx * l, y); c.lineTo(x, y); c.lineTo(x, y - sy * l); c.stroke(); });
        c.fillStyle = o.hi; if(Math.floor(t * 2) % 2 === 0){ c.beginPath(); c.arc(W / 2 - bw / 2 + px * 0.25, yc - bh / 2 - px * 0.45, px * 0.12, 0, TAU); c.fill(); }
        c.font = fnt(o.pf, px * 0.28); c.textAlign = "left"; c.fillStyle = o.tx; c.fillText("REC", W / 2 - bw / 2 + px * 0.45, yc - bh / 2 - px * 0.45);
        c.font = fnt(o.pf, px); c.textAlign = "center"; c.globalAlpha *= k; c.fillText(txt, W / 2, yc);
    } },
    { id: "poster", name: "Poster", cat: "editorial", caseDef: "upper", demo: "neon on the water tonight", def: { pf: "black", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){   // each word fills the width, stacked like a gig poster
        const words = s.words.slice(0, Math.max(1, s.rev)).map(w => caseOf(st, "upper", w.w)), maxW = W * 0.82; let y = cy(H, st), hs = [];
        const sizes = words.map(w => fitK(c, o.pf, [w], maxW, H * 0.2)), total = sizes.reduce((a, b) => a + b * 0.92, 0), scale = total > H * 0.6 ? H * 0.6 / total : 1;
        y -= total * scale / 2; c.textAlign = "center"; c.textBaseline = "top";
        words.forEach((w, i) => { const px = sizes[i] * scale, k = ease((t - s.words[i].t) / 0.2); c.font = fnt(o.pf, px); c.save(); c.globalAlpha *= k; c.fillStyle = i === s.rev - 1 ? o.hi : o.tx; c.fillText(w, W / 2, y + (1 - k) * px * 0.1); c.restore(); y += px * 0.92; });
    } },
    { id: "tilt", name: "Tilt", cat: "playful", caseDef: "upper", demo: "say it like you mean it", def: { pf: "anton", hi: "#ffd23f" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "middle";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.07, maxW: 0.8, lh: 1.15, each(it, i, x, y, px, lh){
          if(!sung(s, i)) return; const k = overshoot(ease((t - s.words[i].t) / 0.25)), r = rng(41 + i * 9), on = i === s.rev - 1;
          c.save(); c.translate(x + it.w / 2, y + lh / 2); c.rotate((r() - 0.5) * 0.35 * k); c.scale(k, k); c.textAlign = "center"; c.fillStyle = on ? o.hi : o.tx; c.fillText(it.s, 0, 0); c.restore(); } });
    } },
    { id: "bubble", name: "Bubble", cat: "playful", caseDef: "lower", demo: "we don't have to go home", def: { pf: "round", hi: "#7b5cff" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "middle";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.045, maxW: 0.8, lh: 1.7, each(it, i, x, y, px, lh){
          if(!sung(s, i)) return; const k = overshoot(ease((t - s.words[i].t) / 0.22)), on = i === s.rev - 1;
          c.save(); c.translate(x + it.w / 2, y + lh / 2); c.scale(k, k); c.fillStyle = on ? o.hi : "rgba(255,255,255,.92)"; roundRect(c, -it.w / 2 - px * 0.4, -px * 0.7, it.w + px * 0.8, px * 1.4, px * 0.7); c.fill();
          c.fillStyle = on ? "#fff" : "#141414"; c.textAlign = "center"; c.fillText(it.s, 0, px * 0.04); c.restore(); } });
    } },
    { id: "ransom", name: "Ransom", cat: "playful", caseDef: "upper", demo: "warning", def: { pf: "black", hi: "#ffffff" },
      draw(c, W, H, s, t, st, o){   // cut-out letters, each its own paper and font
        const { i, w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), r = rng(13 + i * 17), fonts = ["black", "serif", "anton", "mono", "marker", "playfair"], cols = ["#fff", "#111", "#ffd23f", "#ff4f8b", "#38d6ff", "#f3ecb0"];
        const chars = [...txt], px = Math.min(H * 0.1, W * 0.84 / Math.max(3, chars.length) * 1.25), yc = cy(H, st);
        const picks = chars.map(() => ({ f: fonts[Math.floor(r() * fonts.length)], bg: cols[Math.floor(r() * cols.length)], rot: (r() - 0.5) * 0.3, dy: (r() - 0.5) * px * 0.2 }));
        c.textBaseline = "middle"; c.textAlign = "center"; let widths = chars.map((ch, n) => { c.font = fnt(picks[n].f, px); return c.measureText(ch).width + px * 0.35; });
        let x = (W - widths.reduce((a, b) => a + b, 0)) / 2;
        chars.forEach((ch, n) => { const k = ease((age - n * 0.03) / 0.15); if(k <= 0){ x += widths[n]; return; } const p = picks[n], bw = widths[n] - px * 0.08;
          c.save(); c.translate(x + widths[n] / 2, yc + p.dy); c.rotate(p.rot); c.scale(k, k); c.fillStyle = p.bg; c.fillRect(-bw / 2, -px * 0.65, bw, px * 1.3);
          c.font = fnt(p.f, px); c.fillStyle = p.bg === "#111" ? "#fff" : "#111"; c.fillText(ch, 0, px * 0.04); c.restore(); x += widths[n]; });
    } },
    { id: "arcade", name: "Arcade", cat: "playful", caseDef: "upper", demo: "player one ready", def: { pf: "pixel", hi: "#39ff6a" },
      draw(c, W, H, s, t, st, o){
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "upper", px: 0.045, maxW: 0.84, lh: 1.6, each(it, i, x, y, px){
          if(!sung(s, i)) return; const on = i === s.rev - 1, w = s.words[i], n = on ? Math.ceil(it.s.length * clamp((t - w.t) / Math.max(0.12, Math.min(0.4, w.d)), 0, 1)) : it.s.length;
          c.save(); c.fillStyle = "rgba(0,0,0,.6)"; c.fillText(it.s.slice(0, n), x + px * 0.12, y + px * 0.12); c.fillStyle = on ? o.hi : o.tx; c.fillText(it.s.slice(0, n), x, y); c.restore(); } });
    } },
    { id: "chrome", name: "Chrome", cat: "bold", caseDef: "upper", demo: "overdrive", def: { pf: "archivoi", hi: "#ff4fd8" },
      draw(c, W, H, s, t, st, o){
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.84, H * 0.11), yc = cy(H, st), k = 0.8 + 0.2 * overshoot(age / 0.22);
        c.save(); c.translate(W / 2, yc); c.scale(k, k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        const g = c.createLinearGradient(0, -px * 0.5, 0, px * 0.5); g.addColorStop(0, "#ffffff"); g.addColorStop(0.45, "#9fb6ff"); g.addColorStop(0.5, "#1b1b3a"); g.addColorStop(0.62, o.hi); g.addColorStop(1, "#ffffff");
        c.lineJoin = "round"; c.lineWidth = px * 0.08; c.strokeStyle = "#0c0c22"; c.strokeText(txt, 0, 0); c.fillStyle = g; c.fillText(txt, 0, 0);
        c.globalCompositeOperation = "lighter"; c.globalAlpha *= 0.5 * (1 - ease(age / 0.4)); c.fillStyle = "#fff"; c.fillText(txt, 0, 0); c.restore();
    } },
    { id: "pulse", name: "Pulse", cat: "glow", caseDef: "upper", demo: "heartbeat", def: { pf: "black", hi: "#ff2d55" },
      draw(c, W, H, s, t, st, o){   // throbs on the song's beat
        const { w, age } = curWord(s, t), txt = caseOf(st, "upper", w.w), px = fitK(c, o.pf, [txt], W * 0.8, H * 0.1), yc = cy(H, st);
        const bl = 60 / ((S.P && S.P.bpm) || 100), ph = (((t - ((S.P && S.P.offset) || 0)) % bl) + bl) % bl / bl, beat = Math.exp(-ph * 6), k = (0.9 + 0.1 * overshoot(age / 0.2)) * (1 + 0.06 * beat);
        c.save(); c.translate(W / 2, yc); c.scale(k, k); c.font = fnt(o.pf, px); c.textAlign = "center"; c.textBaseline = "middle";
        c.shadowColor = o.hi; c.shadowBlur = px * (0.3 + 0.9 * beat); c.fillStyle = o.hi; c.fillText(txt, 0, 0); c.shadowBlur = 0; c.fillStyle = o.tx; c.globalAlpha *= 0.35 + 0.4 * beat; c.fillText(txt, 0, 0); c.restore();
    } },
    { id: "rain", name: "Rain", cat: "layered", caseDef: "lower", demo: "tell me where the river goes", def: { pf: "sans", hi: "#9fd8ff" },
      draw(c, W, H, s, t, st, o){   // letters fall into place one after another
        c.textBaseline = "top";
        lineLayout(c, W, H, s, st, o, { caseDef: "lower", px: 0.05, maxW: 0.84, lh: 1.35, each(it, i, x, y, px){
          if(!sung(s, i)) return; const age = t - s.words[i].t, on = i === s.rev - 1; let cx = x, n = 0;
          c.save(); c.fillStyle = on ? o.hi : o.tx;
          for(const ch of it.s){ const k = bounceOut(clamp((age - n * 0.035) / 0.4, 0, 1)); if(k > 0){ c.globalAlpha = s.fade * Math.min(1, k * 2); c.fillText(ch, cx, y - (1 - k) * px * 1.6); } cx += c.measureText(ch).width; n++; }
          c.restore(); } });
    } },
  ];
  NEW.push(...MORE);

  for(const p of NEW) if(!PRESETS.some(x => x.id === p.id)) PRESETS.push(p);
  // a saved project that uses one of these styles may have been loaded before this file ran
  try { const d = store.get("sls-draft"); if(d && d.P && d.P.style && NEW.some(p => p.id === d.P.style.preset) && S.P && S.songName === d.songName){ S.P.style.preset = d.P.style.preset; syncUI(); } } catch {}
  renderPresetGrid();

  /* ---------- hover preview: a small window that plays the style beside the grid ---------- */
  const peek = document.createElement("div"); peek.className = "style-peek"; peek.hidden = true;
  peek.innerHTML = `<canvas width="270" height="480"></canvas><div class="sp-cap"><b></b><span></span></div>`;
  document.body.append(peek);
  const pc = peek.querySelector("canvas"), pg = pc.getContext("2d"), CATS = { minimal: "Minimal", bold: "Bold", layered: "Layered", glow: "Glow", cinematic: "Cinematic", playful: "Playful", editorial: "Editorial" };
  let showing = null, raf = 0, t0 = 0, hideT = 0;
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  function frame(now){
    if(!showing){ raf = 0; return; }
    const pr = styleDef(showing), n = Math.max(1, (pr.demo || "x").split(/\s+/).length), loop = n * 0.38 + 1.6, t = ((now - t0) / 1000) % loop;
    pg.setTransform(1, 0, 0, 1, 0, 0); pg.clearRect(0, 0, pc.width, pc.height);
    // the project's own footage colours would be nicer, but a calm backdrop keeps every style readable
    const g = pg.createLinearGradient(0, 0, 0, pc.height); g.addColorStop(0, "#1b1d33"); g.addColorStop(1, "#0b0b12"); pg.fillStyle = g; pg.fillRect(0, 0, pc.width, pc.height);
    const st = { ...S.P.style, preset: pr.id, size: 1, x: 0.5, y: 0.5, case: "auto" }, s = demoState(pr, t);
    if(s && s.rev){ pg.save(); try { pr.draw(pg, pc.width, pc.height, s, t, st, styleOpts(st, pr)); } catch {} pg.restore(); }
    raf = requestAnimationFrame(frame);
  }
  function show(btn){
    const id = btn.dataset.id; clearTimeout(hideT); if(showing === id) return;
    showing = id; t0 = performance.now(); const pr = styleDef(id);
    peek.querySelector("b").textContent = pr.name; peek.querySelector("span").textContent = (CATS[pr.cat] || "") + (id === S.P.style.preset ? " · in use" : " · click to use");
    const r = btn.getBoundingClientRect(), pw = 200, ph = 356 + 44, gap = 14;
    let x = r.left - pw - gap; if(x < 8) x = r.right + gap; if(x + pw > innerWidth - 8) x = Math.max(8, innerWidth - pw - 8);
    const y = clamp(r.top + r.height / 2 - ph / 2, 8, innerHeight - ph - 8);
    peek.style.left = x + "px"; peek.style.top = y + "px"; peek.hidden = false; peek.classList.remove("in"); void peek.offsetWidth; peek.classList.add("in");
    if(!raf) raf = requestAnimationFrame(frame);
  }
  function hide(){ hideT = setTimeout(() => { showing = null; peek.hidden = true; }, 80); }
  if(canHover){
    $("#presets").addEventListener("pointerover", e => { const b = e.target.closest(".preset"); if(b) show(b); });
    $("#presets").addEventListener("pointerout", e => { const b = e.target.closest(".preset"); if(b && !b.contains(e.relatedTarget)) hide(); });
    $("#presets").addEventListener("click", () => { if(showing) peek.querySelector("span").textContent = (CATS[styleDef(showing).cat] || "") + " · in use"; });
    addEventListener("scroll", () => { if(showing){ showing = null; peek.hidden = true; } }, true);
  }
})();

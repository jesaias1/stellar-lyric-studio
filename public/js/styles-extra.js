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

  for(const p of NEW) if(!PRESETS.some(x => x.id === p.id)) PRESETS.push(p);
  // a saved project that uses one of these styles may have been loaded before this file ran
  try { const d = store.get("sls-draft"); if(d && d.P && d.P.style && NEW.some(p => p.id === d.P.style.preset) && S.P && S.songName === d.songName){ S.P.style.preset = d.P.style.preset; syncUI(); } } catch {}
  renderPresetGrid();
})();

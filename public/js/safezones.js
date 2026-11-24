"use strict";
/* Safe-zone overlays: shows where TikTok, Instagram and YouTube put their buttons, captions and bars over the
   video, so the lyrics can be kept clear of them. Drawn on a separate layer over the preview; never exported.
   Positions are approximate (apps change their layouts) and are given as fractions of the frame. */
window.SLSSafe = (() => {
  // each platform: the interface parts (rects as x, y, w, h fractions), and the area that stays clear for text
  const P = {
    tiktok: { name: "TikTok", aspects: ["9:16"], safe: [0.06, 0.12, 0.78, 0.6],
      bars: [{ r: [0, 0, 1, 0.085], label: "Following   For You" }, { r: [0.84, 0.4, 0.16, 0.47], rail: ["avatar", "heart", "comment", "bookmark", "share", "disc"] }, { r: [0, 0.78, 0.84, 0.14], caption: ["@artist", "Caption text goes here #lyrics", "♫ original sound"] }, { r: [0, 0.93, 1, 0.07], nav: 5 }] },
    reels: { name: "Reels", aspects: ["9:16"], safe: [0.06, 0.1, 0.78, 0.62],
      bars: [{ r: [0, 0, 1, 0.08], label: "Reels" }, { r: [0.86, 0.52, 0.14, 0.38], rail: ["heart", "comment", "share", "more", "disc"] }, { r: [0, 0.79, 0.86, 0.14], caption: ["@artist · Follow", "Caption text goes here…", "♫ Artist · Song"] }, { r: [0, 0.94, 1, 0.06], nav: 5 }] },
    shorts: { name: "Shorts", aspects: ["9:16"], safe: [0.06, 0.1, 0.78, 0.6],
      bars: [{ r: [0, 0, 1, 0.07], label: "" }, { r: [0.85, 0.44, 0.15, 0.46], rail: ["heart", "dislike", "comment", "share", "remix", "disc"] }, { r: [0, 0.78, 0.85, 0.14], caption: ["@artist  Subscribe", "Video title goes here", "♫ Song"] }, { r: [0, 0.93, 1, 0.07], nav: 5 }] },
    story: { name: "Story", aspects: ["9:16"], safe: [0.06, 0.14, 0.88, 0.72],
      bars: [{ r: [0, 0, 1, 0.12], story: true }, { r: [0, 0.89, 1, 0.11], reply: true }] },
    feed: { name: "Instagram feed", aspects: ["4:5", "1:1"], safe: [0.05, 0.05, 0.9, 0.82],
      bars: [{ r: [0, 0.88, 1, 0.12], feed: true }] },
    youtube: { name: "YouTube", aspects: ["16:9"], safe: [0.05, 0.12, 0.9, 0.7],
      bars: [{ r: [0, 0, 1, 0.12], label: "Song title · Artist" }, { r: [0, 0.84, 1, 0.16], player: true }] },
  };
  let mode = (() => { try { return localStorage.getItem("sls-safe") || "off"; } catch { return "off"; } })();

  // the overlay sits on top of the preview canvas, same size
  const wrap = document.createElement("div"); wrap.className = "stage-wrap"; stage.parentNode.insertBefore(wrap, stage); wrap.append(stage);
  const ov = document.createElement("canvas"); ov.className = "safe-ov"; ov.setAttribute("aria-hidden", "true"); wrap.append(ov);
  const warn = document.createElement("div"); warn.className = "safe-warn"; warn.hidden = true; warn.innerHTML = `<span></span><button class="btn small">Move lyrics into the safe area</button>`; wrap.append(warn);

  // the switch, in the bar above the preview
  const bar = document.createElement("div"); bar.className = "safe-bar";
  bar.innerHTML = `<span class="label">Preview as</span><div class="seg seg-wrap" id="safeSeg"></div>`;
  $(".stagebar").append(bar);
  function paintSwitch(){
    const key = aspectKey(S.P.aspect, true), list = Object.entries(P).filter(([, p]) => p.aspects.includes(key));
    if(mode !== "off" && !P[mode].aspects.includes(key)) mode = list.length ? list[0][0] : "off";
    $("#safeSeg").innerHTML = `<button data-v="off" aria-pressed="${mode === "off"}">Clean</button>` + list.map(([k, p]) => `<button data-v="${k}" aria-pressed="${mode === k}">${p.name}</button>`).join("");
  }
  $("#safeSeg").onclick = e => { const b = e.target.closest("button"); if(!b) return; mode = b.dataset.v; try { localStorage.setItem("sls-safe", mode); } catch {} paintSwitch(); last = ""; };
  slsOn("change", () => { paintSwitch(); last = ""; });

  const ICON = {
    heart(c, x, y, r){ c.beginPath(); c.moveTo(x, y + r * 0.7); c.bezierCurveTo(x - r * 1.4, y - r * 0.3, x - r * 0.6, y - r * 1.2, x, y - r * 0.45); c.bezierCurveTo(x + r * 0.6, y - r * 1.2, x + r * 1.4, y - r * 0.3, x, y + r * 0.7); c.fill(); },
    comment(c, x, y, r){ c.beginPath(); c.ellipse(x, y - r * 0.1, r, r * 0.8, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.moveTo(x - r * 0.5, y + r * 0.5); c.lineTo(x - r * 0.8, y + r); c.lineTo(x, y + r * 0.6); c.fill(); },
    share(c, x, y, r){ c.beginPath(); c.moveTo(x - r, y + r * 0.6); c.quadraticCurveTo(x - r * 0.6, y - r * 0.4, x + r * 0.2, y - r * 0.4); c.lineTo(x + r * 0.2, y - r * 0.9); c.lineTo(x + r, y - r * 0.1); c.lineTo(x + r * 0.2, y + r * 0.7); c.lineTo(x + r * 0.2, y + r * 0.15); c.quadraticCurveTo(x - r * 0.5, y + r * 0.1, x - r, y + r * 0.6); c.fill(); },
    bookmark(c, x, y, r){ c.beginPath(); c.moveTo(x - r * 0.6, y - r); c.lineTo(x + r * 0.6, y - r); c.lineTo(x + r * 0.6, y + r); c.lineTo(x, y + r * 0.5); c.lineTo(x - r * 0.6, y + r); c.closePath(); c.fill(); },
    avatar(c, x, y, r){ c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.fillStyle = "#fe2c55"; c.beginPath(); c.arc(x, y + r, r * 0.32, 0, Math.PI * 2); c.fill(); },
    disc(c, x, y, r){ c.beginPath(); c.arc(x, y, r * 0.85, 0, Math.PI * 2); c.fill(); c.fillStyle = "rgba(0,0,0,.6)"; c.beginPath(); c.arc(x, y, r * 0.3, 0, Math.PI * 2); c.fill(); },
    more(c, x, y, r){ for(let k = -1; k <= 1; k++){ c.beginPath(); c.arc(x + k * r * 0.6, y, r * 0.18, 0, Math.PI * 2); c.fill(); } },
    dislike(c, x, y, r){ c.save(); c.translate(x, y); c.rotate(Math.PI); ICON.thumb(c, 0, 0, r); c.restore(); },
    thumb(c, x, y, r){ c.fillRect(x - r, y - r * 0.1, r * 0.45, r); c.beginPath(); c.moveTo(x - r * 0.45, y - r * 0.1); c.lineTo(x - r * 0.1, y - r); c.lineTo(x + r * 0.2, y - r * 0.9); c.lineTo(x + r * 0.1, y - r * 0.2); c.lineTo(x + r, y - r * 0.2); c.lineTo(x + r * 0.8, y + r * 0.9); c.lineTo(x - r * 0.45, y + r * 0.9); c.closePath(); c.fill(); },
    remix(c, x, y, r){ c.lineWidth = r * 0.25; c.beginPath(); c.arc(x, y, r * 0.75, 0.3, Math.PI * 1.7); c.stroke(); },
  };
  ICON.heart.label = "1.2M"; ICON.comment.label = "4,812"; ICON.share.label = "Share"; ICON.bookmark.label = "88K";

  let last = "";
  function draw(){
    const w = stage.clientWidth, h = stage.clientHeight, k = Math.min(2, window.devicePixelRatio || 1);
    const key = [mode, w, h, S.P.aspect, S.P.style.x, S.P.style.y, S.P.style.size, document.documentElement.dataset.theme].join("|");
    if(key === last) return; last = key;
    ov.style.width = w + "px"; ov.style.height = h + "px"; ov.width = Math.round(w * k); ov.height = Math.round(h * k);
    const c = ov.getContext("2d"); c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, w, h);
    const p = P[mode]; warn.hidden = true;
    if(!p || !p.aspects.includes(aspectKey(S.P.aspect, true))) return;
    const R = ([x, y, ww, hh]) => [x * w, y * h, ww * w, hh * h], u = Math.min(w, h) / 100;
    for(const b of p.bars){
      const [x, y, bw, bh] = R(b.r);
      // dim the strip the interface covers
      const g = y < h / 2 ? c.createLinearGradient(0, y, 0, y + bh) : c.createLinearGradient(0, y + bh, 0, y);
      if(!b.rail){ g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(x, y, bw, bh); }
      c.fillStyle = "rgba(255,255,255,.92)"; c.strokeStyle = "rgba(255,255,255,.92)";
      if(b.label != null){ c.font = `700 ${4 * u}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(b.label, w / 2, y + bh / 2); }
      if(b.rail){ const n = b.rail.length, step = bh / n, r = Math.min(bw * 0.28, step * 0.28);
        b.rail.forEach((ic, i) => { const cx = x + bw / 2, cy0 = y + step * (i + 0.42); c.save(); c.fillStyle = "rgba(255,255,255,.95)"; c.strokeStyle = c.fillStyle; c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 4; (ICON[ic] || ICON.more)(c, cx, cy0, r); c.restore();
          if(ICON[ic] && ICON[ic].label){ c.font = `600 ${2.6 * u}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "top"; c.fillStyle = "rgba(255,255,255,.9)"; c.fillText(ICON[ic].label, cx, cy0 + r * 1.2); } }); }
      if(b.caption){ c.textAlign = "left"; c.textBaseline = "top"; b.caption.forEach((t, i) => { c.font = `${i ? 500 : 700} ${(i ? 3.2 : 3.6) * u}px system-ui, sans-serif`; c.fillStyle = "rgba(255,255,255,.92)"; c.fillText(t, x + 4 * u, y + 2 * u + i * 5 * u); }); }
      if(b.nav){ c.fillStyle = "rgba(0,0,0,.85)"; c.fillRect(x, y, bw, bh); c.fillStyle = "rgba(255,255,255,.85)"; for(let i = 0; i < b.nav; i++){ const nx = x + bw * (i + 0.5) / b.nav, ny = y + bh / 2; if(i === 2){ c.beginPath(); c.roundRect ? c.roundRect(nx - 4 * u, ny - 2.4 * u, 8 * u, 4.8 * u, 1.2 * u) : c.rect(nx - 4 * u, ny - 2.4 * u, 8 * u, 4.8 * u); c.fill(); } else { c.beginPath(); c.arc(nx, ny, 1.8 * u, 0, Math.PI * 2); c.fill(); } } }
      if(b.story){ for(let i = 0; i < 4; i++){ c.fillStyle = i ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.95)"; c.fillRect(3 * u + i * (w - 6 * u) / 4, 2 * u, (w - 6 * u) / 4 - u, 0.6 * u); }
        c.beginPath(); c.arc(7 * u, 7 * u, 3 * u, 0, Math.PI * 2); c.fill(); c.font = `700 ${3.4 * u}px system-ui, sans-serif`; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("artist  2h", 12 * u, 7 * u); }
      if(b.reply){ c.strokeStyle = "rgba(255,255,255,.8)"; c.lineWidth = 2; c.beginPath(); c.roundRect ? c.roundRect(4 * u, y + bh * 0.25, w * 0.68, bh * 0.5, bh * 0.25) : c.rect(4 * u, y + bh * 0.25, w * 0.68, bh * 0.5); c.stroke();
        c.font = `500 ${3.2 * u}px system-ui, sans-serif`; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText("Send message", 8 * u, y + bh / 2); ICON.heart(c, w * 0.8, y + bh / 2, 2.4 * u); ICON.share(c, w * 0.91, y + bh / 2, 2.4 * u); }
      if(b.feed){ c.beginPath(); c.arc(w - 5 * u, y + bh - 5 * u, 2.6 * u, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(5 * u, y + bh - 5 * u, 2.6 * u, 0, Math.PI * 2); c.fill(); }
      if(b.player){ c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(3 * u, y + bh * 0.35, w - 6 * u, 0.8 * u); c.fillStyle = "#ff0033"; c.fillRect(3 * u, y + bh * 0.35, (w - 6 * u) * 0.3, 0.8 * u);
        c.fillStyle = "rgba(255,255,255,.9)"; for(let i = 0; i < 4; i++){ c.beginPath(); c.arc(6 * u + i * 7 * u, y + bh * 0.7, 1.8 * u, 0, Math.PI * 2); c.fill(); } }
    }
    // the clear area
    const [sx, sy, sw, sh] = R(p.safe);
    c.save(); c.setLineDash([6, 5]); c.strokeStyle = "rgba(112,136,255,.95)"; c.lineWidth = 1.5; c.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1); c.restore();
    c.font = `600 ${2.6 * u}px system-ui, sans-serif`; c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = "rgba(112,136,255,.95)"; c.fillText("Safe for lyrics", sx + 1.5 * u, sy + 1.2 * u);
    // are the lyrics inside it? (centre of the lyric block, from the style position)
    const st = S.P.style, ly = cy(1, st), lx = st.x ?? 0.5, halfH = 0.06 * (st.size || 1);
    const out = ly - halfH < p.safe[1] || ly + halfH > p.safe[1] + p.safe[3] || lx < p.safe[0] + 0.1 || lx > p.safe[0] + p.safe[2] - 0.1;
    if(out){ warn.hidden = false; warn.querySelector("span").textContent = `The lyrics sit under ${p.name}'s interface here.`;
      warn.querySelector("button").onclick = () => { const mid = p.safe[1] + p.safe[3] / 2; st.y = clamp((mid - 0.18) / 0.64, 0, 1); st.x = clamp(Math.max(p.safe[0] + 0.12, Math.min(p.safe[0] + p.safe[2] - 0.12, lx)), 0, 1); syncUI(); saveDraft(); last = ""; }; }
  }
  (function frame(){ try { draw(); } catch(err){ if(!frame.w){ frame.w = 1; console.error(err); } } requestAnimationFrame(frame); })();
  paintSwitch();
  return { platforms: P };
})();

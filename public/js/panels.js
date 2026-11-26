/* Resizable editor panels (desktop only): left menu | stage (and a right rack, if the page has one), and stage | timeline.
   Sizes live in CSS vars --left-w, --right-w, --tl-h on <html>; unset means the stylesheet default. */
(function(){
  const KEY = "sls-panels", ROOT = document.documentElement, B = document.body;
  const MQ = window.matchMedia("(max-width:1050px) and (pointer:coarse), (max-width:760px)");
  const MIN_SIDE = 320, MIN_STAGE_W = 280, MIN_STAGE_H = 220, MIN_TL = 140, STEP = 16;
  const $ = s => document.querySelector(s);
  const main = $(".main"), side = $(".main > .side:not(.rack)"), rack = $(".main > .rack"), tline = $(".timeline");
  if(!main || !side || !tline) return;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch(e){}
  const val = {}; // user-chosen sizes (px), only the keys that were set
  for(const k of rack ? ["l","r","t"] : ["l","t"]) if(Number.isFinite(saved[k])) val[k] = saved[k];
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(val)); } catch(e){} };
  const active = () => !MQ.matches && B.dataset.step === "design" && !B.classList.contains("stage-full");
  const tlOpen = () => B.dataset.tl === "open";

  const mk = (cls, orient, label) => { const h = document.createElement("div"); h.className = "pn-h " + cls; h.setAttribute("role", "separator"); h.setAttribute("aria-orientation", orient); h.setAttribute("aria-label", label); h.tabIndex = 0; h.hidden = true; h.title = "Drag to resize. Double-click to reset."; B.appendChild(h); return h; };
  const hL = mk("pn-v", "vertical", "Resize left panel"), hR = mk("pn-v", "vertical", "Resize right panel"), hT = mk("pn-t", "horizontal", "Resize timeline");

  const W = () => main.getBoundingClientRect().width;
  const bounds = {
    l: () => [MIN_SIDE, Math.max(MIN_SIDE, Math.min(innerWidth * .45, W() - (rack ? rack.getBoundingClientRect().width : 0) - MIN_STAGE_W))],
    r: () => [MIN_SIDE, Math.max(MIN_SIDE, Math.min(innerWidth * .45, W() - side.getBoundingClientRect().width - MIN_STAGE_W))],
    t: () => { const room = tline.getBoundingClientRect().height + main.getBoundingClientRect().height - MIN_STAGE_H;
      const cs = getComputedStyle(tline), nat = [...tline.children].reduce((n, c) => n + c.getBoundingClientRect().height, 0) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      return [MIN_TL, Math.max(MIN_TL, Math.min(innerHeight * .7, room, Math.ceil(nat)))]; }
  };
  const cur = { l: () => side.getBoundingClientRect().width, r: () => rack ? rack.getBoundingClientRect().width : 0, t: () => tline.getBoundingClientRect().height };
  const prop = { l: "--left-w", r: "--right-w", t: "--tl-h" };
  const clampTo = (k, v) => { const [a, b] = bounds[k](); return Math.round(Math.min(b, Math.max(a, v))); };
  function apply(k, v){ // v null = default
    if(v == null){ ROOT.style.removeProperty(prop[k]); } else ROOT.style.setProperty(prop[k], v + "px");
    if(k === "t") ROOT.classList.toggle("pn-tl", v != null);
    refresh();
  }
  function applyAll(){
    ROOT.classList.toggle("pn-on", active());
    if(!active()){ for(const k in prop) ROOT.style.removeProperty(prop[k]); ROOT.classList.remove("pn-tl"); return; }
    // sides first (the other side's width bounds this one), then timeline
    for(const k of ["l","r"]) if(val[k] != null){ ROOT.style.setProperty(prop[k], val[k] + "px"); ROOT.style.setProperty(prop[k], clampTo(k, val[k]) + "px"); }
    if(val.t != null && tlOpen()){ ROOT.style.setProperty(prop.t, val.t + "px"); ROOT.classList.add("pn-tl"); ROOT.style.setProperty(prop.t, clampTo("t", val.t) + "px"); }
    else { ROOT.style.removeProperty(prop.t); ROOT.classList.remove("pn-tl"); }
  }
  function place(){
    const on = active();
    hL.hidden = !on; hR.hidden = !(on && rack); hT.hidden = !(on && tlOpen());
    if(!on) return;
    const m = main.getBoundingClientRect(), l = side.getBoundingClientRect(), r = rack ? rack.getBoundingClientRect() : null, t = tline.getBoundingClientRect();
    const v = (h, x) => { h.style.left = x - 4 + "px"; h.style.top = m.top + "px"; h.style.height = m.height + "px"; };
    v(hL, l.right); if(r) v(hR, r.left);
    if(!hT.hidden){ hT.style.top = t.top - 4 + "px"; hT.style.left = "0px"; hT.style.width = innerWidth + "px"; }
    for(const [h, k] of [[hL,"l"],[hR,"r"],[hT,"t"]]){ if(h.hidden) continue; const [a, b] = bounds[k](); h.setAttribute("aria-valuemin", Math.round(a)); h.setAttribute("aria-valuemax", Math.round(b)); h.setAttribute("aria-valuenow", Math.round(cur[k]())); }
  }
  function refresh(){ place(); tlDirty_(); }
  function tlDirty_(){ try { if(typeof fitStage === "function") fitStage(); if(typeof sizeTimeline === "function") sizeTimeline(); } catch(e){} }
  let raf = 0; const sched = () => { if(!raf) raf = requestAnimationFrame(() => { raf = 0; applyAll(); place(); }); };

  function setup(h, k, sign){
    let start = null;
    h.addEventListener("pointerdown", e => {
      if(e.button !== 0) return; e.preventDefault();
      start = { p: k === "t" ? e.clientY : e.clientX, v: cur[k]() };
      h.setPointerCapture(e.pointerId); h.classList.add("drag"); B.classList.add("pn-drag"); B.dataset.pnDir = k === "t" ? "row" : "col";
    });
    h.addEventListener("pointermove", e => {
      if(!start) return;
      const d = (k === "t" ? e.clientY : e.clientX) - start.p;
      val[k] = clampTo(k, start.v + sign * d); apply(k, val[k]);
    });
    const end = e => { if(!start) return; start = null; h.classList.remove("drag"); B.classList.remove("pn-drag"); delete B.dataset.pnDir; try { h.releasePointerCapture(e.pointerId); } catch(_){} persist(); };
    h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
    h.addEventListener("dblclick", () => { delete val[k]; apply(k, null); persist(); });
    h.addEventListener("keydown", e => {
      const keys = k === "t" ? { ArrowUp: 1, ArrowDown: -1 } : { ArrowRight: sign, ArrowLeft: -sign };
      let nv;
      if(e.key in keys) nv = cur[k]() + keys[e.key] * STEP * (e.shiftKey ? 3 : 1) * (k === "t" ? 1 : sign);
      else if(e.key === "Home") nv = bounds[k]()[0]; else if(e.key === "End") nv = bounds[k]()[1];
      else if(e.key === "Enter" || e.key === "Escape" && false){ delete val[k]; apply(k, null); persist(); e.preventDefault(); return; }
      else return;
      e.preventDefault(); val[k] = clampTo(k, nv); apply(k, val[k]); persist();
    });
  }
  setup(hL, "l", 1); setup(hR, "r", -1); setup(hT, "t", -1);

  addEventListener("resize", sched);
  MQ.addEventListener?.("change", sched);
  new MutationObserver(sched).observe(B, { attributes: true, attributeFilter: ["data-step", "data-tl", "class"] });
  if(window.ResizeObserver){ const ro = new ResizeObserver(() => place()); ro.observe(main); ro.observe(tline); }
  sched(); setTimeout(sched, 600);
})();

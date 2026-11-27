/* Hover tips. The studio shows just the titles of things; anything with data-tip="..." shows its explanation
   in a small bubble when you hover over it (or reach it with the keyboard). Touch screens don't get hover, so
   there each titled thing gets a small round "i" after it: tap it to see the explanation, tap anywhere to close. */
(function(){
  "use strict";
  let bub = null, cur = null, timer = 0;
  const touchy = !!(window.matchMedia && matchMedia("(hover:none) and (pointer:coarse)").matches);   // a phone or tablet
  function bubble(){ if(!bub){ bub = document.createElement("div"); bub.className = "tipbub"; bub.setAttribute("role", "tooltip"); bub.hidden = true; document.body.appendChild(bub); } return bub; }
  function show(el){
    const b = bubble(), text = el.dataset.tip; if(!text || !el.isConnected) return;
    b.textContent = touchy ? text.replace(/\bClick\b/g, "Tap").replace(/\bclick\b/g, "tap").replace(/\bclicks\b/g, "taps") : text; b.hidden = false;
    const r = el.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    let y = r.top - h - 8; if(y < 8) y = r.bottom + 8;
    b.style.left = x + "px"; b.style.top = y + "px";
  }
  function hide(){ clearTimeout(timer); cur = null; if(bub) bub.hidden = true; }
  const tipOf = t => (t && t.closest) ? t.closest("[data-tip]") : null;
  addEventListener("pointerover", e => {
    if(e.pointerType === "touch") return;
    const el = tipOf(e.target); if(el === cur) return;
    hide(); if(!el) return;
    cur = el; timer = setTimeout(() => { if(cur === el) show(el); }, 250);
  });
  addEventListener("pointerdown", hide, true);
  addEventListener("scroll", hide, true);
  addEventListener("blur", hide);
  addEventListener("keydown", e => { if(e.key === "Escape") hide(); }, true);
  addEventListener("focusin", e => { const el = tipOf(e.target); if(el && e.target.matches(":focus-visible")){ cur = el; show(el); } });
  addEventListener("focusout", hide);

  /* ---------- touch screens: the "i" buttons ---------- */
  const touch = window.matchMedia && matchMedia("(hover:none) and (pointer:coarse)");
  if(!touch || !touch.matches) return;
  document.documentElement.classList.add("tips-touch");
  // the toolbar buttons have their own short labels, and form fields take taps themselves
  const OWN = "button,input,select,textarea,a,.tlt";
  function mark(){
    document.querySelectorAll("[data-tip]").forEach(el => {
      if(el.matches(OWN) || el.closest("button")) return;
      const last = el.lastElementChild;
      if(last && last.classList.contains("tipi")) return;
      el.querySelectorAll(":scope > .tipi").forEach(x => x.remove());   // text was rewritten in front of an old one
      const b = document.createElement("button");   // no text inside, so el.textContent stays the title alone
      b.type = "button"; b.className = "tipi"; b.setAttribute("aria-label", "What's this?");
      el.appendChild(b);
    });
  }
  let queued = false;
  const later = () => { if(queued) return; queued = true; requestAnimationFrame(() => { queued = false; mo.disconnect(); mark(); watch(); }); };
  // only changes that can matter: a tip added or changed, or a titled thing's text rewritten (the play clock changes
  // every frame and isn't one of them)
  const matters = m => m.type === "attributes" || (m.target.closest && m.target.closest("[data-tip]")) ||
    [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches("[data-tip]") || n.querySelector("[data-tip]")));
  const mo = new MutationObserver(ms => { if(ms.some(matters)) later(); }), watch = () => mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tip"] });
  mark(); watch();
  let open = null;
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".tipi");
    if(!b) { open = null; return; }
    e.preventDefault(); e.stopPropagation();   // a tap on the "i" never opens or toggles what it sits in
    const el = b.parentElement;
    if(open === el){ hide(); open = null; return; }
    cur = el; show(el); open = el;
  }, true);
})();

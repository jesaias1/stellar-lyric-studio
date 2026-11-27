/* Hover tips. The studio shows just the titles of things; anything with data-tip="..." shows its explanation
   in a small bubble when you hover over it (or reach it with the keyboard). Touch screens don't get hover, so
   nothing changes there. */
(function(){
  "use strict";
  let bub = null, cur = null, timer = 0;
  function bubble(){ if(!bub){ bub = document.createElement("div"); bub.className = "tipbub"; bub.setAttribute("role", "tooltip"); bub.hidden = true; document.body.appendChild(bub); } return bub; }
  function show(el){
    const b = bubble(), text = el.dataset.tip; if(!text || !el.isConnected) return;
    b.textContent = text; b.hidden = false;
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
})();

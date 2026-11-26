/* The tutorial video on the front page (about 1 minute).
   Nothing is downloaded until someone opens it (the video's src is set on open), and closing it stops playback.
   Opens from the "Watch how it works" button, the "tutorial" link in the top bar, the login screen, or a link to /#tutorial. */
(() => {
  const $t = s => document.querySelector(s);
  const box = $t("#tutModal"), video = $t("#tutVideo");
  if(!box || !video) return;
  // a wide video for computers, a tall one (made for phones) on phones and narrow upright screens
  const WIDE = { src: "media/tutorial.mp4?v=6", poster: "media/tutorial-poster.jpg?v=6", w: 1280, h: 720 };
  const TALL = { src: "media/tutorial-phone.mp4?v=3", poster: "media/tutorial-phone-poster.jpg?v=3", w: 720, h: 1280 };
  const PHONE = matchMedia("(max-width: 640px), (orientation: portrait) and (max-width: 900px)");
  const frame = box.querySelector(".tut-box");
  let opener = null;

  function open(){
    if(!box.hidden) return;
    opener = document.activeElement;
    const v = PHONE.matches ? TALL : WIDE;
    if(video.getAttribute("src") !== v.src){ video.poster = v.poster; video.src = v.src; video.width = v.w; video.height = v.h; }
    if(frame) frame.classList.toggle("tall", v === TALL);
    box.hidden = false;
    document.documentElement.classList.add("tut-on");
    try { video.currentTime = 0; } catch {}
    const p = video.play(); if(p && p.catch) p.catch(() => {});   // a blocked autoplay just leaves the play button
    $t("#tutClose").focus({ preventScroll: true });
  }
  function close(){
    if(box.hidden) return;
    video.pause();
    box.hidden = true;
    document.documentElement.classList.remove("tut-on");
    if(location.hash === "#tutorial") history.replaceState(null, "", location.pathname + location.search);
    if(opener && opener.focus) opener.focus({ preventScroll: true });
  }

  const btn = $t("#tutBtn"); if(btn) btn.onclick = open;
  const nav = $t("#navTutorial"); if(nav) nav.onclick = e => { e.preventDefault(); open(); };
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-tut-open]"); if(b){ e.preventDefault(); open(); } });
  $t("#tutClose").onclick = close;
  box.addEventListener("click", e => { if(e.target === box) close(); });
  document.addEventListener("keydown", e => { if(e.key === "Escape" && !box.hidden){ e.stopPropagation(); close(); } }, true);
  video.addEventListener("ended", () => { try { if(document.fullscreenElement) document.exitFullscreen(); } catch {} });
  if(location.hash === "#tutorial") setTimeout(open, 400);
  window.addEventListener("hashchange", () => { if(location.hash === "#tutorial") open(); });
  window.SLSTutorial = { open, close };
})();

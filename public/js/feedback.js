"use strict";
/* Feedback for the internal demo round (Ana's form): the red Feedback button on the landing page, and the same
   form right after an export, while the video is fresh. Answers go to /api/feedback (src/feedback.js), which adds
   one row to Ana's Google Sheet. Anonymous: the form sends no username or email.
   Filled in by the studio: where it was opened (button or after export), the lyric template, the song, the version.
   If the Sheet can't be reached (or isn't connected yet), the answers stay in this browser and are sent later.
   window.SLSFeedback = { open(source) } */
window.SLSFeedback = (() => {
  const QKEY = "sls-fb-queue", SEEN = "sls-fb-asked";
  const store = { get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const RATE = [
    ["ease", "How easy was it to make a lyric video?", "Couldn't finish", "Super easy"],
    ["quality", "How happy are you with the final video?", "Wouldn't post it", "Would post it as is"],
    ["again", "How likely are you to use SLS for your next campaign?", "Never", "Definitely"],
  ];
  const WRITE = [
    ["confusing", "Was anything confusing or hard to find?"],
    ["broke", "Did anything break or not work?"],
    ["change", "What's one thing we should add or change?"],
    ["other", "Any other feedback?"],
  ];
  const m = document.createElement("div"); m.className = "modal fb-modal"; m.id = "fbModal"; m.hidden = true;
  m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="fbTitle">
    <div class="ph-head"><h2 id="fbTitle">Feedback</h2><button class="btn small ghost" type="button" data-fb="x" aria-label="Close">✕</button></div>
    <form id="fbForm" novalidate>
      <p class="fb-intro">Please fill this out! It would be super helpful for the team and help make your dreams come true #livelaughlovefeedback</p>
      ${RATE.map(([k, q, lo, hi], i) => `<fieldset class="fb-q" data-k="${k}"><legend>${i + 1}. ${q}</legend>
        <div class="fb-scale" role="radiogroup" aria-label="${q}">${[0, 1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="false" aria-pressed="false" data-v="${n}">${n}</button>`).join("")}</div>
        <div class="fb-ends"><span>0 = ${lo}</span><span>5 = ${hi}</span></div></fieldset>`).join("")}
      ${WRITE.map(([k, q], i) => `<label class="fb-q"><span>${i + 4}. ${q} <span class="fb-opt">optional</span></span><textarea data-k="${k}" rows="2" maxlength="2000"></textarea></label>`).join("")}
      <div class="fb-acts"><button class="btn primary" type="submit" id="fbSend">Send feedback</button><span class="fb-msg" id="fbMsg" role="status"></span></div>
    </form>
    <div class="fb-done" id="fbDone" hidden><b>Thank you!</b><p class="fb-intro" id="fbDoneNote">Your feedback is in. It goes straight to the team.</p><button class="btn" type="button" data-fb="x">Close</button></div>
  </div>`;
  document.body.append(m);
  const $m = s => m.querySelector(s);
  let source = "button", answers = {}, sending = false, id = "";
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function context(){
    const song = typeof S !== "undefined" && S.songName && S.songName !== "Demo track" ? String(S.songName) : "";
    let template = ""; try { if(typeof S !== "undefined" && song) template = styleDef(S.P.style.preset).name; } catch {}
    const version = (document.querySelector('meta[name="sls-build"]') || {}).content || "";
    return { template, song, version };
  }
  function open(src = "button"){
    source = src === "export" ? "export" : "button"; answers = {}; id = newId(); sending = false;
    m.querySelectorAll(".fb-scale button").forEach(b => { b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-checked", "false"); });
    m.querySelectorAll("textarea").forEach(t => t.value = "");
    $m("#fbForm").hidden = false; $m("#fbDone").hidden = true; msg("");
    $m("#fbSend").disabled = false; $m("#fbSend").textContent = "Send feedback";
    m.hidden = false; store.set(SEEN, Date.now());
    setTimeout(() => { const f = $m(".fb-scale button"); if(f) f.focus({ preventScroll: true }); }, 40);
  }
  const close = () => { if(!sending) m.hidden = true; };
  const msg = (t, bad) => { const e = $m("#fbMsg"); e.textContent = t || ""; e.classList.toggle("bad", !!bad); };

  m.addEventListener("click", e => {
    if(e.target === m || e.target.closest('[data-fb="x"]')){ close(); return; }
    const b = e.target.closest(".fb-scale button"); if(!b) return;
    const q = b.closest(".fb-q"); answers[q.dataset.k] = +b.dataset.v;
    q.querySelectorAll("button").forEach(x => { const on = x === b; x.setAttribute("aria-pressed", String(on)); x.setAttribute("aria-checked", String(on)); });
    msg("");
  });
  addEventListener("keydown", e => { if(e.key === "Escape" && !m.hidden) close(); });

  // send one set of answers; false when it has to wait (kept in this browser)
  async function send(body){
    try { await SLSBackend.api("/api/feedback", { method: "POST", body, timeout: 20000 }); return true; }
    catch(err){ if(err && (err.status === 400)) throw err; return false; }
  }
  function keep(body){ const q = store.get(QKEY, []).filter(x => x.id !== body.id); q.push(body); store.set(QKEY, q.slice(-20)); }
  async function flush(){
    const q = store.get(QKEY, []); if(!q.length) return;
    const left = [];
    for(const b of q){ let ok = false; try { ok = await send(b); } catch { ok = true; } if(!ok) left.push(b); }   // a 400 won't get better: dropped
    store.set(QKEY, left);
  }

  $m("#fbForm").onsubmit = async e => {
    e.preventDefault(); if(sending) return;
    const missing = RATE.filter(([k]) => answers[k] == null);
    if(missing.length){ const n = missing.map(([k]) => RATE.findIndex(r => r[0] === k) + 1), list = n.length > 1 ? n.slice(0, -1).join(", ") + " and " + n[n.length - 1] : n[0];
      msg(`Pick a number from 0 to 5 for question${n.length > 1 ? "s" : ""} ${list}.`, true); m.querySelector(`.fb-q[data-k="${missing[0][0]}"] button`).focus(); return; }
    const body = { id, source, ...context(), ...answers };
    m.querySelectorAll("textarea").forEach(t => body[t.dataset.k] = t.value.trim());
    sending = true; const btn = $m("#fbSend"); btn.disabled = true; btn.textContent = "Sending…"; msg("");
    let ok = false;
    try { ok = await send(body); } catch(err){ sending = false; btn.disabled = false; btn.textContent = "Send feedback"; msg((err && err.message) || "That didn't work. Try again.", true); return; }
    if(!ok) keep(body);   // the Sheet isn't reachable right now: kept and sent next time the studio opens
    sending = false;
    $m("#fbForm").hidden = true; $m("#fbDone").hidden = false;
    $m("#fbDoneNote").textContent = ok ? "Your feedback is in. It goes straight to the team." : "Your feedback is saved and will be sent to the team automatically.";
    setTimeout(() => { const c = $m('#fbDone [data-fb="x"]'); if(c) c.focus({ preventScroll: true }); }, 40);
  };

  // the landing page's red button, and any "Give feedback" button
  const btn = document.getElementById("fbBtn"); if(btn) btn.onclick = () => open("button");
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-fb-open]"); if(b){ e.preventDefault(); open(b.dataset.fbOpen); } });
  // after an export: the invitation under the video, and the form itself the first time in a session
  addEventListener("sls-exported", () => {
    const card = document.getElementById("exFb"); if(card) card.hidden = false;
    let asked = false; try { asked = sessionStorage.getItem("sls-fb-auto") === "1"; sessionStorage.setItem("sls-fb-auto", "1"); } catch {}
    if(!asked) setTimeout(() => { if(m.hidden) open("export"); }, 1200);
  });
  // anything that waited for the Sheet goes out once the studio is open (logged in)
  setTimeout(() => { if(window.SLSAuth && SLSAuth.ready) SLSAuth.ready.then(() => flush()).catch(() => {}); else flush(); }, 4000);
  return { open, flush };
})();

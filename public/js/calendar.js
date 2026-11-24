"use strict";
/* The calendar: every post you planned or sent, by day. Opens as a full-screen page over the studio.
   Rows come from the `posts` table in the user's account (SLSAuth.rest); the studio server posts the due ones
   and fills in the results. Here you can see, move, cancel and retry them. window.SLSCalendar = { open(dateISO?), close() } */
const clockOf = t => { t = Math.max(0, +t || 0); const m = Math.floor(t / 60); return m + ":" + String(Math.floor(t - m * 60)).padStart(2, "0"); };
window.SLSCalendar = (() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PN = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const STATUS = { scheduled: "Scheduled", posting: "Posting now…", working: "Posting now…", posted: "Posted", failed: "Didn't post", cancelled: "Cancelled" };
  const p2 = n => String(n).padStart(2, "0");
  const dayKey = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const hhmm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const toLocalInput = d => `${dayKey(d)}T${hhmm(d)}`;
  const longWhen = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${hhmm(d)}`;
  const shortDay = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  const num = n => Number(n).toLocaleString("en-GB");
  const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); if(isNaN(m)) return ""; if(m < 1) return "just now"; if(m < 60) return `${m} min ago`; const h = Math.round(m / 60); if(h < 48) return `${h} h ago`; return `${Math.round(h / 24)} days ago`; };
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
  const who = r => r.artist || r.account_name || "";

  const MARK = {
    scheduled: `<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
    posting: `<i class="cal-spin" aria-hidden="true"></i>`,
    posted: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6.5 2.4 2.4L9.6 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    failed: `<b aria-hidden="true">!</b>`,
    cancelled: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  };
  const mark = s => `<span class="cal-st st-${s === "working" ? "posting" : s}" title="${esc(STATUS[s] || s)}">${MARK[s === "working" ? "posting" : s] || ""}</span>`;
  const dot = p => `<i class="cal-pl p-${esc(p)}" title="${esc(PN[p] || p)}" aria-hidden="true"></i>`;

  /* ---------- the page ---------- */
  const root = document.createElement("div");
  root.className = "cal"; root.id = "calRoot"; root.hidden = true;
  root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-labelledby", "calTitle");
  root.innerHTML = `
    <header class="cal-head">
      <h2 id="calTitle">Calendar</h2>
      <div class="cal-nav">
        <button class="icon-btn" type="button" data-cal="prev" aria-label="Previous month">‹</button>
        <b class="cal-month" id="calMonth" aria-live="polite"></b>
        <button class="icon-btn" type="button" data-cal="next" aria-label="Next month">›</button>
        <button class="btn small" type="button" data-cal="today">Today</button>
      </div>
      <select id="calFilter" aria-label="Show posts for"><option value="">All artists</option></select>
      <button class="icon-btn cal-x" type="button" data-cal="close" aria-label="Close the calendar">✕</button>
    </header>
    <div class="cal-state" id="calState" role="status"></div>
    <div class="cal-body" id="calBody">
      <section class="cal-main" aria-label="Month">
        <div class="cal-wk" aria-hidden="true">${WEEK.map(w => `<span>${w}</span>`).join("")}</div>
        <div class="cal-grid" id="calGrid"></div>
      </section>
      <div class="cal-side">
        <section class="cal-day" id="calDay" aria-live="polite"></section>
        <section class="cal-up" id="calUp" aria-label="Coming up"></section>
      </div>
    </div>
    <div class="cal-scrim" id="calScrim" hidden></div>
    <aside class="cal-detail" id="calDetail" role="dialog" aria-modal="false" aria-labelledby="calDetT" hidden></aside>`;
  document.body.append(root);
  const $c = s => root.querySelector(s);

  let view = null, posts = [], upcoming = [], filter = "", selDay = "", openId = "", editing = false, busy = false;
  let isOpen = false, opener = null, loadTok = 0, timer = null, err = "", loading = false, loadedOnce = false;
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const gridStart = v => { const f = new Date(v.y, v.m, 1), dow = (f.getDay() + 6) % 7; return new Date(v.y, v.m, 1 - dow); };
  const weeksIn = v => Math.ceil((((new Date(v.y, v.m, 1).getDay() + 6) % 7) + new Date(v.y, v.m + 1, 0).getDate()) / 7);
  const known = id => posts.find(r => r.id === id) || upcoming.find(r => r.id === id);

  /* ---------- loading ---------- */
  async function load(quiet){
    if(!window.SLSAuth || SLSAuth.mode !== "accounts"){ paint(); return; }
    const tok = ++loadTok, from = gridStart(view), to = new Date(from); to.setDate(to.getDate() + weeksIn(view) * 7);
    if(!quiet){ loading = true; err = ""; paintState(); }
    try {
      const [a, b] = await Promise.all([
        SLSAuth.rest("posts?select=*&publish_at=gte." + encodeURIComponent(from.toISOString()) + "&publish_at=lt." + encodeURIComponent(to.toISOString()) + "&order=publish_at.asc"),
        SLSAuth.rest("posts?select=*&status=eq.scheduled&order=publish_at.asc&limit=10")]);
      if(tok !== loadTok) return;
      posts = Array.isArray(a) ? a : []; upcoming = Array.isArray(b) ? b : []; err = ""; loadedOnce = true;
    } catch(e){ if(tok !== loadTok) return; if(!quiet || !loadedOnce) err = (e && e.message) || "The calendar couldn't be loaded."; }
    loading = false; paint();
  }

  /* ---------- painting ---------- */
  const visible = rows => filter ? rows.filter(r => who(r) === filter) : rows;
  function paintState(){
    const s = $c("#calState");
    if(SLSAuth.mode !== "accounts") s.innerHTML = "";
    else if(err) s.innerHTML = `<span>${esc(err)}</span> <button class="btn small" type="button" data-cal="retry">Try again</button>`;
    else if(loading && !loadedOnce) s.textContent = "Loading…";
    else if(loadedOnce && !visible(posts).length) s.textContent = "Nothing planned this month";
    else s.textContent = "";
    s.hidden = !s.textContent && !s.innerHTML;
    s.classList.toggle("bad", !!err);
  }
  function paint(){
    const login = !window.SLSAuth || SLSAuth.mode !== "accounts";
    $c("#calBody").hidden = login; $c(".cal-head .cal-nav").hidden = login; $c("#calFilter").hidden = login;
    if(login){ const s = $c("#calState"); s.hidden = false; s.classList.remove("bad"); s.textContent = "The calendar needs a login"; $c("#calMonth").textContent = ""; closeDetail(true); return; }
    $c("#calMonth").textContent = `${MONTHS[view.m]} ${view.y}`;
    // artist filter: everyone seen in the loaded posts
    const names = [...new Set([...posts, ...upcoming].map(who).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if(filter && !names.includes(filter)) names.push(filter);
    const sel = $c("#calFilter"), want = `<option value="">All artists</option>` + names.map(n => `<option value="${esc(n)}"${n === filter ? " selected" : ""}>${esc(n)}</option>`).join("");
    if(sel.dataset.sig !== want){ sel.innerHTML = want; sel.dataset.sig = want; } sel.value = filter;
    paintState(); paintGrid(); paintSide();
    if(openId) paintDetail();
  }
  function paintGrid(){
    const start = gridStart(view), weeks = weeksIn(view), t0 = today(), byDay = new Map();
    for(const r of visible(posts)){ const k = dayKey(new Date(r.publish_at)); (byDay.get(k) || byDay.set(k, []).get(k)).push(r); }
    let h = "";
    for(let i = 0; i < weeks * 7; i++){
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = dayKey(d), rows = byDay.get(k) || [];
      const cls = ["cal-cell", d.getMonth() !== view.m && "out", +d === +t0 && "today", d < t0 && "past", k === selDay && "sel"].filter(Boolean).join(" ");
      h += `<div class="${cls}" role="group" aria-label="${esc(shortDay(d))}, ${rows.length} post${rows.length === 1 ? "" : "s"}">
        <button class="cal-dn" type="button" data-day="${k}"${+d === +t0 ? ` aria-current="date"` : ""}>${d.getDate()}</button>
        <div class="cal-chips">${rows.slice(0, 3).map(chip).join("")}${rows.length > 3 ? `<button class="cal-more" type="button" data-day="${k}">+${rows.length - 3} more</button>` : ""}</div>
        ${rows.length ? `<button class="cal-dots" type="button" data-day="${k}" aria-label="Show the ${rows.length} post${rows.length === 1 ? "" : "s"} on ${esc(shortDay(d))}">${rows.slice(0, 4).map(r => `<i class="cal-pl p-${esc(r.platform)} st-${esc(r.status)}"></i>`).join("")}${rows.length > 4 ? `<em>+${rows.length - 4}</em>` : ""}</button>` : ""}
      </div>`;
    }
    $c("#calGrid").innerHTML = h; $c("#calGrid").style.setProperty("--weeks", weeks);
  }
  const chip = r => { const d = new Date(r.publish_at); return `<button class="cal-chip st-${esc(r.status)}${r.id === openId ? " on" : ""}" type="button" data-id="${esc(r.id)}" title="${esc(`${hhmm(d)} · ${r.account_name} (${PN[r.platform] || r.platform}) · ${STATUS[r.status] || r.status}`)}">${dot(r.platform)}<span class="cal-t">${hhmm(d)}</span><span class="cal-n">${esc(r.account_name || "")}</span>${mark(r.status)}</button>`; };
  const row = (r, withDate) => { const d = new Date(r.publish_at); return `<button class="cal-row st-${esc(r.status)}${r.id === openId ? " on" : ""}" type="button" data-id="${esc(r.id)}">${dot(r.platform)}
      <span class="cal-rt"><b>${esc(r.project_name || "Untitled")}</b><span>${withDate ? shortDay(d) + " · " : ""}${hhmm(d)} · ${esc(r.account_name || "")}</span></span>${mark(r.status)}<span class="cal-rs">${esc(STATUS[r.status] || r.status)}</span></button>`; };
  function paintSide(){
    const dayBox = $c("#calDay");
    if(selDay){
      const [y, m, dd] = selDay.split("-").map(Number), d = new Date(y, m - 1, dd), rows = visible(posts).filter(r => dayKey(new Date(r.publish_at)) === selDay);
      dayBox.hidden = false;
      dayBox.innerHTML = `<h3>${esc(shortDay(d))}</h3>` + (rows.length ? `<div class="cal-list">${rows.map(r => row(r)).join("")}</div>`
        : `<p class="cal-hint">${d >= today() ? "Nothing planned for this day. Open a project and choose Schedule when posting to add a post here." : "Nothing was posted on this day."}</p>`);
    } else { dayBox.hidden = true; dayBox.innerHTML = ""; }
    const up = visible(upcoming);
    $c("#calUp").innerHTML = `<h3>Coming up</h3>` + (up.length ? `<div class="cal-list">${up.map(r => row(r, true)).join("")}</div>` : `<p class="cal-hint">No scheduled posts yet.</p>`);
  }

  /* ---------- details ---------- */
  function paintDetail(){
    const r = known(openId), box = $c("#calDetail");
    if(!r){ closeDetail(); return; }
    if(editing && !box.hidden && box.dataset.id === r.id && box.dataset.st === r.status && box.dataset.at === r.publish_at) return;   // don't wipe a time being typed
    const d = new Date(r.publish_at), m = r.meta || {}, cap = String(m.caption || "").trim(), st = r.stats && typeof r.stats === "object" ? r.stats : {};
    const stats = [["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"]].filter(([k]) => st[k] != null);
    const url = safeUrl(r.result_url), s = r.status === "working" ? "posting" : r.status;
    let acts = "";
    if(r.status === "scheduled") acts = editing
      ? `<label class="cal-f"><span>New date and time</span><input type="datetime-local" id="calAt" value="${esc(toLocalInput(d))}" min="${esc(toLocalInput(new Date(Date.now() + 10 * 60e3)))}"></label>
         <div class="cal-acts"><button class="btn small primary" type="button" data-act="save">Save</button><button class="btn small ghost" type="button" data-act="keep">Keep the old time</button></div>`
      : `<div class="cal-acts"><button class="btn small" type="button" data-act="edit">Change time</button><button class="btn small" type="button" data-act="now">Post now</button><button class="btn small ghost cal-danger" type="button" data-act="cancel">Cancel post</button></div>`;
    else if(r.status === "failed") acts = r.video_url ? `<div class="cal-acts"><button class="btn small primary" type="button" data-act="retry">Try again</button></div>`
      : `<p class="cal-hint">The video is gone, so this can't be retried. Open the project and post it again.</p>`;
    $c("#calDetail").dataset.id = r.id; $c("#calDetail").dataset.st = r.status; $c("#calDetail").dataset.at = r.publish_at;
    $c("#calDetail").innerHTML = `
      <div class="cal-dh"><button class="icon-btn cal-dback" type="button" data-act="closed" aria-label="Back to the calendar">‹</button><h3 id="calDetT">${esc(r.project_name || "Untitled")}</h3><button class="icon-btn" type="button" data-act="closed" aria-label="Close details">✕</button></div>
      <div class="cal-db">
        <div class="cal-pill st-${esc(s)}">${mark(r.status)}<span>${esc(STATUS[r.status] || r.status)}</span></div>
        <dl class="cal-dl">
          ${r.artist ? `<dt>Artist</dt><dd>${esc(r.artist)}</dd>` : ""}
          <dt>Account</dt><dd>${dot(r.platform)} ${esc(r.account_name || "")} <span class="cal-muted">(${esc(PN[r.platform] || r.platform)})</span></dd>
          <dt>${r.status === "posted" ? "Posted" : "When"}</dt><dd>${esc(longWhen(d))}</dd>
          ${m.title ? `<dt>Title</dt><dd>${esc(String(m.title).slice(0, 120))}</dd>` : ""}
        </dl>
        ${m.clip ? `<div class="cal-cap"><span class="cal-muted">Soundbite</span><p>${esc(clockOf(m.clip.a))} to ${esc(clockOf(m.clip.b))} in the song${m.clip.tiktok ? " · the popular TikTok sound" : ""}</p></div>` : ""}
        ${cap ? `<div class="cal-cap"><span class="cal-muted">Caption</span><p>${esc(cap.slice(0, 300))}${cap.length > 300 ? "…" : ""}</p></div>` : ""}
        ${r.note ? `<p class="cal-note${r.status === "failed" ? " bad" : ""}">${esc(r.note)}</p>` : ""}
        ${r.platform === "tiktok" && m.seed && r.status !== "cancelled" && r.status !== "failed" ? `<div class="cal-cap"><span class="cal-muted">${r.status === "posted" ? "In TikTok, to finish it with the official sound" : "When it lands in TikTok drafts"}</span><ol class="pub-seed">${m.seed.url ? `<li>On the phone, open the <a href="${esc(m.seed.url)}" target="_blank" rel="noopener">${m.seed.popular ? "popular sound" : "official sound"}</a> and tap <b>Add to Favourites</b>. <a class="btn small pub-tt-open" href="${esc(m.seed.url)}" target="_blank" rel="noopener">Open the sound in TikTok</a></li>` : ""}<li>Open TikTok on ${esc(r.account_name || "the account")} and tap the notification to open the draft. <a class="btn small pub-tt-open" href="https://www.tiktok.com/" target="_blank" rel="noopener">Open TikTok</a></li><li>${m.seed.url ? `Tap <b>Sounds</b>, then <b>Favourites</b>, and pick the ${m.seed.popular ? "popular" : "official"} sound.` : `Tap <b>Sounds</b>, search <b>${esc(m.seed.song || r.project_name || "the song")}</b> and pick the official sound.`}</li><li>${m.seed.noTrim ? "Leave the sound untrimmed: it already starts at the right place." : `Trim it to start at <b>${esc(clockOf(m.seed.start))}</b>.`}</li><li>Set <b>Original sound</b> to 0 % under Volume, then post.</li></ol></div>` : ""}
        ${url ? `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Open post</a>` : ""}
        ${stats.length ? `<div class="cal-res"><span class="cal-muted">Results${r.stats_at ? ` · updated ${esc(ago(r.stats_at))}` : ""}</span><div class="cal-stats">${stats.map(([k, l]) => `<div><b>${esc(num(st[k]))}</b><span>${l}</span></div>`).join("")}</div></div>` : ""}
        ${acts}
        <div class="cal-msg" id="calMsg" role="status"></div>
      </div>`;
    const was = box.hidden; box.hidden = false; $c("#calScrim").hidden = false;
    if(was){ requestAnimationFrame(() => box.classList.add("open")); setTimeout(() => { const f = box.querySelector("[data-act='closed']:not(.cal-dback)") || box; f.focus({ preventScroll: true }); }, 30); }
    else box.classList.add("open");
  }
  function openDetail(id){ openId = id; editing = false; paint(); }
  function closeDetail(quiet){
    const box = $c("#calDetail"); const had = openId; openId = ""; editing = false;
    box.classList.remove("open"); box.hidden = true; $c("#calScrim").hidden = true; box.innerHTML = "";
    if(had && !quiet){ paintGrid(); paintSide(); const b = root.querySelector(`[data-id="${CSS.escape(had)}"]`); if(b) b.focus({ preventScroll: true }); }
  }
  const say = t => { const m = $c("#calMsg"); if(m) m.textContent = t; toast(t); };
  function put(rowNew){ [posts, upcoming].forEach(list => { const i = list.findIndex(r => r.id === rowNew.id); if(i >= 0) list[i] = rowNew; }); if(rowNew.status !== "scheduled") upcoming = upcoming.filter(r => r.id !== rowNew.id); }
  async function change(r, from, body, done){
    if(busy) return; busy = true;
    try {
      const out = await SLSAuth.rest(`posts?id=eq.${encodeURIComponent(r.id)}&status=eq.${from}`, { method: "PATCH", body, prefer: "return=representation" });
      if(!Array.isArray(out) || !out.length){ editing = false; toast(from === "scheduled" ? "It already started, so it can't be changed now." : "That post has changed. Refreshed."); busy = false; await load(true); return; }
      put(out[0]); editing = false; if(done) await done(out[0]);
    } catch(e){ toast((e && e.message) || "That didn't work. Try again."); }
    busy = false; paint(); window.dispatchEvent(new Event("sls-posts-changed-cal"));
  }
  async function dropVideo(r){   // the stored video is only deleted when no other account still needs it
    if(!r.video_url) return;
    try {
      const others = await SLSAuth.rest("posts?select=id&status=eq.scheduled&video_url=eq." + encodeURIComponent(r.video_url));
      if(Array.isArray(others) && others.length) return;
      await SLSBackend.api("/api/publish/blob-done", { method: "POST", body: { url: r.video_url }, timeout: 20000 });
    } catch {}
  }
  root.addEventListener("click", async e => {
    const t = e.target, a = t.closest("[data-act]");
    if(a){
      const r = known(openId), k = a.dataset.act; if(k === "closed"){ closeDetail(); return; } if(!r || busy) return;
      if(k === "edit"){ editing = true; $c("#calDetail").dataset.st = ""; paintDetail(); const i = $c("#calAt"); i && i.focus(); }
      else if(k === "keep"){ editing = false; $c("#calDetail").dataset.st = ""; paintDetail(); }
      else if(k === "save"){
        const d = new Date($c("#calAt").value);
        if(isNaN(d) || d < new Date(Date.now() + 9.5 * 60e3)){ const m = $c("#calMsg"); m.textContent = "Pick a time at least 10 minutes from now."; return; }
        await change(r, "scheduled", { publish_at: d.toISOString() }, () => toast(`Moved to ${longWhen(d)}.`));
      }
      else if(k === "now") await change(r, "scheduled", { publish_at: new Date().toISOString() }, () => say("It goes out within 5 minutes."));
      else if(k === "cancel"){
        if(!a.dataset.sure){ a.dataset.sure = "1"; a.textContent = "Really cancel?"; setTimeout(() => { if(a.isConnected){ delete a.dataset.sure; a.textContent = "Cancel post"; } }, 3500); return; }
        await change(r, "scheduled", { status: "cancelled" }, async () => { toast("The post is cancelled."); await dropVideo(r); });
      }
      else if(k === "retry"){
        if(!r.video_url){ say("The video is gone. Open the project and post it again."); return; }
        await change(r, "failed", { status: "scheduled", publish_at: new Date().toISOString() }, () => say("Trying again. It goes out within 5 minutes."));
      }
      return;
    }
    const c = t.closest("[data-cal]");
    if(c){ const k = c.dataset.cal;
      if(k === "close") close(); else if(k === "prev") go(-1); else if(k === "next") go(1);
      else if(k === "today"){ const n = new Date(); view = { y: n.getFullYear(), m: n.getMonth() }; selDay = dayKey(n); load(); paint(); }
      else if(k === "retry") load();
      return; }
    const chipEl = t.closest("[data-id]");
    if(chipEl){ const r = known(chipEl.dataset.id); if(r){ const d = new Date(r.publish_at); selDay = dayKey(d); } openDetail(chipEl.dataset.id); return; }
    const dayEl = t.closest("[data-day]");
    if(dayEl){ selDay = dayEl.dataset.day; closeDetail(true); paint(); const s = $c("#calDay"); if(s && matchMedia("(max-width:760px)").matches) s.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    if(t.closest("#calScrim")) closeDetail();
  });
  $c("#calFilter").onchange = e => { filter = e.target.value; paint(); };
  function go(n){ view = { y: view.y, m: view.m + n }; const d = new Date(view.y, view.m, 1); view = { y: d.getFullYear(), m: d.getMonth() }; selDay = ""; closeDetail(true); posts = []; loadedOnce = false; paint(); load(); }

  /* ---------- open / close ---------- */
  function onKey(e){
    if(e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); if(openId) closeDetail(); else close(); return; }
    if(e.key !== "Tab") return;
    const f = [...root.querySelectorAll("button,select,input,a[href]")].filter(x => !x.disabled && x.offsetParent !== null && !x.closest("[hidden]"));
    if(!f.length) return; const a = f[0], z = f[f.length - 1];
    if(!root.contains(document.activeElement)){ e.preventDefault(); a.focus(); }
    else if(e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); }
    else if(!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); }
  }
  function open(dateISO){
    const d = dateISO ? new Date(dateISO) : new Date(), ok = !isNaN(d), base = ok ? d : new Date();
    opener = document.activeElement; view = { y: base.getFullYear(), m: base.getMonth() }; selDay = ok && dateISO ? dayKey(base) : "";
    if(!isOpen){ posts = []; upcoming = []; err = ""; loadedOnce = false; filter = ""; }
    closeDetail(true); isOpen = true; root.hidden = false; document.body.classList.add("cal-open");
    document.addEventListener("keydown", onKey, true);
    clearInterval(timer); timer = setInterval(() => { if(isOpen && !document.hidden && !busy) load(true); }, 60000);
    paint(); load();
    setTimeout(() => { if(isOpen && !root.contains(document.activeElement)) $c(".cal-x").focus({ preventScroll: true }); }, 40);
  }
  function close(){
    if(!isOpen) return; isOpen = false; closeDetail(true); root.hidden = true; document.body.classList.remove("cal-open");
    document.removeEventListener("keydown", onKey, true); clearInterval(timer); loadTok++;
    if(opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true }); opener = null;
  }
  addEventListener("sls-posts-changed", () => { if(isOpen) load(true); });

  const nav = document.getElementById("navCalendar"); if(nav) nav.onclick = e => { e.preventDefault(); open(); };
  const btn = document.getElementById("calBtn"); if(btn) btn.onclick = () => open();
  return { open, close };
})();

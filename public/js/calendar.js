"use strict";
/* The calendar: every post you planned or sent, by day. Opens as a full-screen page over the studio.
   Rows come from the `posts` table in the user's account (SLSAuth.rest); the studio server posts the due ones
   and fills in the results. Here you can see, move, cancel and retry them.
   The content plan (table content_plan, shared by the team) sits on the same days: video ideas with their project,
   how far along they are and the TikTok link once posted. "Trending sounds" (js/trends.js) opens in the same page.
   window.SLSCalendar = { open(dateISO?), close() } */
const clockOf = t => { t = Math.max(0, +t || 0); const m = Math.floor(t / 60); return m + ":" + String(Math.floor(t - m * 60)).padStart(2, "0"); };
window.SLSCalendar = (() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PN = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const PLAN = { idea: "Idea", making: "Making it", ready: "Ready to post", posted: "Posted" };
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
      <div class="seg cal-who" role="group" aria-label="Whose bookings"><button type="button" data-cal="mine" aria-pressed="true">Mine</button><button type="button" data-cal="team" aria-pressed="false">Team</button></div>
      <button class="btn small cal-trend-btn" type="button" data-cal="trend" aria-pressed="false">Trending sounds</button>
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
        <section class="cal-up cal-res" id="calRes" aria-label="What worked" hidden></section>
      </div>
    </div>
    <section class="cal-trend" id="calTrend" aria-label="Trending sounds" hidden></section>
    <div class="cal-scrim" id="calScrim" hidden></div>
    <aside class="cal-detail" id="calDetail" role="dialog" aria-modal="false" aria-labelledby="calDetT" hidden></aside>`;
  document.body.append(root);
  const $c = s => root.querySelector(s);

  let results = [], resLoaded = false;
  let view = null, posts = [], upcoming = [], filter = "", selDay = "", openId = "", editing = false, busy = false;
  let isOpen = false, opener = null, loadTok = 0, timer = null, err = "", loading = false, loadedOnce = false;
  let plans = [], planNext = [], planMissing = false, planEdit = null, trendOn = false;
  // bookings: periods each person books for an artist ("Ingrid Eikeland until 24 Dec"). Mine = only my own, Team = everyone's
  let books = [], bookNext = [], bookMissing = false, bookEdit = null, whose = (() => { try { return localStorage.getItem("sls-cal-whose") === "team" ? "team" : "mine"; } catch { return "mine"; } })();
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
    await Promise.all([loadPlan(from, to, tok), loadBooks(from, to, tok)]);
    loading = false; paint();
  }
  /* ---------- the content plan ---------- */
  const missingTable = e => e && (e.code === "PGRST205" || e.code === "42P01" || e.status === 404);
  async function loadPlan(from, to, tok){
    try {
      const [a, b] = await Promise.all([
        SLSAuth.rest(`content_plan?select=*&day=gte.${dayKey(from)}&day=lt.${dayKey(to)}&order=day.asc,created_at.asc`),
        SLSAuth.rest(`content_plan?select=*&day=gte.${dayKey(today())}&status=neq.posted&order=day.asc,created_at.asc&limit=8`)]);
      if(tok !== loadTok) return;
      plans = Array.isArray(a) ? a : []; planNext = Array.isArray(b) ? b : []; planMissing = false;
    } catch(e){ if(tok !== loadTok) return; if(missingTable(e)){ planMissing = true; plans = []; planNext = []; } }
  }
  const artistOf = name => { const m = String(name || "").match(/^(.+?)\s+[-–]\s+/); return m ? m[1].trim().slice(0, 120) : ""; };
  const tiktokOk = u => /^https:\/\/([a-z]+\.)?tiktok\.com\/\S+$/i.test(u || "");
  const pDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const planChip = p => `<button class="cal-chip cal-plan pl-${esc(p.status)}${planEdit && planEdit.id === p.id ? " on" : ""}" type="button" data-plan="${esc(p.id)}" title="${esc(`${PLAN[p.status] || p.status}: ${p.title || p.project || "Video"}`)}"><i class="cal-pm" aria-hidden="true"></i><span class="cal-n">${esc(p.title || p.project || "Video")}</span></button>`;
  const planRow = (p, withDate) => `<button class="cal-row cal-plan pl-${esc(p.status)}${planEdit && planEdit.id === p.id ? " on" : ""}" type="button" data-plan="${esc(p.id)}"><i class="cal-pm" aria-hidden="true"></i>
      <span class="cal-rt"><b>${esc(p.title || p.project || "Video")}</b><span>${withDate ? esc(shortDay(pDay(p.day))) + " · " : ""}${esc(p.project && p.title ? p.project : (p.artist || ""))}</span></span><span class="cal-rs">${esc(PLAN[p.status] || p.status)}</span></button>`;
  const planSetup = `<p class="cal-hint">To plan videos here, the content plan needs a one-time setup: in Supabase, open the SQL editor and run the <b>content plan</b> part of supabase/schema.sql.</p>`;
  const planVisible = rows => filter ? rows.filter(p => (p.artist || artistOf(p.project)) === filter) : rows;
  let projNames = [];
  async function editPlan(p){
    planEdit = p; openId = ""; editing = false;
    if(!projNames.length && window.SLSProjects && SLSProjects.names) projNames = (await SLSProjects.names()).slice(0, 40);
    paintPlanForm();
  }
  function paintPlanForm(){
    const p = planEdit, box = $c("#calDetail"); if(!p){ return; }
    box.dataset.id = ""; box.dataset.st = ""; box.dataset.at = "";
    box.innerHTML = `
      <div class="cal-dh"><button class="icon-btn cal-dback" type="button" data-act="plan-close" aria-label="Back to the calendar">‹</button><h3 id="calDetT">${p.id ? "Planned video" : "Plan a video"}</h3><button class="icon-btn" type="button" data-act="plan-close" aria-label="Close">✕</button></div>
      <form class="cal-db cal-pform" id="calPlanForm" autocomplete="off">
        <label class="cal-f"><span>The video</span><input id="cpTitle" maxlength="200" placeholder="e.g. Chorus with the ferris wheel clips" value="${esc(p.title || "")}"></label>
        <label class="cal-f"><span>Project</span><input id="cpProject" maxlength="200" list="cpProjects" placeholder="Artist - Song" value="${esc(p.project || "")}"><datalist id="cpProjects">${projNames.map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist></label>
        <div class="cal-f2">
          <label class="cal-f"><span>Day</span><input type="date" id="cpDay" required value="${esc(p.day || selDay || dayKey(today()))}"></label>
          <label class="cal-f"><span>Status</span><select id="cpStatus">${Object.entries(PLAN).map(([k, l]) => `<option value="${k}"${k === (p.status || "idea") ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <label class="cal-f"><span>TikTok link <em class="cal-muted">once it's posted</em></span><input type="url" id="cpLink" inputmode="url" maxlength="500" placeholder="https://www.tiktok.com/@…" value="${esc(p.tiktok_url || "")}"></label>
        ${tiktokOk(p.tiktok_url) ? `<a class="btn small" href="${esc(p.tiktok_url)}" target="_blank" rel="noopener">Open on TikTok</a>` : ""}
        <label class="cal-f"><span>Note</span><textarea id="cpNote" rows="3" maxlength="1000" placeholder="Hook, caption idea, who does what…">${esc(p.note || "")}</textarea></label>
        <div class="cal-acts"><button class="btn small primary" type="submit">${p.id ? "Save" : "Add to the plan"}</button>${p.id ? `<button class="btn small ghost cal-danger" type="button" data-act="plan-del">Remove</button>` : ""}</div>
        <div class="cal-msg" id="calMsg" role="status"></div>
      </form>`;
    const was = box.hidden; box.hidden = false; $c("#calScrim").hidden = false;
    if(was){ requestAnimationFrame(() => box.classList.add("open")); } else box.classList.add("open");
    setTimeout(() => { const f = $c("#cpTitle"); if(f && !p.id) f.focus({ preventScroll: true }); }, 40);
    $c("#calPlanForm").onsubmit = e => { e.preventDefault(); savePlan(); };
  }
  async function savePlan(){
    if(busy) return; const p = planEdit, msg = $c("#calMsg");
    const title = $c("#cpTitle").value.trim(), project = $c("#cpProject").value.trim(), day = $c("#cpDay").value, link = $c("#cpLink").value.trim();
    if(!title && !project){ msg.textContent = "Give the video a name or pick its project."; return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)){ msg.textContent = "Pick a day."; return; }
    if(link && !tiktokOk(link)){ msg.textContent = "The TikTok link should start with https://www.tiktok.com/"; return; }
    const body = { title, project, artist: artistOf(project), day, status: $c("#cpStatus").value, tiktok_url: link || null, note: $c("#cpNote").value.trim(), updated_at: new Date().toISOString() };
    busy = true;
    try {
      if(p.id) await SLSAuth.rest(`content_plan?id=eq.${encodeURIComponent(p.id)}`, { method: "PATCH", body, prefer: "return=minimal" });
      else await SLSAuth.rest("content_plan", { method: "POST", body, prefer: "return=minimal" });
      toast(p.id ? "Saved." : "Added to the plan."); selDay = day; planEdit = null; busy = false; closeDetail(true);
      const d = pDay(day); if(d.getMonth() !== view.m || d.getFullYear() !== view.y) view = { y: d.getFullYear(), m: d.getMonth() };
      await load(true);
    } catch(e){ busy = false; if(missingTable(e)){ planMissing = true; msg.innerHTML = planSetup; } else msg.textContent = (e && e.message) || "That didn't save. Try again."; }
  }
  async function removePlan(btn){
    const p = planEdit; if(!p || !p.id || busy) return;
    if(!btn.dataset.sure){ btn.dataset.sure = "1"; btn.textContent = "Really remove?"; setTimeout(() => { if(btn.isConnected){ delete btn.dataset.sure; btn.textContent = "Remove"; } }, 3500); return; }
    busy = true;
    try { await SLSAuth.rest(`content_plan?id=eq.${encodeURIComponent(p.id)}`, { method: "DELETE", prefer: "return=minimal" }); toast("Removed from the plan."); planEdit = null; busy = false; closeDetail(true); await load(true); }
    catch(e){ busy = false; const m = $c("#calMsg"); if(m) m.textContent = (e && e.message) || "That didn't work. Try again."; }
  }

  /* ---------- bookings: my calendar ----------
     A period someone books for an artist on the roster: a campaign, a run of videos. Everyone sees them under Team,
     only the person who booked one can change it (row-level security in the bookings table). */
  const me = () => (window.SLSAuth && SLSAuth.user && SLSAuth.user()) || {};
  const mineOnly = () => whose === "mine" && me().id ? `&user_id=eq.${encodeURIComponent(me().id)}` : "";
  async function loadBooks(from, to, tok){
    try {
      const last = new Date(to); last.setDate(last.getDate() - 1);
      const [a, b] = await Promise.all([
        SLSAuth.rest(`bookings?select=*&starts=lte.${dayKey(last)}&ends=gte.${dayKey(from)}${mineOnly()}&order=starts.asc,created_at.asc`),
        SLSAuth.rest(`bookings?select=*&ends=gte.${dayKey(today())}${mineOnly()}&order=starts.asc,created_at.asc&limit=12`)]);
      if(tok !== loadTok) return;
      books = Array.isArray(a) ? a : []; bookNext = Array.isArray(b) ? b : []; bookMissing = false;
    } catch(e){ if(tok !== loadTok) return; if(missingTable(e)){ bookMissing = true; books = []; bookNext = []; } }
  }
  const hueOf = s => { let h = 0; for(const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const shortRange = b => { const a = pDay(b.starts), z = pDay(b.ends); return +a === +z ? shortDay(a) : `${shortDay(a)} – ${shortDay(z)}`; };
  const ownBook = b => b.user_id && b.user_id === me().id;
  const bookVisible = rows => filter ? rows.filter(b => b.artist === filter) : rows;
  // in a day: a bar in the artist's colour, with the name on the first day and at the start of each week
  const bookBar = (b, k) => { const first = k === b.starts || pDay(k).getDay() === 1, last = k === b.ends;
    return `<button class="cal-book${first ? " first" : ""}${last ? " last" : ""}${bookEdit && bookEdit.id === b.id ? " on" : ""}" type="button" data-book="${esc(b.id)}" style="--bh:${hueOf(b.artist)}" title="${esc(`${b.artist}${b.title ? " · " + b.title : ""} · ${shortRange(b)}${b.owner_name && !ownBook(b) ? " · " + b.owner_name : ""}`)}">${first ? `<span class="cal-n">${esc(b.artist)}</span>` : ""}</button>`; };
  const bookRow = b => `<button class="cal-row cal-brow${bookEdit && bookEdit.id === b.id ? " on" : ""}" type="button" data-book="${esc(b.id)}" style="--bh:${hueOf(b.artist)}"><i class="cal-bm" aria-hidden="true"></i>
      <span class="cal-rt"><b>${esc(b.artist)}${b.title ? ` · ${esc(b.title)}` : ""}</b><span>${esc(shortRange(b))}${whose === "team" && b.owner_name ? " · " + esc(ownBook(b) ? "you" : b.owner_name) : ""}</span></span></button>`;
  const bookSetup = `<p class="cal-hint">To book periods here, the calendar needs a one-time setup: in Supabase, open the SQL editor and run the <b>bookings</b> part of supabase/schema.sql.</p>`;
  let roster = null;
  async function rosterNames(){
    if(roster) return roster;
    try { const d = await SLSBackend.api("/api/catalog"); roster = [...new Set((d.artists || []).map(a => String(a.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
    catch { roster = []; }
    return roster;
  }
  async function editBook(b){
    bookEdit = b; planEdit = null; openId = ""; editing = false;
    const [names, projs] = await Promise.all([rosterNames(), !projNames.length && window.SLSProjects && SLSProjects.names ? SLSProjects.names() : projNames]);
    projNames = (projs || []).slice(0, 40);
    paintBookForm(names);
  }
  function paintBookForm(names){
    const b = bookEdit, box = $c("#calDetail"); if(!b) return;
    const own = !b.id || ownBook(b);
    box.dataset.id = ""; box.dataset.st = ""; box.dataset.at = "";
    box.innerHTML = `
      <div class="cal-dh"><button class="icon-btn cal-dback" type="button" data-act="book-close" aria-label="Back to the calendar">‹</button><h3 id="calDetT">${b.id ? (own ? "Your booking" : `${esc(b.owner_name || "Someone")}'s booking`) : "Book a period"}</h3><button class="icon-btn" type="button" data-act="book-close" aria-label="Close">✕</button></div>
      <form class="cal-db cal-pform" id="calBookForm" autocomplete="off">
        <label class="cal-f"><span>Artist</span><input id="cbArtist" maxlength="120" list="cbArtists" required placeholder="Pick an artist from the roster" value="${esc(b.artist || "")}"${own ? "" : " disabled"}><datalist id="cbArtists">${(names || []).map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist></label>
        <label class="cal-f"><span>What you're doing <em class="cal-muted">a campaign or project</em></span><input id="cbTitle" maxlength="200" list="cbProjects" placeholder="e.g. Posting videos for the new single" value="${esc(b.title || "")}"${own ? "" : " disabled"}><datalist id="cbProjects">${projNames.map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist></label>
        <div class="cal-f2">
          <label class="cal-f"><span>From</span><input type="date" id="cbFrom" required value="${esc(b.starts || selDay || dayKey(today()))}"${own ? "" : " disabled"}></label>
          <label class="cal-f"><span>Until</span><input type="date" id="cbTo" required value="${esc(b.ends || b.starts || selDay || dayKey(today()))}"${own ? "" : " disabled"}></label>
        </div>
        <label class="cal-f"><span>Note</span><textarea id="cbNote" rows="3" maxlength="1000" placeholder="Anything to remember: how many videos, which songs…"${own ? "" : " disabled"}>${esc(b.note || "")}</textarea></label>
        ${own ? `<div class="cal-acts"><button class="btn small primary" type="submit">${b.id ? "Save" : "Book it"}</button>${b.id ? `<button class="btn small ghost cal-danger" type="button" data-act="book-del">Remove</button>` : ""}</div>`
          : `<p class="cal-hint">Only ${esc(b.owner_name || "the person who booked it")} can change this booking.</p>`}
        <div class="cal-msg" id="calMsg" role="status"></div>
      </form>`;
    const was = box.hidden; box.hidden = false; $c("#calScrim").hidden = false;
    if(was){ requestAnimationFrame(() => box.classList.add("open")); } else box.classList.add("open");
    setTimeout(() => { const f = $c("#cbArtist"); if(f && !b.id) f.focus({ preventScroll: true }); }, 40);
    $c("#calBookForm").onsubmit = e => { e.preventDefault(); saveBook(); };
  }
  async function saveBook(){
    if(busy) return; const b = bookEdit, msg = $c("#calMsg");
    const artist = $c("#cbArtist").value.trim().replace(/\s+/g, " "), title = $c("#cbTitle").value.trim(), starts = $c("#cbFrom").value, ends = $c("#cbTo").value;
    if(!artist){ msg.textContent = "Pick the artist."; return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends)){ msg.textContent = "Pick the first and the last day."; return; }
    if(ends < starts){ msg.textContent = "The last day can't be before the first."; return; }
    const body = { artist, title, starts, ends, note: $c("#cbNote").value.trim(), updated_at: new Date().toISOString() };
    if(!b.id) body.owner_name = String(me().name || (me().email || "").split("@")[0] || "").slice(0, 80);
    busy = true;
    try {
      if(b.id) await SLSAuth.rest(`bookings?id=eq.${encodeURIComponent(b.id)}`, { method: "PATCH", body, prefer: "return=minimal" });
      else await SLSAuth.rest("bookings", { method: "POST", body, prefer: "return=minimal" });
      toast(b.id ? "Saved." : `Booked: ${artist}, ${shortRange(body)}.`); selDay = starts; bookEdit = null; busy = false; closeDetail(true);
      const d = pDay(starts); if(d.getMonth() !== view.m || d.getFullYear() !== view.y) view = { y: d.getFullYear(), m: d.getMonth() };
      await load(true);
    } catch(e){ busy = false; if(missingTable(e)){ bookMissing = true; msg.innerHTML = bookSetup; } else msg.textContent = (e && e.message) || "That didn't save. Try again."; }
  }
  async function removeBook(btn){
    const b = bookEdit; if(!b || !b.id || busy) return;
    if(!btn.dataset.sure){ btn.dataset.sure = "1"; btn.textContent = "Really remove?"; setTimeout(() => { if(btn.isConnected){ delete btn.dataset.sure; btn.textContent = "Remove"; } }, 3500); return; }
    busy = true;
    try { await SLSAuth.rest(`bookings?id=eq.${encodeURIComponent(b.id)}`, { method: "DELETE", prefer: "return=minimal" }); toast("Booking removed."); bookEdit = null; busy = false; closeDetail(true); await load(true); }
    catch(e){ busy = false; const m = $c("#calMsg"); if(m) m.textContent = (e && e.message) || "That didn't work. Try again."; }
  }

  /* ---------- what worked ----------
     Posts that went out and have results, from the last 90 days: per song, the versions side by side (which part of the
     song, which look, which frame shape), best first. The results come from the platforms (see src/schedule.js). */
  async function loadResults(){
    try {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const rows = await SLSAuth.rest("posts?select=id,project_name,artist,account_name,platform,meta,stats,publish_at&status=eq.posted&stats=not.is.null&publish_at=gte." + encodeURIComponent(since) + "&order=publish_at.desc&limit=300");
      results = Array.isArray(rows) ? rows : []; resLoaded = true; paintResults();
    } catch { resLoaded = true; results = []; paintResults(); }
  }
  const n0 = x => +x || 0;
  function versionOf(r){
    const c = (r.meta && r.meta.clip) || {}, bits = [];
    if(c.a != null && c.b != null) bits.push(c.part ? `Part ${c.part} (${clockOf(c.a)} to ${clockOf(c.b)})` : `${clockOf(c.a)} to ${clockOf(c.b)}`);
    if(c.look) bits.push(c.look);
    if(c.size) bits.push(c.size);
    return bits.join(" · ") || "This video";
  }
  function paintResults(){
    const box = $c("#calRes"); if(!box) return;
    const rows = visible(results).filter(r => r.stats && (r.stats.views != null || r.stats.likes != null));
    box.hidden = !resLoaded;
    if(!rows.length){ box.innerHTML = `<h3>What worked</h3><p class="hint">Once posts are out, their views and likes show up here, with the versions of each song side by side.</p>`; return; }
    const songs = new Map();
    for(const r of rows){
      const name = r.project_name || "Untitled", s = songs.get(name) || { name, who: who(r), views: 0, likes: 0, posts: 0, vers: new Map() };
      const st = r.stats, k = versionOf(r), v = s.vers.get(k) || { k, views: 0, likes: 0, posts: 0, pl: new Set() };
      s.views += n0(st.views); s.likes += n0(st.likes); s.posts++;
      v.views += n0(st.views); v.likes += n0(st.likes); v.posts++; v.pl.add(PN[r.platform] || r.platform);
      s.vers.set(k, v); songs.set(name, s);
    }
    const top = [...songs.values()].sort((a, b) => b.views - a.views || b.likes - a.likes).slice(0, 6);
    box.innerHTML = `<h3>What worked</h3>` + top.map(s => {
      const vs = [...s.vers.values()].sort((a, b) => b.views - a.views || b.likes - a.likes), max = Math.max(1, ...vs.map(v => v.views));
      return `<div class="res-song"><div class="res-head"><b>${esc(s.name)}</b><span>${num(s.views)} views · ${num(s.likes)} likes · ${s.posts} post${s.posts > 1 ? "s" : ""}</span></div>`
        + (vs.length > 1 ? vs.map((v, i) => `<div class="res-ver${i === 0 ? " best" : ""}"><span class="res-k">${i === 0 ? "<em>Best</em> " : ""}${esc(v.k)}</span><span class="res-n">${num(v.views)} views · ${num(v.likes)} likes · ${[...v.pl].join(", ")}</span><i style="width:${Math.max(3, Math.round(v.views / max * 100))}%"></i></div>`).join("")
          : `<div class="res-one hint">${esc(vs[0].k)} · ${[...vs[0].pl].join(", ")}</div>`) + `</div>`;
    }).join("") + `<p class="hint">Make versions in Export > Also make (another part of the song, or another frame shape) and post them on different days to see which one people like.</p>`;
  }

  /* ---------- painting ---------- */
  const visible = rows => filter ? rows.filter(r => who(r) === filter) : rows;
  function paintState(){
    const s = $c("#calState");
    if(SLSAuth.mode !== "accounts") s.innerHTML = "";
    else if(err) s.innerHTML = `<span>${esc(err)}</span> <button class="btn small" type="button" data-cal="retry">Try again</button>`;
    else if(loading && !loadedOnce) s.textContent = "Loading…";
    else if(loadedOnce && !visible(posts).length && !planVisible(plans).length && !bookVisible(books).length) s.textContent = "Nothing planned this month";
    else s.textContent = "";
    s.hidden = !s.textContent && !s.innerHTML;
    s.classList.toggle("bad", !!err);
  }
  function paint(){
    const login = !window.SLSAuth || SLSAuth.mode !== "accounts";
    $c("#calBody").hidden = login; $c(".cal-head .cal-nav").hidden = login; $c("#calFilter").hidden = login; $c(".cal-who").hidden = login;
    if(login){ const s = $c("#calState"); s.hidden = false; s.classList.remove("bad"); s.textContent = "The calendar needs a login"; $c("#calMonth").textContent = ""; closeDetail(true); return; }
    $c("#calMonth").textContent = `${MONTHS[view.m]} ${view.y}`;
    // artist filter: everyone seen in the loaded posts
    const names = [...new Set([...posts, ...upcoming].map(who).concat([...plans, ...planNext].map(p => p.artist || artistOf(p.project)), [...books, ...bookNext].map(b => b.artist)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    root.querySelectorAll(".cal-who [data-cal]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.cal === whose)));
    if(filter && !names.includes(filter)) names.push(filter);
    const sel = $c("#calFilter"), want = `<option value="">All artists</option>` + names.map(n => `<option value="${esc(n)}"${n === filter ? " selected" : ""}>${esc(n)}</option>`).join("");
    if(sel.dataset.sig !== want){ sel.innerHTML = want; sel.dataset.sig = want; } sel.value = filter;
    paintState(); paintGrid(); paintSide(); paintResults();
    if(openId) paintDetail();
    $c("#calBody").hidden = trendOn; $c("#calState").hidden = trendOn || $c("#calState").hidden; $c(".cal-head .cal-nav").hidden = trendOn; $c("#calFilter").hidden = trendOn; $c(".cal-who").hidden = trendOn; $c("#calTrend").hidden = !trendOn;
    $c(".cal-trend-btn").setAttribute("aria-pressed", String(trendOn)); $c(".cal-trend-btn").textContent = trendOn ? "Back to the calendar" : "Trending sounds";
  }
  function paintGrid(){
    const start = gridStart(view), weeks = weeksIn(view), t0 = today(), byDay = new Map();
    for(const p of planVisible(plans)){ (byDay.get(p.day) || byDay.set(p.day, []).get(p.day)).push({ plan: p }); }
    for(const r of visible(posts)){ const k = dayKey(new Date(r.publish_at)); (byDay.get(k) || byDay.set(k, []).get(k)).push(r); }
    let h = "";
    for(let i = 0; i < weeks * 7; i++){
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = dayKey(d), rows = byDay.get(k) || [], bk = bookVisible(books).filter(b => b.starts <= k && b.ends >= k);
      const cls = ["cal-cell", d.getMonth() !== view.m && "out", +d === +t0 && "today", d < t0 && "past", k === selDay && "sel"].filter(Boolean).join(" ");
      h += `<div class="${cls}" role="group" aria-label="${esc(shortDay(d))}, ${rows.length} item${rows.length === 1 ? "" : "s"}">
        <button class="cal-dn" type="button" data-day="${k}"${+d === +t0 ? ` aria-current="date"` : ""}>${d.getDate()}</button>
        ${bk.length ? `<div class="cal-books">${bk.slice(0, 3).map(b => bookBar(b, k)).join("")}</div>` : ""}
        <div class="cal-chips">${rows.slice(0, 3).map(r => r.plan ? planChip(r.plan) : chip(r)).join("")}${rows.length > 3 ? `<button class="cal-more" type="button" data-day="${k}">+${rows.length - 3} more</button>` : ""}</div>
        ${rows.length ? `<button class="cal-dots" type="button" data-day="${k}" aria-label="Show the ${rows.length} item${rows.length === 1 ? "" : "s"} on ${esc(shortDay(d))}">${rows.slice(0, 4).map(r => r.plan ? `<i class="cal-pl p-plan pl-${esc(r.plan.status)}"></i>` : `<i class="cal-pl p-${esc(r.platform)} st-${esc(r.status)}"></i>`).join("")}${rows.length > 4 ? `<em>+${rows.length - 4}</em>` : ""}</button>` : ""}
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
      const [y, m, dd] = selDay.split("-").map(Number), d = new Date(y, m - 1, dd), rows = visible(posts).filter(r => dayKey(new Date(r.publish_at)) === selDay), pl = planVisible(plans).filter(p => p.day === selDay);
      dayBox.hidden = false;
      const bk = bookVisible(books).filter(b => b.starts <= selDay && b.ends >= selDay);
      dayBox.innerHTML = `<div class="cal-dayh"><h3>${esc(shortDay(d))}</h3><span class="cal-dayb">${bookMissing ? "" : `<button class="btn small ghost" type="button" data-act="book-new">＋ Book</button>`}${planMissing ? "" : `<button class="btn small" type="button" data-act="plan-new">＋ Plan a video</button>`}</span></div>`
        + (bk.length ? `<div class="cal-list">${bk.map(bookRow).join("")}</div>` : "")
        + (pl.length ? `<div class="cal-list">${pl.map(p => planRow(p)).join("")}</div>` : "")
        + (rows.length ? `<div class="cal-list">${rows.map(r => row(r)).join("")}</div>`
        : pl.length || bk.length ? "" : `<p class="cal-hint">${d >= today() ? "Nothing planned for this day yet. Plan a video here, or open a project and choose Schedule when posting." : "Nothing was posted on this day."}</p>`)
        + (planMissing ? planSetup : "");
    } else { dayBox.hidden = true; dayBox.innerHTML = ""; }
    const up = visible(upcoming);
    const pn = planVisible(planNext);
    const bn = bookVisible(bookNext);
    $c("#calUp").innerHTML = `<div class="cal-dayh"><h3>${whose === "team" ? "Team bookings" : "My bookings"}</h3>${bookMissing ? "" : `<button class="btn small ghost" type="button" data-act="book-new">＋ Book a period</button>`}</div>`
      + (bookMissing ? bookSetup : bn.length ? `<div class="cal-list">${bn.map(bookRow).join("")}</div>` : `<p class="cal-hint">${whose === "team" ? "Nobody has booked anything coming up." : "Nothing booked yet. Book the period you work on an artist, like posting videos for a new single until a date."}</p>`)
      + `<h3 class="cal-planh">Coming up</h3>` + (up.length ? `<div class="cal-list">${up.map(r => row(r, true)).join("")}</div>` : `<p class="cal-hint">No scheduled posts yet.</p>`)
      + `<div class="cal-dayh cal-planh"><h3>Planned videos</h3>${planMissing ? "" : `<button class="btn small ghost" type="button" data-act="plan-new">＋ Plan</button>`}</div>`
      + (planMissing ? planSetup : pn.length ? `<div class="cal-list">${pn.map(p => planRow(p, true)).join("")}</div>` : `<p class="cal-hint">No videos planned yet. Pick a day and plan one: what it is, which project, and how far along it is.</p>`);
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
    const box = $c("#calDetail"); const had = openId; openId = ""; editing = false; planEdit = null; bookEdit = null;
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
      const k = a.dataset.act;
      if(k === "plan-new"){ editPlan({ day: selDay || dayKey(today()), status: "idea" }); return; }
      if(k === "book-new"){ editBook({ starts: selDay || dayKey(today()), ends: selDay || dayKey(today()) }); return; }
      if(k === "book-close"){ closeDetail(); return; }
      if(k === "book-del"){ removeBook(a); return; }
      if(k === "plan-close"){ closeDetail(); return; }
      if(k === "plan-del"){ removePlan(a); return; }
      const r = known(openId); if(k === "closed"){ closeDetail(); return; } if(!r || busy) return;
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
      else if(k === "mine" || k === "team"){ if(whose !== k){ whose = k; try { localStorage.setItem("sls-cal-whose", k); } catch {} closeDetail(true); load(); paint(); } }
      else if(k === "trend"){ trendOn = !trendOn; closeDetail(true); paint(); if(trendOn && window.SLSTrends) SLSTrends.paint($c("#calTrend")); }
      return; }
    const bookEl = t.closest("[data-book]");
    if(bookEl){ const b = [...books, ...bookNext].find(x => x.id === bookEl.dataset.book); if(b){ editBook({ ...b }); } return; }
    const planEl = t.closest("[data-plan]");
    if(planEl){ const p = [...plans, ...planNext].find(x => x.id === planEl.dataset.plan); if(p){ selDay = p.day; paintGrid(); paintSide(); editPlan({ ...p }); } return; }
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
    if(e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); if(openId || planEdit || bookEdit) closeDetail(); else if(trendOn){ trendOn = false; paint(); } else close(); return; }
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
    if(!isOpen){ posts = []; upcoming = []; plans = []; planNext = []; books = []; bookNext = []; err = ""; loadedOnce = false; filter = ""; trendOn = false; }
    closeDetail(true); isOpen = true; root.hidden = false; document.body.classList.add("cal-open");
    document.addEventListener("keydown", onKey, true);
    clearInterval(timer); timer = setInterval(() => { if(isOpen && !document.hidden && !busy) load(true); }, 60000);
    paint(); load(); loadResults();
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

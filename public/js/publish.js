"use strict";
/* Posting the exported video to YouTube, Instagram and TikTok. Accounts are linked once (as many as you like,
   one per artist or profile) and kept in this browser, sealed so only the studio server can use them. The
   server side is src/publish.js. Opens from the export window once a video is made. */
window.SLSPublish = (() => {
  const api = window.SLSBackend;
  const keep = { get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const errText = err => err && err.message ? err.message : "Something went wrong.";
  const P = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
  const ICON = {
    youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" fill="#ff0033"/><path d="m10 9 5 3-5 3z" fill="#fff"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".5" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="3" y="3" width="18" height="18" rx="5" fill="url(#igg)"/><circle cx="12" cy="12" r="4" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="17" cy="7" r="1.2" fill="#fff"/></svg>`,
    tiktok: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" fill="#000"/><path d="M13.5 6v8.2a2.3 2.3 0 1 1-2.3-2.3" fill="none" stroke="#25f4ee" stroke-width="1.8" transform="translate(-.6 .4)"/><path d="M13.5 6v8.2a2.3 2.3 0 1 1-2.3-2.3M13.5 6c.3 1.8 1.6 3 3.4 3.1" fill="none" stroke="#fe2c55" stroke-width="1.8" transform="translate(.6 -.4)"/><path d="M13.5 6v8.2a2.3 2.3 0 1 1-2.3-2.3M13.5 6c.3 1.8 1.6 3 3.4 3.1" fill="none" stroke="#fff" stroke-width="1.8"/></svg>`,
  };

  /* ---------- accounts, kept in this browser ---------- */
  const accounts = () => keep.get("sls-accounts", []).filter(a => a && a.id && P[a.platform] && a.sealed);
  const saveAccounts = list => keep.set("sls-accounts", list);
  const updateAccount = (id, patch) => saveAccounts(accounts().map(a => a.id === id ? { ...a, ...patch } : a));
  let selected = new Set(keep.get("sls-pub-sel", []));
  const saveSel = () => keep.set("sls-pub-sel", [...selected]);

  /* ---------- the window ---------- */
  const m = document.createElement("div"); m.className = "modal"; m.id = "pubModal"; m.hidden = true;
  m.innerHTML = `<div class="dialog ph-dialog pub-dialog" role="dialog" aria-modal="true" aria-labelledby="pubTitleH">
    <div class="ph-head"><h2 id="pubTitleH">Post the video</h2><button class="btn small ghost" id="pubX" type="button" aria-label="Close">✕</button></div>
    <div class="pub-top"><video id="pubPrev" muted playsinline loop></video><div class="pub-meta"><b id="pubSong"></b><span class="hint" id="pubInfo"></span><span class="hint pub-warn" id="pubFmt"></span></div></div>
    <div class="field">
      <div class="row" style="justify-content:space-between"><span class="label">Post to</span>
        <span class="pub-link" id="pubLink">${Object.keys(P).map(p => `<button class="btn small" type="button" data-link="${p}">${ICON[p]}<span>Link ${P[p]}</span></button>`).join("")}</span></div>
      <div class="pub-list" id="pubList"></div>
      <div class="hint" id="pubSetup"></div>
    </div>
    <div class="field pub-text" id="pubText">
      <label class="field"><span class="hint">Caption <span id="pubCapFor"></span></span><textarea id="pubCaption" rows="3" maxlength="2200"></textarea></label>
      <label class="field" data-for="youtube"><span class="hint">YouTube title</span><input type="text" id="pubYtTitle" maxlength="100"></label>
      <div class="field" data-for="youtube"><span class="hint">YouTube visibility</span><div class="seg" id="pubYtPriv"><button data-v="public">Public</button><button data-v="unlisted">Unlisted</button><button data-v="private">Private</button></div></div>
      <label class="ph-only" data-for="instagram"><input type="checkbox" id="pubFeed" checked> Also show the Reel in the Instagram profile grid</label>
      <label class="ph-only"><input type="checkbox" id="pubAi"> Label it as made with AI <span class="hint">(turn on when it uses AI backgrounds)</span></label>
    </div>
    <div class="pub-tts" id="pubTT"></div>
    <div class="hint pub-consent" id="pubConsent"></div>
    <div class="pub-jobs" id="pubJobs"></div>
    <div class="row ph-actions"><button class="btn primary" id="pubGo" type="button">Post</button><span class="hint" id="pubWhy"></span><button class="btn ghost" id="pubClose" type="button">Close</button></div>
  </div>`;
  document.body.append(m);

  let health = null, video = null, ytPriv = keep.get("sls-pub-ytpriv", "public"), creator = {}, tt = keep.get("sls-pub-tt", {});
  async function getHealth(force){ if(health && !force) return health; try { health = await api.health(); } catch { health = {}; } return health; }
  const firstLine = () => { const { a, b } = S.P.section, L = lineGroups().find(g => g[0].t >= a - 0.3 && g[0].t < b); return L ? L.map(w => w.w).join(" ") : ""; };

  async function open(){
    const r = window.SLSExport && SLSExport.result;
    if(!r){ toast("Export the video first, then post it."); return; }
    video = r; m.hidden = false; creator = {}; tt = Object.fromEntries(Object.entries(tt).map(([k, v]) => [k, { mode: v.mode }]));
    const v = $("#pubPrev"); if(v.dataset.src !== String(r.blob.size)){ if(v.src) URL.revokeObjectURL(v.src); v.src = URL.createObjectURL(r.blob); v.dataset.src = String(r.blob.size); } v.play().catch(() => {});
    $("#pubSong").textContent = S.songName;
    $("#pubInfo").textContent = `${(r.blob.size / 1048576).toFixed(1)} MB · ${r.f.label} · ${r.w}×${r.h} · ${(S.P.section.b - S.P.section.a).toFixed(0)} s`;
    if(!$("#pubCaption").value || $("#pubCaption").dataset.song !== S.songName){ const fl = firstLine(); $("#pubCaption").value = (fl ? `“${fl}”\n\n` : "") + S.songName; $("#pubCaption").dataset.song = S.songName; }
    if(!$("#pubYtTitle").value || $("#pubYtTitle").dataset.song !== S.songName){ $("#pubYtTitle").value = `${S.songName} (Lyrics)`.slice(0, 100); $("#pubYtTitle").dataset.song = S.songName; }
    await getHealth(true); paint(); loadCreators();
  }
  const close = () => { m.hidden = true; $("#pubPrev").pause(); };
  $("#pubX").onclick = close; $("#pubClose").onclick = close;
  m.addEventListener("click", e => { if(e.target === m) close(); });
  addEventListener("keydown", e => { if(e.key === "Escape" && !m.hidden && !document.querySelector("#pubList input:focus")) close(); });

  /* what the exported file can go to */
  function fits(p){
    if(!video) return "Export the video first.";
    const ext = video.f.ext, len = S.P.section.b - S.P.section.a;
    if(p === "instagram" && !["mp4", "mov"].includes(ext)) return "Instagram needs MP4 or MOV.";
    if(p === "instagram" && SLSExport.audioCodec && SLSExport.audioCodec !== "aac" && ext === "mp4") return "Instagram needs AAC audio, which this browser couldn't make. Try Chrome.";
    if(p === "tiktok" && !["mp4", "mov", "webm"].includes(ext)) return "TikTok needs MP4, MOV or WebM.";
    if(p === "instagram" && len < 3) return "Instagram Reels must be at least 3 seconds.";
    if(video.blob.size > 95 * 1048576) return "Larger than 95 MB: export at 1080p or Standard quality.";
    return "";
  }

  function paint(){
    const list = accounts(), h = (health && health.publish) || {};
    for(const id of [...selected]) if(!list.some(a => a.id === id)) selected.delete(id);
    // grouped by artist label, so one tap picks all of an artist's profiles
    const groups = new Map();
    for(const a of list.slice().sort((x, y) => (x.label || x.name).localeCompare(y.label || y.name) || x.platform.localeCompare(y.platform))){ const g = a.label || ""; if(!groups.has(g)) groups.set(g, []); groups.get(g).push(a); }
    $("#pubList").innerHTML = list.length ? [...groups.entries()].map(([g, as]) => `
      <div class="pub-group">${g ? `<button class="pub-artist" type="button" data-artist="${esc(g)}" title="Select all of ${esc(g)}">${esc(g)}</button>` : ""}
      ${as.map(a => { const why = fits(a.platform), on = selected.has(a.id) && !why; return `<div class="pub-acct${on ? " on" : ""}${why ? " off" : ""}" data-id="${esc(a.id)}">
        <label class="pub-pick"><input type="checkbox" ${on ? "checked" : ""} ${why ? "disabled" : ""}><span class="pub-av">${a.avatar ? `<img alt="" src="${esc(a.avatar)}" referrerpolicy="no-referrer">` : ""}<i>${ICON[a.platform]}</i></span>
          <span class="pub-who"><b>${esc(a.name)}</b><span class="hint">${P[a.platform]}${why ? ` · ${esc(why)}` : a.platform === "tiktok" && !(a.scopes || []).includes("direct") ? " · drafts only" : ""}</span></span></label>
        <button class="btn small ghost pub-label" type="button" data-label="${esc(a.id)}">${a.label ? "Artist: " + esc(a.label) : "Set artist"}</button>
        <button class="btn small ghost pub-rm" type="button" data-rm="${esc(a.id)}" aria-label="Remove ${esc(a.name)}">✕</button></div>`; }).join("")}</div>`).join("")
      : `<div class="hint pub-empty">No accounts linked yet. Link each artist's YouTube channel, Instagram and TikTok once; they stay linked in this browser.</div>`;
    const off = Object.keys(P).filter(p => !h[p]);
    $$("#pubLink [data-link]").forEach(b => { const p = b.dataset.link; b.disabled = !h[p]; b.title = h[p] ? `Link a ${P[p]} account` : `${P[p]} isn't set up on the server yet`; });
    $("#pubSetup").textContent = (off.length ? `${off.map(p => P[p]).join(", ")} ${off.length === 1 ? "isn't" : "aren't"} set up on the server yet: the app keys go in the site's settings (see the setup guide). ` : "")
      + (h.instagram && !h.instagramStorage ? "Instagram also needs the site's video storage (KV namespace PUBLISH)." : "");
    const sel = list.filter(a => selected.has(a.id) && !fits(a.platform)), has = p => sel.some(a => a.platform === p);
    $$("#pubText [data-for]").forEach(el => el.hidden = !has(el.dataset.for));
    $$("#pubYtPriv button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === ytPriv)));
    $("#pubCapFor").textContent = sel.length ? "· " + [has("instagram") && "Instagram", has("tiktok") && "TikTok", has("youtube") && "YouTube description"].filter(Boolean).join(", ") : "";
    paintTikTok(sel.filter(a => a.platform === "tiktok"));
    paintGo(sel);
  }

  /* ---------- TikTok: what TikTok requires on the posting screen ---------- */
  function ttOpt(id){ return tt[id] || (tt[id] = { mode: "draft" }); }
  // only the mode is remembered: TikTok wants privacy and the rest chosen fresh every time, with nothing preset
  const saveTT = () => keep.set("sls-pub-tt", Object.fromEntries(Object.entries(tt).map(([k, v]) => [k, { mode: v.mode }])));
  async function loadCreators(){
    for(const a of accounts().filter(x => x.platform === "tiktok" && selected.has(x.id) && (x.scopes || []).includes("direct"))){
      if(creator[a.id]) continue; creator[a.id] = { loading: true }; paint();
      try { const d = await api.api("/api/publish/creator", { method: "POST", body: { account: a.sealed }, timeout: 20000 });
        if(d.account) updateAccount(a.id, { sealed: d.account }); creator[a.id] = d; }
      catch(err){ creator[a.id] = { error: errText(err) }; }
      paint();
    }
  }
  const PRIV = { PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers", SELF_ONLY: "Only me" };
  function paintTikTok(list){
    const len = S.P.section.b - S.P.section.a;
    $("#pubTT").innerHTML = list.map(a => {
      const o = ttOpt(a.id), direct = (a.scopes || []).includes("direct"), c = creator[a.id] || {};
      if(o.mode === "direct" && !direct) o.mode = "draft";
      let body = "";
      if(o.mode === "draft") body = `<div class="hint">It lands in the TikTok inbox of <b>${esc(a.name)}</b>: open TikTok, tap the notification, then add sounds or edit and post. At most 5 drafts can wait at a time.</div>`;
      else if(c.loading) body = `<div class="hint">Checking what ${esc(a.name)} can post…</div>`;
      else if(c.error) body = `<div class="hint pub-warn">${esc(c.error)}</div>`;
      else {
        const opts = c.privacy_level_options || [], tooLong = c.max_video_post_duration_sec && len > c.max_video_post_duration_sec;
        const branded = !!o.brandContent;
        body = `<div class="hint">Posting as <b>${esc(c.creator_nickname || a.name)}</b>${c.creator_username ? ` (@${esc(c.creator_username)})` : ""}. TikTok can take a few minutes to process it before it shows on the profile.</div>
          ${tooLong ? `<div class="hint pub-warn">This account can post up to ${c.max_video_post_duration_sec} s; the video is ${len.toFixed(0)} s.</div>` : ""}
          <label class="field"><span class="hint">Who can see it</span><select data-tt="privacy" data-id="${esc(a.id)}"><option value="">Choose…</option>${opts.map(v => `<option value="${v}" ${o.privacy === v ? "selected" : ""} ${branded && v === "SELF_ONLY" ? "disabled" : ""}>${PRIV[v] || v}${branded && v === "SELF_ONLY" ? " (not for branded content)" : ""}</option>`).join("")}</select></label>
          <div class="pub-checks"><span class="hint">Allow</span>
            ${[["comment", "Comments", c.comment_disabled], ["duet", "Duet", c.duet_disabled], ["stitch", "Stitch", c.stitch_disabled]].map(([k, l, dis]) => `<label class="ph-only${dis ? " dim" : ""}" title="${dis ? "Turned off in this account's TikTok settings" : ""}"><input type="checkbox" data-tt="${k}" data-id="${esc(a.id)}" ${o[k] && !dis ? "checked" : ""} ${dis ? "disabled" : ""}> ${l}</label>`).join("")}</div>
          <label class="ph-only"><input type="checkbox" data-tt="commercial" data-id="${esc(a.id)}" ${o.commercial ? "checked" : ""}> Disclose commercial content <span class="hint">(promotes a brand, product or service)</span></label>
          ${o.commercial ? `<div class="pub-checks pub-indent">
            <label class="ph-only"><input type="checkbox" data-tt="brandOrganic" data-id="${esc(a.id)}" ${o.brandOrganic ? "checked" : ""}> Your brand <span class="hint">(labelled “Promotional content”)</span></label>
            <label class="ph-only"><input type="checkbox" data-tt="brandContent" data-id="${esc(a.id)}" ${o.brandContent ? "checked" : ""}> Branded content <span class="hint">(a paid partnership, labelled as such)</span></label>
            ${!o.brandOrganic && !o.brandContent ? `<div class="hint pub-warn">Pick at least one, or turn disclosure off.</div>` : ""}</div>` : ""}`;
      }
      return `<div class="pub-tt" data-id="${esc(a.id)}"><div class="row" style="justify-content:space-between"><b class="pub-tt-h">${ICON.tiktok} ${esc(a.name)}</b>
        <div class="seg"><button data-tt="mode" data-v="draft" data-id="${esc(a.id)}" aria-pressed="${o.mode === "draft"}">Send to drafts</button><button data-tt="mode" data-v="direct" data-id="${esc(a.id)}" aria-pressed="${o.mode === "direct"}" ${direct ? "" : `disabled title="This TikTok login only allows drafts"`}>Post directly</button></div></div>${body}</div>`;
    }).join("");
    const anyDirect = list.some(a => ttOpt(a.id).mode === "direct"), branded = list.some(a => ttOpt(a.id).mode === "direct" && ttOpt(a.id).commercial && ttOpt(a.id).brandContent);
    $("#pubConsent").innerHTML = anyDirect ? `By posting to TikTok, you agree to TikTok's ${branded ? `<a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Branded Content Policy</a> and ` : ""}<a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>.` : "";
  }
  function ttProblem(a){
    const o = ttOpt(a.id); if(o.mode !== "direct") return "";
    const c = creator[a.id] || {};
    if(c.loading) return "Checking the TikTok account…";
    if(c.error) return c.error;
    if(c.max_video_post_duration_sec && S.P.section.b - S.P.section.a > c.max_video_post_duration_sec) return `Too long for ${a.name} on TikTok.`;
    if(!o.privacy) return `Choose who can see it on TikTok (${a.name}).`;
    if(o.commercial && !o.brandOrganic && !o.brandContent) return "Pick what kind of commercial content it is, or turn disclosure off.";
    if(o.brandContent && o.privacy === "SELF_ONLY") return "Branded content can't be private on TikTok.";
    return "";
  }
  $("#pubTT").addEventListener("click", e => {
    const b = e.target.closest("button[data-tt='mode']"); if(!b || b.disabled) return;
    ttOpt(b.dataset.id).mode = b.dataset.v; saveTT(); paint(); loadCreators();
  });
  $("#pubTT").addEventListener("change", e => {
    const el = e.target, k = el.dataset.tt, id = el.dataset.id; if(!k || !id) return; const o = ttOpt(id);
    if(k === "privacy") o.privacy = el.value || null;
    else { o[k] = el.checked; if(k === "commercial" && !el.checked){ o.brandOrganic = false; o.brandContent = false; } }
    if(o.brandContent && o.privacy === "SELF_ONLY"){ o.privacy = null; toast("Branded content can't be private on TikTok. Choose who can see it again."); }
    saveTT(); paint();
  });

  function paintGo(sel){
    const problems = sel.map(a => a.platform === "tiktok" ? ttProblem(a) : "").filter(Boolean);
    const go = $("#pubGo"), n = sel.length;
    go.textContent = n ? `Post to ${n} account${n === 1 ? "" : "s"}` : "Post";
    go.disabled = !n || !!problems.length || posting;
    $("#pubWhy").textContent = posting ? "" : !n ? (accounts().length ? "Tick the accounts to post to." : "") : problems[0] || "";
    go.title = problems[0] || "";
  }

  /* ---------- the list: pick, label, remove ---------- */
  $("#pubList").addEventListener("change", e => { const row = e.target.closest(".pub-acct"); if(!row || e.target.type !== "checkbox") return; e.target.checked ? selected.add(row.dataset.id) : selected.delete(row.dataset.id); saveSel(); paint(); loadCreators(); });
  $("#pubList").addEventListener("click", e => {
    const art = e.target.closest("[data-artist]");
    if(art){ const as = accounts().filter(a => (a.label || "") === art.dataset.artist && !fits(a.platform)), all = as.every(a => selected.has(a.id)); as.forEach(a => all ? selected.delete(a.id) : selected.add(a.id)); saveSel(); paint(); loadCreators(); return; }
    const lb = e.target.closest("[data-label]");
    if(lb){ const a = accounts().find(x => x.id === lb.dataset.label); if(!a) return;
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "pub-label-in"; inp.value = a.label || ""; inp.placeholder = "Artist or profile name"; inp.maxLength = 40;
      lb.replaceWith(inp); inp.focus();
      const done = save => { if(save) updateAccount(a.id, { label: inp.value.trim() }); paint(); };
      inp.onkeydown = ev => { if(ev.key === "Enter") done(true); if(ev.key === "Escape"){ ev.stopPropagation(); done(false); } };
      inp.onblur = () => done(true); return; }
    const rm = e.target.closest("[data-rm]");
    if(rm){ if(!rm.dataset.sure){ rm.dataset.sure = "1"; rm.textContent = "Remove?"; setTimeout(() => { if(rm.isConnected){ delete rm.dataset.sure; rm.textContent = "✕"; } }, 3000); return; }
      const a = accounts().find(x => x.id === rm.dataset.rm); saveAccounts(accounts().filter(x => x.id !== rm.dataset.rm)); selected.delete(rm.dataset.rm); saveSel(); paint();
      if(a) toast(`${a.name} removed from this browser. To cut the app off completely, remove its access in ${P[a.platform]}'s settings.`); }
  });
  $("#pubYtPriv").onclick = e => { const b = e.target.closest("button"); if(!b) return; ytPriv = b.dataset.v; keep.set("sls-pub-ytpriv", ytPriv); paint(); };

  /* ---------- linking: the platform's login opens in a new window and comes back to /api/oauth/... ---------- */
  $("#pubLink").onclick = async e => {
    const b = e.target.closest("[data-link]"); if(!b || b.disabled) return;
    const p = b.dataset.link, w = window.open("", "sls-link", "width=520,height=760");   // opened right away so popup blockers allow it
    if(!(await SLSApp.ensurePass())){ if(w) w.close(); return; }
    try {
      const d = await api.api("/api/publish/connect", { method: "POST", body: { platform: p }, timeout: 20000 });
      if(w) w.location = d.url; else location.href = d.url;
      toast(`Log in to ${P[p]} in the new window and allow access. Pick the account or channel you want to post to.`);
    } catch(err){ if(w) w.close(); toast(errText(err)); }
  };
  addEventListener("message", e => {
    if(e.origin !== location.origin || !e.data || e.data.sls !== "account") return;
    if(e.data.ok){ if(e.data.id){ selected.add(e.data.id); saveSel(); } const a = accounts().find(x => x.id === e.data.id); toast(`${a ? a.name : "The account"} is linked.` + (a && !a.label ? " Give it an artist name to group it." : "")); }
    else if(e.data.problem) toast(e.data.problem);
    if(!m.hidden){ paint(); loadCreators(); }
  });
  addEventListener("storage", e => { if(e.key === "sls-accounts" && !m.hidden) paint(); });

  /* ---------- posting ---------- */
  let posting = false;
  const jobs = [];
  function paintJobs(){
    $("#pubJobs").innerHTML = jobs.map(j => `<div class="fx-job pub-job ${j.state}"><span class="fx-dot"></span><span class="fx-jt">${ICON[j.platform]} ${esc(j.name)}</span>
      <span class="hint">${esc(j.text)}${j.url ? ` · <a href="${esc(j.url)}" target="_blank" rel="noopener">Open</a>` : ""}</span>${j.state === "uploading" ? `<span class="bar"><i style="width:${(j.pct * 100).toFixed(0)}%"></i></span>` : ""}</div>`).join("");
  }
  const b64 = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function metaFor(a){
    const caption = $("#pubCaption").value.trim(), ai = $("#pubAi").checked;
    if(a.platform === "youtube") return { title: $("#pubYtTitle").value.trim() || S.songName, caption, privacy: ytPriv, ai, tags: ["lyrics", "lyric video", S.songName].filter(Boolean) };
    if(a.platform === "instagram") return { caption, feed: $("#pubFeed").checked, ai };
    const o = ttOpt(a.id);
    return o.mode === "direct" ? { mode: "direct", caption, privacy: o.privacy, comment: !!o.comment, duet: !!o.duet, stitch: !!o.stitch, brandOrganic: !!(o.commercial && o.brandOrganic), brandContent: !!(o.commercial && o.brandContent), ai }
      : { mode: "draft" };
  }
  $("#pubGo").onclick = async () => {
    const sel = accounts().filter(a => selected.has(a.id) && !fits(a.platform)); if(!sel.length || posting) return;
    if(!(await SLSApp.ensurePass())) return;
    posting = true; paintGo(sel);
    const blob = video.blob, mine = sel.map(a => ({ id: a.id, platform: a.platform, name: a.name, state: "waiting", text: "Waiting…", pct: 0, meta: metaFor(a) }));
    jobs.unshift(...mine); paintJobs(); $("#pubJobs").scrollIntoView({ block: "nearest", behavior: "smooth" });
    // On Vercel the video goes to Vercel Blob once, and each platform is fed from there (requests there carry at most 4.5 MB)
    let src = null;
    if(health && health.publish && health.publish.blob){
      mine.forEach(j => { j.state = "uploading"; j.text = "Uploading the video…"; }); paintJobs();
      try { src = await toBlob(blob, p => { mine.forEach(j => j.pct = p); paintJobs(); }); }
      catch(err){ mine.forEach(j => Object.assign(j, { state: "failed", text: "The video couldn't be uploaded: " + errText(err) })); paintJobs(); posting = false; paint(); return; }
      mine.forEach(j => { j.state = "waiting"; j.text = "Waiting…"; j.pct = 0; }); paintJobs();
    }
    const follows = [];
    for(const j of mine){   // one at a time: each upload carries the whole file
      const a = accounts().find(x => x.id === j.id);
      j.state = "uploading"; j.text = src ? `Sending to ${P[j.platform]}…` : `Uploading to ${P[j.platform]}…`; paintJobs();
      try {
        const body = src ? new Blob([JSON.stringify({ src, type: blob.type || "video/mp4" })], { type: "application/json" }) : blob;
        const d = await api.send(`/api/publish/${j.platform}`, body, { headers: { "content-type": src ? "application/json" : (blob.type || "video/mp4"), "x-sls-account": a.sealed, "x-sls-meta": b64(j.meta) }, onProgress: p => { if(!src){ j.pct = p; paintJobs(); } } });
        if(d.account) updateAccount(a.id, { sealed: d.account });
        Object.assign(j, { ref: d.ref, url: d.url || null, state: d.state === "done" ? "added" : "working", text: d.note || (d.state === "done" ? "Done." : "Processing…") });
        if(j.state === "working") follows.push(follow(j));
      } catch(err){ Object.assign(j, { state: "failed", text: errText(err) }); }
      paintJobs();
    }
    posting = false; paint();
    if(src){ await Promise.allSettled(follows); api.api("/api/publish/blob-done", { method: "POST", body: { url: src }, timeout: 20000 }).catch(() => {}); }   // the stored copy is deleted once every post is through
  };
  /* uploads the file to Vercel Blob with Vercel's own browser library; the server only hands out the upload token */
  async function toBlob(file, onProgress){
    const lib = await import(window.SLS_BLOB_CLIENT || "https://esm.sh/@vercel/blob@2/client");
    const ext = (video && video.f && video.f.ext) || "mp4", name = (S.songName || "lyric-video").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lyric-video";
    const r = await lib.upload(`sls-posts/${name}.${ext}`, file, { access: "public", handleUploadUrl: "/api/publish/blob", contentType: file.type || "video/mp4",
      clientPayload: JSON.stringify({ pass: api.passcode() }), multipart: file.size > 20 * 1048576, onUploadProgress: e => onProgress((e && e.percentage || 0) / 100) });
    return r.url;
  }
  async function follow(j){
    const t0 = Date.now();
    while(Date.now() - t0 < 15 * 60e3){
      await new Promise(r => setTimeout(r, j.platform === "instagram" ? 8000 : 6000));
      const a = accounts().find(x => x.id === j.id); if(!a) return;
      try {
        const d = await api.api("/api/publish/status", { method: "POST", body: { platform: j.platform, account: a.sealed, ref: j.ref }, timeout: 60000 });
        if(d.account) updateAccount(a.id, { sealed: d.account });
        if(d.state === "done"){ Object.assign(j, { state: "added", text: d.note || "Done.", url: d.url || j.url }); paintJobs(); toast(`${P[j.platform]} · ${j.name}: ${d.note || "done"}`); return; }
        if(d.state === "failed"){ Object.assign(j, { state: "failed", text: d.note || "Failed." }); paintJobs(); return; }
      } catch(err){ if(err.code === "relink" || err.code === "unauthorized"){ Object.assign(j, { state: "failed", text: errText(err) }); paintJobs(); return; } }
    }
    Object.assign(j, { state: "failed", text: `Still processing after 15 minutes. Check ${P[j.platform]} directly.` }); paintJobs();
  }

  /* a "Post" button next to Save in the export window */
  const save = $("#exSave");
  if(save){ const b = document.createElement("button"); b.className = "btn primary"; b.id = "exPublish"; b.type = "button"; b.textContent = "Post to accounts…"; save.after(b); save.classList.remove("primary"); b.onclick = open; }
  return { open, accounts };
})();

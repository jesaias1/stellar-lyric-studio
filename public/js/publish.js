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

  /* ---------- accounts: they belong to the logged-in user (kept in their account, see auth.js) ---------- */
  const store = window.SLSAuth.accounts;
  const accounts = () => store.all().filter(a => a && a.id && P[a.platform] && a.sealed);
  const updateAccount = (id, patch) => store.update(id, patch);
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
      <div class="field"><div class="row pub-cap-h"><span class="hint">Caption <span id="pubCapFor"></span></span><button class="btn small ghost" id="pubWrite" type="button">✨ Write a caption</button></div>
        <textarea id="pubCaption" rows="3" maxlength="2200" aria-label="Caption"></textarea>
        <div class="hint pub-undo" id="pubUndo" hidden>Your old caption was replaced. <button class="btn small ghost" id="pubUndoBtn" type="button">Undo</button></div></div>
      <label class="field" data-for="youtube"><span class="hint">YouTube title</span><input type="text" id="pubYtTitle" maxlength="100"></label>
      <div class="field" data-for="youtube"><span class="hint">YouTube visibility</span><div class="seg" id="pubYtPriv"><button data-v="public">Public</button><button data-v="unlisted">Unlisted</button><button data-v="private">Private</button></div></div>
      <label class="ph-only" data-for="instagram"><input type="checkbox" id="pubFeed" checked> Also show the Reel in the Instagram profile grid</label>
      <label class="ph-only"><input type="checkbox" id="pubAi"> Label it as made with AI <span class="hint">(turn on when it uses AI backgrounds)</span></label>
    </div>
    <div class="pub-tts" id="pubTT"></div>
    <div class="field pub-when" id="pubWhen"><span class="label">When</span>
      <div class="seg" id="pubWhenSeg" role="group" aria-label="When to post"><button type="button" data-w="now" aria-pressed="true">Post now</button><button type="button" data-w="later" aria-pressed="false">Schedule</button></div>
      <div class="pub-sched" id="pubSched" hidden><input type="datetime-local" id="pubAt" aria-label="Date and time to post"><span class="hint">The studio posts it for you at that time, even if your computer is off.</span></div>
      <div class="hint pub-warn" id="pubSchedWhy"></div></div>
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
    $("#pubUndo").hidden = true; await getHealth(true); paint(); loadCreators();
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
  function ttOpt(id){ const o = tt[id] || (tt[id] = { mode: "draft" }); if(o.seed == null) o.seed = true; return o; }
  /* "Use the official sound": TikTok's API can't attach a sound, so the video goes to the account's drafts and
     the artist adds the song's official sound in the TikTok app before posting (that links the post to it,
     instead of starting a new "original sound"). The studio knows where in the song the clip starts. */
  const clock = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return m + ":" + String(Math.floor(t - m * 60)).padStart(2, "0"); };
  const songTitle = () => String(S.songName || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/\s*\((preview|lyrics?)\)\s*$/i, "").trim();
  /* the steps to finish a seeded draft in TikTok. snd: { url, popular, videos, noTrim }. On a phone the links are buttons
     that open the TikTok app (TikTok's links open the app when it's installed). */
  function seedSteps(name, title, start, snd = {}){
    const url = snd.url || "", what = snd.popular ? `popular sound${snd.videos != null ? ` (${fmtCount(snd.videos)} videos)` : ""}` : "official sound";
    return `<ol class="pub-seed" aria-label="Sound seeding in TikTok">${url ? `<li>On the phone, open the <a href="${esc(url)}" target="_blank" rel="noopener">${what}</a> in TikTok and tap <b>Add to Favourites</b> (the bookmark). <a class="btn small pub-tt-open" href="${esc(url)}" target="_blank" rel="noopener">Open the sound in TikTok</a></li>` : ""}
      <li>Open TikTok on <b>${esc(name)}</b> and tap the notification to open the draft. <a class="btn small pub-tt-open" href="https://www.tiktok.com/" target="_blank" rel="noopener">Open TikTok</a></li>
      ${url ? `<li>Tap <b>Sounds</b>, then <b>Favourites</b>, and pick the ${snd.popular ? "popular" : "official"} sound.</li>` : `<li>Tap <b>Sounds</b>, search <b>${esc(title || "the song")}</b> and pick the official sound (the artist's name, not "original sound").</li>`}
      ${snd.noTrim ? `<li>Leave the sound untrimmed: it already starts where this clip starts.</li>` : `<li>Trim the sound so it starts at <b>${clock(start)}</b>, where this clip starts in the song.</li>`}
      <li>Tap <b>Volume</b> and set <b>Original sound</b> to 0 %, then post.</li></ol>`;
  }
  const fmtCount = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n);
  /* the song's official TikTok sound link, saved once for the whole team (Supabase table song_sounds) */
  const songKey = () => songTitle().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 200);
  const SOUND_URL = /^https:\/\/([a-z]+\.)?tiktok\.com\/\S+$/i;
  const sounds = {}, helpOpen = {}; let soundDraft = "", soundEdit = false;
  async function loadSound(){
    const k = songKey(); if(!k || sounds[k] || SLSAuth.mode !== "accounts") return;
    sounds[k] = { loading: true };
    try { const rows = await SLSAuth.rest(`song_sounds?select=tiktok_url,title,clip_url,clip_videos,clip_from&key=eq.${encodeURIComponent(k)}`), r = rows && rows[0] || {};
      // the popular sound (from "Match the TikTok sound") is used when it's a sound link of its own; else the official one
      const pop = r.clip_url && /tiktok\.com\/music\//i.test(r.clip_url) ? r.clip_url : "";
      sounds[k] = { url: r.tiktok_url || "", pop, videos: r.clip_videos ?? null, popFrom: r.clip_from || "" }; }
    catch { sounds[k] = { url: "", error: true }; }
    paint();
  }
  // which sound the draft should use: the popular one people already use, else the official one
  const soundInfo = () => { const st = sounds[songKey()] || {};
    if(st.pop) return { url: st.pop, popular: true, videos: st.videos, noTrim: st.popFrom === "link" };
    return st.url ? { url: st.url } : {}; };
  const soundUrl = () => soundInfo().url || "";
  function soundBlock(){
    const k = songKey(), st = sounds[k] || {}, title = songTitle();
    if(SLSAuth.mode !== "accounts" || !k) return "";
    if(st.loading) return `<div class="pub-sound hint">Looking for the song's official TikTok sound…</div>`;
    if(st.pop && !soundEdit) return `<div class="pub-sound pub-sound-row"><span><b>Sound seeding</b> · the popular TikTok sound for “${esc(title)}”${st.videos != null ? ` (${fmtCount(st.videos)} videos)` : ""} · <a href="${esc(st.pop)}" target="_blank" rel="noopener">open in TikTok ↗</a></span><button class="link-btn tt-match" type="button">Change</button></div>`;
    if(st.url && !soundEdit) return `<div class="pub-sound pub-sound-row"><span><b>Sound seeding</b> · official sound for “${esc(title)}” saved · <a href="${esc(st.url)}" target="_blank" rel="noopener">open in TikTok ↗</a></span><button class="link-btn" type="button" data-sound="change">Change</button></div>`;
    return `<div class="pub-sound"><label class="field"><span><b>Sound seeding</b> · the official TikTok sound link for “${esc(title)}” <span class="hint">(optional, saved once for the whole team)</span></span>
      <span class="row" style="gap:6px"><input type="url" id="pubSoundUrl" placeholder="https://www.tiktok.com/music/…" value="${esc(soundDraft || st.url || "")}" style="flex:1"><button class="btn small" type="button" data-sound="save">Save</button>${st.url ? `<button class="btn small ghost" type="button" data-sound="cancel">Cancel</button>` : ""}</span></label>
      <details class="pub-howto"><summary>How to get the link (30 seconds)</summary><ol>
        <li>In TikTok, open any video that uses the song's <b>official</b> sound (it shows the artist's name, not "original sound").</li>
        <li>Tap the spinning record at the bottom right to open the sound.</li>
        <li>Tap <b>Share</b> (the arrow), then <b>Copy link</b>.</li>
        <li>Paste it here and press <b>Save</b>. Everyone on the team gets it for this song from now on.</li></ol></details></div>`;
  }
  async function saveSound(){
    const v = ($("#pubSoundUrl") || {}).value ? $("#pubSoundUrl").value.trim() : "";
    if(!SOUND_URL.test(v)){ toast("Paste a TikTok link: it starts with https://www.tiktok.com/ or https://vm.tiktok.com/"); return; }
    const k = songKey();
    try { await SLSAuth.rest("song_sounds", { method: "POST", body: { key: k, title: songTitle(), tiktok_url: v }, prefer: "resolution=merge-duplicates,return=minimal" });
      sounds[k] = { url: v }; soundDraft = ""; soundEdit = false; paint(); toast("Saved: the official sound is now linked to this song for everyone."); }
    catch(err){ toast("The link couldn't be saved: " + (err.message || "try again")); }
  }
  // only the mode is remembered: TikTok wants privacy and the rest chosen fresh every time, with nothing preset
  const saveTT = () => keep.set("sls-pub-tt", Object.fromEntries(Object.entries(tt).map(([k, v]) => [k, { mode: v.mode, seed: v.seed }])));
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
    const len = S.P.section.b - S.P.section.a, seeding = list.some(a => ttOpt(a.id).seed);
    if(seeding) loadSound();
    $("#pubTT").innerHTML = (seeding ? soundBlock() : "") + list.map(a => {
      const o = ttOpt(a.id), direct = (a.scopes || []).includes("direct"), c = creator[a.id] || {};
      if(o.mode === "direct" && (!direct || o.seed)) o.mode = "draft";
      let body = "";
      if(o.seed) body = `<div class="hint pub-seed-sum">${later() ? "At the chosen time it" : "It"} lands in the TikTok drafts of <b>${esc(a.name)}</b>, where the ${soundInfo().popular ? "popular" : "official"} sound is added before posting. <button class="pub-help" type="button" data-help="${esc(a.id)}" aria-expanded="${!!helpOpen[a.id]}"><span aria-hidden="true">?</span>How sound seeding works</button></div>${helpOpen[a.id] ? seedSteps(a.name, songTitle(), S.P.section.a, soundInfo()) : ""}`;
      else if(o.mode === "draft") body = `<div class="hint">It lands in the TikTok inbox of <b>${esc(a.name)}</b>: open TikTok, tap the notification, then add sounds or edit and post. At most 5 drafts can wait at a time.</div>`;
      else if(c.loading) body = `<div class="hint">Checking what ${esc(a.name)} can post…</div>`;
      else if(c.error) body = `<div class="hint pub-warn">${esc(c.error)}</div>`;
      else {
        // before TikTok approves the app it refuses every direct post that isn't private
        const audited = !!(health && health.publish && health.publish.tiktokAudited), opts = (c.privacy_level_options || []).filter(v => audited || v === "SELF_ONLY"), tooLong = c.max_video_post_duration_sec && len > c.max_video_post_duration_sec;
        const branded = !!o.brandContent;
        body = `<div class="hint">Posting as <b>${esc(c.creator_nickname || a.name)}</b>${c.creator_username ? ` (@${esc(c.creator_username)})` : ""}. TikTok can take a few minutes to process it before it shows on the profile.</div>
          ${tooLong ? `<div class="hint pub-warn">This account can post up to ${c.max_video_post_duration_sec} s; the video is ${len.toFixed(0)} s.</div>` : ""}
          ${audited ? "" : `<span class="hint pub-warn">Until TikTok approves the app, direct posts can only be private (Only me). Make it public in TikTok afterwards, or use Send to drafts.</span>`}<label class="field"><span class="hint">Who can see it</span><select data-tt="privacy" data-id="${esc(a.id)}"><option value="">Choose…</option>${opts.map(v => `<option value="${v}" ${o.privacy === v ? "selected" : ""} ${branded && v === "SELF_ONLY" ? "disabled" : ""}>${PRIV[v] || v}${branded && v === "SELF_ONLY" ? " (not for branded content)" : ""}</option>`).join("")}</select></label>
          <div class="pub-checks"><span class="hint">Allow</span>
            ${[["comment", "Comments", c.comment_disabled], ["duet", "Duet", c.duet_disabled], ["stitch", "Stitch", c.stitch_disabled]].map(([k, l, dis]) => `<label class="ph-only${dis ? " dim" : ""}" title="${dis ? "Turned off in this account's TikTok settings" : ""}"><input type="checkbox" data-tt="${k}" data-id="${esc(a.id)}" ${o[k] && !dis ? "checked" : ""} ${dis ? "disabled" : ""}> ${l}</label>`).join("")}</div>
          <label class="ph-only"><input type="checkbox" data-tt="commercial" data-id="${esc(a.id)}" ${o.commercial ? "checked" : ""}> Disclose commercial content <span class="hint">(promotes a brand, product or service)</span></label>
          ${o.commercial ? `<div class="pub-checks pub-indent">
            <label class="ph-only"><input type="checkbox" data-tt="brandOrganic" data-id="${esc(a.id)}" ${o.brandOrganic ? "checked" : ""}> Your brand <span class="hint">(labelled “Promotional content”)</span></label>
            <label class="ph-only"><input type="checkbox" data-tt="brandContent" data-id="${esc(a.id)}" ${o.brandContent ? "checked" : ""}> Branded content <span class="hint">(a paid partnership, labelled as such)</span></label>
            ${!o.brandOrganic && !o.brandContent ? `<div class="hint pub-warn">Pick at least one, or turn disclosure off.</div>` : ""}</div>` : ""}`;
      }
      return `<div class="pub-tt" data-id="${esc(a.id)}"><div class="row" style="justify-content:space-between"><b class="pub-tt-h">${ICON.tiktok} ${esc(a.name)}</b>
        <div class="seg"><button data-tt="mode" data-v="draft" data-id="${esc(a.id)}" aria-pressed="${o.mode === "draft"}">Send to drafts</button><button data-tt="mode" data-v="direct" data-id="${esc(a.id)}" aria-pressed="${o.mode === "direct"}" ${direct && !o.seed ? "" : `disabled title="${o.seed ? "Turn off sound seeding to post directly" : "This TikTok login only allows drafts"}"`}>Post directly</button></div></div>
        <label class="ph-only pub-seed-on"><input type="checkbox" data-tt="seed" data-id="${esc(a.id)}" ${o.seed ? "checked" : ""}> <b>Sound seeding</b> <span class="hint">links the post to the song's official TikTok sound, so it counts for the song instead of starting a new "original sound" (for released songs)</span></label>${body}</div>`;
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
  $("#pubTT").addEventListener("input", e => { if(e.target.id === "pubSoundUrl") soundDraft = e.target.value; });
  $("#pubTT").addEventListener("keydown", e => { if(e.target.id === "pubSoundUrl" && e.key === "Enter"){ e.preventDefault(); saveSound(); } });
  $("#pubTT").addEventListener("click", e => {
    const sb = e.target.closest("[data-sound]");
    const hb = e.target.closest("[data-help]"); if(hb){ helpOpen[hb.dataset.help] = !helpOpen[hb.dataset.help]; paint(); return; }
    if(sb){ const k = sb.dataset.sound; if(k === "save") saveSound(); if(k === "change"){ soundEdit = true; paint(); } if(k === "cancel"){ soundEdit = false; soundDraft = ""; paint(); } return; }
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

  /* ---------- when: now or later ---------- */
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p2 = n => String(n).padStart(2, "0");
  const toLocalInput = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const niceWhen = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} at ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const minAt = () => new Date(Date.now() + 10 * 60e3);
  let when = keep.get("sls-when", "now") === "later" ? "later" : "now";
  function scheduleBlock(){
    if(!window.SLSAuth || SLSAuth.mode !== "accounts") return "Scheduling needs a login.";
    if(health && health.publish && !health.publish.blob) return "Scheduling needs the site's video storage.";
    return "";
  }
  function setAtDefaults(){
    const at = $("#pubAt"), min = minAt(); at.min = toLocalInput(min);
    const cur = at.value ? new Date(at.value) : null;
    if(!cur || isNaN(cur) || cur < new Date()){ const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); at.value = toLocalInput(d); }
  }
  const later = () => when === "later" && !scheduleBlock();
  function atProblem(){
    const d = new Date($("#pubAt").value);
    if(!$("#pubAt").value || isNaN(d)) return "Pick a date and time to post.";
    if(d < new Date(Date.now() + 9.5 * 60e3)) return "Pick a time at least 10 minutes from now.";
    return "";
  }
  $("#pubWhenSeg").onclick = e => { const b = e.target.closest("button[data-w]"); if(!b || b.disabled) return; when = b.dataset.w; keep.set("sls-when", when); paint(); };
  $("#pubAt").addEventListener("input", () => paint());

  function paintGo(sel){
    const block = scheduleBlock(), sched = when === "later" && !block;
    $$("#pubWhenSeg button").forEach(b => { b.setAttribute("aria-pressed", String(b.dataset.w === (sched ? "later" : "now"))); if(b.dataset.w === "later") b.disabled = !!block; });
    $("#pubSched").hidden = !sched; $("#pubSchedWhy").textContent = block;
    if(sched) setAtDefaults();
    const problems = sel.map(a => a.platform === "tiktok" ? ttProblem(a) : "").filter(Boolean);
    if(sched && sel.length && atProblem()) problems.push(atProblem());
    const go = $("#pubGo"), n = sel.length;
    go.textContent = n ? `${sched ? "Schedule for" : "Post to"} ${n} account${n === 1 ? "" : "s"}` : sched ? "Schedule" : "Post";
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
      const a = accounts().find(x => x.id === rm.dataset.rm); store.remove(rm.dataset.rm); selected.delete(rm.dataset.rm); saveSel(); paint();
      if(a) toast(`${a.name} removed from your account. To cut the app off completely, remove its access in ${P[a.platform]}'s settings.`); }
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
    if(e.data.ok){ if(e.data.record && e.data.record.sealed) store.put(e.data.record); else store.adoptNew();
      if(e.data.id){ selected.add(e.data.id); saveSel(); } const a = accounts().find(x => x.id === e.data.id); toast(`${a ? a.name : "The account"} is linked.` + (a && !a.label ? " Give it an artist name to group it." : "")); }
    else if(e.data.problem) toast(e.data.problem);
    if(!m.hidden){ paint(); loadCreators(); }
  });
  addEventListener("sls-accounts", () => { if(!m.hidden) paint(); });

  /* ---------- posting ---------- */
  let posting = false;
  const jobs = [];
  function paintJobs(){
    $("#pubJobs").innerHTML = jobs.map(j => `<div class="fx-job pub-job ${j.state}"><span class="fx-dot"></span><span class="fx-jt">${ICON[j.platform]} ${esc(j.name)}</span>
      <span class="hint">${esc(j.text)}${j.cal ? ` <button class="btn small" type="button" data-cal="${esc(j.cal)}">Open calendar</button>` : ""}${j.url ? ` · <a href="${esc(j.url)}" target="_blank" rel="noopener">Open</a>` : ""}</span>${j.state === "uploading" ? `<span class="bar"><i style="width:${(j.pct * 100).toFixed(0)}%"></i></span>` : ""}</div>`).join("");
  }
  const b64 = obj => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // which part of the song the post uses (and whether it's the matched TikTok sound), kept with the post for comparing results
  // plus the look, the frame shape and which of the song's best parts it is, so the calendar can compare versions
  const clipInfo = () => {
    const part = (S.P.bites || []).findIndex(p => Math.abs(S.P.section.a - p.a) < 0.3 && Math.abs(S.P.section.b - Math.min(p.b, p.a + 60)) < 0.3);
    return { a: +S.P.section.a.toFixed(2), b: +S.P.section.b.toFixed(2), ...(S.P.ttSound && Math.abs(S.P.ttSound.a - S.P.section.a) < 0.3 ? { tiktok: true } : {}),
      look: styleDef(S.P.style.preset).name, size: S.P.aspect, ...(part >= 0 ? { part: part + 1 } : {}) };
  };
  function metaFor(a){
    const caption = $("#pubCaption").value.trim(), ai = $("#pubAi").checked;
    if(a.platform === "youtube") return { title: $("#pubYtTitle").value.trim() || S.songName, caption, privacy: ytPriv, ai, tags: ["lyrics", "lyric video", S.songName].filter(Boolean) };
    if(a.platform === "instagram") return { caption, feed: $("#pubFeed").checked, ai };
    const o = ttOpt(a.id);
    return o.mode === "direct" ? { mode: "direct", caption, privacy: o.privacy, comment: !!o.comment, duet: !!o.duet, stitch: !!o.stitch, brandOrganic: !!(o.commercial && o.brandOrganic), brandContent: !!(o.commercial && o.brandContent), ai }
      : { mode: "draft", ...(o.seed ? { seed: { song: songTitle(), start: +S.P.section.a.toFixed(2), ...(soundUrl() ? { url: soundUrl() } : {}), ...(soundInfo().popular ? { popular: true, videos: soundInfo().videos ?? null, noTrim: !!soundInfo().noTrim } : {}) } } : {}) };
  }
  /* ---------- "Post it again?": the same video, or the same song on the same account in the last day ---------- */
  const sent = new WeakMap();   // exported video -> Map(account id -> { at, sched })
  function markSent(sel, sched){ const mp = sent.get(video.blob) || new Map(); sel.forEach(a => mp.set(a.id, { at: Date.now(), sched })); sent.set(video.blob, mp); }
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : (d => `at ${p2(d.getHours())}:${p2(d.getMinutes())}`)(new Date(t)); };
  async function repeats(sel){
    const out = [], mine = sent.get(video.blob), seen = new Set();
    sel.forEach(a => { const x = mine && mine.get(a.id); if(x){ seen.add(a.id); out.push(`<b>${esc(a.name)}</b> (${P[a.platform]}): this video was ${x.sched ? "scheduled" : "posted"} ${ago(x.at)}`); } });
    if(window.SLSAuth && SLSAuth.mode === "accounts" && S.songName){
      try {
        const since = new Date(Date.now() - 24 * 3600e3).toISOString(), ids = sel.filter(a => !seen.has(a.id)).map(a => a.id);
        const rows = ids.length ? await Promise.race([SLSAuth.rest(`posts?select=account_id,status,publish_at&project_name=eq.${encodeURIComponent(S.songName)}&account_id=in.(${ids.map(i => `"${i}"`).join(",")})&status=in.(scheduled,posting,working,posted)&publish_at=gte.${encodeURIComponent(since)}&order=publish_at.desc`), new Promise(r => setTimeout(() => r([]), 4000))]) : [];
        (Array.isArray(rows) ? rows : []).forEach(r => { if(seen.has(r.account_id)) return; seen.add(r.account_id); const a = sel.find(x => x.id === r.account_id); if(!a) return;
          const t = new Date(r.publish_at), fut = r.status === "scheduled" && t > new Date();
          out.push(`<b>${esc(a.name)}</b> (${P[a.platform]}): “${esc(S.songName)}” ${fut ? `is already scheduled for ${niceWhen(t)}` : `was already posted ${ago(+t)}`}`); });
      } catch(err){ console.warn("couldn't check earlier posts", err); }
    }
    return out;
  }
  function askAgain(lines, sched){
    return new Promise(done => {
      const d = document.createElement("div"); d.className = "modal pub-again"; d.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="pubAgainH" aria-describedby="pubAgainB">
        <h2 id="pubAgainH">${sched ? "Schedule it again?" : "Post it again?"}</h2>
        <div id="pubAgainB"><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul><p class="hint">${sched ? "Scheduling again" : "Posting again"} puts a second copy on ${lines.length === 1 ? "that account" : "those accounts"}.</p></div>
        <div class="row ph-actions"><button class="btn" type="button" data-a="no">Cancel</button><button class="btn primary" type="button" data-a="yes">${sched ? "Schedule again" : "Post again"}</button></div></div>`;
      const end = ok => { d.remove(); removeEventListener("keydown", key, true); done(ok); };
      const key = e => { if(e.key === "Escape"){ e.stopPropagation(); e.preventDefault(); end(false); } };
      d.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if(b) end(b.dataset.a === "yes"); else if(e.target === d) end(false); });
      addEventListener("keydown", key, true); document.body.append(d); d.querySelector("[data-a=no]").focus();
    });
  }
  let checking = false;
  $("#pubGo").onclick = async () => {
    const sel = accounts().filter(a => selected.has(a.id) && !fits(a.platform)); if(!sel.length || posting || checking) return;
    if(!(await SLSApp.ensurePass())) return;
    checking = true; const go = $("#pubGo"); go.disabled = true;
    let again; try { again = await repeats(sel); } finally { checking = false; go.disabled = false; }
    if(again.length && !(await askAgain(again, later()))){ paint(); return; }
    if(later()) return schedule(sel);
    markSent(sel, false);
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
        if(j.state === "working") follows.push(follow(j).then(() => record(j))); else record(j);
      } catch(err){ Object.assign(j, { state: "failed", text: errText(err) }); record(j); }
      paintJobs();
    }
    posting = false; paint();
    if(src){ await Promise.allSettled(follows); api.api("/api/publish/blob-done", { method: "POST", body: { url: src }, timeout: 20000 }).catch(() => {}); }   // the stored copy is deleted once every post is through
  };
  /* ---------- scheduling: the video goes to storage once, and one row per account goes in the calendar ---------- */
  async function schedule(sel){
    const d = new Date($("#pubAt").value), bad = atProblem(); if(bad){ toast(bad); return; }
    markSent(sel, true);
    posting = true; paintGo(sel);
    const blob = video.blob, type = blob.type || "video/mp4", mine = sel.map(a => ({ id: a.id, platform: a.platform, name: a.name, state: "uploading", text: "Uploading the video…", pct: 0, meta: metaFor(a), artist: a.label || "" }));
    jobs.unshift(...mine); paintJobs(); $("#pubJobs").scrollIntoView({ block: "nearest", behavior: "smooth" });
    let src = null;
    try { src = await toBlob(blob, p => { mine.forEach(j => j.pct = p); paintJobs(); }); }
    catch(err){ mine.forEach(j => Object.assign(j, { state: "failed", text: "The video couldn't be uploaded: " + errText(err) })); paintJobs(); posting = false; paint(); return; }
    mine.forEach(j => Object.assign(j, { text: "Saving to the calendar…", pct: 0 })); paintJobs();
    const iso = d.toISOString();
    try {
      const rows = await SLSAuth.rest("posts", { method: "POST", prefer: "return=representation", body: mine.map(j => ({ platform: j.platform, account_id: j.id, account_name: j.name, project_name: S.songName || "", artist: j.artist, video_url: src, video_type: type, cover_url: null, meta: { ...j.meta, clip: clipInfo() }, publish_at: iso, status: "scheduled" })) });
      if(!Array.isArray(rows) || rows.length < mine.length) throw new Error("The calendar didn't save it.");
      mine.forEach(j => Object.assign(j, { state: "added", cal: iso, text: `Scheduled for ${niceWhen(d)} on ${j.name} (${P[j.platform]}). See it in the calendar.` }));
      toast(mine.length === 1 ? "Scheduled." : `Scheduled on ${mine.length} accounts.`);
      window.dispatchEvent(new Event("sls-posts-changed"));
    } catch(err){
      mine.forEach(j => Object.assign(j, { state: "failed", text: "The video was uploaded but the post couldn't be saved: " + errText(err) }));
      api.api("/api/publish/blob-done", { method: "POST", body: { url: src }, timeout: 20000 }).catch(() => {});
    }
    paintJobs(); posting = false; paint();
  }
  /* a line in the calendar for every post that went out now, so the history is in one place */
  async function record(j){
    try {
      if(!window.SLSAuth || SLSAuth.mode !== "accounts" || (j.state !== "added" && j.state !== "failed")) return;
      const a = accounts().find(x => x.id === j.id) || {}, ok = j.state === "added";
      await SLSAuth.rest("posts", { method: "POST", body: { platform: j.platform, account_id: j.id, account_name: j.name, project_name: S.songName || "", artist: a.label || "", video_url: null, video_type: (video && video.blob.type) || "video/mp4", cover_url: null, meta: { ...j.meta, clip: clipInfo() }, publish_at: new Date().toISOString(), status: ok ? "posted" : "failed", ref: j.ref || null, result_url: ok ? (j.url || null) : null, note: String(j.text || "").slice(0, 500) } });
      window.dispatchEvent(new Event("sls-posts-changed"));
    } catch(err){ console.warn("post history not saved", err); }
  }
  $("#pubJobs").addEventListener("click", e => { const b = e.target.closest("[data-cal]"); if(b && window.SLSCalendar) SLSCalendar.open(b.dataset.cal); });

  /* ---------- "Write a caption": only when asked ---------- */
  let capBefore = null;
  const soundbiteLyrics = () => {
    let lines = []; try { lines = lineGroups().filter(g => g[0].t >= S.P.section.a - 0.3 && g[0].t < S.P.section.b).map(g => g.map(w => w.w).join(" ")); } catch {}
    return lines.join(" / ").slice(0, 1500);
  };
  $("#pubWrite").onclick = async () => {
    const btn = $("#pubWrite"); if(btn.disabled) return;
    const sel = accounts().filter(a => selected.has(a.id) && !fits(a.platform)), a = sel[0];
    btn.disabled = true; btn.classList.add("busy"); btn.textContent = "Writing…";
    try {
      const d = await api.api("/api/caption", { method: "POST", timeout: 30000, body: { platform: a ? a.platform : "tiktok", title: S.songName, artist: a ? (a.label || a.name) : "", lyrics: soundbiteLyrics(), language: S.P.lang || "" } });
      const tags = (d.hashtags || []).map(h => "#" + String(h).replace(/^#/, "")).join(" "), text = [d.caption || "", tags].filter(Boolean).join("\n\n");
      if(!text) throw new Error("No caption came back. Try again.");
      const cap = $("#pubCaption"), old = cap.value;
      cap.value = text.slice(0, 2200); cap.dispatchEvent(new Event("input", { bubbles: true }));
      if(old.trim()){ capBefore = old; $("#pubUndo").hidden = false; } else { capBefore = null; $("#pubUndo").hidden = true; }
    } catch(err){ toast(errText(err)); }
    btn.disabled = false; btn.classList.remove("busy"); btn.textContent = "✨ Write a caption";
  };
  $("#pubUndoBtn").onclick = () => { if(capBefore != null) $("#pubCaption").value = capBefore; capBefore = null; $("#pubUndo").hidden = true; };
  $("#pubCaption").addEventListener("input", e => { if(e.isTrusted) $("#pubUndo").hidden = true; });

  /* uploads the file to Vercel Blob with Vercel's own browser library; the server only hands out the upload token */
  async function toBlob(file, onProgress){
    const lib = await import(window.SLS_BLOB_CLIENT || "https://esm.sh/@vercel/blob@2/client");
    const ext = (video && video.f && video.f.ext) || "mp4", name = (S.songName || "lyric-video").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lyric-video";
    const who = window.SLSAuth && SLSAuth.user(), dir = who && who.id ? who.id + "/" : "";
    const r = await lib.upload(`sls-posts/${dir}${name}.${ext}`, file, { access: "public", handleUploadUrl: "/api/publish/blob", contentType: file.type || "video/mp4",
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
        if(d.state === "done"){ Object.assign(j, { state: "added", text: d.note || "Done.", url: d.url || j.url, ref: d.ref || j.ref }); paintJobs(); toast(`${P[j.platform]} · ${j.name}: ${d.note || "done"}`); return; }
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

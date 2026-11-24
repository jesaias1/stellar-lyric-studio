"use strict";
/* "Match the TikTok sound": the video uses exactly the part of the song that the popular TikTok sound uses, so
   nobody times the lyrics to one part and then finds the sound on TikTok starts somewhere else.

   Someone gives the studio the sound once per song: a TikTok link (sound or video, read by src/tiktok-sound.js)
   or a video saved from TikTok. js/soundmatch.js finds where that audio is in the song. The result is kept with
   the song for the whole team (Supabase song_sounds: clip_start, clip_len, clip_url, clip_title, clip_videos),
   so whenever anyone loads that song the video starts on the TikTok sound automatically, phone or computer.
   In the list of best parts it's the first card, marked TikTok.
   Exposes window.SLSTikTokSound: { open(), attach(), key() }. */
window.SLSTikTokSound = (() => {
  const api = window.SLSBackend;
  const title = () => String(S.songName || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/\s*\((preview|lyrics?)\)\s*$/i, "").trim();
  const key = () => title().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 200);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return m + ":" + String(Math.floor(t - m * 60)).padStart(2, "0"); };
  const count = n => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K" : String(n);
  const real = () => S.audio && S.songName && S.songName !== "Demo track";
  const team = () => window.SLSAuth && SLSAuth.mode === "accounts";

  /* ---------- the bite card for it ---------- */
  function bite(tt){
    const len = Math.min(60, tt.len);
    return { a: tt.a, b: +(tt.a + len).toFixed(2), label: "The TikTok sound", score: null, tiktok: true,
      reasons: ["Exactly the part the popular TikTok sound uses", tt.videos != null ? `${count(tt.videos)} videos use this sound` : "Matched by listening to the sound", tt.title ? `“${tt.title}”` : ""].filter(Boolean) };
  }
  function put(tt, { use = true, quiet = true } = {}){
    S.P.ttSound = tt;
    S.P.bites = [bite(tt), ...(S.P.bites || []).filter(p => !p.tiktok)];
    if(use && window.SLSApp && SLSApp.useBite) SLSApp.useBite(0, { quiet });
    window.dispatchEvent(new Event("sls-bites"));
  }
  /* after a song is timed (and when a project opens): use the team's TikTok sound for this song, if there is one */
  async function attach({ use = false } = {}){
    if(!real()) return null;
    if(S.P.ttSound && S.P.ttSound.key === key()){ put(S.P.ttSound, { use }); return S.P.ttSound; }
    if(!team()) return null;
    try {
      const rows = await Promise.race([SLSAuth.rest(`song_sounds?select=clip_start,clip_len,clip_url,clip_title,clip_videos,clip_from&key=eq.${encodeURIComponent(key())}`), new Promise(r => setTimeout(() => r(null), 4000))]);
      const r = rows && rows[0]; if(!r || r.clip_start == null || !r.clip_len) return null;
      if(r.clip_start + 1 > S.audio.duration) return null;
      const tt = { key: key(), a: +r.clip_start, len: +r.clip_len, url: r.clip_url || "", title: r.clip_title || "", videos: r.clip_videos ?? null, from: r.clip_from || "video" };
      put(tt, { use }); return tt;
    } catch(err){ console.warn("couldn't read the TikTok sound for this song", err); return null; }
  }

  /* ---------- the window ---------- */
  const m = document.createElement("div"); m.className = "modal"; m.id = "ttmModal"; m.hidden = true;
  m.innerHTML = `<div class="dialog ttm-dialog" role="dialog" aria-modal="true" aria-labelledby="ttmH">
    <div class="ph-head"><h2 id="ttmH">Match the TikTok sound</h2><button class="btn small ghost" id="ttmX" type="button" aria-label="Close">✕</button></div>
    <p class="hint ttm-why">Your video will start exactly where the popular TikTok sound starts, so the lyrics line up when it's posted with that sound. Do it once per song: everyone on the team gets it.</p>
    <ol class="ttm-steps">
      <li><b>Find the sound with the most videos.</b> In TikTok, search the song and open its sounds: the number under a sound's name is how many videos use it. Take the biggest, ideally the artist's own.
        <a class="btn small" id="ttmSearch" target="_blank" rel="noopener">Search TikTok</a></li>
      <li><b>Give it to the studio</b>, one of two ways:
        <form class="ttm-link" id="ttmForm" autocomplete="off"><input type="url" id="ttmUrl" inputmode="url" placeholder="Paste the sound's link (Share, then Copy link)" aria-label="TikTok sound or video link"><button class="btn primary" type="submit">Match</button></form>
        <label class="btn ttm-file"><input type="file" id="ttmFile" accept="video/*,audio/*" hidden>Choose a video saved from TikTok</label>
        <span class="hint ttm-phone">On the phone: in TikTok tap Share, then Save video, and choose it here.</span></li>
    </ol>
    <div class="ttm-result" id="ttmResult" aria-live="polite"></div>
    <div class="row ph-actions"><button class="btn" id="ttmClose" type="button">Close</button></div>
  </div>`;
  document.body.append(m);
  const $m = s => m.querySelector(s);
  const show = (html, cls = "") => { const r = $m("#ttmResult"); r.className = "ttm-result " + cls; r.innerHTML = html; };
  function open(){
    if(!real()){ toast("Load the song first."); return; }
    const q = [title(), (window.SLSArtists && SLSArtists.current && SLSArtists.current()) || ""].filter(Boolean).join(" ");
    $m("#ttmSearch").href = "https://www.tiktok.com/search?q=" + encodeURIComponent(q);
    const tt = S.P.ttSound && S.P.ttSound.key === key() ? S.P.ttSound : null;
    show(tt ? `<b>This song is matched</b> to ${tt.title ? `“${esc(tt.title)}”` : "a TikTok sound"}${tt.videos != null ? ` (${count(tt.videos)} videos)` : ""}: ${clock(tt.a)} to ${clock(tt.a + tt.len)}. Give it another sound to change it.` : "", tt ? "ok" : "");
    $m("#ttmUrl").value = ""; m.hidden = false;
  }
  const close = () => { m.hidden = true; };
  $m("#ttmX").onclick = close; $m("#ttmClose").onclick = close;
  m.addEventListener("click", e => { if(e.target === m) close(); });
  addEventListener("keydown", e => { if(e.key === "Escape" && !m.hidden) close(); });

  let busy = false;
  async function run(getSound, from){
    if(busy) return; busy = true; m.classList.add("busy");
    show(`<span class="ttm-spin" aria-hidden="true"></span> Listening for the sound in your song…`);
    try {
      const { buf, info } = await getSound();
      const r = await SLSSoundMatch.match(S.audio, buf);
      if(!r.ok){
        if(r.why === "speed") show(`<b>That sound is the song ${r.speed > 1 ? "sped up" : "slowed down"}</b> (${r.speed}× speed), so a video at the song's own speed won't line up with it. Pick the sound at normal speed, usually the artist's own.`, "warn");
        else if(r.why === "short") show("That's too short to match. Use a sound or video of at least 3 seconds.", "warn");
        else if(r.why === "longer") show("That's longer than the song you loaded. Is it the right song?", "warn");
        else show(`<b>That sound isn't in this song.</b> Is it a remix, or a different song? Try the artist's own sound.`, "warn");
        return;
      }
      // a link to the whole song (most official sounds) matches from 0:00 and says nothing about the part people use
      const soundLen = info.duration || buf.duration;
      if(from === "link" && r.start < 1.5 && soundLen > 45 && soundLen > S.audio.duration * 0.6){
        show(`<b>That link is the whole song</b>, so it doesn't show which part people use. Open a popular video that uses the sound, tap Share, then Save video, and choose that video here instead.
          ${team() ? `<div class="row"><button class="btn small" type="button" id="ttmAsOfficial">Save the link as the official sound for sound seeding</button></div>` : ""}`, "warn");
        const b = $m("#ttmAsOfficial"); if(b) b.onclick = async () => { try { await SLSAuth.rest("song_sounds", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { key: key(), title: title(), tiktok_url: info.link || info.url } }); b.replaceWith(Object.assign(document.createElement("span"), { textContent: "Saved as the official sound." })); } catch(err){ toast("Couldn't save it: " + (err.message || "try again")); } };
        return;
      }
      const tt = { key: key(), a: r.start, len: Math.max(3, r.len), url: info.link || info.url || "", title: info.title || "", videos: info.videos ?? null, sure: r.sure, from };
      put(tt, { use: true, quiet: false });
      let saved = false;
      if(team()){
        try { await SLSAuth.rest("song_sounds", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
          body: { key: key(), title: title(), clip_start: tt.a, clip_len: +tt.len.toFixed(2), clip_url: /^https:\/\/([a-z]+\.)?tiktok\.com\//i.test(tt.url) ? tt.url : null, clip_title: tt.title.slice(0, 200) || null, clip_videos: tt.videos, clip_from: from,
            ...($m("#ttmOfficial") && $m("#ttmOfficial").checked && /tiktok\.com\/music\//i.test(tt.url) ? { tiktok_url: tt.url } : {}) } }); saved = true; }
        catch(err){ console.warn("TikTok sound not saved for the team", err); }
      }
      show(`<b>Found it.</b> The sound is ${clock(tt.a)} to ${clock(tt.a + tt.len)} in your song (${Math.round(tt.len)} s)${tt.videos != null ? `, used in ${count(tt.videos)} videos` : ""}. Your video now uses exactly that part.${saved ? " Saved for everyone on the team." : ""}${r.sure < 0.5 ? " <span class=\"hint\">It's a close call (other sounds were mixed in), so give it a listen.</span>" : ""}
        <div class="row"><button class="btn small" type="button" id="ttmHear">▶ Hear it</button><button class="btn small primary" type="button" id="ttmDone">Done</button></div>`, "ok");
      $m("#ttmHear").onclick = () => SLSLyricsUI && SLSLyricsUI.hear ? SLSLyricsUI.hear(tt.a, tt.a + Math.min(60, tt.len)) : null;
      $m("#ttmDone").onclick = close;
    } catch(err){ show(esc(err.message || "Something went wrong.") + (from === "link" ? " You can choose a saved TikTok video instead." : ""), "warn"); }
    finally { busy = false; m.classList.remove("busy"); }
  }
  $m("#ttmForm").onsubmit = e => {
    e.preventDefault(); const url = $m("#ttmUrl").value.trim();
    if(!/^https:\/\/([a-z]+\.)?tiktok\.com\/\S+$/i.test(url)){ show("Paste a TikTok link: it starts with https://www.tiktok.com/ or https://vm.tiktok.com/", "warn"); return; }
    run(async () => {
      const info = await api.api("/api/tiktok/sound", { method: "POST", body: { url }, timeout: 30000 });
      const blob = await api.blob(info.audio);
      const ac = new (window.AudioContext || window.webkitAudioContext)(); let buf;
      try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); } finally { ac.close && ac.close(); }
      const isMusic = /tiktok\.com\/music\//i.test(info.link || url);
      if(isMusic && !$m("#ttmOfficial")){ const l = document.createElement("label"); l.className = "ph-only ttm-off"; l.innerHTML = `<input type="checkbox" id="ttmOfficial"> It's the artist's official sound: use it for sound seeding too`; $m(".ttm-steps").after(l); }
      return { buf, info: { ...info, url } };
    }, "link");
  };
  $m("#ttmFile").onchange = e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if(!f) return;
    run(async () => {
      let buf; try { buf = await SLSSoundMatch.decode(f); } catch { throw new Error("That file's sound couldn't be read. Try the video TikTok saved, or an MP4, MOV, M4A or MP3."); }
      return { buf, info: { title: f.name.replace(/\.[a-z0-9]{2,4}$/i, "") } };
    }, "file");
  };
  return { open, attach, key, bite };
})();

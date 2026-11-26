"use strict";
/* Trending sounds: the TikTok sounds that are taking off now (Chartmetric's TikTok chart, read by src/trends.js),
   worldwide or in one country, this week or today. With a song open, the ones that fit it come first: the same
   artist, the same genre, climbing fast. Shown inside the calendar page (js/calendar.js, "Trending sounds").
   window.SLSTrends = { paint(el) } */
window.SLSTrends = (() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const big = n => n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
  const PLACES = [["", "Worldwide"], ["DK", "Denmark"], ["SE", "Sweden"], ["NO", "Norway"], ["DE", "Germany"], ["GB", "United Kingdom"], ["US", "United States"]];
  let el = null, place = "", period = "weekly", data = null, err = "", loading = false, tok = 0, forSong = "";

  // the song that's open, as "Artist - Title" (the studio's project names)
  function song(){
    let n = (typeof S !== "undefined" && S.songName && S.songName !== "Demo track") ? String(S.songName) : "";
    n = n.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/\s*\((preview|lyrics?)\)\s*$/i, "").trim();
    const m = n.match(/^(.+?)\s+[-–]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: "", title: n };
  }
  async function load(){
    const my = ++tok, s = song(); loading = true; err = ""; draw();
    const q = new URLSearchParams({ interval: period, ...(place ? { country: place } : {}), ...(s.title ? { song: s.title, artist: s.artist } : {}) });
    try { const d = await SLSBackend.api("/api/trends/tiktok?" + q, { timeout: 30000 }); if(my !== tok) return; data = d; forSong = s.title; }
    catch(e){ if(my !== tok) return; err = (e && e.message) || "Trending sounds couldn't be loaded."; data = null; }
    loading = false; draw();
  }
  function change(r){
    if(r.prev == null) return `<span class="tr-ch new" title="New on the chart">new</span>`;
    const d = r.prev - r.rank;
    return d > 0 ? `<span class="tr-ch up" title="Up ${d} places">▲ ${d}</span>` : d < 0 ? `<span class="tr-ch down" title="Down ${-d} places">▼ ${-d}</span>` : `<span class="tr-ch same" title="Same place">=</span>`;
  }
  const art = r => r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<i></i>`;
  const open = r => r.link ? `<a class="btn small" href="${esc(r.link)}" target="_blank" rel="noopener">Open in TikTok</a>` : "";
  function draw(){
    if(!el) return;
    const s = song();
    const head = `<div class="tr-head"><div><h3>Trending on TikTok</h3><p class="hint">The sounds most used in new TikTok videos right now. From Chartmetric, updated every few hours.</p></div>
      <div class="tr-pick"><select id="trPlace" aria-label="Where">${PLACES.map(([k, l]) => `<option value="${k}"${k === place ? " selected" : ""}>${l}</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Period"><button type="button" data-tr="weekly" aria-pressed="${period === "weekly"}">This week</button><button type="button" data-tr="daily" aria-pressed="${period === "daily"}">Today</button></div></div></div>`;
    let body = "";
    if(loading && !data) body = `<p class="cal-hint">Loading the chart…</p>`;
    else if(err) body = `<p class="cal-hint bad">${esc(err)}</p><button class="btn small" type="button" data-tr="retry">Try again</button>`;
    else if(data && data.configured === false) body = `<div class="tr-setup"><b>Trending sounds aren't switched on yet.</b>
      <p>They come from Chartmetric's API (a paid Chartmetric plan). To switch them on, add the API refresh token from Chartmetric in Vercel as <code>CHARTMETRIC_REFRESH_TOKEN</code>, then redeploy.</p></div>`;
    else if(data){
      const rows = data.rows || [];
      const fits = rows.filter(r => r.fit && r.fit.score >= 3).sort((a, b) => b.fit.score - a.fit.score || a.rank - b.rank).slice(0, 3);
      const songLine = s.title ? `<p class="tr-for">For <b>${esc(s.title)}</b>${s.artist ? ` by ${esc(s.artist)}` : ""}${data.song && data.song.genre ? ` · ${esc(data.song.genre)}` : ""}</p>` : `<p class="tr-for hint">Open a project to see which trending sounds fit its song.</p>`;
      body = songLine + (s.title ? (fits.length ? `<div class="tr-fits">${fits.map(r => `<div class="tr-fit">${art(r)}<div class="tr-t"><b>${esc(r.name)}</b><span>${esc(r.artists.join(", "))}</span><ul>${r.fit.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>${open(r)}</div>`).join("")}</div>`
          : `<p class="cal-hint">None of the sounds on this chart are close to this song right now. Try another country or Today.</p>`) : "")
        + (rows.length ? `<ol class="tr-list">${rows.map(r => `<li class="tr-row">
            <span class="tr-rank">${r.rank ?? ""}</span>${change(r)}${art(r)}
            <span class="tr-t"><b>${esc(r.name)}</b><span>${esc(r.artists.join(", "))}${r.genre ? ` · ${esc(r.genre)}` : ""}</span></span>
            <span class="tr-n">${r.recent != null ? `<b>${big(r.recent)}</b> new videos` : r.posts != null ? `<b>${big(r.posts)}</b> videos` : ""}</span>${open(r)}</li>`).join("")}</ol>`
          : `<p class="cal-hint">The chart is empty right now.</p>`);
    }
    el.innerHTML = `<div class="tr">${head}${body}</div>`;
    el.querySelector("#trPlace").onchange = e => { place = e.target.value; load(); };
    el.querySelectorAll("[data-tr]").forEach(b => b.onclick = () => { const v = b.dataset.tr; if(v === "retry") return load(); if(v !== period){ period = v; load(); } });
  }
  function paint(target){
    el = target;
    if(!window.SLSAuth || SLSAuth.mode !== "accounts"){ el.innerHTML = `<p class="cal-hint">Trending sounds need a login.</p>`; return; }
    if(!data || song().title !== forSong) load(); else draw();
  }
  return { paint };
})();

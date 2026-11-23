"use strict";
/* Footage without files on your computer: photos picked for the song (js/photos.js fills that tab), free stock
   video search (Pixabay, Pexels) and AI-generated background clips written from the lyrics (Higgsfield). Both add clips to the same footage pool as imported files.
   The backend side is src/media.js. Loaded after app.js. */
window.SLSFootage = (() => {
  const api = window.SLSBackend, pane = $('[data-pane="clips"]');
  const IDEAS = ["night city", "snow falling", "ocean waves", "neon lights", "forest fog", "sunset clouds", "rain window", "candle light", "stars sky", "road trip"];
  const panel = document.createElement("div"); panel.className = "fx-wrap";
  panel.innerHTML = `
    <div class="fx-tabs" role="tablist"><button data-fx="photos" aria-selected="true">Photos</button><button data-fx="stock" aria-selected="false">Free videos</button><button data-fx="ai" aria-selected="false">AI background</button></div>
    <div class="fx-body" data-fxp="photos"></div>
    <div class="fx-body" data-fxp="stock" hidden>
      <form class="fx-search" id="stockForm" autocomplete="off"><input type="search" id="stockQ" placeholder="Search: snow, city at night, ocean…" aria-label="Search free videos"><button class="btn small primary">Search</button></form>
      <div class="chips fx-ideas" id="stockIdeas">${IDEAS.map(q => `<button type="button" data-q="${q}">${q}</button>`).join("")}</div>
      <div class="fx-msg hint" id="stockMsg"></div>
      <div class="fx-grid" id="stockGrid"></div>
      <div class="row"><button class="btn small ghost" id="stockMore" hidden>More results</button></div>
      <div class="hint fx-credit" id="stockCredit"></div>
    </div>
    <div class="fx-body" data-fxp="ai" hidden>
      <div class="fx-msg hint" id="aiMsg">SLS reads your lyrics, writes a scene for each part of the song, and Higgsfield turns each scene into a background clip.</div>
      <label class="field"><span class="hint">Mood or setting (optional)</span><input type="text" id="aiMood" placeholder="e.g. warm Christmas night, snow, candlelight"></label>
      <div class="fx-opts"><span class="hint">Clips</span><div class="seg" id="aiCount"><button data-v="1">1</button><button data-v="2">2</button><button data-v="3">3</button><button data-v="4">4</button></div>
        <span class="hint">Length</span><div class="seg" id="aiLen"><button data-v="5">5 s</button><button data-v="10">10 s</button></div></div>
      <button class="btn small" id="aiIdeas">Write scenes from the lyrics</button>
      <div class="fx-prompts" id="aiPrompts"></div>
      <div class="fx-go" id="aiGoRow" hidden><button class="btn primary small" id="aiGo">Generate</button><span class="hint" id="aiCost"></span></div>
      <div class="fx-jobs" id="aiJobs"></div>
    </div>`;
  pane.querySelector("#clipGrid").nextElementSibling.after(panel);   // under the footage pool

  let health = null;
  const getHealth = async () => { if(health) return health; try { health = await api.health(); } catch { health = {}; } return health; };
  $$(".fx-tabs button").forEach(b => b.onclick = () => { $$(".fx-tabs button").forEach(x => x.setAttribute("aria-selected", String(x === b))); $$(".fx-body").forEach(p => p.hidden = p.dataset.fxp !== b.dataset.fx); if(b.dataset.fx === "ai") paintAI(); });
  const orient = () => ({ "9:16": "portrait", "4:5": "portrait", "1:1": "square", "16:9": "landscape" })[S.P.aspect] || "portrait";
  const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "";
  const errText = err => err && err.message ? err.message : "Something went wrong.";

  /* ---------- free stock videos ---------- */
  let query = "", page = 1, busy = false;
  async function search(q, more){
    q = (q || "").trim(); if(!q || busy) return;
    const h = await getHealth();
    if(h.stock && !h.stock.pixabay && !h.stock.pexels){ $("#stockMsg").textContent = "Stock video search isn't switched on yet. It needs a free Pixabay key (PIXABAY_KEY) in the site's settings."; return; }
    if(!(await SLSApp.ensurePass())) return;
    if(!more){ query = q; page = 1; $("#stockGrid").textContent = ""; } else page++;
    busy = true; $("#stockMsg").textContent = more ? "Loading more…" : `Searching for "${q}"…`; $("#stockMore").hidden = true;
    try {
      const d = await api.api(`/api/stock/search?q=${encodeURIComponent(q)}&orientation=${orient()}&page=${page}`, { timeout: 30000 });
      const grid = $("#stockGrid");
      d.results.forEach(r => grid.append(tile(r)));
      $("#stockMsg").textContent = d.results.length ? (d.errors.length ? d.errors.join(" · ") : "") : (more ? "No more results." : `Nothing found for "${q}". Try English words, or something simpler.`);
      $("#stockMore").hidden = d.results.length < 10;
      const src = [d.sources.pixabay && '<a href="https://pixabay.com" target="_blank" rel="noopener">Pixabay</a>', d.sources.pexels && '<a href="https://www.pexels.com" target="_blank" rel="noopener">Pexels</a>'].filter(Boolean).join(" and ");
      $("#stockCredit").innerHTML = src ? `Videos from ${src}. Free to use; each clip keeps its creator's credit.` : "";
    } catch(err){ $("#stockMsg").textContent = errText(err); page = Math.max(1, page - (more ? 1 : 0)); }
    finally { busy = false; }
  }
  function tile(r){
    const b = document.createElement("button"); b.className = "fx-tile"; b.type = "button"; b.title = `${r.title || query} · ${r.author} on ${r.source}`;
    b.innerHTML = `<img alt="" loading="lazy" src="${esc(r.thumb)}"><span class="fx-badge">${fmtDur(r.duration)}</span><span class="fx-src">${esc(r.source)}</span><span class="fx-bar"><i></i></span><span class="fx-done">Added ✓</span>`;
    let v = null;
    b.addEventListener("pointerenter", () => { if(!r.preview || b.classList.contains("loading")) return; if(!v){ v = document.createElement("video"); v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto"; v.src = r.preview; b.prepend(v); } v.play().catch(() => {}); b.classList.add("playing"); });
    b.addEventListener("pointerleave", () => { if(v){ v.pause(); } b.classList.remove("playing"); });
    b.onclick = async () => {
      if(b.classList.contains("loading")) return; if(v) v.pause();
      b.classList.add("loading"); const bar = b.querySelector(".fx-bar i");
      try {
        const blob = await api.blob(r.file, { onProgress: p => bar.style.width = (p * 100).toFixed(0) + "%" });
        const ids = await addFootage([blob], [{ name: (r.title || query).split(",")[0], kind: "video", credit: `${r.author} on ${r.source}`, src: { kind: "stock", file: r.file, thumb: r.thumb, page: r.page, author: r.author, source: r.source, title: r.title || query } }], { quiet: true });
        if(ids.length){ b.classList.add("added"); toast(`Added. Video by ${r.author} on ${r.source}.`); } else toast("That video couldn't be read. Try another one.");
      } catch(err){ toast(errText(err)); }
      finally { b.classList.remove("loading"); bar.style.width = "0"; }
    };
    return b;
  }
  $("#stockForm").onsubmit = e => { e.preventDefault(); search($("#stockQ").value); };
  $("#stockIdeas").onclick = e => { const b = e.target.closest("[data-q]"); if(!b) return; $("#stockQ").value = b.dataset.q; search(b.dataset.q); };
  $("#stockMore").onclick = () => search(query, true);

  /* ---------- AI backgrounds ---------- */
  const keep = { get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let count = keep.get("sls-ai-count", 0), len = keep.get("sls-ai-len", 5), prompts = [], estimate = null;
  const defCount = () => clamp(Math.round((S.P.section.b - S.P.section.a) / (len === 10 ? 10 : 6)), 1, 4);
  function paintAI(){
    const n = count || defCount();
    $$("#aiCount button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === n)));
    $$("#aiLen button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === len)));
    getHealth().then(h => { if(h.bg === false){ $("#aiMsg").innerHTML = "AI backgrounds aren't switched on yet. They need a Higgsfield API key (HF_KEY_ID and HF_KEY_SECRET from <a href='https://console.higgsfield.ai' target='_blank' rel='noopener'>console.higgsfield.ai</a>) in the site's settings."; $("#aiIdeas").disabled = true; } });
  }
  $("#aiCount").onclick = e => { const b = e.target.closest("button"); if(!b) return; count = +b.dataset.v; keep.set("sls-ai-count", count); paintAI(); if(prompts.length) fitPrompts(); };
  $("#aiLen").onclick = e => { const b = e.target.closest("button"); if(!b) return; len = +b.dataset.v; keep.set("sls-ai-len", len); paintAI(); price(); };
  function sectionLyrics(){
    const {a, b} = S.P.section, inside = lineGroups().filter(L => L[0].t >= a - 0.5 && L[0].t < b);
    return (inside.length ? inside : lineGroups()).map(L => L.map(w => w.w).join(" ")).join("\n");
  }
  function fitPrompts(){ const n = count || defCount(); while(prompts.length < n) prompts.push(prompts[prompts.length - 1] || ""); prompts.length = n; drawPrompts(); }
  function drawPrompts(){
    $("#aiPrompts").innerHTML = prompts.map((p, i) => `<label class="fx-prompt"><span class="hint">Scene ${i + 1}</span><textarea data-i="${i}" rows="3">${esc(p)}</textarea></label>`).join("");
    $("#aiGoRow").hidden = !prompts.length; price();
  }
  $("#aiPrompts").addEventListener("input", e => { const i = +e.target.dataset.i; if(e.target.tagName === "TEXTAREA") prompts[i] = e.target.value; });
  $("#aiIdeas").onclick = async () => {
    if(!(await SLSApp.ensurePass())) return;
    const lyr = sectionLyrics(), b = $("#aiIdeas"); b.disabled = true; b.textContent = "Reading the lyrics…";
    try { const d = await api.api("/api/bg/prompts", { method: "POST", body: { lyrics: lyr, count: count || defCount(), mood: $("#aiMood").value }, timeout: 60000 });
      prompts = d.prompts; drawPrompts(); if(!lyr.trim()) toast("No lyrics yet, so the scenes are generic. Edit them before generating."); }
    catch(err){ toast(errText(err)); }
    finally { b.disabled = false; b.textContent = "Write the scenes again"; }
  };
  async function price(){
    const n = prompts.length; if(!n){ $("#aiCost").textContent = ""; return; }
    $("#aiGo").textContent = `Generate ${n} clip${n === 1 ? "" : "s"}`;
    try { const d = await api.api("/api/bg/estimate", { method: "POST", body: { duration: len, aspect: S.P.aspect }, timeout: 20000 }); estimate = d.usd != null ? +d.usd : null; }
    catch { estimate = null; }
    $("#aiCost").textContent = estimate != null ? `About $${(estimate * n).toFixed(2)} on your Higgsfield balance ($${estimate.toFixed(2)} per clip)` : "Charged to your Higgsfield balance";
  }
  /* jobs survive a page reload: they're kept in this browser until the clip is added */
  let jobs = keep.get("sls-ai-jobs", []).filter(j => Date.now() - j.at < 864e5 && !["added", "failed"].includes(j.state));
  const saveJobs = () => keep.set("sls-ai-jobs", jobs);
  function drawJobs(){
    $("#aiJobs").innerHTML = jobs.map(j => `<div class="fx-job ${j.state}"><span class="fx-dot"></span><span class="fx-jt">${esc(j.prompt.slice(0, 70))}${j.prompt.length > 70 ? "…" : ""}</span><span class="hint">${{ queued: "Waiting in line", in_progress: "Rendering", downloading: "Downloading", added: "Added to your clips", failed: esc(j.error || "Failed") }[j.state] || esc(j.state)}</span></div>`).join("");
  }
  $("#aiGo").onclick = async () => {
    if(!prompts.some(p => p.trim())) return; if(!(await SLSApp.ensurePass())) return;
    const go = $("#aiGo"); go.disabled = true;
    for(const p of prompts.filter(x => x.trim())){
      try { const d = await api.api("/api/bg/generate", { method: "POST", body: { prompt: p, duration: len, aspect: S.P.aspect }, timeout: 60000 }); jobs.push({ id: d.id, prompt: p, state: d.status || "queued", at: Date.now() }); }
      catch(err){ jobs.push({ id: "x" + Date.now(), prompt: p, state: "failed", error: errText(err), at: Date.now() }); if(/balance|key|connected/i.test(errText(err))) break; }
      saveJobs(); drawJobs();
    }
    go.disabled = false; poll();
  };
  let polling = false;
  async function poll(){
    if(polling) return; polling = true;
    try {
      while(jobs.some(j => j.state === "queued" || j.state === "in_progress")){
        await new Promise(r => setTimeout(r, 5000));
        for(const j of jobs.filter(x => x.state === "queued" || x.state === "in_progress")){
          try {
            const d = await api.api(`/api/bg/status/${j.id}`, { timeout: 20000 });
            if(d.status === "completed" && d.file){ j.state = "downloading"; drawJobs();
              const blob = await api.blob(d.file);
              const ids = await addFootage([blob], [{ name: "AI · " + j.prompt.split(/[,.]/)[0].slice(0, 20), kind: "video", credit: "Generated with Higgsfield", src: { kind: "ai", prompt: j.prompt } }], { quiet: true });
              j.state = ids.length ? "added" : "failed"; if(!ids.length) j.error = "The clip couldn't be read"; else toast("An AI background clip was added to your footage.");
            } else if(["failed", "nsfw", "canceled"].includes(d.status)){ j.state = "failed"; j.error = d.error || "Higgsfield couldn't make this one"; }
            else j.state = d.status || j.state;
          } catch(err){ if(err.code === "unauthorized") { polling = false; return; } }
          saveJobs(); drawJobs();
        }
      }
    } finally { polling = false; }
  }
  drawJobs(); if(jobs.length && api.hasPass()) poll();
  paintAI();
  /* a template can bring its AI scenes along: they wait in the AI tab, ready to generate */
  function setScenes(list){ prompts = list.slice(0, 4); count = prompts.length; drawPrompts(); paintAI(); }
  return { search, poll, setScenes };
})();

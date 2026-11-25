"use strict";
/* The song's vibe: what the song feels like, read once per song by the backend (/api/vibe, src/vibe.js) from the
   whole lyrics plus a few things measured here from the audio (tempo, loudness, how bright it sounds, how much it
   swings). It is kept with the project (S.P.vibe), and the video and photo searches send it along, so their
   searches and ranking follow the song's feel. Loaded before footage.js and photos.js. */
window.SLSVibe = (() => {
  const api = window.SLSBackend;
  const songLyrics = () => lineGroups().map(L => L.map(w => w.w).join(" ")).join("\n");
  const title = () => S.songName && S.songName !== "Demo track" ? S.songName : "";

  // a few numbers about the sound, 0 to 1, measured over the whole song
  let soundFor = null, soundVal = null;
  function sound(){
    const buf = S.audio; if(!buf) return null;
    if(soundFor === buf) return soundVal;
    const ch = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : null];
    const win = Math.round(buf.sampleRate * 0.05), dbs = []; let zc = 0, n = 0;
    for(let i = 0; i + win <= buf.length; i += win * 2){   // every other 50 ms window is plenty
      let sum = 0, prev = 0;
      for(let j = i; j < i + win; j += 2){ const x = ch[1] ? (ch[0][j] + ch[1][j]) / 2 : ch[0][j]; sum += x * x; if((x >= 0) !== (prev >= 0)) zc++; prev = x; n++; }
      dbs.push(10 * Math.log10(sum / (win / 2) + 1e-10));
    }
    const loudDb = dbs.filter(d => d > -50).sort((a, b) => a - b);
    if(loudDb.length < 10){ soundFor = buf; soundVal = null; return null; }
    const pct = p => loudDb[Math.floor(p * (loudDb.length - 1))], c01 = x => Math.max(0, Math.min(1, x));
    soundVal = {
      bpm: S.P.bpm,
      loud: +c01((pct(0.5) + 30) / 22).toFixed(2),            // about -30 dBFS (very soft) to -8 (very loud)
      bright: +c01((zc / n * 2 - 0.02) / 0.1).toFixed(2),     // zero crossings: more = brighter, airier sound
      dynamic: +c01((pct(0.9) - pct(0.1)) / 20).toFixed(2),   // the gap between the quiet and the loud parts
    };
    soundFor = buf; return soundVal;
  }

  // what the vibe depends on: the lyrics, the song and its tempo
  function key(){
    const s = `${songLyrics()}|${title()}|${Math.round(S.P.bpm || 0)}|${S.audio ? S.audio.duration.toFixed(1) : ""}`;
    let h = 0; for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }
  const cached = () => S.P.vibe && S.P.vibe.k === key() ? S.P.vibe.v : null;

  // the song's colour for the tint: the one the reading chose, or one from its colour words
  const WORDS = [[/amber|gold|honey|ochre|mustard/, "#c8913a"], [/orange|rust|copper|terracotta|burnt/, "#c46a3a"], [/red|crimson|scarlet|wine|burgundy/, "#a83a3a"],
    [/pink|rose|blush|magenta/, "#c86a8a"], [/purple|violet|lilac|lavender|plum/, "#7a5aa8"], [/teal|turquoise|aqua|cyan/, "#3a9a9a"], [/green|olive|sage|emerald|forest/, "#5a8a5a"],
    [/navy|midnight|indigo|deep blue|dark blue/, "#2f3f7a"], [/blue|azure|sky|ice|steel/, "#4a7ab0"], [/beige|cream|sand|ivory|warm white|peach/, "#c8a882"],
    [/brown|sepia|coffee|earth/, "#8a6a4a"], [/grey|gray|silver|ash|smoke/, "#8a8a92"], [/black|dark|shadow/, "#3a3540"], [/yellow|sun/, "#d0b040"]];
  function tintOf(v){
    if(!v) return "";
    if(/^#[0-9a-f]{6}$/i.test(v.tint || "")) return v.tint;
    const text = [...(v.colours || []), v.light || ""].join(" ").toLowerCase();
    for(const [re, c] of WORDS) if(re.test(text)) return c;
    return "";
  }
  // the first time a song is read, its colour goes over the footage, softly (Clips > Song colour turns it off)
  function firstTint(v){ if(S.P.tint === undefined){ const c = tintOf(v); if(c) S.P.tint = { on: true, color: c, amount: 0.35 }; } }
  let pending = null, pendingKey = "";
  async function get(){
    const have = cached(); if(have) return have;
    const k = key(); if(pending && pendingKey === k) return pending;
    const lyrics = songLyrics(), snd = sound();
    if(!lyrics.trim() && !snd) return null;
    pendingKey = k;
    pending = (async () => {
      try {
        const d = await api.api("/api/vibe", { method: "POST", body: { lyrics, title: title(), sound: snd }, timeout: 45000 });
        if(d.vibe && key() === k){ S.P.vibe = { k, v: d.vibe }; firstTint(d.vibe); saveDraft(); slsEmit("vibe"); }
        return d.vibe || null;
      } catch { return null; }
      finally { if(pendingKey === k) pending = null; }
    })();
    return pending;
  }
  // a vibe the backend sent along with search results (it reads one itself when the app had none yet)
  function keep(v){ if(v && !cached()){ S.P.vibe = { k: key(), v }; firstTint(v); saveDraft(); slsEmit("vibe"); } }
  // one short line for the screen: "Bittersweet, hopeful · slow and calm · warm gold light"
  function line(v){
    if(!v) return "";
    const cap = s => s ? s[0].toUpperCase() + s.slice(1) : "";
    const energy = { calm: "calm", steady: "steady", lively: "lively", intense: "intense" }[v.energy] || "";
    return [cap((v.mood || []).slice(0, 3).join(", ")), energy, v.light].filter(Boolean).join(" · ");
  }
  /* A search box filled in with a suggestion from the song, which you can type over or remove with ✕. Once removed,
     it stays empty for this song. Your own words are never replaced. */
  const OFF = "sls-prefill-off";
  const offFor = () => { try { return JSON.parse(sessionStorage.getItem(OFF)) || []; } catch { return []; } };
  function prefill(input, text){
    if(!input) return;
    let x = input.parentElement && input.parentElement.classList.contains("pre-wrap") ? input.parentElement.querySelector(".pre-x") : null;
    if(!x){
      const wrap = document.createElement("span"); wrap.className = "pre-wrap"; input.before(wrap); wrap.append(input);
      x = document.createElement("button"); x.type = "button"; x.className = "pre-x"; x.hidden = true; x.setAttribute("aria-label", "Remove the suggestion"); x.textContent = "✕"; wrap.append(x);
      x.onclick = () => { input.value = ""; delete input.dataset.pre; x.hidden = true; const l = offFor(); l.push(input.id + "|" + (S.songName || "")); try { sessionStorage.setItem(OFF, JSON.stringify(l.slice(-100))); } catch {} input.focus(); };
      input.addEventListener("input", () => { delete input.dataset.pre; x.hidden = !input.value; });
    }
    const mine = input.value.trim() && !input.dataset.pre;
    if(!text || mine || offFor().includes(input.id + "|" + (S.songName || ""))){ x.hidden = !input.value; return; }
    input.value = text; input.dataset.pre = "1"; x.hidden = false;
  }
  return { get, cached, keep, sound, line, songLyrics, tintOf, prefill };
})();

/**
 * The song's vibe, and keeping AI-made pictures and videos out of the searches.
 *
 *   POST /api/vibe {lyrics, title?, sound?: {bpm, loud, bright, dynamic}} -> {vibe, ai}
 *        Reads the whole song once: the lyrics plus a few numbers the browser measured from the audio (tempo,
 *        how loud and how bright it sounds). The answer is a small profile (mood, energy, colours, light,
 *        places, season, the lyrics' own imagery) plus ready-made searches for stock video and for photos.
 *        The app keeps it with the project, and sends it along with every video and photo search, so the
 *        searches and the ranking follow the song's feel and not only its words.
 *
 * aiMade() is the last line of defence against generated pictures: the searches already ask for fewer of them
 * where a source can (Pinterest's "less AI"), and Pixabay marks them itself (isAiGenerated, an "ai generated" tag).
 */
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const cache = new Map();

/* ---------- AI-made pictures and videos ---------- */
const AI_WORDS = /(^|[^a-z])(ai[ -]?(generated|art|artwork|image|images|photo|picture|created|made|render|illustration|design|edited|modified|enhanced)|made (with|by) ai|created (with|by|using) ai|generated (with|by|using) ai|generative ai|gen ?ai|midjourney|mid journey|dall[ -]?e|stable ?diffusion|sdxl|leonardo ?ai|firefly ai|adobe firefly|flux ai|ideogram|nightcafe|dreamstudio|niji ?journey|chatgpt image)([^a-z]|$)|#ai(art|generated|artwork|artist|image)\b/i;
export function aiMade(it) {
  if (!it) return false;
  if (it.isAiGenerated === true || it.ai === true) return true;
  const text = [it.title, it.tags, it.description, it.alt].filter(Boolean).join(" · ");
  return /(^|,)\s*ai[ -]generated\s*(,|$)/i.test(String(it.tags || "")) || AI_WORDS.test(text);
}

/* ---------- the vibe ---------- */
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const list = (x, n, len = 40) => (Array.isArray(x) ? x : []).map(v => clean(v).replace(/["#]/g, "").slice(0, len)).filter(Boolean).slice(0, n);
const ENERGY = ["calm", "steady", "lively", "intense"];

// the measured sound in words, for the model
function soundWords(s) {
  if (!s || typeof s !== "object") return "";
  const out = [];
  const bpm = +s.bpm;
  if (bpm >= 40 && bpm <= 240) out.push(`tempo about ${Math.round(bpm)} BPM (${bpm < 80 ? "slow" : bpm < 105 ? "mid-tempo" : bpm < 130 ? "upbeat" : "fast"}; could be half or double)`);
  if (Number.isFinite(+s.loud)) out.push(+s.loud < 0.35 ? "quiet, soft production" : +s.loud < 0.65 ? "medium loudness" : "loud, dense production");
  if (Number.isFinite(+s.bright)) out.push(+s.bright < 0.35 ? "dark, warm, bass-heavy sound" : +s.bright < 0.65 ? "balanced sound" : "bright, airy sound");
  if (Number.isFinite(+s.dynamic)) out.push(+s.dynamic > 0.6 ? "big swings between quiet and loud parts" : "even, steady level");
  return out.join("; ");
}

function fromModel(out) {
  const resp = out && (out.response ?? (out.result && out.result.response) ?? out);
  if (resp && typeof resp === "object" && !Array.isArray(resp)) return resp;
  const text = String(resp || "");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

export async function readVibe(ai, { lyrics, title, sound }) {
  lyrics = String(lyrics || "").slice(0, 5000);
  const heard = soundWords(sound);
  if (!ai || (!clean(lyrics) && !heard)) return null;
  const key = `${clean(lyrics).toLowerCase().slice(0, 600)}|${clean(title).toLowerCase()}|${heard}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sys = `You read a song for the people making its lyric video, so they can find background footage and photos that feel like the song. You get the lyrics and a few things measured from the audio. Work out the song's real feel: read past single words (a song that mentions "fire" can be tender; "rain" can be joyful) and weigh the sound: a slow, soft, dark-sounding song is not a party song even with happy words, and a fast bright one is not gloomy. Answer with one JSON object and nothing else, in English whatever the lyrics' language:
{"summary": one plain sentence on what the song feels like,
 "mood": 2 to 4 mood words,
 "energy": one of "calm", "steady", "lively", "intense",
 "colours": 2 to 4 colour words that fit,
 "light": a few words on the light (e.g. "soft golden hour", "neon at night", "grey daylight"),
 "places": 2 to 4 settings that fit (concrete, filmable),
 "season": a season or "any",
 "imagery": 3 to 6 concrete images taken from the lyrics themselves,
 "avoid": 2 to 4 things that would clash with this song,
 "video": 6 different stock-video searches of 2 to 4 plain words each, things a camera can film that exist on free stock sites (e.g. "rain on window", "city lights night", "waves at sunset", "candle flame dark"), matching the mood, energy and light; vary them; no people's faces, no text, no famous places,
 "photo": 4 different image searches of 3 to 6 words each for mood-board style pictures, each a concrete scene plus a look (film photo, painting, etc.)}`;
  const user = (clean(title) ? `Song title: ${clean(title).slice(0, 80)}\n` : "") + (heard ? `Measured from the audio: ${heard}\n` : "") + `\nLyrics:\n${clean(lyrics) ? lyrics : "(instrumental or no lyrics yet)"}`;
  try {
    const v = fromModel(await ai({ messages: [{ role: "system", content: sys }, { role: "user", content: user }], max_tokens: 700, temperature: 0.4 }));
    const vibe = {
      summary: clean(v.summary).slice(0, 220),
      mood: list(v.mood, 4, 24), energy: ENERGY.includes(v.energy) ? v.energy : "steady",
      colours: list(v.colours || v.colors, 4, 24), light: clean(v.light).slice(0, 60),
      places: list(v.places, 4), season: clean(v.season).slice(0, 20) || "any",
      imagery: list(v.imagery, 6), avoid: list(v.avoid, 4),
      video: [...new Set(list(v.video, 6, 40).map(q => q.toLowerCase()))],
      photo: [...new Set(list(v.photo, 4, 60))],
    };
    if (!vibe.video.length && !vibe.mood.length) return null;
    cache.set(key, vibe); if (cache.size > 300) cache.delete(cache.keys().next().value);
    return vibe;
  } catch (err) {
    console.error("vibe failed:", String(err && err.message || err));
    return null;
  }
}

// a vibe the browser sent back, cleaned up (never trust its shape)
export function vibeFrom(x) {
  if (!x || typeof x !== "object") return null;
  const v = {
    summary: clean(x.summary).slice(0, 220), mood: list(x.mood, 4, 24), energy: ENERGY.includes(x.energy) ? x.energy : "",
    colours: list(x.colours, 4, 24), light: clean(x.light).slice(0, 60), places: list(x.places, 4), season: clean(x.season).slice(0, 20),
    imagery: list(x.imagery, 6), avoid: list(x.avoid, 4), video: list(x.video, 6, 40), photo: list(x.photo, 4, 60),
  };
  return v.summary || v.mood.length ? v : null;
}

// the vibe as a short paragraph for other prompts
export function vibeText(v) {
  if (!v) return "";
  return [v.summary && `Feel: ${v.summary}`, v.mood.length && `Mood: ${v.mood.join(", ")}`, v.energy && `Energy: ${v.energy}`,
    v.colours.length && `Colours: ${v.colours.join(", ")}`, v.light && `Light: ${v.light}`, v.places.length && `Places: ${v.places.join(", ")}`,
    v.season && v.season !== "any" && `Season: ${v.season}`, v.imagery.length && `Images from the lyrics: ${v.imagery.join(", ")}`,
    v.avoid.length && `Avoid: ${v.avoid.join(", ")}`].filter(Boolean).join("\n");
}

async function body(request) { try { return await request.json(); } catch { return {}; } }

export async function vibeRoute(request, env, path, method, { hasAI, runModel, json }) {
  if (path !== "/api/vibe" || method !== "POST") return null;
  const b = await body(request);
  if (!hasAI) return json({ vibe: null, ai: false });
  const ai = input => runModel(env, TEXT_MODEL, input);
  const vibe = await readVibe(ai, { lyrics: b.lyrics, title: b.title, sound: b.sound });
  return json({ vibe, ai: !!vibe });
}

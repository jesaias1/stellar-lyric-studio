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
// a list the model wrote, as an array or as one comma-separated string
const list = (x, n, len = 40) => (Array.isArray(x) ? x : typeof x === "string" ? x.split(/[,;\n]/) : []).map(v => clean(v).replace(/["#]/g, "").slice(0, len)).filter(Boolean).slice(0, n);
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

// the model's answer as an object: already parsed (JSON mode), or text with a fence, a sentence, smart quotes or
// trailing commas around it
function fromModel(out) {
  const resp = out && (out.response ?? (out.result && out.result.response) ?? out);
  if (resp && typeof resp === "object" && !Array.isArray(resp)) return resp;
  let text = String(resp || "").replace(/```(?:json)?/gi, "");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON object in the answer: " + text.slice(0, 80));
  text = text.slice(a, b + 1);
  try { return JSON.parse(text); } catch {}
  return JSON.parse(text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, "$1"));
}

// the shape asked for; Workers AI's JSON mode holds the model to it
const strs = { type: "array", items: { type: "string" } };
const SHAPE = { type: "object", properties: { summary: { type: "string" }, mood: strs, energy: { type: "string", enum: ENERGY }, colours: strs, light: { type: "string" },
  places: strs, season: { type: "string" }, imagery: strs, avoid: strs, video: strs, photo: strs }, required: ["summary", "mood", "energy", "video", "photo"] };
const EXAMPLE = '{"summary": "A slow, bittersweet song about learning to love your own flaws.", "mood": ["bittersweet", "hopeful", "tender"], "energy": "calm", "colours": ["amber", "gold", "soft grey"], "light": "soft golden hour", "places": ["quiet bedroom", "rainy street", "old stone wall"], "season": "autumn", "imagery": ["scars", "mirror", "rain"], "avoid": ["party crowds", "bright neon"], "video": ["rain on window", "candle flame dark", "dust in sunlight", "slow waves sunset", "curtains blowing", "city lights blur"], "photo": ["kintsugi bowl close up film photo", "rainy window golden light", "cracked stone wall gold painting", "empty room soft light 35mm"]}';

export let lastWhy = "";   // why the last read failed (for the API answer and the logs)
export async function readVibe(ai, { lyrics, title, sound }) {
  lyrics = String(lyrics || "").slice(0, 5000);
  const heard = soundWords(sound);
  if (!ai || (!clean(lyrics) && !heard)) { lastWhy = "nothing to read"; return null; }
  const key = `${clean(lyrics).toLowerCase().slice(0, 600)}|${clean(title).toLowerCase()}|${heard}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sys = `You read a song for the people making its lyric video, so they can find background footage and photos that feel like the song. You get the lyrics and a few things measured from the audio. Work out the song's real feel: read past single words (a song that mentions "fire" can be tender; "rain" can be joyful) and weigh the sound: a slow, soft, dark-sounding song is not a party song even with happy words, and a fast bright one is not gloomy.

Answer in English (whatever the lyrics' language) with one JSON object and nothing else. The fields:
summary: one plain sentence on what the song feels like. mood: 2 to 4 mood words. energy: exactly one of "calm", "steady", "lively", "intense". colours: 2 to 4 colour words. light: a few words on the light. places: 2 to 4 concrete, filmable settings. season: a season or "any". imagery: 3 to 6 concrete images taken from the lyrics. avoid: 2 to 4 things that would clash with the song.
video: 6 different stock-video searches of 2 to 4 plain words each: things a camera can film that exist on free stock video sites, matching the mood, energy and light; vary them; no faces, no text, no famous places.
photo: 4 different image searches of 3 to 6 words each for mood-board pictures, each a concrete scene plus a look (film photo, painting and so on).

An example of the format only (for a different song; don't copy its content):
${EXAMPLE}`;
  const user = (clean(title) ? `Song title: ${clean(title).slice(0, 80)}\n` : "") + (heard ? `Measured from the audio: ${heard}\n` : "") + `\nLyrics:\n${clean(lyrics) ? lyrics : "(instrumental or no lyrics yet)"}`;
  const messages = [{ role: "system", content: sys }, { role: "user", content: user }];
  const whys = [];
  // JSON mode first; if the model or the account doesn't take it, the same question as plain text
  for (const strict of [true, false]) {
    try {
      const out = await ai({ messages, max_tokens: 900, temperature: 0.4, ...(strict ? { response_format: { type: "json_schema", json_schema: SHAPE } } : {}) });
      const v = fromModel(out);
      const vibe = {
        summary: clean(v.summary).slice(0, 220),
        mood: list(v.mood, 4, 24), energy: ENERGY.includes(clean(v.energy).toLowerCase()) ? clean(v.energy).toLowerCase() : "steady",
        colours: list(v.colours || v.colors, 4, 24), light: clean(v.light).slice(0, 60),
        places: list(v.places, 4), season: clean(v.season).slice(0, 20) || "any",
        imagery: list(v.imagery, 6), avoid: list(v.avoid, 4),
        video: [...new Set(list(v.video || v.videos, 6, 40).map(q => q.toLowerCase()))],
        photo: [...new Set(list(v.photo || v.photos, 4, 60))],
      };
      if (!vibe.video.length && !vibe.mood.length) throw new Error("the answer had no searches or moods");
      cache.set(key, vibe); if (cache.size > 300) cache.delete(cache.keys().next().value);
      lastWhy = "";
      return vibe;
    } catch (err) {
      whys.push(`${strict ? "json mode" : "plain"}: ${String(err && err.message || err).slice(0, 160)}`);
    }
  }
  lastWhy = whys.join(" | ");
  console.error("vibe failed:", lastWhy);
  return null;
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

// searches from the lyrics' own words, for when the vibe couldn't be read
const COMMON = new Set("that this with your have from what when they there their been were will just like know about would could into onto over under through around again still only dont cant wont youre feel never ever always every more love baby yeah gonna wanna gotta cause because nothing something everything someone tonight right left want need take make give come back down away even much ain't these those them then than here where".split(" "));
export function lyricSearches(lyrics, n = 4) {
  const words = clean(lyrics).toLowerCase().replace(/[^\p{L}\s']/gu, " ").split(/\s+/).filter(w => w.length >= 4 && !COMMON.has(w) && !COMMON.has(w.replace(/'/g, "")));
  const count = new Map(); for (const w of words) count.set(w, (count.get(w) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
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
  return json(vibe ? { vibe, ai: true } : { vibe: null, ai: false, why: lastWhy });
}

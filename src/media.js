/**
 * Footage for the lyric videos: free stock video search, AI-generated backgrounds, and a relay for the files.
 *
 *   GET  /api/stock/search?q=&orientation=portrait|landscape|square&page=1
 *        Searches Pixabay (PIXABAY_KEY) and Pexels (PEXELS_KEY), whichever keys are set.
 *   GET  /api/media?u=<url>&s=<signature>
 *        Streams a video or photo file to the browser. Only URLs this backend handed out (signed) are relayed, so it
 *        can't be used as an open proxy. Needed because most video hosts don't allow a web page to read their
 *        files, and the app must read them to put them in the exported video.
 *   POST /api/bg/prompts   {lyrics, count, mood}            -> {prompts: [...]}   ideas written by an AI from the lyrics
 *   POST /api/bg/estimate  {duration, aspect}               -> {usd}              Higgsfield's price for one clip
 *   POST /api/bg/generate  {prompt, duration, aspect}       -> {id}               starts a Higgsfield video (Kling 2.6 Pro)
 *   GET  /api/bg/status/:id                                 -> {status, file?}    file is a signed /api/media link
 *
 * Higgsfield needs HF_KEY_ID and HF_KEY_SECRET (from https://console.higgsfield.ai, an API account with balance).
 */

const HF = "https://api.higgsfield.ai";
const HF_MODEL = "kling-video/v2.6/pro/text-to-video";
const PROMPT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const ASPECTS = { "9:16": "9:16", "4:5": "9:16", "1:1": "1:1", "16:9": "16:9" };   // Kling offers 9:16, 1:1 and 16:9
const cache = new Map();   // search results, kept a day (Pixabay asks for this); per server instance

export function mediaHealth(env) {
  return { stock: { pixabay: !!env.PIXABAY_KEY, pexels: !!env.PEXELS_KEY }, bg: !!(env.HF_KEY_ID && env.HF_KEY_SECRET) };
}

export async function mediaRoute(request, env, url, path, method, { hasAI, runModel, json }) {
  if (path === "/api/stock/search" && method === "GET") return stockSearch(env, url, json);
  if (path === "/api/media" && method === "GET") return relay(env, url, request, json);
  if (path === "/api/bg/prompts" && method === "POST") return bgPrompts(env, request, json, hasAI, runModel);
  if (path === "/api/bg/estimate" && method === "POST") return bgEstimate(env, request, json);
  if (path === "/api/bg/generate" && method === "POST") return bgGenerate(env, request, json);
  const m = path.match(/^\/api\/bg\/status\/([A-Za-z0-9-]{8,64})$/);
  if (m && method === "GET") return bgStatus(env, m[1], url, json);
  return null;
}

/* ---------- signed links for the relay ---------- */
async function sign(env, u) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("media:" + (env.MEDIA_SECRET || env.SLS_PASSCODE || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(u)));
  return [...mac.slice(0, 16)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function mediaLink(env, u) { return `/api/media?u=${encodeURIComponent(u)}&s=${await sign(env, u)}`; }

async function relay(env, url, request, json) {
  const u = url.searchParams.get("u") || "", s = url.searchParams.get("s") || "";
  if (!/^https:\/\//.test(u) || s !== (await sign(env, u))) return json({ error: "bad_link", message: "That link isn't valid." }, 403);
  const up = await fetch(u, { redirect: "follow", headers: { "user-agent": "StellarLyricStudio/1.0" } });
  if (!up.ok || !up.body) return json({ error: "upstream", message: `The host answered ${up.status}.` }, 502);
  let type = (up.headers.get("content-type") || "").split(";")[0].trim();
  const pic = u.match(/\.(jpe?g|png|webp|gif|avif)(\?|$)/i);
  if (!/^(video|image)\//.test(type)) type = pic ? "image/" + pic[1].toLowerCase().replace("jpg", "jpeg") : /\.webm(\?|$)/i.test(u) ? "video/webm" : "video/mp4";
  const headers = { "content-type": type, "cache-control": "private, max-age=3600" };
  const len = up.headers.get("content-length"); if (len) headers["content-length"] = len;
  return new Response(up.body, { status: 200, headers });
}

/* ---------- stock video search ---------- */
const shape = (w, h) => (h > w * 1.15 ? "portrait" : w > h * 1.15 ? "landscape" : "square");

async function stockSearch(env, url, json) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100), orientation = url.searchParams.get("orientation") || "portrait";
  const page = Math.max(1, Math.min(20, +url.searchParams.get("page") || 1));
  if (!q) return json({ error: "bad_request", message: "Type something to search for." }, 400);
  if (!env.PIXABAY_KEY && !env.PEXELS_KEY) return json({ error: "no_stock", message: "No stock video service is connected yet." }, 503);
  const key = `${q.toLowerCase()}|${orientation}|${page}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 86400000) return json(hit.data);
  const jobs = [];
  if (env.PEXELS_KEY) jobs.push(pexels(env, q, orientation, page).catch(e => ({ error: "Pexels: " + e.message, results: [] })));
  if (env.PIXABAY_KEY) jobs.push(pixabay(env, q, orientation, page).catch(e => ({ error: "Pixabay: " + e.message, results: [] })));
  const parts = await Promise.all(jobs);
  // interleave the two sources, best orientation match first
  const lists = parts.map(p => p.results), results = [];
  for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (l[i]) results.push(l[i]);
  results.sort((a, b) => (b.shape === orientation) - (a.shape === orientation));
  for (const r of results) r.file = await mediaLink(env, r.file);
  const data = { results, errors: parts.map(p => p.error).filter(Boolean), sources: { pixabay: !!env.PIXABAY_KEY, pexels: !!env.PEXELS_KEY } };
  if (results.length) { cache.set(key, { at: Date.now(), data }); if (cache.size > 500) cache.delete(cache.keys().next().value); }
  return json(data);
}

async function pixabay(env, q, orientation, page) {
  const u = `https://pixabay.com/api/videos/?key=${encodeURIComponent(env.PIXABAY_KEY)}&q=${encodeURIComponent(q)}&per_page=30&page=${page}&safesearch=true`;
  const r = await fetch(u); if (!r.ok) throw new Error(r.status === 429 ? "busy, try again in a minute" : `HTTP ${r.status}`);
  const d = await r.json();
  return { results: (d.hits || []).map(h => {
    const v = h.videos || {}, big = v.medium && v.medium.url ? v.medium : v.small && v.small.url ? v.small : v.large;
    const pick = big && big.size > 30e6 && v.small && v.small.url ? v.small : big;   // keep downloads reasonable
    if (!pick || !pick.url) return null;
    const prev = (v.tiny && v.tiny.url) ? v.tiny : v.small;
    return { id: "pb" + h.id, source: "Pixabay", w: pick.width, h: pick.height, shape: shape(pick.width, pick.height), duration: h.duration,
      thumb: (v.medium && v.medium.thumbnail) || (v.small && v.small.thumbnail) || "", preview: prev && prev.url, file: pick.url,
      author: h.user || "Pixabay", page: h.pageURL, title: (h.tags || "").split(",").slice(0, 3).join(", ").trim() };
  }).filter(Boolean) };
}

async function pexels(env, q, orientation, page) {
  const u = `https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(q)}&orientation=${orientation}&per_page=30&page=${page}&size=medium`;
  const r = await fetch(u, { headers: { authorization: env.PEXELS_KEY } }); if (!r.ok) throw new Error(r.status === 429 ? "busy, try again later" : `HTTP ${r.status}`);
  const d = await r.json();
  return { results: (d.videos || []).map(v => {
    const files = (v.video_files || []).filter(f => f.link && f.width && f.height && /mp4/.test(f.file_type || "mp4"));
    if (!files.length) return null;
    const long = f => Math.max(f.width, f.height);
    const pick = files.filter(f => long(f) <= 2000).sort((a, b) => long(b) - long(a))[0] || files.sort((a, b) => long(a) - long(b))[0];
    const prev = files.slice().sort((a, b) => long(a) - long(b))[0];
    return { id: "px" + v.id, source: "Pexels", w: pick.width, h: pick.height, shape: shape(pick.width, pick.height), duration: v.duration,
      thumb: v.image || "", preview: prev.link, file: pick.link, author: (v.user && v.user.name) || "Pexels", page: v.url, title: "" };
  }).filter(Boolean) };
}

/* ---------- AI backgrounds ---------- */
async function body(request) { try { return await request.json(); } catch { return {}; } }
const hfHeaders = env => ({ authorization: `Key ${env.HF_KEY_ID}:${env.HF_KEY_SECRET}`, "content-type": "application/json" });
const noHF = json => json({ error: "no_bg", message: "Higgsfield isn't connected yet." }, 503);
const STYLE = "Cinematic vertical background footage for a music lyric video. Slow, smooth camera movement, rich atmosphere, soft depth of field. No text, no letters, no logos, no subtitles. Leave calm space in the middle of the frame for lyrics.";
function hfBody(b) {
  const duration = +b.duration === 10 ? 10 : 5, aspect_ratio = ASPECTS[b.aspect] || "9:16";
  const prompt = `${String(b.prompt || "").trim().slice(0, 1200)}\n\n${STYLE}`;
  return { prompt, duration, aspect_ratio, sound: "off" };
}

async function bgPrompts(env, request, json, hasAI, runModel) {
  const b = await body(request), lyrics = String(b.lyrics || "").slice(0, 6000), count = Math.max(1, Math.min(6, +b.count || 3)), mood = String(b.mood || "").slice(0, 200);
  const fallback = () => Array.from({ length: count }, (_, i) => `${mood || "Dreamy, cinematic night"} scene inspired by the song: ${lyrics.split("\n").filter(Boolean)[i * 2] || "city lights and soft glow"}`);
  if (!hasAI || !lyrics.trim()) return json({ prompts: fallback(), ai: false });
  const sys = `You write prompts for an AI video generator that makes background footage for a music lyric video. Read the lyrics, find their imagery, mood, setting and season, and write exactly ${count} different shot descriptions that follow the song from start to end. Each is one or two sentences in English (whatever the lyrics' language), visual only: place, light, weather, colours, movement, camera move. No text or lettering on screen, no famous people, no brands, no close-up faces. Answer with a JSON array of ${count} strings and nothing else.`;
  try {
    const out = await runModel(env, PROMPT_MODEL, { messages: [{ role: "system", content: sys }, { role: "user", content: (mood ? `Mood wanted: ${mood}\n\n` : "") + `Lyrics:\n${lyrics}` }], max_tokens: 900, temperature: 0.7 });
    // the model may hand back the JSON already parsed, or as text with a sentence around it
    const resp = out && (out.response ?? out.result?.response ?? out);
    let arr = Array.isArray(resp) ? resp : null;
    if (!arr) { const text = typeof resp === "string" ? resp : JSON.stringify(resp); arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)); }
    const prompts = arr.map(x => String(x).trim()).filter(Boolean).slice(0, count);
    if (!prompts.length) throw new Error("empty");
    while (prompts.length < count) prompts.push(prompts[prompts.length - 1]);
    return json({ prompts, ai: true });
  } catch (err) {
    console.error("prompt writing failed:", String(err && err.message || err));
    return json({ prompts: fallback(), ai: false });
  }
}

async function bgEstimate(env, request, json) {
  if (!env.HF_KEY_ID || !env.HF_KEY_SECRET) return noHF(json);
  const b = hfBody({ ...(await body(request)), prompt: "estimate" });
  const r = await fetch(`${HF}/estimate/${HF_MODEL}`, { method: "POST", headers: hfHeaders(env), body: JSON.stringify(b) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) return json({ error: "hf_error", message: hfMessage(r.status, d) }, r.status === 401 ? 502 : 502);
  return json({ usd: d.usd != null ? String(d.usd) : null });
}

async function bgGenerate(env, request, json) {
  if (!env.HF_KEY_ID || !env.HF_KEY_SECRET) return noHF(json);
  const b = await body(request); if (!String(b.prompt || "").trim()) return json({ error: "bad_request", message: "Describe the background first." }, 400);
  const r = await fetch(`${HF}/${HF_MODEL}`, { method: "POST", headers: { ...hfHeaders(env), "Hf-Expires-After": "86400" }, body: JSON.stringify(hfBody(b)) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || !d.request_id) return json({ error: "hf_error", message: hfMessage(r.status, d) }, 502);
  return json({ id: d.request_id, status: d.status || "queued" });
}

async function bgStatus(env, id, url, json) {
  if (!env.HF_KEY_ID || !env.HF_KEY_SECRET) return noHF(json);
  const r = await fetch(`${HF}/requests/${id}/status`, { headers: hfHeaders(env) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d) return json({ error: "hf_error", message: hfMessage(r.status, d) }, 502);
  const out = { status: d.status, error: d.error || null };
  if (d.status === "completed" && d.video && d.video.url) out.file = await mediaLink(env, d.video.url);
  if (d.status === "nsfw") out.error = "Higgsfield refused this description. Try wording it differently.";
  return json(out);
}

function hfMessage(status, d) {
  const detail = d && (d.detail || d.message || d.error);
  if (status === 401 || status === 403) return "Higgsfield didn't accept the API key.";
  if (status === 402 || /balance|insufficient|credit/i.test(String(detail))) return "The Higgsfield account is out of balance. Top it up at console.higgsfield.ai.";
  if (status === 429) return "Higgsfield is busy. Try again in a minute.";
  return "Higgsfield answered with an error" + (detail ? `: ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 200)}` : ` (${status}).`);
}

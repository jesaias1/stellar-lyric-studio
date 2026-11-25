/**
 * Photos for lyric videos: the image grabber and moodboards.
 *
 *   GET  /api/photos/search?q=&orientation=&from=free|pinterest|both&page=1&next=
 *        One search, as is. Free photos come from Pexels (PEXELS_KEY) and Pixabay (PIXABAY_KEY);
 *        Pinterest results come through SerpApi (SERPAPI_KEY), because Pinterest has no public search API.
 *   POST /api/photos/pick     {lyrics, prompt, count, aspect, from, look?, exclude?, queries?, page?, next?}
 *                             -> {queries, picks, spare, errors, page, next, skipped, pinLeft}
 *        look: "mix" (art and film-style photos), "art" or "photo". pinLeft: Pinterest searches left this month.
 *        exclude: ids/links of images already used, never returned. queries+page+next: "find more", the same
 *        searches further down the results (page is the last page read, next the Pinterest page tokens).
 *        The whole grab in one go: an AI turns the keywords and the lyrics into a few searches, they run on
 *        every source that is switched on, and the AI ranks what came back against the song. `picks` are
 *        the best `count`, `spare` the runners-up the review window offers as replacements.
 *   POST /api/photos/rank     {lyrics, prompt, count, items: [{id, text}]} -> {order: [id...], ai}
 *        Ranks images the browser already has (a moodboard) by how well their titles fit the song.
 *   POST /api/moodboard/pinterest {url}  -> {name, images}
 *        Reads a public Pinterest board through its RSS feed (the latest pins, about 25). Pinterest blocks
 *        some servers, so this can fail; the app then suggests saving the images and dropping them in.
 *
 * Every image file goes back to the browser as a signed /api/media link (see src/media.js).
 * vibe: the song's vibe (src/vibe.js), which /api/photos/pick and /api/photos/rank use to write the searches
 * and rank the results. No AI-made pictures: Pinterest is asked for "less AI", Pixabay marks its own, and every
 * description is checked (aiMade).
 */
import { mediaLink } from "./media.js";
import { aiMade, readVibe, vibeFrom, vibeText } from "./vibe.js";

const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const ORIENT = { "9:16": "portrait", "4:5": "portrait", "1:1": "square", "16:9": "landscape" };
const cache = new Map();   // search results for a day, per server instance (Pixabay asks for caching)

export function photosHealth(env) {
  return { photos: { pexels: !!env.PEXELS_KEY, pixabay: !!env.PIXABAY_KEY, pinterest: !!env.SERPAPI_KEY } };
}

export async function photosRoute(request, env, url, path, method, { hasAI, runModel, json }) {
  const ai = hasAI ? (input) => runModel(env, TEXT_MODEL, input) : null;
  if (path === "/api/photos/search" && method === "GET") return searchRoute(env, url, json);
  if (path === "/api/photos/pick" && method === "POST") return pickRoute(env, request, json, ai);
  if (path === "/api/photos/rank" && method === "POST") return rankRoute(request, json, ai);
  if (path === "/api/moodboard/pinterest" && method === "POST") return boardRoute(env, request, json);
  return null;
}

/* ---------- helpers ---------- */
async function body(request) { try { return await request.json(); } catch { return {}; } }
const shape = (w, h) => (!w || !h ? "unknown" : h > w * 1.15 ? "portrait" : w > h * 1.15 ? "landscape" : "square");
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const wantFree = from => from !== "pinterest";
const wantPin = from => from === "pinterest" || from === "both";

function sources(env, from) {
  return {
    pexels: wantFree(from) && !!env.PEXELS_KEY,
    pixabay: wantFree(from) && !!env.PIXABAY_KEY,
    pinterest: wantPin(from) && !!env.SERPAPI_KEY,
  };
}
function noSourceMessage(env, from) {
  if (from === "pinterest") return "Pinterest search isn't switched on yet. It needs a SerpApi key (SERPAPI_KEY) in the site's settings.";
  if (!env.PEXELS_KEY && !env.PIXABAY_KEY) return "Free photo search isn't switched on yet. It needs a free Pixabay or Pexels key in the site's settings.";
  return "No photo source is switched on.";
}

/* ---------- the sources ---------- */
async function pexels(env, q, orientation, page, per) {
  const o = orientation === "square" ? "square" : orientation;
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=${o}&per_page=${per}&page=${page}`, { headers: { authorization: env.PEXELS_KEY } });
  if (!r.ok) throw new Error(r.status === 429 ? "busy, try again later" : `HTTP ${r.status}`);
  const d = await r.json();
  return { items: (d.photos || []).map(p => ({
    id: "pxp" + p.id, source: "Pexels", w: p.width, h: p.height, shape: shape(p.width, p.height),
    thumb: (p.src && (p.src.medium || p.src.small)) || "", file: p.src && (p.src.large2x || p.src.large || p.src.original),
    author: p.photographer || "Pexels", page: p.url, title: clean(p.alt),
  })).filter(p => p.file && !aiMade(p)) };
}

async function pixabay(env, q, orientation, page, per, look = "mix") {
  const o = orientation === "portrait" ? "vertical" : orientation === "landscape" ? "horizontal" : "all";
  // paintings and drawings are "illustrations" on Pixabay; a query that asks for one gets those
  const kind = look === "photo" ? "photo" : look === "art" || ART_Q.test(q) ? "illustration" : "photo";
  const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(env.PIXABAY_KEY)}&q=${encodeURIComponent(q.slice(0, 100))}&image_type=${kind}&orientation=${o}&per_page=${per}&page=${page}&safesearch=true`);
  if (!r.ok) throw new Error(r.status === 429 ? "busy, try again in a minute" : `HTTP ${r.status}`);
  const d = await r.json();
  return { items: (d.hits || []).filter(h => !aiMade({ isAiGenerated: h.isAiGenerated, tags: h.tags })).map(h => ({
    id: "pbp" + h.id, source: "Pixabay", w: h.imageWidth, h: h.imageHeight, shape: shape(h.imageWidth, h.imageHeight),
    thumb: h.webformatURL || h.previewURL || "", file: h.largeImageURL || h.webformatURL,
    author: h.user || "Pixabay", page: h.pageURL, title: clean(h.tags),
  })).filter(p => p.file) };
}

async function pinterest(env, q, next) {
  const u = `https://serpapi.com/search.json?engine=pinterest&less_ai=true&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(env.SERPAPI_KEY)}` + (next ? `&next_page_token=${encodeURIComponent(next)}` : "");
  const r = await fetch(u);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) {
    const why = d && d.error ? String(d.error) : `HTTP ${r.status}`;
    throw new Error(/run out|limit|plan/i.test(why) ? "the SerpApi account is out of searches this month" : /invalid api key/i.test(why) ? "SerpApi didn't accept the key" : why.slice(0, 160));
  }
  const items = (d.pins || []).filter(p => p.original && !p.video && p.price == null).map(p => ({
    id: "pin" + (p.pin_id || p.original).toString().replace(/[^A-Za-z0-9]/g, "").slice(-24), source: "Pinterest",
    w: p.original_width || 0, h: p.original_height || 0, shape: shape(p.original_width, p.original_height),
    thumb: p.thumbnail || p.original, file: p.original,
    author: (p.pinner && (p.pinner.name || p.pinner.username)) || "Pinterest", page: p.pin_link || p.link || (p.board && p.board.link) || "https://www.pinterest.com",
    title: clean([p.title, p.alt_text, p.description].filter(Boolean).join(" · ")).slice(0, 220),
    ai: aiMade({ title: [p.title, p.alt_text, p.description, p.board && p.board.name].filter(Boolean).join(" · ") }),
  })).filter(p => !p.ai);
  return { items, next: (d.serpapi_pagination && d.serpapi_pagination.next_page_token) || d.next_page_token || null };
}

/* Runs one query on every source that is on. Results interleaved, so no source crowds out the others.
   pin: false leaves Pinterest out (each Pinterest search costs one of the SerpApi account's monthly searches). */
async function searchAll(env, q, orientation, from, { page = 1, next = null, per = 20, look = "mix", pin = true } = {}) {
  const on = { ...sources(env, from) }; if (!pin) on.pinterest = false;
  const key = `${q.toLowerCase()}|${orientation}|${from}|${page}|${next || ""}|${look}|${pin ? 1 : 0}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 86400000) return hit.data;
  const jobs = [];
  if (on.pexels) jobs.push(pexels(env, q, orientation, page, per).catch(e => ({ error: "Pexels: " + e.message, items: [] })));
  if (on.pixabay) jobs.push(pixabay(env, q, orientation, page, per, look).catch(e => ({ error: "Pixabay: " + e.message, items: [] })));
  if (on.pinterest && (page === 1 || next)) jobs.push(pinterest(env, q, next).then(x => ({ ...x, pin: true })).catch(e => ({ error: "Pinterest: " + e.message, items: [], pin: true })));
  const parts = await Promise.all(jobs), lists = parts.map(p => p.items), items = [];
  for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (l[i]) items.push({ ...l[i], q });
  const pinPart = parts.find(p => p.pin);
  const data = { items, errors: parts.map(p => p.error).filter(Boolean), next: pinPart ? pinPart.next || null : null };
  if (items.length) { cache.set(key, { at: Date.now(), data }); if (cache.size > 500) cache.delete(cache.keys().next().value); }
  return data;
}

// how many Pinterest searches the SerpApi account has left this month (asking costs nothing)
let leftCache = { at: 0, n: null };
async function searchesLeft(env) {
  if (!env.SERPAPI_KEY) return null;
  if (Date.now() - leftCache.at < 20000) return leftCache.n;
  try {
    const r = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(env.SERPAPI_KEY)}`), d = await r.json();
    const n = Number(d.total_searches_left ?? d.plan_searches_left);
    leftCache = { at: Date.now(), n: Number.isFinite(n) ? n : null };
  } catch { leftCache = { at: Date.now(), n: null }; }
  return leftCache.n;
}

async function signAll(env, items) {
  return Promise.all(items.map(async it => ({ ...it, file: await mediaLink(env, it.file) })));
}

async function searchRoute(env, url, json) {
  const q = clean(url.searchParams.get("q")).slice(0, 120), from = url.searchParams.get("from") || "free";
  const orientation = url.searchParams.get("orientation") || "portrait", page = Math.max(1, Math.min(20, +url.searchParams.get("page") || 1));
  if (!q) return json({ error: "bad_request", message: "Type some keywords first." }, 400);
  const on = sources(env, from);
  if (!on.pexels && !on.pixabay && !on.pinterest) return json({ error: "no_photos", message: noSourceMessage(env, from) }, 503);
  const d = await searchAll(env, q, orientation, from, { page, next: url.searchParams.get("next") || null, per: 30 });
  return json({ results: await signAll(env, d.items), errors: d.errors, next: d.next, sources: on });
}

/* ---------- the AI parts ---------- */
// the model may answer with the JSON already parsed, or as text with a sentence around it
function jsonArray(out) {
  const resp = out && (out.response ?? (out.result && out.result.response) ?? out);
  if (Array.isArray(resp)) return resp;
  const text = typeof resp === "string" ? resp : JSON.stringify(resp);
  return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
}

/* The look: "mix" (default) half painted or drawn art, half film-style photos; "art" only paintings, drawings
   and illustration; "photo" only photos. The searches ask for a medium, because a plain subject search
   ("snowy cabin night") mostly finds polished stock shots and glossy AI renders, while "snowy cabin night oil
   painting" or "snowy street night 35mm film" finds the characterful pictures people actually pin. */
const LOOKS = {
  art: ["oil painting", "illustration", "gouache painting", "vintage illustration", "anime background art", "watercolor painting"],
  photo: ["35mm film photo", "film photography", "cinematic film still", "analog photo"],
};
const ART_Q = /\b(painting|painted|illustration|drawing|art|artwork|gouache|watercolou?r|linocut|pastel|sketch|anime|storybook|impressionist|print)\b/i;
function withMedium(q, look, k) {
  if (ART_Q.test(q) || /\b(film|35mm|analog|photograph|photo|polaroid|still)\b/i.test(q)) return q;
  const pool = look === "art" ? LOOKS.art : look === "photo" ? LOOKS.photo : (k % 2 ? LOOKS.photo : LOOKS.art);
  return `${q} ${pool[(k * 3 + q.length) % pool.length]}`;
}
async function writeQueries(ai, lyrics, prompt, n, look = "mix", vibe = null) {
  const base = clean(prompt);
  const fallback = () => {
    let qs;
    if (base) qs = [base, base, base].slice(0, Math.max(1, Math.min(n, 3)));
    else {
      const words = clean(lyrics).toLowerCase().match(/\p{L}{4,}/gu) || [];
      const common = new Set("that this with your have from what when they there their been were will just like know about would could into onto over under through around again still only dont cant wont youre feel never ever always every more love baby yeah oh".split(" "));
      const pick = [...new Set(words.filter(w => !common.has(w)))].slice(0, 3);
      qs = [pick.length ? pick.join(" ") : "dreamy scenery", pick.length ? pick.slice(0, 2).join(" ") + " scenery" : "everyday life scenes"];
    }
    return qs.map((q, k) => k === 0 && base ? q : withMedium(q, look, k));
  };
  if (!ai || (!base && !clean(lyrics))) return { queries: [...new Set(fallback())], ai: false };
  const medium = look === "art" ? "Every query names an art medium (for example oil painting, gouache, watercolor, vintage or storybook illustration, anime background art, linocut)."
    : look === "photo" ? "Every query names a photo style that isn't stock (for example 35mm film, analog, grainy, cinematic film still, candid, vintage photograph)."
    : "Mix the mediums: about half the queries name an art medium (oil painting, gouache, vintage or storybook illustration, anime background art, watercolor), the other half a photo style that isn't stock (35mm film, analog, cinematic film still, grainy, candid).";
  const feel = vibeText(vibe);
  const sys = `You help pick images for a music lyric video on social media. Write exactly ${n} short image search queries for Pinterest-style searches (3 to 7 words each, in English, whatever language the lyrics are in). Aim for characterful, artistic, interesting images, the kind people collect on mood boards: not polished stock photos, not people posing, not glossy 3D or fantasy renders. Match the song's own mood and colours: bright, warm and playful for an upbeat song, soft for a gentle one, dark only when the song is dark. Each query = a concrete scene or subject + a medium or style.` +
    (base ? ` The creator asked for: "${base}". Every query must stay inside that request (same subject, style or category); use the lyrics only to steer the mood, places, season and colours.` : " Base them on the imagery, mood, setting and season of the lyrics.") +
    ` ${medium} Make the queries different from each other (different scenes, angles, mediums) so the results vary. No artist names, no song titles, no words like "lyrics", "quote", "wallpaper" or "stock". Answer with a JSON array of ${n} strings and nothing else.`;
  try {
    const out = await ai({ messages: [{ role: "system", content: sys + (feel ? " The song has been read already (below): follow its feel, energy, colours and light closely." : "") }, { role: "user", content: (feel ? `How the song feels:\n${feel}\n\n` : "") + `Lyrics:\n${clean(lyrics) ? lyrics.slice(0, 4000) : "(no lyrics yet)"}` }], max_tokens: 240, temperature: 0.8 });
    let qs = jsonArray(out).map(x => clean(x).replace(/["#]/g, "").slice(0, 70)).filter(Boolean);
    if (!qs.length) throw new Error("empty");
    qs = qs.map((q, k) => withMedium(q, look, k));
    if (base && !qs.some(q => q.toLowerCase() === base.toLowerCase()) && base.split(" ").length <= 6) qs.unshift(base);   // the creator's own words always get searched
    return { queries: [...new Set(qs)].slice(0, n), ai: true };
  } catch (err) {
    console.error("photo queries failed:", String(err && err.message || err));
    return { queries: [...new Set(fallback())], ai: false };
  }
}

/* Quality without looking at the picture: right orientation, enough pixels, and no signs of text, collages or products. */
const BAD = /\b(quote|quotes|text|typography|lettering|infographic|meme|logo|poster|flyer|template|collage|mockup|tutorial|diy|recipe|outfit|product|sale|shop|printable|clipart|vector|illustration set|wallpaper with text)\b/i;
// what makes a picture look like stock or a generated render, from its description
const STOCK = /\b(stock (photo|image|footage)|royalty[- ]free|business(man|woman)?|corporate|office|smiling|happy (woman|man|couple|family)|copy ?space|isolated on|studio shot|model posing|banner|background image|hd wallpaper|4k wallpaper|8k|3d render|3d illustration|cgi|octane|unreal engine|hyper ?realistic|ultra ?realistic|ai[- ]generated|ai art|generative ai|midjourney|dall[- ]?e|stable diffusion|fantasy art|digital art)\b/i;
function baseScore(it, orientation, i) {
  let s = 0;
  if (it.shape === orientation) s += 3; else if (it.shape === "square" || it.shape === "unknown") s += 1;
  // enough pixels for a phone screen is enough: extra resolution mostly means stock
  const short = Math.min(it.w || 0, it.h || 0); s += short ? Math.min(1, short / 700) : 0.6;
  if (BAD.test(it.title || "")) s -= 4;
  if (STOCK.test(it.title || "")) s -= 2.5;
  if (it.source === "Pinterest") s += 0.6;   // collected by people, so more often has character
  return s - i * 0.02;   // earlier in the search results is a little better
}

async function rankByText(ai, lyrics, prompt, items, want, vibe = null) {
  if (!ai || items.length <= 1) return null;
  const lines = items.map((it, i) => `${i + 1}. [${it.shape}] ${clean(it.title || "(no description)").slice(0, 120)}`).join("\n");
  const sys = `You choose background photos for a music lyric video (lyrics are written over the photo). Below is a numbered list of photos, each with its orientation and description. Pick the ${want} that best fit the song's mood, imagery and the creator's request, best first. Prefer interesting, characterful, artistic images (paintings, illustration, film photography, real moments) over polished generic stock photos (posed people, business, perfect glossy landscapes) and over glossy AI or 3D renders. Match the song's own mood (bright and colourful for an upbeat song, dark only for a dark one). They also need to work behind text: not too busy, no text or quotes in the picture, no collages, no products, no infographics. Keep a visual mix (different scenes and mediums, not ${want} near-identical shots) while the whole set still feels like one mood. Answer with a JSON array of the chosen numbers only, best first.`;
  const feel = vibeText(vibe);
  const user = (clean(prompt) ? `Creator's request: ${clean(prompt)}\n\n` : "") + (feel ? `How the song feels (match this closely):\n${feel}\n\n` : "") + `Lyrics:\n${clean(lyrics) ? lyrics.slice(0, 3000) : "(none)"}\n\nPhotos:\n${lines}`;
  try {
    const out = await ai({ messages: [{ role: "system", content: sys }, { role: "user", content: user }], max_tokens: 400, temperature: 0.2 });
    const nums = jsonArray(out).map(n => parseInt(n, 10) - 1).filter(n => n >= 0 && n < items.length);
    const seen = new Set(), order = [];
    for (const n of nums) if (!seen.has(n)) { seen.add(n); order.push(n); }
    return order.length ? order : null;
  } catch (err) {
    console.error("photo ranking failed:", String(err && err.message || err));
    return null;
  }
}

/* ---------- the whole grab ---------- */
async function pickRoute(env, request, json, ai) {
  const b = await body(request), from = ["free", "pinterest", "both"].includes(b.from) ? b.from : "free";
  const count = Math.max(1, Math.min(40, Math.round(+b.count || 10))), orientation = ORIENT[b.aspect] || "portrait";
  const lyrics = String(b.lyrics || "").slice(0, 6000), prompt = clean(b.prompt).slice(0, 300);
  const look = ["mix", "art", "photo"].includes(b.look) ? b.look : "mix";
  const on = sources(env, from);
  if (!on.pexels && !on.pixabay && !on.pinterest) return json({ error: "no_photos", message: noSourceMessage(env, from) }, 503);
  const vibe = vibeFrom(b.vibe) || (ai && !b.queries && clean(lyrics) ? await readVibe(ai, { lyrics, title: b.title, sound: b.sound }) : null);
  // images already used (in this video or an earlier one) or already shown: never offered again
  const exclude = new Set((Array.isArray(b.exclude) ? b.exclude : []).slice(0, 4000).map(x => String(x).replace(/\?.*$/, "")));
  // "find more": the same searches, further down the results
  const again = Array.isArray(b.queries) && b.queries.length ? b.queries.map(q => clean(q).slice(0, 120)).filter(Boolean).slice(0, 5) : null;
  let page = again ? Math.max(1, Math.min(19, Math.round(+b.page || 1))) + 1 : 1, lastPage = page;
  const next = b.next && typeof b.next === "object" ? b.next : {};
  if (!again && !prompt && !clean(lyrics)) return json({ error: "bad_request", message: "Type a few keywords or a prompt first." }, 400);

  // more searches when more pictures are needed, so there is plenty to choose from
  const nq = count > 16 ? 4 : 3;
  const { queries, ai: wrote } = again ? { queries: again, ai: false } : await writeQueries(ai, lyrics, prompt, nq, look, vibe);
  const per = Math.max(12, Math.min(30, Math.ceil(count * 2.2 / queries.length)));
  const used = it => exclude.has(it.id) || exclude.has(String(it.page || "").replace(/\?.*$/, "")) || exclude.has(it.file.replace(/\?.*$/, ""));
  const seen = new Set(), pool = [], errors = new Set(), tokens = {};
  let skipped = 0;
  // up to three pages deep until there are enough new images to choose from
  for (let round = 0; round < 3 && page <= 20; round++, page++) {
    lastPage = page;
    // Pinterest only on the first round: every Pinterest search uses one of the month's SerpApi searches
    const runs = await Promise.all(queries.map(q => searchAll(env, q, orientation, from, { per, page, look, pin: round === 0, next: page > 1 ? next[q] || null : null })));
    runs.forEach((r, k) => { r.errors.forEach(e => errors.add(e)); tokens[queries[k]] = r.next || null; next[queries[k]] = r.next || null; });
    // one list, no duplicates, the first results of every query first
    for (let i = 0; runs.some(r => i < r.items.length); i++) for (const r of runs) {
      const it = r.items[i]; if (!it) continue;
      const k = it.file.replace(/\?.*$/, ""); if (seen.has(it.id) || seen.has(k)) continue;
      seen.add(it.id); seen.add(k);
      if (used(it)) { skipped++; continue; }
      pool.push(it);
    }
    const more = runs.some(r => r.items.length) && (on.pexels || on.pixabay);
    if (pool.length >= count * 1.6 || !more) break;
  }
  const pinLeft = on.pinterest ? await searchesLeft(env) : null;
  if (!pool.length) return json({ queries, picks: [], spare: [], errors: [...errors], ai: wrote, page: lastPage, next: tokens, skipped, pinLeft,
    message: skipped ? "Every image these searches found has been used already. Try other keywords." : `Nothing found for ${queries.map(q => `"${q}"`).join(", ")}. Try other keywords.` });

  // quality first, then the AI's judgement on the best of them
  const scored = pool.map((it, i) => ({ it, s: baseScore(it, orientation, i) })).sort((x, y) => y.s - x.s).map(x => x.it);
  const shortlist = scored.slice(0, Math.min(scored.length, Math.max(30, count * 2 + 8), 70));
  const want = Math.min(shortlist.length, count + Math.min(count, 12));
  const order = await rankByText(ai, lyrics, prompt, shortlist, want, vibe);
  let ranked = shortlist;
  if (order) { const chosen = order.map(n => shortlist[n]); ranked = [...chosen, ...shortlist.filter(it => !chosen.includes(it))]; }
  ranked = [...ranked, ...scored.slice(shortlist.length)];

  const picks = await signAll(env, ranked.slice(0, count)), spare = await signAll(env, ranked.slice(count, count + Math.max(12, count)));
  return json({ queries, picks, spare, vibe, errors: [...errors], ai: !!order || wrote, sources: on, page: lastPage, next: tokens, skipped, pinLeft });
}

async function rankRoute(request, json, ai) {
  const b = await body(request), items = Array.isArray(b.items) ? b.items.slice(0, 120) : [];
  const count = Math.max(1, Math.min(items.length || 1, Math.round(+b.count || 10)));
  const list = items.map(x => ({ id: String(x.id), title: clean(x.text).slice(0, 200), shape: x.shape || "unknown" }));
  const useful = list.filter(x => x.title && !/^(img|dsc|pxl|image|photo|screenshot|whatsapp|signal)[\s_-]*[\d_-]+/i.test(x.title));
  if (!ai || useful.length < 2) return json({ order: list.map(x => x.id), ai: false });
  const order = await rankByText(ai, String(b.lyrics || ""), String(b.prompt || ""), useful, Math.min(useful.length, count), vibeFrom(b.vibe));
  if (!order) return json({ order: list.map(x => x.id), ai: false });
  const first = order.map(n => useful[n].id);
  return json({ order: [...first, ...list.map(x => x.id).filter(id => !first.includes(id))], ai: true });
}

/* ---------- a Pinterest board as a moodboard ---------- */
async function boardRoute(env, request, json) {
  const b = await body(request);
  let raw = clean(b.url);
  if (!raw) return json({ error: "bad_request", message: "Paste the link to a Pinterest board." }, 400);
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let u;
  try { u = new URL(raw); } catch { return json({ error: "bad_request", message: "That doesn't look like a link." }, 400); }
  // pin.it short links point at the board: follow them once
  if (/(^|\.)pin\.it$/i.test(u.hostname)) {
    try { const r = await fetch(u.href, { redirect: "manual", headers: { "user-agent": UA } }); const loc = r.headers.get("location"); if (loc) u = new URL(loc, u); } catch {}
  }
  if (!/(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) return json({ error: "bad_request", message: "That isn't a Pinterest link. Open the board on Pinterest and copy the address from the browser." }, 400);
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || ["pin", "search", "ideas", "today", "_"].includes(parts[0])) return json({ error: "bad_request", message: "That's not a board link. Open the board itself (pinterest.com/name/board-name) and copy its address." }, 400);
  const user = parts[0], board = parts[1].replace(/\.rss$/, "");
  let xml = "";
  try {
    const r = await fetch(`https://www.pinterest.com/${encodeURIComponent(user)}/${encodeURIComponent(board)}.rss`, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" } });
    if (r.ok) xml = await r.text();
  } catch {}
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  const images = [];
  for (const it of items) {
    const desc = decode((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "");
    const src = (desc.match(/<img[^>]+src="([^"]+)"/i) || [])[1];
    if (!src || !/^https:\/\/i\.pinimg\.com\//.test(src)) continue;
    const title = clean(decode((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/<[^>]+>/g, ""));
    const link = clean(decode((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ""));
    // the full-size picture (sharp in a 1080p or 4K video), with the 736 px one as a fallback when that isn't there
    const big = src.replace(/\/\d+x\//, "/736x/"), full = src.replace(/\/\d+x\//, "/originals/");
    images.push({ id: "pb" + big.split("/").pop().replace(/\W/g, "").slice(0, 32), title, page: link, thumb: src, file: await mediaLink(env, full), alt: await mediaLink(env, big) });
  }
  if (!images.length) return json({ error: "board_unavailable", message: "Pinterest didn't hand over this board. Only public boards work, and Pinterest sometimes blocks servers. You can save the images from the board and drop them in here instead." }, 502);
  const name = clean(decode((xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1] || "")) || board.replace(/-/g, " ");
  return json({ name: name.slice(0, 60), images, note: images.length >= 24 ? "Pinterest only shares a board's latest 25 pins this way." : null });
}

function decode(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
}

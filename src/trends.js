/**
 * Trending TikTok sounds, from Chartmetric, and which of them fit the song that's open in the studio.
 *
 *   GET /api/trends/tiktok?country=&interval=weekly|daily&song=&artist=
 *     -> {configured, rows: [{rank, prev, name, artists, image, posts, recent, velocity, genre, weeks, link, fit}], song: {genre}, at}
 *        country: "" for the worldwide chart, or a two-letter country code (DK, US, ...).
 *        fit: {score, why: [...]} for the open song: same genre, climbing, the same artist.
 *
 * Needs CHARTMETRIC_REFRESH_TOKEN: the refresh token of a Chartmetric API account (a paid Chartmetric plan; the
 * token comes from Chartmetric, hi@chartmetric.com). Without it this answers {configured: false} and the studio
 * explains how to turn it on. Chartmetric is asked at most once every 6 hours per chart.
 */
const CM = "https://api.chartmetric.com/api";
const COUNTRIES = new Set(["DK", "SE", "NO", "FI", "DE", "GB", "US", "FR", "NL", "ES", "IT", "AU", "CA"]);
let tok = null;
const charts = new Map(), genres = new Map();

export async function trendsRoute(request, env, url, path, method, { json }) {
  if (path !== "/api/trends/tiktok") return null;
  if (method !== "GET") return json({ error: "method" }, 405);
  if (!env.CHARTMETRIC_REFRESH_TOKEN) return json({ configured: false, rows: [] });
  const q = url.searchParams, country = String(q.get("country") || "").toUpperCase(), interval = q.get("interval") === "daily" ? "daily" : "weekly";
  if (country && !COUNTRIES.has(country)) return json({ error: "bad_country", message: "That country isn't on the list." }, 400);
  const song = clean(q.get("song")), artist = clean(q.get("artist"));
  let rows, at;
  try { ({ rows, at } = await chart(env, country, interval)); }
  catch (err) { return json({ error: "chartmetric", message: err.message || "Chartmetric didn't answer. Try again in a minute." }, err.status === 429 ? 429 : 502); }
  const genre = song ? await songGenre(song, artist).catch(() => "") : "";
  return json({ configured: true, at, song: { genre }, rows: rows.map(r => ({ ...r, fit: song ? fitOf(r, genre, artist) : null })) });
}

const clean = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 120);
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const arr = x => Array.isArray(x) ? x : x == null ? [] : [x];

async function token(env) {
  if (tok && tok.exp > Date.now() + 60e3) return tok.v;
  const r = await fetch(CM + "/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshtoken: env.CHARTMETRIC_REFRESH_TOKEN }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(`Chartmetric didn't accept the key (${r.status}). Check CHARTMETRIC_REFRESH_TOKEN in Vercel.`);
  tok = { v: d.token, exp: Date.now() + (+d.expires_in || 3600) * 1000 };
  return tok.v;
}

async function chart(env, country, interval) {
  const k = country + "|" + interval, hit = charts.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit;
  const p = new URLSearchParams({ latest: "true", interval, limit: "50" });
  if (country) { p.set("countryChart", "true"); p.set("code2", country); }
  const go = async () => fetch(`${CM}/charts/tiktok/tracks?${p}`, { headers: { authorization: "Bearer " + await token(env) } });
  let r = await go();
  if (r.status === 401) { tok = null; r = await go(); }
  if (r.status === 429) throw Object.assign(new Error("Chartmetric is busy. Try again in a minute."), { status: 429 });
  if (!r.ok) throw new Error(`Chartmetric didn't send the chart (${r.status}).`);
  const d = await r.json().catch(() => ({}));
  const list = d.obj && Array.isArray(d.obj.data) ? d.obj.data : Array.isArray(d.obj) ? d.obj : [];
  const v = { at: Date.now(), rows: list.map(row).filter(x => x.name) };
  charts.set(k, v); if (charts.size > 40) charts.delete(charts.keys().next().value);
  return v;
}

function row(t) {
  const id = String(t.tiktok_track_id || arr(t.tiktok_track_ids)[0] || "");
  const artists = arr(t.artist_names).length ? arr(t.artist_names) : arr(t.tiktok_artist_names);
  return {
    rank: +t.rank || null, prev: t.pre_rank != null ? +t.pre_rank : null, name: String(t.name || ""), artists: artists.map(String).slice(0, 4),
    image: /^https:\/\//.test(t.image_url || "") ? t.image_url : "", posts: t.posts != null ? +t.posts : null,
    recent: t.weekly_posts != null ? +t.weekly_posts : t.daily_posts != null ? +t.daily_posts : null, velocity: t.velocity != null ? +t.velocity : null,
    genre: String(arr(t.track_genre)[0] || ""), weeks: t.time_on_chart != null && !isNaN(+t.time_on_chart) ? +t.time_on_chart : null,
    link: /^[\w'.!()~-]+$/.test(id) ? "https://www.tiktok.com/music/" + encodeURIComponent(id) : "",
  };
}

/* the open song's genre, from Apple Music (the studio's song catalogue) */
async function songGenre(song, artist) {
  const k = norm(artist + "|" + song); if (genres.has(k)) return genres.get(k);
  const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent((artist + " " + song).trim())}&media=music&entity=song&limit=8&country=DK`, { headers: { "user-agent": "StellarLyricStudio/1.0" } });
  const d = await r.json().catch(() => ({})), res = d.results || [];
  const a0 = norm(artist).split(/\s+/)[0] || "";
  const t = res.find(x => norm(x.trackName).startsWith(norm(song).slice(0, 12)) && (!a0 || norm(x.artistName).includes(a0))) || res.find(x => !a0 || norm(x.artistName).includes(a0)) || null;
  const g = t && t.primaryGenreName ? String(t.primaryGenreName) : "";
  genres.set(k, g); if (genres.size > 300) genres.delete(genres.keys().next().value);
  return g;
}

const SKIP = new Set(["music", "and", "the", "other"]);
const words = g => new Set(norm(g).replace(/hip[\s-]?hop/g, "hiphop").replace(/r\s*&\s*b/g, "rnb").split(/[^a-z0-9]+/).filter(w => w.length > 1 && !SKIP.has(w)));
function fitOf(r, genre, artist) {
  const why = []; let score = 0;
  const a = norm(artist);
  if (a && r.artists.some(x => norm(x).includes(a) || (a.length > 3 && a.includes(norm(x))))) { score += 5; why.push("The same artist"); }
  const gs = words(genre), rs = words(r.genre);
  if (gs.size && [...rs].some(w => gs.has(w))) { score += 3; why.push(`The same genre as your song (${genre})`); }
  const up = r.prev != null && r.rank != null ? r.prev - r.rank : 0;
  if (up >= 3) { score += 2; why.push(`Climbing: up ${up} places`); }
  else if (r.prev == null && r.weeks != null && r.weeks <= 1) { score += 2; why.push("New on the chart"); }
  else if (r.velocity > 0) { score += 1; why.push("Climbing"); }
  if (r.recent != null && r.recent >= 10000) { score += 1; why.push(`${r.recent >= 1e6 ? (r.recent / 1e6).toFixed(1) + "M" : Math.round(r.recent / 1000) + "K"} new videos lately`); }
  return { score, why };
}

/**
 * The Stellar Music artists (stellarmusic.dk/mgmt) and their songs, from Apple Music's free 30-second previews.
 *
 *   GET /api/catalog        -> {artists: [{id, name, picture}]}
 *   GET /api/catalog/:id    -> {artist, songs: [{id, title, artist, album, year, cover, duration, preview, link}]}
 *
 * Uses the public iTunes Search API (no key). preview is a signed /api/media link to the AAC preview, so the
 * studio can read the audio (Apple's file host doesn't allow web pages to read it directly). The artist picture
 * is the one on the artist's Apple Music page. Answers are kept in memory for a few hours.
 * To add or remove an artist, edit ARTISTS: the number is the artist's Apple Music ID (the number at the end of
 * their music.apple.com artist link).
 */
import { mediaLink } from "./media.js";

export const ARTISTS = [
  { id: "giift", name: "Giift", apple: 1609293959 },
  { id: "alex-vargas", name: "Alex Vargas", apple: 207308428 },
  { id: "scarlet-pleasure", name: "Scarlet Pleasure", apple: 823560885 },
  { id: "aleksiah", name: "aleksiah", apple: 1653982021 },
  { id: "maximillian", name: "Maximillian", apple: 1275654641 },
];
const COUNTRY = "dk", HOURS = 6;
const cache = new Map();
const fresh = (k, h = HOURS) => { const c = cache.get(k); return c && Date.now() - c.at < h * 3600e3 ? c.v : null; };
const keep = (k, v) => { cache.set(k, { at: Date.now(), v }); if (cache.size > 200) cache.delete(cache.keys().next().value); return v; };

export async function catalogRoute(request, env, path, method, { json }) {
  if (method !== "GET" || !path.startsWith("/api/catalog")) return null;
  if (path === "/api/catalog") {
    const artists = await Promise.all(ARTISTS.map(async a => ({ id: a.id, name: a.name, picture: await picture(a) })));
    return json({ artists });
  }
  const m = path.match(/^\/api\/catalog\/([a-z0-9-]{1,40})$/);
  const a = m && ARTISTS.find(x => x.id === m[1]);
  if (!a) return json({ error: "not_found", message: "No such artist." }, 404);
  let songs;
  try { songs = await songsOf(a); }
  catch (err) { console.error("apple lookup failed:", String(err && err.message || err)); return json({ error: "upstream", message: "Apple Music didn't answer. Try again in a moment." }, 502); }
  const out = await Promise.all(songs.map(async s => ({ ...s, preview: await mediaLink(env, s.preview) })));
  return json({ artist: { id: a.id, name: a.name, picture: await picture(a) }, songs: out });
}

async function songsOf(a) {
  const hit = fresh("songs:" + a.id); if (hit) return hit;
  const r = await fetch(`https://itunes.apple.com/lookup?id=${a.apple}&entity=song&country=${COUNTRY}&limit=200`, { headers: { "user-agent": "StellarLyricStudio/1.0" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const d = await r.json();
  const seen = new Set(), songs = [];
  const rows = (d.results || []).filter(t => t.wrapperType === "track" && t.kind === "song" && t.previewUrl && /^https:\/\//.test(t.previewUrl))
    .sort((x, y) => String(y.releaseDate || "").localeCompare(String(x.releaseDate || "")));
  for (const t of rows) {
    // the same song is often on a single and an album: keep the newest
    const key = String(t.trackName || "").toLowerCase().replace(/\s*[\(\[].*?[\)\]]\s*/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim() + "|" + Math.round((t.trackTimeMillis || 0) / 4000);
    if (seen.has(key)) continue; seen.add(key);
    songs.push({ id: String(t.trackId), title: t.trackName, artist: t.artistName, album: t.collectionName || "", year: String(t.releaseDate || "").slice(0, 4),
      cover: String(t.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/600x600bb."), duration: Math.round((t.trackTimeMillis || 0) / 1000),
      preview: t.previewUrl, link: t.trackViewUrl || "" });
  }
  return keep("songs:" + a.id, songs);
}

// the picture on the artist's Apple Music page; the newest cover if that can't be read
async function picture(a) {
  const hit = fresh("pic:" + a.id, 24); if (hit) return hit;
  let pic = "";
  try {
    const r = await fetch(`https://music.apple.com/${COUNTRY}/artist/${a.apple}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; StellarLyricStudio/1.0)" } });
    const html = r.ok ? await r.text() : "";
    const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (m && /^https:\/\/[a-z0-9.-]+\.mzstatic\.com\//.test(m[1])) pic = m[1].replace(/\/\d+x\d+[a-z]*(-\d+)?\.(jpg|png|webp)$/i, "/600x600cc.jpg");
  } catch {}
  if (!pic) { try { const s = await songsOf(a); pic = s[0] ? s[0].cover : ""; } catch {} }
  return keep("pic:" + a.id, pic);
}

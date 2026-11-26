/**
 * A TikTok sound, read from its public page, so the studio can line the video up with it.
 *
 *   POST /api/tiktok/sound {url}  -> {title, author, videos, original, duration, link, id, audio}
 *        url: a TikTok sound link (tiktok.com/music/...) or a video that uses the sound (tiktok.com/@x/video/...,
 *        vm.tiktok.com/...). audio is a signed /api/media link to the sound's audio file; videos is how many
 *        TikTok videos use the sound (what tells which version took off).
 *
 * TikTok has no API for this, so the page's own data (the JSON it ships for its app) is read. Video pages carry
 * their sound; sound pages stopped doing so (Nov 2026), so for those this asks for a video link instead.
 * TikTok sometimes answers servers with an empty page; then this says so and the studio asks for a saved video.
 */
import { mediaLink } from "./media.js";

const OK_HOST = /^https:\/\/((www|m|vm|vt)\.)?tiktok\.com\//i;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const cache = new Map();

export async function tiktokSoundRoute(request, env, path, method, { json }) {
  if (path !== "/api/tiktok/sound") return null;
  if (method !== "POST") return json({ error: "method" }, 405);
  let body = {}; try { body = await request.json(); } catch {}
  const url = String(body.url || "").trim();
  if (!OK_HOST.test(url) || url.length > 500) return json({ error: "bad_link", message: "Paste a TikTok link: a sound (tiktok.com/music/…) or a video that uses it." }, 400);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 30 * 60e3) return json(hit.v);
  let page, finalUrl = url;
  try {
    const r = await (env.fetch || fetch)(url, { redirect: "follow", headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    finalUrl = r.url || url;
    page = await r.text();
  } catch (err) { return json({ error: "tiktok_unreachable", message: "TikTok didn't answer. Save a video that uses the sound and choose it instead." }, 502); }
  const info = readPage(page);
  // TikTok's sound pages (tiktok.com/music/...) no longer carry the sound: they load it later, in the browser, so a
  // server reading the page finds nothing. Video pages still carry their sound, so ask for a video link instead.
  if ((!info || !info.playUrl) && /tiktok\.com\/music\//i.test(finalUrl)) return json({ error: "tiktok_sound_page", message: "TikTok doesn't show its sound pages to other sites, so a sound link can't be read. Open a video that uses the sound, tap Share, then Copy link, and paste that link instead." }, 422);
  if (!info || !info.playUrl) return json({ error: "tiktok_blocked", message: "TikTok didn't share that video's sound with the studio. Save the video (Share, then Save video) and choose it instead." }, 422);
  const v = { title: info.title || "", author: info.author || "", videos: info.videos ?? null, original: !!info.original, duration: info.duration || null,
    id: info.id || "", link: info.id ? `https://www.tiktok.com/music/${slug(info.title)}-${info.id}` : url, audio: await mediaLink(env, info.playUrl) };
  cache.set(url, { at: Date.now(), v }); if (cache.size > 200) cache.delete(cache.keys().next().value);
  return json(v);
}

const slug = t => String(t || "sound").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "sound";

/* the sound's details out of the page: the app data script first, then the older one, then a plain search */
export function readPage(html) {
  const grab = id => { const m = html.match(new RegExp(`<script[^>]+id="${id}"[^>]*>([\\s\\S]*?)</script>`)); if (!m) return null; try { return JSON.parse(m[1]); } catch { return null; } };
  const pick = (music, stats) => music && (music.playUrl || music.play_url) ? {
    id: String(music.id || music.idStr || ""), title: music.title || "", author: music.authorName || music.author || "",
    original: !!music.original, duration: music.duration || null, playUrl: typeof music.playUrl === "string" ? music.playUrl : (music.playUrl && music.playUrl.urlList && music.playUrl.urlList[0]) || "",
    videos: stats && (stats.videoCount ?? stats.video_count) != null ? +(stats.videoCount ?? stats.video_count) : null } : null;
  const u = grab("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const sc = u && u.__DEFAULT_SCOPE__;
  if (sc) {
    const md = sc["webapp.music-detail"], vd = sc["webapp.video-detail"];
    if (md && md.musicInfo) { const r = pick(md.musicInfo.music, md.musicInfo.stats); if (r) return r; }
    if (vd && vd.itemInfo && vd.itemInfo.itemStruct) { const it = vd.itemInfo.itemStruct, r = pick(it.music, null); if (r) return r; }
  }
  const sg = grab("SIGI_STATE");
  if (sg) {
    const mm = sg.MusicModule && sg.MusicModule.musicInfo; if (mm) { const r = pick(mm.music, mm.stats); if (r) return r; }
    const items = sg.ItemModule && Object.values(sg.ItemModule); if (items && items[0]) { const r = pick(items[0].music, null); if (r) return r; }
  }
  const m = html.match(/"playUrl":"(https:[^"]+?\.mp3[^"]*)"/);
  if (m) { const t = html.match(/"title":"([^"]{1,200})","playUrl"/); return { playUrl: JSON.parse(`"${m[1]}"`), title: t ? JSON.parse(`"${t[1]}"`) : "" }; }
  return null;
}

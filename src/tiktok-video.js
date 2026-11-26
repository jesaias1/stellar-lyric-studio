/**
 * A TikTok video as a background clip: paste the link, the studio gets the video file.
 *
 *   POST /api/tiktok/video {url, hevc}  -> {title, author, duration, w, h, codec, link, file}
 *        url: a TikTok video link (tiktok.com/@x/video/..., vm.tiktok.com/..., tiktok.com/t/...).
 *        file: /api/tiktok/file?k=... , the video itself, for the next 30 minutes.
 *   GET  /api/tiktok/file?k=...   -> the MP4 (streamed)
 *
 * No API and no outside service: the video's public page carries its own data (the JSON it ships for its app),
 * with the video's addresses. TikTok only hands out the file together with the cookie its page sets, so the
 * address and that cookie are sealed into `k` (TOKEN_KEY, like the publishing logins) and the file is fetched
 * with both. No watermark: these are TikTok's own playback files (only its "download" file carries the watermark).
 * Sharpness: TikTok often keeps its 1080p only as H.265. The studio says whether its browser can play and decode
 * H.265 ({hevc: true}); then the sharpest version of either kind is picked, else the sharpest H.264 (plays everywhere).
 */
import { seal, unseal } from "./publish.js";

const OK_HOST = /^https:\/\/((www|m|vm|vt)\.)?tiktok\.com\//i;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const CDN = /^https:\/\/[a-z0-9.-]+\.(tiktok|tiktokcdn|tiktokcdn-us|tiktokv|ibytedtos|byteoversea|muscdn)\.com\//i;

export async function tiktokVideoRoute(request, env, url, path, method, { json }) {
  if (path === "/api/tiktok/video" && method === "POST") return find(request, env, json);
  if (path === "/api/tiktok/file" && method === "GET") return file(request, env, url, json);
  return null;
}

async function find(request, env, json) {
  let body = {}; try { body = await request.json(); } catch {}
  const link = String(body.url || "").trim();
  if (!OK_HOST.test(link) || link.length > 500) return json({ error: "bad_link", message: "Paste a link to a TikTok video (in TikTok: Share, then Copy link)." }, 400);
  let r, page;
  try {
    r = await fetch(link, { redirect: "follow", headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    page = await r.text();
  } catch { return json({ error: "tiktok_unreachable", message: "TikTok didn't answer. Try again in a minute." }, 502); }
  if (/tiktok\.com\/music\//i.test(r.url || "")) return json({ error: "tiktok_sound_page", message: "That's a sound, not a video. Open one of its videos, tap Share, then Copy link." }, 422);
  const v = readVideo(page, !!body.hevc);
  if (!v) return json({ error: "tiktok_blocked", message: "TikTok didn't share this video with the studio. It may be private, or TikTok asked for a login. Save it in TikTok (Share, then Save video) and add it with + Add files." }, 422);
  // the cookie TikTok's page set: the file is only handed out with it
  const set = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : String(r.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  const cookie = set.map(c => String(c).split(";")[0].trim()).filter(c => /^(tt_chain_token|ttwid|tt_csrf_token|msToken)=/.test(c)).join("; ");
  const k = await seal(env, { k: "ttv", u: v.src, c: cookie, exp: Date.now() + 30 * 60e3 });
  return json({ title: v.title, author: v.author, duration: v.duration, w: v.w, h: v.h, codec: v.codec, link: r.url || link, file: "/api/tiktok/file?k=" + encodeURIComponent(k) });
}

async function file(request, env, url, json) {
  const s = await unseal(env, url.searchParams.get("k") || "");
  if (!s || s.k !== "ttv" || !CDN.test(s.u || "") || Date.now() > s.exp) return json({ error: "expired", message: "That TikTok link has expired. Add the video again." }, 410);
  const up = await fetch(s.u, { redirect: "follow", headers: { "user-agent": UA, referer: "https://www.tiktok.com/", ...(s.c ? { cookie: s.c } : {}) } });
  if (!up.ok || !up.body) return json({ error: "upstream", message: `TikTok didn't hand over the video (${up.status}). Add it again.` }, 502);
  const headers = { "content-type": "video/mp4", "cache-control": "private, no-store" };
  const len = up.headers.get("content-length"); if (len) headers["content-length"] = len;
  return new Response(up.body, { status: 200, headers });
}

/* The video's data from its page: the address of the sharpest version this browser can use (H.264, or H.265 too
   when hevc is true), its size, length and who posted it. */
export function readVideo(html, hevc = false) {
  const m = String(html || "").match(/<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let d; try { d = JSON.parse(m[1]); } catch { return null; }
  const it = d && d.__DEFAULT_SCOPE__ && d.__DEFAULT_SCOPE__["webapp.video-detail"] && d.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo && d.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct;
  const v = it && it.video; if (!v) return null;
  const opts = (Array.isArray(v.bitrateInfo) ? v.bitrateInfo : []).map(b => {
    const pa = b.PlayAddr || {}, src = (pa.UrlList || []).find(u => CDN.test(u)) || "";
    return { src, h264: !/265|hev|bytevc/i.test(String(b.CodecType || "")), px: (+pa.Width || 0) * (+pa.Height || 0), w: +pa.Width || 0, h: +pa.Height || 0, br: +b.Bitrate || 0 };
  }).filter(o => o.src);
  const best = opts.filter(o => o.h264 || hevc).sort((a, b) => b.px - a.px || (a.h264 === b.h264 ? b.br - a.br : a.h264 ? -1 : 1))[0];
  const src = best ? best.src : (CDN.test(v.playAddr || "") ? v.playAddr : "");
  if (!src) return null;
  return { src, w: best ? best.w : +v.width || 0, h: best ? best.h : +v.height || 0, codec: best && !best.h264 ? "h265" : "h264", duration: +v.duration || null,
    title: String(it.desc || "").replace(/\s+/g, " ").trim().slice(0, 120), author: String((it.author && it.author.uniqueId) || "").slice(0, 60) };
}

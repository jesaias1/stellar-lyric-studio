/**
 * Publishing: link YouTube, Instagram and TikTok accounts (as many as you like, one per artist or profile) and
 * post the exported video to them.
 *
 * Linked accounts live in the browser that linked them (localStorage), sealed: the tokens inside are encrypted
 * with TOKEN_KEY (or the passcode when TOKEN_KEY isn't set), so only this server can read them. Nothing about the
 * accounts is stored on the server, so no database is needed.
 *
 *   GET  /api/oauth/:platform            where the platform sends you back after you log in (no passcode: the
 *                                        sealed `state` proves the login was started here). Stores the account
 *                                        in the browser and closes the window.
 *   GET  /api/publish/file/:id           the video, for Instagram's servers to fetch (signed link, 3 hours)
 *   POST /api/publish/connect   {platform}                 -> {url}       the platform's login page
 *   POST /api/publish/creator   {account}                  -> TikTok creator info (privacy options and so on)
 *   POST /api/publish/:platform  body = the video file, headers x-sls-account (sealed account) and
 *                                x-sls-meta (base64url JSON: title, caption, privacy...) -> {ref, url?, state}
 *   POST /api/publish/status    {platform, account, ref}   -> {state: working|done|failed, url?, note?}
 *   Every answer that had to refresh a login also returns `account`: the new sealed account to keep.
 *
 * Settings (secrets):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET      YouTube (Google Cloud OAuth client, YouTube Data API v3)
 *   INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET      Instagram (Meta app, Instagram API with Instagram login)
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET     TikTok (TikTok for Developers app: Login Kit + Content Posting API)
 *   TIKTOK_SCOPES     optional, default "user.info.basic,video.upload" (drafts). Add ",video.publish" once TikTok approves direct posting
 *   TOKEN_KEY         optional but recommended: a long random string that seals the account tokens
 *   PUBLIC_URL        optional: the site's address, if it differs from the one the request came in on
 * Instagram also needs a KV namespace bound as PUBLISH (or TEMPLATES) to hold the video for a few hours,
 * because Instagram only takes videos by link.
 */

const IG = "https://graph.instagram.com/v25.0";
const TT = "https://open.tiktokapis.com/v2";
const MAX_BYTES = 95 * 1024 * 1024;          // Cloudflare takes requests up to 100 MB
const KV_CHUNK = 20 * 1024 * 1024;           // a KV value holds up to 25 MB
const NAMES = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

export function publishHealth(env) {
  return { publish: {
    youtube: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    instagram: !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET),
    instagramStorage: !!(env.PUBLISH || env.TEMPLATES || env.BLOB_READ_WRITE_TOKEN),
    tiktok: !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
    // until TikTok approves the app (then set TIKTOK_AUDITED=1), it only lets direct posts be private ("Only me")
    tiktokAudited: /^(1|true|yes)$/i.test(env.TIKTOK_AUDITED || ""),
    // on Vercel a request can carry only 4.5 MB, so the browser puts the video in Vercel Blob first (api/index.js)
    blob: !!env.BLOB_READ_WRITE_TOKEN,
  } };
}

/* routes that come from other servers: no passcode, each one checks its own signature */
export async function publishPublicRoute(request, env, url, path, method) {
  const o = path.match(/^\/api\/oauth\/(youtube|instagram|tiktok)$/);
  if (o && method === "GET") return oauthReturn(env, url, o[1]);
  const f = path.match(/^\/api\/publish\/file\/([a-z0-9]{8,40})(\.mp4|\.mov)?$/);
  if (f && (method === "GET" || method === "HEAD")) return serveFile(env, request, url, f[1]);
  return null;
}

export async function publishRoute(request, env, url, path, method, { json, user = {} }) {
  if (path === "/api/publish/connect" && method === "POST") return connect(env, request, url, json, user);
  if (path === "/api/publish/creator" && method === "POST") return creatorInfo(env, request, json, user);
  if (path === "/api/publish/status" && method === "POST") return status(env, request, url, json, user);
  const m = path.match(/^\/api\/publish\/(youtube|instagram|tiktok)$/);
  if (m && method === "POST") return upload(env, request, url, m[1], json, user);
  return null;
}

/* A linked account belongs to the person who linked it: the sealed record carries their user id, and only
   they can post with it (copying the sealed text to another login doesn't work). */
async function openAccount(env, sealed, p, user) {
  const a = await unseal(env, sealed || "");
  if (!a || a.p !== p) throw new Fail(`That ${NAMES[p] || ""} account can't be read here (the site's TOKEN_KEY may have changed). Link it again.`, "relink", 409);
  // the studio login that linked it ("owner"; accounts linked before that was added kept it in "uid", which
  // Instagram also uses for its own account id, so "owner" comes first)
  const owner = a.owner !== undefined ? a.owner : a.uid;
  if (user && user.id && owner !== user.id) throw new Fail(`That ${NAMES[p]} account was linked under another login. Link it again from your own account.`, "relink", 409);
  return a;
}

/* ---------- sealing: AES-GCM with a key derived from TOKEN_KEY ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
function b64u(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s) { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
async function key(env) {
  const secret = env.TOKEN_KEY || env.SLS_PASSCODE || "";
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("sls-seal:v1:" + secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64u(out);
}
export async function unseal(env, s) {
  try { const b = unb64u(s); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, await key(env), b.subarray(12)); return JSON.parse(dec.decode(pt)); }
  catch { return null; }
}
async function hmac(env, text) {
  const k = await crypto.subtle.importKey("raw", enc.encode("publish-file:" + (env.TOKEN_KEY || env.SLS_PASSCODE || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(text))).subarray(0, 18));
}

/* ---------- helpers ---------- */
async function body(request) { try { return await request.json(); } catch { return {}; } }
const origin = (env, url) => (env.PUBLIC_URL || url.origin).replace(/\/+$/, "");
const redirectUri = (base, p) => `${base}/api/oauth/${p}`;
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();
class Fail extends Error { constructor(message, code = "publish_failed", status = 502) { super(message); this.code = code; this.status = status; } }
const relink = p => new Fail(`The ${NAMES[p]} login has run out. Remove the account and link it again.`, "relink", 409);   // not 401: that one means "wrong passcode" to the app
async function getJSON(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }
function configured(env, p) {
  const h = publishHealth(env).publish;
  if (!h[p]) throw new Fail(`${NAMES[p]} isn't switched on yet. Its app keys need to be added to the site's settings (see the setup guide).`, "not_configured", 503);
}
const fail = (json, e) => json({ error: e.code || "publish_failed", message: e.message || "Publishing failed." }, e.status || 502);

/* ---------- 1. linking an account ---------- */
async function connect(env, request, url, json, user) {
  const b = await body(request), p = b.platform;
  try {
    if (!NAMES[p]) throw new Fail("Unknown platform.", "bad_request", 400);
    configured(env, p);
    const base = origin(env, url), state = await seal(env, { k: "state", p, base, uid: user.id || null, t: Date.now(), n: b64u(crypto.getRandomValues(new Uint8Array(9))) });
    const ru = redirectUri(base, p);
    let auth;
    if (p === "youtube") auth = "https://accounts.google.com/o/oauth2/v2/auth?" + form({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: ru, response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state });
    if (p === "instagram") auth = "https://www.instagram.com/oauth/authorize?" + form({ client_id: env.INSTAGRAM_APP_ID, redirect_uri: ru, response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish", force_reauth: "true", state });
    if (p === "tiktok") auth = "https://www.tiktok.com/v2/auth/authorize/?" + form({ client_key: env.TIKTOK_CLIENT_KEY, redirect_uri: ru, response_type: "code",
      scope: env.TIKTOK_SCOPES || "user.info.basic,video.upload", disable_auto_auth: "1", state });
    return json({ url: auth, redirect: ru });
  } catch (e) { return fail(json, e); }
}

async function oauthReturn(env, url, p) {
  const st = await unseal(env, url.searchParams.get("state") || "");
  if (!st || st.k !== "state" || st.p !== p || Date.now() - st.t > 30 * 60e3) return page(`That link has expired or didn't start here. Close this window and press Link ${NAMES[p]} again.`);
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) return page(err === "access_denied" || /denied|cancel/i.test(err) ? "Linking was cancelled." : `${NAMES[p]} said: ${err}`);
  const code = url.searchParams.get("code");
  if (!code) return page(`${NAMES[p]} didn't send a login code back. Try again.`);
  try {
    const ru = redirectUri(st.base, p);
    const acct = p === "youtube" ? await youtubeLink(env, code, ru) : p === "instagram" ? await instagramLink(env, code, ru) : await tiktokLink(env, code, ru);
    const { secret, ...pub } = acct;
    const record = { ...pub, id: `${p}:${pub.rid}`, platform: p, sealed: await seal(env, { k: "acct", p, rid: pub.rid, ...secret, owner: st.uid || null }), linkedAt: Date.now() };
    return page(null, record);
  } catch (e) {
    console.error("oauth failed", p, e && e.message);
    return page(e.message || "Linking failed.");
  }
}

/* The page the login window lands on. It hands the linked account to the studio window (which saves it to
   the user's own account list), and closes itself. If the studio window can't be reached, the account waits in
   this browser's storage and the studio picks it up next time it opens. */
function page(problem, record) {
  const title = problem ? "Couldn't link the account" : `${NAMES[record.platform]} account linked`;
  const data = JSON.stringify({ problem, record: record || null }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · SLS</title>
<style>body{font:15px/1.5 "Inter Tight","Helvetica Neue",Helvetica,Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0626c7;color:#fff}main{max-width:420px;padding:28px;text-align:center}h1{font-weight:500;font-size:24px;letter-spacing:-.02em;margin:0 0 8px}p{color:rgba(255,255,255,.75)}a{color:#fff}</style>
<main><h1 id="t"></h1><p id="m"></p><p><a href="/">Back to the studio</a></p></main>
<script>
var d = ${data};
document.getElementById("t").textContent = ${JSON.stringify(title)};
if (d.problem) { document.getElementById("m").textContent = d.problem; }
else {
  try { var q = JSON.parse(localStorage.getItem("sls-account-new") || "[]") || []; q = q.filter(function (a) { return a.id !== d.record.id; }); q.push(d.record); localStorage.setItem("sls-account-new", JSON.stringify(q.slice(-10))); } catch (e) {}
  document.getElementById("m").textContent = (d.record.name || "The account") + " is ready to post to. You can close this window.";
}
try { if (window.opener) { window.opener.postMessage({ sls: "account", ok: !d.problem, id: d.record && d.record.id, record: d.record, problem: d.problem }, location.origin); setTimeout(function () { window.close(); }, d.problem ? 4000 : 900); } } catch (e) {}
</script></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/* ---------- YouTube ---------- */
async function youtubeLink(env, code, ru) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: ru, grant_type: "authorization_code" }) });
  const t = await getJSON(r);
  if (!r.ok || !t.access_token) throw new Fail("Google didn't accept the login: " + (t.error_description || t.error || r.status));
  if (!t.refresh_token) throw new Fail("Google didn't hand over a lasting login. Remove Stellar Lyric Studio under myaccount.google.com/permissions and link again.");
  const c = await getJSON(await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: "Bearer " + t.access_token } }));
  const ch = c.items && c.items[0];
  if (!ch) throw new Fail("This Google account has no YouTube channel. Pick the channel (or brand account) you post to when Google asks.");
  return { rid: ch.id, name: ch.snippet.title, handle: ch.snippet.customUrl || "", avatar: ch.snippet.thumbnails && (ch.snippet.thumbnails.default || {}).url || "", scopes: ["upload"],
    secret: { rt: t.refresh_token } };
}
async function googleAccess(env, a) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: a.rt, grant_type: "refresh_token" }) });
  const t = await getJSON(r);
  if (!r.ok || !t.access_token) { if (t.error === "invalid_grant") throw relink("youtube"); throw new Fail("Google didn't renew the login: " + (t.error_description || t.error || r.status)); }
  return t.access_token;
}
async function youtubeUpload(env, a, bytes, type, meta) {
  const token = await googleAccess(env, a), privacy = ["public", "unlisted", "private"].includes(meta.privacy) ? meta.privacy : "public";
  const resource = { snippet: { title: String(meta.title || "Lyric video").slice(0, 100), description: String(meta.caption || "").slice(0, 5000), categoryId: "10",
      tags: (meta.tags || []).slice(0, 15) },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: !!meta.ai } };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8", "x-upload-content-type": type, "x-upload-content-length": String(bytes.byteLength) },
    body: JSON.stringify(resource) });
  if (!init.ok) throw new Fail(youtubeError(await getJSON(init), init.status));
  const put = await fetch(init.headers.get("location"), { method: "PUT", headers: { "content-type": type }, body: bytes });
  const v = await getJSON(put);
  if (!put.ok || !v.id) throw new Fail(youtubeError(v, put.status));
  const got = v.status && v.status.privacyStatus;
  return { ref: v.id, state: "done", url: `https://youtube.com/shorts/${v.id}`,
    note: got && got !== privacy ? `YouTube set it to ${got}: uploads from an API project that hasn't passed YouTube's audit stay private. You can change it in YouTube Studio.` : "YouTube is processing it; it can take a few minutes to appear." };
}
function youtubeError(d, status) {
  const e = d && d.error, reason = e && e.errors && e.errors[0] && e.errors[0].reason;
  if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") return "YouTube's daily upload limit for this project is used up. Try again tomorrow.";
  if (reason === "youtubeSignupRequired") return "This Google account has no YouTube channel yet.";
  if (status === 401) return "YouTube didn't accept the login. Remove the account and link it again.";
  return "YouTube said: " + ((e && e.message) || (d && d.raw) || status);
}

/* ---------- Instagram (Instagram API with Instagram login) ---------- */
async function instagramLink(env, code, ru) {
  const r = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: env.INSTAGRAM_APP_ID, client_secret: env.INSTAGRAM_APP_SECRET, grant_type: "authorization_code", redirect_uri: ru, code }) });
  let t = await getJSON(r); if (Array.isArray(t.data)) t = t.data[0] || {};
  if (!r.ok || !t.access_token) throw new Fail("Instagram didn't accept the login: " + (t.error_message || (t.error && t.error.message) || r.status));
  const l = await getJSON(await fetch("https://graph.instagram.com/access_token?" + form({ grant_type: "ig_exchange_token", client_secret: env.INSTAGRAM_APP_SECRET, access_token: t.access_token })));
  const token = l.access_token || t.access_token, ttl = (l.expires_in || 3600) * 1000;
  const me = await getJSON(await fetch(`${IG}/me?` + form({ fields: "user_id,username,name,profile_picture_url,account_type", access_token: token })));
  if (!me.user_id && !me.id) throw new Fail("Instagram didn't share the account details: " + ((me.error && me.error.message) || "unknown error"));
  return { rid: String(me.user_id || me.id), name: me.username ? "@" + me.username : (me.name || "Instagram"), handle: me.username || "", avatar: me.profile_picture_url || "", scopes: ["publish"],
    secret: { at: token, exp: Date.now() + ttl, ref: Date.now(), uid: String(me.user_id || me.id) } };
}
/* long-lived tokens last 60 days; refresh once a week while the account is in use */
async function instagramToken(env, a) {
  if (a.exp && Date.now() > a.exp) throw relink("instagram");
  if (Date.now() - (a.ref || 0) < 7 * 864e5) return { a, changed: false };
  const r = await getJSON(await fetch("https://graph.instagram.com/refresh_access_token?" + form({ grant_type: "ig_refresh_token", access_token: a.at })));
  if (!r.access_token) return { a, changed: false };   // still valid; try again next time
  return { a: { ...a, at: r.access_token, exp: Date.now() + (r.expires_in || 5184000) * 1000, ref: Date.now() }, changed: true };
}
async function instagramUpload(env, url, a, bytes, type, meta, src) {
  const kv = env.PUBLISH || env.TEMPLATES;
  if (!/mp4|quicktime/.test(type)) throw new Fail("Instagram only takes MP4 or MOV. Export the video as MP4 · H.264.", "bad_request", 400);
  if (src) return instagramContainer(a, src, meta, "");   // Vercel: Instagram fetches straight from Vercel Blob
  if (!kv) throw new Fail("Instagram needs the site's video storage (a KV namespace bound as PUBLISH, or Vercel Blob). See the setup guide.", "not_configured", 503);
  // keep the video for 3 hours under a signed link: Instagram fetches it from there
  const id = b64u(crypto.getRandomValues(new Uint8Array(12))).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16).padEnd(12, "0");
  const n = Math.ceil(bytes.byteLength / KV_CHUNK), u8 = new Uint8Array(bytes);
  for (let i = 0; i < n; i++) await kv.put(`pubfile:${id}:${i}`, u8.slice(i * KV_CHUNK, Math.min(bytes.byteLength, (i + 1) * KV_CHUNK)), { expirationTtl: 3 * 3600 });
  await kv.put(`pubfile:${id}`, JSON.stringify({ n, size: bytes.byteLength, type }), { expirationTtl: 3 * 3600 });
  const fileUrl = `${origin(env, url)}/api/publish/file/${id}${/quicktime/.test(type) ? ".mov" : ".mp4"}?s=${await hmac(env, id)}`;
  return instagramContainer(a, fileUrl, meta, id);
}
async function instagramContainer(a, fileUrl, meta, id) {
  const params = { media_type: "REELS", video_url: fileUrl, caption: String(meta.caption || "").slice(0, 2200), share_to_feed: meta.feed === false ? "false" : "true" };
  if (meta.ai) params.is_ai_generated = "true";
  const r = await fetch(`${IG}/${a.uid}/media`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Bearer " + a.at }, body: form(params) });
  const d = await getJSON(r);
  if (!r.ok || !d.id) throw new Fail(instagramError(d, r.status));
  return { ref: `${d.id}|${id}`, state: "working", note: "Instagram is processing the video. It usually takes under a minute." };
}
function instagramError(d, status) {
  const e = d && d.error, msg = (e && (e.error_user_msg || e.message)) || (d && d.raw) || String(status);
  if (e && (e.code === 190 || status === 401)) return "Instagram didn't accept the login. Remove the account and link it again.";
  if (e && (e.code === 9 || e.code === 4 || /limit/i.test(msg))) return "Instagram's posting limit for this account is reached (100 posts a day through apps). Try later.";
  if (e && e.code === 10) return "This Instagram account isn't allowed to post through the app yet. While the Meta app is in development mode, every account must be added as an Instagram tester (see the setup guide).";
  return "Instagram said: " + msg;
}
async function instagramStatus(env, a, ref) {
  const [cid, fid] = String(ref).split("|");
  const s = await getJSON(await fetch(`${IG}/${cid}?` + form({ fields: "status_code,status", access_token: a.at })));
  const code = s.status_code;
  if (code === "IN_PROGRESS" || (!code && !s.error)) return { state: "working" };
  if (code === "ERROR" || code === "EXPIRED") { await dropFile(env, fid); return { state: "failed", note: "Instagram couldn't process the video" + (s.status ? `: ${s.status}` : ".") }; }
  if (s.error) return { state: "failed", note: instagramError(s, 400) };
  if (code === "FINISHED" || code === "PUBLISHED") {
    const p = await fetch(`${IG}/${a.uid}/media_publish`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Bearer " + a.at }, body: form({ creation_id: cid }) });
    const d = await getJSON(p);
    if (!p.ok || !d.id) return code === "PUBLISHED" ? { state: "done", note: "Posted." } : { state: "failed", note: instagramError(d, p.status) };
    await dropFile(env, fid);
    const m = await getJSON(await fetch(`${IG}/${d.id}?` + form({ fields: "permalink", access_token: a.at })));
    return { state: "done", url: m.permalink || null, note: "Posted as a Reel.", ref: d.id };
  }
  return { state: "working" };
}
async function dropFile(env, id) {
  const kv = env.PUBLISH || env.TEMPLATES; if (!kv || !id) return;
  try { const m = JSON.parse(await kv.get(`pubfile:${id}`) || "null"); if (m) for (let i = 0; i < m.n; i++) await kv.delete(`pubfile:${id}:${i}`); await kv.delete(`pubfile:${id}`); } catch {}
}
async function serveFile(env, request, url, id) {
  const kv = env.PUBLISH || env.TEMPLATES;
  if (!kv || url.searchParams.get("s") !== (await hmac(env, id))) return new Response("Not found", { status: 404 });
  const m = JSON.parse(await kv.get(`pubfile:${id}`) || "null");
  if (!m) return new Response("Gone", { status: 404 });
  // one byte range at most, since that's all a video fetcher asks for
  let start = 0, end = m.size - 1, partial = false;
  const rg = (request.headers.get("range") || "").match(/^bytes=(\d*)-(\d*)$/);
  if (rg && (rg[1] || rg[2])) {
    if (rg[1]) { start = +rg[1]; if (rg[2]) end = Math.min(+rg[2], m.size - 1); } else { start = Math.max(0, m.size - +rg[2]); }
    if (start > end || start >= m.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${m.size}` } });
    partial = true;
  }
  const headers = { "content-type": m.type, "content-length": String(end - start + 1), "accept-ranges": "bytes", "cache-control": "no-store" };
  if (partial) headers["content-range"] = `bytes ${start}-${end}/${m.size}`;
  if (request.method === "HEAD") return new Response(null, { status: partial ? 206 : 200, headers });
  const first = Math.floor(start / KV_CHUNK), last = Math.floor(end / KV_CHUNK);
  const stream = new ReadableStream({
    async pull(ctrl) {
      if (this.i == null) this.i = first;
      if (this.i > last) { ctrl.close(); return; }
      const buf = new Uint8Array(await kv.get(`pubfile:${id}:${this.i}`, "arrayBuffer"));
      const base = this.i * KV_CHUNK, from = Math.max(0, start - base), to = Math.min(buf.length, end - base + 1);
      ctrl.enqueue(buf.subarray(from, to)); this.i++;
    },
  });
  return new Response(stream, { status: partial ? 206 : 200, headers });
}

/* ---------- TikTok ---------- */
async function tiktokToken(env, body) {
  const r = await fetch(`${TT}/oauth/token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: form({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, ...body }) });
  const t = await getJSON(r);
  if (!r.ok || !t.access_token) { if (body.grant_type === "refresh_token") throw relink("tiktok"); throw new Fail("TikTok didn't accept the login: " + (t.error_description || t.error || r.status)); }
  return t;
}
async function tiktokLink(env, code, ru) {
  const t = await tiktokToken(env, { code, grant_type: "authorization_code", redirect_uri: ru });
  const u = await getJSON(await fetch(`${TT}/user/info/?fields=open_id,display_name,avatar_url`, { headers: { authorization: "Bearer " + t.access_token } }));
  const user = (u.data && u.data.user) || {};
  const scopes = String(t.scope || "").split(",").map(s => s.trim());
  return { rid: t.open_id, name: user.display_name || "TikTok", handle: "", avatar: user.avatar_url || "",
    scopes: [scopes.includes("video.upload") && "draft", scopes.includes("video.publish") && "direct"].filter(Boolean),
    secret: { at: t.access_token, atExp: Date.now() + (t.expires_in || 86400) * 1000, rt: t.refresh_token, rtExp: Date.now() + (t.refresh_expires_in || 31536000) * 1000, scope: scopes.join(",") } };
}
async function tiktokAccess(env, a) {
  if (a.atExp && Date.now() < a.atExp - 120e3) return { a, changed: false };
  if (a.rtExp && Date.now() > a.rtExp) throw relink("tiktok");
  const t = await tiktokToken(env, { grant_type: "refresh_token", refresh_token: a.rt });
  return { a: { ...a, at: t.access_token, atExp: Date.now() + (t.expires_in || 86400) * 1000, rt: t.refresh_token || a.rt, rtExp: t.refresh_expires_in ? Date.now() + t.refresh_expires_in * 1000 : a.rtExp }, changed: true };
}
async function ttCall(a, path, payload) {
  const r = await fetch(`${TT}${path}`, { method: "POST", headers: { authorization: "Bearer " + a.at, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(payload || {}) });
  const d = await getJSON(r);
  if (!r.ok || (d.error && d.error.code && d.error.code !== "ok")) throw new Fail(tiktokError(d.error || {}, r.status));
  return d.data || {};
}
function tiktokError(e, status) {
  const code = e.code || "";
  const known = {
    spam_risk_too_many_pending_share: "This TikTok account already has 5 drafts waiting in its inbox today. Post or delete them in TikTok, then try again.",
    spam_risk_too_many_posts: "This TikTok account has reached its posting limit for today.",
    spam_risk_user_banned_from_posting: "TikTok doesn't let this account post right now.",
    reached_active_user_cap: "TikTok's daily limit of accounts posting through this app is reached (5 a day until TikTok audits the app).",
    unaudited_client_can_only_post_to_private_accounts: "Until TikTok approves the app, direct posts can only be private (Only me). Pick Only me, or use Send to drafts.",
    privacy_level_option_mismatch: "That privacy choice isn't available for this account.",
    scope_not_authorized: "This TikTok login doesn't allow that. Link the account again, or use the other posting mode.",
    access_token_invalid: "TikTok didn't accept the login. Remove the account and link it again.",
    rate_limit_exceeded: "TikTok is rate limiting. Wait a minute and try again.",
  };
  return known[code] || "TikTok said: " + (e.message || code || status);
}
async function creatorInfo(env, request, json, user) {
  try {
    configured(env, "tiktok");
    const b = await body(request), a0 = await openAccount(env, b.account, "tiktok", user);
    const { a, changed } = await tiktokAccess(env, a0);
    const d = await ttCall(a, "/post/publish/creator_info/query/");
    return json({ ...d, account: changed ? await seal(env, a) : undefined });
  } catch (e) { return fail(json, e); }
}
async function tiktokUpload(env, a, bytes, type, meta) {
  const size = bytes.byteLength, MB = 1024 * 1024;
  // chunks of 5 to 64 MB, sent in order; a file up to 64 MB goes in one piece
  const chunk = size <= 64 * MB ? size : 32 * MB, count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count };
  let init;
  if (meta.mode === "direct") {
    if (!meta.privacy) throw new Fail("Choose who can see the TikTok post.", "bad_request", 400);
    const post_info = { title: String(meta.caption || "").slice(0, 2200), privacy_level: meta.privacy, disable_comment: !meta.comment, disable_duet: !meta.duet, disable_stitch: !meta.stitch,
      brand_content_toggle: !!meta.brandContent, brand_organic_toggle: !!meta.brandOrganic, video_cover_timestamp_ms: 1000 };
    if (meta.ai) post_info.is_aigc = true;
    init = await ttCall(a, "/post/publish/video/init/", { post_info, source_info });
  } else init = await ttCall(a, "/post/publish/inbox/video/init/", { source_info });
  for (let i = 0; i < count; i++) {
    const from = i * chunk, to = i === count - 1 ? size : from + chunk;
    const r = await fetch(init.upload_url, { method: "PUT", headers: { "content-type": type, "content-range": `bytes ${from}-${to - 1}/${size}` }, body: bytes.slice(from, to) });
    if (![200, 201, 206].includes(r.status)) throw new Fail(`TikTok didn't take the video (${r.status}${r.status === 403 ? ": the upload link expired" : ""}).`);
  }
  return { ref: init.publish_id, state: "working", note: meta.mode === "direct" ? "TikTok is processing the post. It can take a few minutes." : "Sending to the TikTok inbox…" };
}
async function tiktokStatus(env, a, ref) {
  const d = await ttCall(a, "/post/publish/status/fetch/", { publish_id: ref });
  if (d.status === "SEND_TO_USER_INBOX") return { state: "done", note: "In the account's TikTok inbox: open TikTok, tap the notification, then post it." };
  if (d.status === "PUBLISH_COMPLETE") { const id = (d.publicaly_available_post_id || d.publicly_available_post_id || [])[0];
    return { state: "done", note: "Posted. Until TikTok audits the app, posts stay private (only the account can see them).", ...(id ? { ref: String(id) } : {}) }; }
  if (d.status === "FAILED") return { state: "failed", note: "TikTok couldn't post it: " + (d.fail_reason || "unknown reason") };
  return { state: "working" };
}

/* ---------- posting, shared by the posting window and the scheduler (src/schedule.js) ----------
   a: the opened account. Returns {out, a, changed}: out = {ref, state, url?, note?}; a is the account with a
   renewed login when changed is true (seal and keep it). */
export async function postWith(env, url, p, a, bytes, type, meta, src) {
  configured(env, p);
  let changed = false, out;
  if (p === "youtube") out = await youtubeUpload(env, a, bytes, type, meta);
  if (p === "instagram") { ({ a, changed } = await instagramToken(env, a)); out = await instagramUpload(env, url, a, bytes, type, meta, src); }
  if (p === "tiktok") { ({ a, changed } = await tiktokAccess(env, a)); out = await tiktokUpload(env, a, bytes, type, meta); }
  return { out, a, changed };
}
export async function statusWith(env, p, a, ref) {
  configured(env, p);
  let changed = false, out;
  if (p === "youtube") out = { state: "done" };
  if (p === "instagram") { ({ a, changed } = await instagramToken(env, a)); out = await instagramStatus(env, a, ref); }
  if (p === "tiktok") { ({ a, changed } = await tiktokAccess(env, a)); out = await tiktokStatus(env, a, ref); }
  return { out, a, changed };
}
/* views, likes and comments of a post, where the platform lets us read them; null when it doesn't */
export async function statsWith(env, p, a, ref) {
  configured(env, p);
  let changed = false, stats = null;
  if (p === "youtube" && ref) {
    const token = await googleAccess(env, a);
    const d = await getJSON(await fetch("https://www.googleapis.com/youtube/v3/videos?" + form({ part: "statistics", id: ref }), { headers: { authorization: "Bearer " + token } }));
    const st = d.items && d.items[0] && d.items[0].statistics;
    if (st) stats = { views: +st.viewCount || 0, likes: +st.likeCount || 0, comments: +st.commentCount || 0 };
  }
  if (p === "instagram" && ref && !String(ref).includes("|")) {
    ({ a, changed } = await instagramToken(env, a));
    const m = await getJSON(await fetch(`${IG}/${ref}?` + form({ fields: "like_count,comments_count", access_token: a.at })));
    if (m && !m.error) {
      stats = { likes: m.like_count || 0, comments: m.comments_count || 0 };
      // views need the insights permission; used when the account granted it
      const ins = await getJSON(await fetch(`${IG}/${ref}/insights?` + form({ metric: "views,shares", access_token: a.at })));
      for (const x of (ins && ins.data) || []) { const v = x.values && x.values[0] ? x.values[0].value : x.total_value && x.total_value.value; if (x.name === "views") stats.views = v; if (x.name === "shares") stats.shares = v; }
    }
  }
  if (p === "tiktok" && ref && /video\.list/.test(a.scope || "")) {
    ({ a, changed } = await tiktokAccess(env, a));
    try {
      const d = await ttCall(a, "/video/query/?fields=id,view_count,like_count,comment_count,share_count", { filters: { video_ids: [String(ref)] } });
      const v = d.videos && d.videos[0];
      if (v) stats = { views: v.view_count || 0, likes: v.like_count || 0, comments: v.comment_count || 0, shares: v.share_count || 0 };
    } catch {}
  }
  return { stats, a, changed };
}
export { openAccount, Fail };

/* ---------- 2. posting ---------- */
async function upload(env, request, url, p, json, user) {
  try {
    configured(env, p);
    const a0 = await openAccount(env, request.headers.get("x-sls-account"), p, user);
    let meta = {};
    try { meta = JSON.parse(dec.decode(unb64u(request.headers.get("x-sls-meta") || "e30"))); } catch {}
    let type = (request.headers.get("content-type") || "video/mp4").split(";")[0], bytes, src = null;
    if (type === "application/json") {
      // Vercel: the video is already in Vercel Blob; fetch it from there
      const b = await body(request); src = String(b.src || "");
      if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(src)) throw new Fail("That video link isn't one the studio made.", "bad_request", 400);
      type = /^video\/(mp4|quicktime|webm|x-matroska)$/.test(b.type) ? b.type : "video/mp4";
      if (p === "instagram") bytes = new ArrayBuffer(1);   // Instagram fetches the link itself
      else {
      const r = await fetch(src);
      if (!r.ok) throw new Fail(`The stored video couldn't be read (${r.status}). Try posting again.`);
      if (+r.headers.get("content-length") > MAX_BYTES) throw new Fail("The video is larger than 95 MB. Export at 1080p or Standard quality.", "too_large", 413);
      bytes = await r.arrayBuffer();
      }
    } else {
      const len = +request.headers.get("content-length") || 0;
      if (len > MAX_BYTES) throw new Fail("The video is larger than 95 MB. Export at 1080p or Standard quality.", "too_large", 413);
      bytes = await request.arrayBuffer();
    }
    if (!bytes.byteLength) throw new Fail("No video was sent.", "bad_request", 400);
    if (bytes.byteLength > MAX_BYTES) throw new Fail("The video is larger than 95 MB. Export at 1080p or Standard quality.", "too_large", 413);
    const { out, a, changed } = await postWith(env, url, p, a0, bytes, type, meta, src);
    return json({ ...out, account: changed ? await seal(env, a) : undefined });
  } catch (e) { console.error("publish failed", p, e && e.message); return fail(json, e); }
}

async function status(env, request, url, json, user) {
  const b = await body(request), p = b.platform;
  try {
    if (!NAMES[p]) throw new Fail("Unknown platform.", "bad_request", 400);
    configured(env, p);
    const a0 = await openAccount(env, b.account, p, user);
    const { out, a, changed } = await statusWith(env, p, a0, b.ref);
    return json({ ...out, account: changed ? await seal(env, a) : undefined });
  } catch (e) { return fail(json, e); }
}

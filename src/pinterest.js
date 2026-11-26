/**
 * Your own Pinterest: connect a Pinterest account, then search its saved pins and import any of its boards
 * (secret boards too, and every pin, not only the latest 25 a public board's feed shows).
 *
 * Pinterest's API only lets an app read the connected person's own boards and pins. It has no way to read
 * their home feed or to search all of Pinterest, so "your own" means what you have saved yourself.
 *
 *   GET  /api/oauth/pinterest                where Pinterest sends you back after you log in (public: the sealed
 *                                            `state` proves the login started here). Saves the account in this
 *                                            browser and closes the window.
 *   POST /api/pinterest/connect  {}          -> {url}  Pinterest's login page
 *   POST /api/pinterest/boards   {account}   -> {boards: [{id, name, count, cover, secret}], account?}
 *   POST /api/pinterest/board    {account, id} -> {name, images, note, account?}
 *   Searching your saved pins is part of /api/photos/pick (from: "mine", see src/photos.js), through mineSearch().
 *   Any answer that had to renew the login also returns `account`: the new sealed account to keep.
 *
 * Settings: PINTEREST_APP_ID and PINTEREST_APP_SECRET, from an app at developers.pinterest.com, with
 * <site>/api/oauth/pinterest as its redirect URI. The login is sealed with TOKEN_KEY like the publishing
 * accounts (src/publish.js) and lives in the browser that connected it: nothing is stored on the server.
 */
import { seal, unseal } from "./publish.js";
import { mediaLink } from "./media.js";
import { aiMade } from "./vibe.js";

const API = "https://api.pinterest.com/v5";
const SCOPES = "user_accounts:read,boards:read,boards:read_secret,pins:read,pins:read_secret";

export const pinterestReady = env => !!(env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET);

class Fail extends Error { constructor(message, code = "pinterest_failed", status = 502) { super(message); this.code = code; this.status = status; } }
const relink = () => new Fail("The Pinterest login has run out. Connect Pinterest again.", "relink", 409);   // not 401: that one means "log in again" to the app
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();
const origin = (env, url) => (env.PUBLIC_URL || url.origin).replace(/\/+$/, "");
async function body(request) { try { return await request.json(); } catch { return {}; } }
async function getJSON(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }
const fail = (json, e) => json({ error: e.code || "pinterest_failed", message: e.message || "Pinterest didn't answer." }, e.status || 502);

/* ---------- routes ---------- */
export async function pinterestPublicRoute(request, env, url, path, method) {
  if (path === "/api/oauth/pinterest" && method === "GET") return oauthReturn(env, url);
  return null;
}

export async function pinterestRoute(request, env, url, path, method, { json, user = {} }) {
  if (!path.startsWith("/api/pinterest/") || method !== "POST") return null;
  try {
    if (!pinterestReady(env)) throw new Fail("Connecting Pinterest isn't switched on yet. It needs a Pinterest app (PINTEREST_APP_ID and PINTEREST_APP_SECRET) in the site's settings.", "not_configured", 503);
    if (path === "/api/pinterest/connect") {
      const base = origin(env, url);
      const state = await seal(env, { k: "state", p: "pinterest", base, uid: user.id || null, t: Date.now() });
      return json({ url: "https://www.pinterest.com/oauth/?" + form({ client_id: env.PINTEREST_APP_ID, redirect_uri: base + "/api/oauth/pinterest", response_type: "code", scope: SCOPES, state }) });
    }
    const b = await body(request), h = await openPin(env, b.account, user);
    if (path === "/api/pinterest/boards") return json({ boards: await boards(env, h), ...(await renewed(env, h)) });
    if (path === "/api/pinterest/board") return json({ ...(await boardPins(env, h, clean(b.id))), ...(await renewed(env, h)) });
    return null;
  } catch (e) { return fail(json, e); }
}

/* ---------- the login ---------- */
async function token(env, fields) {
  const r = await fetch(API + "/oauth/token", { method: "POST",
    headers: { authorization: "Basic " + btoa(env.PINTEREST_APP_ID + ":" + env.PINTEREST_APP_SECRET), "content-type": "application/x-www-form-urlencoded" }, body: form(fields) });
  const t = await getJSON(r);
  if (!r.ok || !t.access_token) { if (fields.grant_type === "refresh_token") throw relink(); throw new Fail("Pinterest didn't accept the login: " + (t.message || t.error_description || t.error || r.status)); }
  return { at: t.access_token, atExp: Date.now() + (+t.expires_in || 2592000) * 1000, rt: t.refresh_token || fields.refresh_token, rtExp: Date.now() + (+t.refresh_token_expires_in || 5184000) * 1000 };
}

async function oauthReturn(env, url) {
  const st = await unseal(env, url.searchParams.get("state") || "");
  if (!st || st.k !== "state" || st.p !== "pinterest" || Date.now() - st.t > 30 * 60e3) return page("That link has expired or didn't start here. Close this window and press Connect Pinterest again.");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) return page(/denied|cancel/i.test(err) ? "Connecting was cancelled." : `Pinterest said: ${err}`);
  const code = url.searchParams.get("code");
  if (!code) return page("Pinterest didn't send a login code back. Try again.");
  try {
    const t = await token(env, { grant_type: "authorization_code", code, redirect_uri: st.base + "/api/oauth/pinterest" });
    const u = await getJSON(await fetch(API + "/user_account", { headers: { authorization: "Bearer " + t.at } }));
    const record = { name: clean(u.business_name) || clean(u.username) || "Pinterest", handle: clean(u.username), avatar: /^https:\/\//.test(u.profile_image || "") ? u.profile_image : "",
      business: u.account_type === "BUSINESS", sealed: await seal(env, { k: "acct", p: "pinterest", ...t, owner: st.uid || null }), linkedAt: Date.now() };
    return page(null, record);
  } catch (e) {
    console.error("pinterest oauth failed", e && e.message);
    return page(e.message || "Connecting failed.");
  }
}

/* A connected account belongs to the studio login that connected it. h = {a, changed}: the open login, and
   whether it was renewed on the way (then the browser gets the new sealed one back). */
export async function openPin(env, sealed, user = {}) {
  const a = await unseal(env, String(sealed || ""));
  if (!a || a.k !== "acct" || a.p !== "pinterest") throw new Fail("That Pinterest login can't be read here. Connect Pinterest again.", "relink", 409);
  if (user && user.id && a.owner && a.owner !== user.id) throw new Fail("That Pinterest account was connected under another login. Connect it again from your own login.", "relink", 409);
  return { a, changed: false };
}
export async function renewed(env, h) { return h.changed ? { account: await seal(env, h.a) } : {}; }

// several searches run at once with the same login: they share one renewal (a second one could cancel the first)
async function fresh(env, h, force = false, used = h.a.at) {
  if (h.renewing) return h.renewing;
  if (force && h.a.at !== used) return;   // another search already renewed it
  if (!force && h.a.atExp && Date.now() < h.a.atExp - 120e3) return;
  if (!h.a.rt || (h.a.rtExp && Date.now() > h.a.rtExp)) throw relink();
  h.renewing = (async () => {
    if (h.a.at !== used) return;   // another search renewed it meanwhile
    h.a = { ...h.a, ...(await token(env, { grant_type: "refresh_token", refresh_token: h.a.rt })) }; h.changed = true;
  })().finally(() => { h.renewing = null; });
  return h.renewing;
}

async function call(env, h, path) {
  await fresh(env, h);
  let sent = h.a.at;
  const go = () => { sent = h.a.at; return fetch(API + path, { headers: { authorization: "Bearer " + sent } }); };
  let r = await go();
  if (r.status === 401) { await fresh(env, h, true, sent); r = await go(); }
  const d = await getJSON(r);
  if (r.ok) return d;
  const why = String(d.message || d.code || "");
  if (r.status === 401) throw relink();
  if (r.status === 429) throw new Fail("Pinterest is busy. Try again in a minute.", "busy", 429);
  if (/PINNER_DATA_ACCESS_DENIED/i.test(why) || r.status === 403) throw new Fail("Pinterest won't share these pins with the studio. Pinterest only lets new apps read business accounts: switch your Pinterest to a free business account (Pinterest settings, Account management, Convert to business), then try again.", "pinterest_denied", 403);
  throw new Fail(`Pinterest didn't answer (${r.status}${why ? ": " + why.slice(0, 120) : ""}).`);
}

/* ---------- reading ---------- */
async function boards(env, h) {
  const out = [];
  let bookmark = null;
  for (let i = 0; i < 4; i++) {
    const d = await call(env, h, "/boards?" + form({ page_size: 100, bookmark }));
    for (const b of d.items || []) out.push({ id: String(b.id), name: clean(b.name).slice(0, 60) || "Board", count: +b.pin_count || 0, secret: b.privacy === "SECRET",
      cover: /^https:\/\//.test((b.media && b.media.image_cover_url) || "") ? b.media.image_cover_url : "" });
    bookmark = d.bookmark; if (!bookmark) break;
  }
  return out;
}

// a pin's picture: the full-size one, with the 1200 px one as the fallback
function picture(p) {
  const m = p.media || {};
  const sizes = m.images || (Array.isArray(m.items) && m.items.find(x => x && x.images) || {}).images;
  if (!sizes) return null;   // videos
  const big = sizes["1200x"] || sizes["600x"];
  if (!big || !/^https:\/\/i\.pinimg\.com\//.test(big.url || "")) return null;
  return { full: big.url.replace(/\/\d+x\//, "/originals/"), big: big.url, thumb: (sizes["600x"] || sizes["400x300"] || big).url, w: +big.width || 0, h: +big.height || 0 };
}
const text = p => clean([p.title, p.alt_text, p.description].filter(Boolean).join(" · ")).slice(0, 220);
const disclosedAI = p => !!(p.ai_disclosures && Array.isArray(p.ai_disclosures.values) && p.ai_disclosures.values.length);

async function boardPins(env, h, id) {
  if (!/^\d{1,30}$/.test(id)) throw new Fail("Pick one of your boards.", "bad_request", 400);
  const meta = await call(env, h, `/boards/${id}`);
  const images = [];
  let bookmark = null, more = false;
  for (let i = 0; i < 2; i++) {   // up to 200 pins
    const d = await call(env, h, `/boards/${id}/pins?` + form({ page_size: 100, bookmark }));
    for (const p of d.items || []) {
      const pic = picture(p); if (!pic) continue;
      images.push({ id: "pm" + String(p.id).replace(/\D/g, "").slice(-24), title: text(p), page: `https://www.pinterest.com/pin/${encodeURIComponent(p.id)}/`, thumb: pic.thumb,
        file: await mediaLink(env, pic.full), alt: await mediaLink(env, pic.big) });
    }
    bookmark = d.bookmark; if (!bookmark) break;
    more = i === 1;
  }
  if (!images.length) throw new Fail("That board has no pictures the studio can use (videos are left out).", "board_empty", 404);
  return { name: clean(meta.name).slice(0, 60) || "Pinterest board", images, note: more ? "The first 200 pins were imported." : null };
}

/* Your saved pins that match a search, for /api/photos/pick. Pinterest searches the pins' own words (titles
   and descriptions), so short keywords work best. Pins marked as made with AI are left out. */
export async function mineSearch(env, h, q, next) {
  const d = await call(env, h, "/search/pins?" + form({ query: q, bookmark: next || null }));
  const items = [];
  for (const p of d.items || []) {
    const pic = picture(p); if (!pic) continue;
    const t = text(p);
    if (disclosedAI(p) || aiMade({ title: t })) continue;
    items.push({ id: "pm" + String(p.id).replace(/\D/g, "").slice(-24), source: "Pinterest", mine: true, w: pic.w, h: pic.h,
      shape: !pic.w || !pic.h ? "unknown" : pic.h > pic.w * 1.15 ? "portrait" : pic.w > pic.h * 1.15 ? "landscape" : "square",
      thumb: pic.thumb, file: pic.full, author: "You", page: `https://www.pinterest.com/pin/${encodeURIComponent(p.id)}/`, title: t });
  }
  return { items, next: d.bookmark || null };
}

/* The page the login window lands on: it saves the account in this browser for the studio, tells the studio
   window, and closes itself. */
function page(problem, record) {
  const title = problem ? "Couldn't connect Pinterest" : "Pinterest connected";
  const data = JSON.stringify({ problem, record: record || null }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · SLS</title>
<style>body{font:15px/1.5 "Inter Tight","Helvetica Neue",Helvetica,Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0626c7;color:#fff}main{max-width:420px;padding:28px;text-align:center}h1{font-weight:500;font-size:24px;letter-spacing:-.02em;margin:0 0 8px}p{color:rgba(255,255,255,.75)}a{color:#fff}</style>
<main><h1 id="t"></h1><p id="m"></p><p><a href="/">Back to the studio</a></p></main>
<script>
var d = ${data};
document.getElementById("t").textContent = ${JSON.stringify(title)};
if (d.problem) { document.getElementById("m").textContent = d.problem; }
else {
  try { localStorage.setItem("sls-pinterest", JSON.stringify(d.record)); } catch (e) {}
  document.getElementById("m").textContent = "The studio can now search your saved pins and import your boards. You can close this window.";
}
try { if (window.opener) { window.opener.postMessage({ sls: "pinterest", ok: !d.problem, record: d.record, problem: d.problem }, location.origin); setTimeout(function () { window.close(); }, d.problem ? 4000 : 900); } } catch (e) {}
</script></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

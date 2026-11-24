/**
 * Logging in with just a username and the team code (no passwords).
 *
 *   POST /api/enter   {username, code}  ->  the Supabase session (access_token, refresh_token, expires_at, user) + {created}
 *
 * The browser never has a password. This server checks the team code (TEAM_CODE), then logs the person in to
 * Supabase with a password only it can work out: an HMAC of the username with LOGIN_SECRET (or TOKEN_KEY). A
 * username that has no account yet gets one (Supabase checks the team code again before it makes the account).
 * Each username is stored as <username>@users.lyrics.stellarmusic.dk; no mail is ever sent there.
 *
 * Anyone with the team code can open any account by typing its username: that's the trade-off for no passwords.
 * Wrong team codes are slowed down per visitor, so the code can't be guessed by trying many.
 *
 * Every new account sends an email to NOTIFY_EMAIL (default linas@stellarmusic.dk) through Resend, when
 * RESEND_API_KEY is set. Without a verified domain Resend can only send from onboarding@resend.dev to the email
 * the Resend account was made with, so make that account with the address that should get the emails.
 */
import { authConfigured } from "./auth.js";
import { sendMail, copenhagen } from "./mail.js";

export const USER_DOMAIN = "users.lyrics.stellarmusic.dk";
const enc = new TextEncoder();
const tries = new Map();   // visitor -> {n, until}: wrong team codes, per server instance

export function slug(name) {
  return String(name || "").trim().toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "");
}

async function secretFor(env, s) {
  const key = env.LOGIN_SECRET || env.TOKEN_KEY;
  const k = await crypto.subtle.importKey("raw", enc.encode("sls-login:" + key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function same(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y); let d = 0; for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i]; return d === 0;
}

export async function loginRoute(request, env, path, method, { json }) {
  if (path !== "/api/enter" || method !== "POST") return null;
  if (!authConfigured(env) || !env.TEAM_CODE || !(env.LOGIN_SECRET || env.TOKEN_KEY))
    return json({ error: "not_configured", message: "Logins aren't fully set up on the server (TEAM_CODE and TOKEN_KEY)." }, 503);

  const who = request.headers.get("cf-connecting-ip") || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  const t = tries.get(who);
  if (t && t.n >= 8 && Date.now() < t.until) return json({ error: "rate_limited", message: "Too many wrong team codes. Wait 10 minutes and try again." }, 429);

  let b; try { b = await request.json(); } catch { b = {}; }
  const name = String(b.username || "").trim().replace(/\s+/g, " ").slice(0, 40), s = slug(name), code = String(b.code || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(s)) return json({ error: "bad_username", message: "Pick a username of at least 2 letters or numbers." }, 400);
  if (!code) return json({ error: "no_code", message: "Type the team code." }, 400);
  if (!(await same(code.toUpperCase(), String(env.TEAM_CODE).trim().toUpperCase()))) {
    const n = t && Date.now() < t.until ? t.n + 1 : 1; tries.set(who, { n, until: Date.now() + 600000 });
    if (tries.size > 5000) tries.delete(tries.keys().next().value);
    return json({ error: "wrong_team_code", message: "That team code isn't right. Ask Stellar Music for it." }, 401);
  }
  tries.delete(who);

  const base = String(env.SUPABASE_URL).replace(/\/+$/, "") + "/auth/v1", email = `${s}@${USER_DOMAIN}`, password = await secretFor(env, s);
  const call = async (p, body) => {
    const r = await fetch(base + p, { method: "POST", headers: { apikey: env.SUPABASE_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) };
  };
  let r = await call("/token?grant_type=password", { email, password }), created = false;
  if (!r.ok && (r.status === 400 || r.status === 401)) {
    // no account with that username yet (or one made with a password before this): try making it
    const up = await call("/signup", { email, password, data: { name, team_code: code } });
    if (up.ok && up.d.access_token) { r = up; created = true; }
    else if (/already|exists/i.test(JSON.stringify(up.d))) return json({ error: "taken", message: "That username can't be used. Pick another." }, 409);
    else return json({ error: "login_failed", message: "The account couldn't be opened. Try again in a minute." }, 502);
  }
  if (!r.ok || !r.d.access_token) return json({ error: "login_failed", message: "The login server didn't answer. Try again in a minute." }, 502);
  const d = r.d;
  if (created) await notify(env, name, s, request);
  return json({ access_token: d.access_token, refresh_token: d.refresh_token, expires_in: d.expires_in, expires_at: d.expires_at,
    user: { id: d.user && d.user.id, email: d.user && d.user.email, user_metadata: { name: (d.user && d.user.user_metadata && d.user.user_metadata.name) || name } }, created });
}

/* an email saying someone made an account (best effort: a failure here never stops the login) */
async function notify(env, name, s, request) {
  const site = env.PUBLIC_URL || new URL(request.url).origin;
  await sendMail(env, `New account on Stellar Lyric Studio: ${name}`,
    `${name} just made an account on Stellar Lyric Studio (username: ${s}).\n\nTime: ${copenhagen(Date.now())}\nSite: ${site}\n\nIf you don't know who this is, change the team code (see the README) and remove the user in Supabase under Authentication > Users.`);
}

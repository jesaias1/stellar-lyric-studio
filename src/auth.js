/**
 * Who is calling the studio's backend.
 *
 * People log in with their own account (Supabase Auth: email + password). The studio sends the login token
 * (a JWT) in "Authorization: Bearer ...". It is checked here against Supabase's public signing keys, so most
 * requests need no extra call; tokens signed the older way (one shared secret) are checked by asking Supabase.
 *
 *   SUPABASE_URL   the project address, e.g. https://abcd.supabase.co
 *   SUPABASE_KEY   the project's publishable (anon) key. Not a secret: the browser uses the same one.
 *
 * Without these two, the studio falls back to the single shared passcode (SLS_PASSCODE): handy for running it
 * on your own computer.
 */

export const authConfigured = env => !!(env.SUPABASE_URL && env.SUPABASE_KEY);

const enc = new TextEncoder(), dec = new TextDecoder();
const b64uBytes = s => { const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };
const part = s => JSON.parse(dec.decode(b64uBytes(s)));
const base = env => String(env.SUPABASE_URL).replace(/\/+$/, "");

let jwks = { at: 0, keys: [], url: "" };
const verified = new Map();   // token hash -> { user, until }

async function signingKeys(env, force) {
  const url = base(env) + "/auth/v1/.well-known/jwks.json";
  if (!force && jwks.url === url && Date.now() - jwks.at < 10 * 60e3) return jwks.keys;
  try {
    const r = await fetch(url, { headers: { apikey: env.SUPABASE_KEY } });
    const d = r.ok ? await r.json() : null;
    jwks = { at: Date.now(), url, keys: (d && Array.isArray(d.keys)) ? d.keys : [] };
  } catch { jwks = { at: Date.now() - 9 * 60e3, url, keys: [] }; }   // try again in a minute
  return jwks.keys;
}

async function verifyLocally(env, token) {
  const [h, p, s] = token.split(".");
  const head = part(h);
  if (!/^(ES256|RS256)$/.test(head.alg || "")) return undefined;          // not checkable here
  let jwk = (await signingKeys(env)).find(k => k.kid === head.kid);
  if (!jwk) jwk = (await signingKeys(env, true)).find(k => k.kid === head.kid);
  if (!jwk) return undefined;
  const algo = head.alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["verify"] }, algo, false, ["verify"]);
  const ok = await crypto.subtle.verify(algo, key, b64uBytes(s), enc.encode(h + "." + p));
  if (!ok) return null;
  const claims = part(p), now = Date.now() / 1000;
  if (!claims.exp || claims.exp < now - 30) return null;
  if (claims.iss && claims.iss !== base(env) + "/auth/v1") return null;
  if (claims.role !== "authenticated" || !claims.sub) return null;
  return { id: claims.sub, email: claims.email || "", exp: claims.exp };
}

async function askSupabase(env, token) {
  const r = await fetch(base(env) + "/auth/v1/user", { headers: { apikey: env.SUPABASE_KEY, authorization: "Bearer " + token } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? { id: u.id, email: u.email || "", exp: Date.now() / 1000 + 60 } : null;
}

/* The signed-in user behind a token, or null. */
export async function userFrom(env, token) {
  if (!token || token.length > 4096 || token.split(".").length !== 3) return null;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(token))).subarray(0, 12)).map(b => b.toString(16).padStart(2, "0")).join("");
  const hit = verified.get(hash);
  if (hit && hit.until > Date.now()) return hit.user;
  let user;
  try { user = await verifyLocally(env, token); } catch { user = undefined; }
  if (user === undefined) { try { user = await askSupabase(env, token); } catch { user = null; } }
  if (user) {
    verified.set(hash, { user, until: Math.min(Date.now() + 5 * 60e3, user.exp * 1000) });
    if (verified.size > 1000) verified.delete(verified.keys().next().value);
  }
  return user || null;
}

export const bearer = request => { const h = request.headers.get("authorization") || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; };

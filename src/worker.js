/**
 * Stellar Lyric Studio backend (Cloudflare Worker).
 *
 * Static files in ./public are served by Cloudflare directly. Everything under /api/ lands here:
 *
 *   GET    /api/health            is the backend up, and is it configured? (no passcode needed)
 *   POST   /api/session           check the login (or the passcode)
 *   POST   /api/transcribe        one chunk of audio in, words with timings out (Workers AI Whisper)
 *   POST   /api/meta/deauthorize, /api/meta/delete   Meta's app-removal and data-deletion callbacks
 *   POST   /api/enter             log in or sign up with a username and the team code (src/login.js)
 *   GET    /api/catalog[/:id]     the Stellar Music artists and their songs' 30 s previews (src/catalog.js)
 *   POST   /api/caption           an AI-written post text and hashtags, when asked (src/caption.js)
 *   POST   /api/cron              posts scheduled posts that are due, every 5 minutes (src/schedule.js)
 *   POST   /api/hooks             rates candidate soundbites' lyrics for TikTok / Reels (src/hooks.js)
 *   GET    /api/templates         the team's shared templates
 *   PUT    /api/templates/:id     save a template
 *   DELETE /api/templates/:id     delete a template
 *   GET    /api/stock/search      free stock videos (Pixabay, Pexels)          } see src/media.js
 *   POST   /api/tiktok/sound      a TikTok sound's details and audio, from a sound or video link (src/tiktok-sound.js)
 *   GET    /api/media             relays a video file the backend vouched for   }
 *   POST   /api/bg/prompts        lyrics in, background video ideas out         }
 *   POST   /api/bg/estimate       price of an AI background video (Higgsfield)  }
 *   POST   /api/bg/generate       start an AI background video                  }
 *   GET    /api/bg/status/:id     is it done yet                                }
 *   GET    /api/photos/search     photos: Pexels, Pixabay, Pinterest (SerpApi)  } see src/photos.js
 *   POST   /api/photos/pick       keywords + lyrics in, the best photos out     }
 *   POST   /api/photos/rank       ranks a moodboard's images against the song   }
 *   POST   /api/moodboard/pinterest  a public Pinterest board's latest pins     }
 *   POST   /api/publish/...       link YouTube, Instagram, TikTok accounts and post to them } see src/publish.js
 *   GET    /api/oauth/:platform   where a login comes back (no passcode, signed state)    }
 *
 * Every route except /api/health needs "Authorization: Bearer ...": the user's login token when accounts are on
 * (SUPABASE_URL and SUPABASE_KEY, see src/auth.js), otherwise the shared SLS_PASSCODE.
 */

import { hooksRoute } from "./hooks.js";
import { loginRoute } from "./login.js";
import { catalogRoute } from "./catalog.js";
import { tiktokSoundRoute } from "./tiktok-sound.js";
import { trendsRoute } from "./trends.js";
import { cronRoute } from "./schedule.js";
import { captionRoute } from "./caption.js";
import { authConfigured, userFrom, bearer } from "./auth.js";
import { mediaRoute, mediaHealth } from "./media.js";
import { photosRoute, photosHealth } from "./photos.js";
import { vibeRoute } from "./vibe.js";
import { publishRoute, publishPublicRoute, publishHealth } from "./publish.js";

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_AUDIO_B64 = 6_000_000;      // about 4.4 MB of audio per request; the app sends ~1 MB chunks
const MAX_TEMPLATE_BYTES = 900_000;
const MAX_TEMPLATES = 200;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error("api error", err && err.stack ? err.stack : err);
      return json({ error: "server_error", message: "Something went wrong on the server." }, 500);
    }
  },
};

async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, ""), method = request.method;

  if (path === "/api/health" && method === "GET") {
    // the login settings are public on purpose: the browser needs them to show the login, and the key is the
    // publishable one (all data is protected by Supabase's row-level security)
    const auth = authConfigured(env) ? { url: String(env.SUPABASE_URL).replace(/\/+$/, ""), key: env.SUPABASE_KEY } : null;
    return json({ ok: true, ai: hasAI(env), locked: !!(auth || env.SLS_PASSCODE), auth, templates: !!env.TEMPLATES, ...mediaHealth(env), ...photosHealth(env), ...publishHealth(env) });
  }

  // Logins coming back from YouTube, Instagram and TikTok, and the video Instagram fetches: these come from
  // other servers, so they carry their own signatures instead of the passcode.
  const pub = await publishPublicRoute(request, env, url, path, method);
  if (pub) return pub;

  // Meta's callbacks for when someone removes the app from Instagram, or asks for their data to be deleted.
  // Nothing about Instagram accounts is kept on the server (logins are sealed into the person's studio account),
  // so these only acknowledge and point to how deletion works.
  if (path === "/api/meta/deauthorize" && (method === "POST" || method === "GET")) return json({ ok: true });
  if (path === "/api/meta/delete" && method === "GET") return json({ ok: true, info: "Send a POST with Meta's signed_request to request deletion." });
  if (path === "/api/meta/delete" && method === "POST") {
    const code = "sls-" + crypto.randomUUID().slice(0, 8);
    const base = (env.PUBLIC_URL || url.origin).replace(/\/+$/, "");
    return json({ url: base + "/privacy.html#delete", confirmation_code: code });
  }

  // The scheduler (every 5 minutes, from Supabase's pg_cron): public, it only does what is due
  const cron = await cronRoute(request, env, url, path, method, { json });
  if (cron) return cron;

  // Logging in (username + team code): public, it's how a session starts
  const enter = await loginRoute(request, env, path, method, { json });
  if (enter) return enter;

  // Everything below is private.
  const who = await guard(request, env);
  if (who instanceof Response) return who;

  if (path === "/api/session" && method === "POST") return json({ ok: true, user: who.id ? { id: who.id, email: who.email } : null });
  if (path === "/api/transcribe" && method === "POST") return transcribe(request, env);

  if (path === "/api/templates" && method === "GET") return listTemplates(env);
  const m = path.match(/^\/api\/templates\/([A-Za-z0-9_-]{1,64})$/);
  if (m && method === "PUT") return saveTemplate(request, env, m[1]);
  if (m && method === "DELETE") return deleteTemplate(env, m[1]);

  const catalog = await catalogRoute(request, env, path, method, { json });
  if (catalog) return catalog;
  const ttSound = await tiktokSoundRoute(request, env, path, method, { json });
  if (ttSound) return ttSound;
  const trends = await trendsRoute(request, env, url, path, method, { json });
  if (trends) return trends;
  const caption = await captionRoute(request, env, path, method, { hasAI: hasAI(env), runModel, json });
  if (caption) return caption;
  const hooks = await hooksRoute(request, env, path, method, { hasAI: hasAI(env), runModel, json });
  if (hooks) return hooks;
  const media = await mediaRoute(request, env, url, path, method, { hasAI: hasAI(env), runModel, json });
  if (media) return media;
  const photos = await photosRoute(request, env, url, path, method, { hasAI: hasAI(env), runModel, json });
  if (photos) return photos;
  const vibe = await vibeRoute(request, env, path, method, { hasAI: hasAI(env), runModel, json });
  if (vibe) return vibe;
  const publish = await publishRoute(request, env, url, path, method, { json, user: who });
  if (publish) return publish;

  return json({ error: "not_found", message: "No such endpoint." }, 404);
}

/* ---------- access ---------- */

/* Who is asking: a logged-in user ({ id, email }) when accounts are on, otherwise the team passcode ({}).
   Answers a Response instead when the request isn't allowed. */
async function guard(request, env) {
  // Slows down guessing and runaway scripts: a cap on requests per visitor.
  if (env.API_LIMIT) {
    const ip = request.headers.get("cf-connecting-ip") || "local";
    const { success } = await env.API_LIMIT.limit({ key: ip });
    if (!success) return json({ error: "rate_limited", message: "Too many requests. Wait a minute and try again." }, 429);
  }
  const given = bearer(request);
  if (authConfigured(env)) {
    const user = await userFrom(env, given);
    if (!user) return json({ error: "unauthorized", message: "Your login has run out. Log in again." }, 401);
    return user;
  }
  if (!env.SLS_PASSCODE) {
    return json({ error: "not_configured", message: "Logins aren't set up on the server yet (SUPABASE_URL and SUPABASE_KEY, or SLS_PASSCODE)." }, 503);
  }
  if (!given || !(await sameSecret(given, env.SLS_PASSCODE))) {
    return json({ error: "unauthorized", message: "That passcode isn't right." }, 401);
  }
  return {};
}

// Compare through a hash so the check takes the same time whatever was sent.
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------- lyrics from audio ---------- */

async function transcribe(request, env) {
  if (!hasAI(env)) return json({ error: "no_ai", message: "Workers AI isn't connected to this Worker." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request", message: "Send JSON." }, 400); }
  const audio = body && body.audio;
  if (typeof audio !== "string" || audio.length < 100) return json({ error: "bad_request", message: "No audio was sent." }, 400);
  if (audio.length > MAX_AUDIO_B64) return json({ error: "too_large", message: "That piece of audio is too large." }, 413);

  const input = {
    audio,
    task: "transcribe",
    vad_filter: false,                    // the speech detector drops sung vocals, so it stays off
    condition_on_previous_text: false,    // stops the model looping on a repeated chorus
  };
  if (typeof body.language === "string" && /^[a-z]{2,3}$/.test(body.language)) input.language = body.language;
  if (typeof body.prompt === "string" && body.prompt.trim()) input.initial_prompt = body.prompt.trim().slice(0, 600);

  let out;
  try {
    out = await runWhisper(env, input);
  } catch (err) {
    const msg = String((err && err.message) || err);
    console.error("whisper failed:", msg);
    const busy = /capacity|rate|limit|3040|429|timeout|temporar/i.test(msg);
    return json({ error: busy ? "busy" : "ai_failed", message: busy ? "The lyric AI is busy. Trying again helps." : "The lyric AI couldn't read this audio.", detail: msg.slice(0, 300) }, busy ? 503 : 502);
  }

  const info = out.transcription_info || {};
  const segments = (out.segments || []).map(s => ({
    s: num(s.start), e: num(s.end), text: String(s.text || "").trim(),
    nsp: num(s.no_speech_prob), lp: num(s.avg_logprob), cr: num(s.compression_ratio),
    words: (s.words || []).map(w => { const o = { w: String(w.word || "").trim(), s: num(w.start), e: num(w.end) }; const p = num(w.probability); if(p != null) o.p = p; return o; }).filter(w => w.w),
  }));
  return json({
    language: info.language || input.language || null,
    languageProbability: num(info.language_probability),
    duration: num(info.duration),
    text: String(out.text || "").trim(),
    segments,
  });
}

// Live: the Workers AI binding. Without it (for example when running locally), the same model over
// Cloudflare's REST API, if CF_ACCOUNT_ID and CF_API_TOKEN are set.
function hasAI(env) { return !!(env.AI || (env.CF_API_TOKEN && env.CF_ACCOUNT_ID)); }

function runWhisper(env, input) { return runModel(env, MODEL, input); }
export async function runModel(env, model, input) {
  if (env.AI) return env.AI.run(model, input);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.result) {
    const why = data && data.errors && data.errors[0] ? `${data.errors[0].code} ${data.errors[0].message}` : `HTTP ${res.status}`;
    throw new Error(why);
  }
  return data.result;
}

/* ---------- shared templates ---------- */

async function listTemplates(env) {
  if (!env.TEMPLATES) return json({ error: "no_storage", message: "Template storage isn't set up." }, 503);
  const { keys } = await env.TEMPLATES.list({ prefix: "tpl:", limit: MAX_TEMPLATES });
  const docs = (await Promise.all(keys.map(k => env.TEMPLATES.get(k.name, "json").catch(() => null)))).filter(Boolean);
  docs.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return json({ templates: docs });
}

async function saveTemplate(request, env, id) {
  if (!env.TEMPLATES) return json({ error: "no_storage", message: "Template storage isn't set up." }, 503);
  const text = await request.text();
  if (text.length > MAX_TEMPLATE_BYTES) return json({ error: "too_large", message: "That template is too large to save." }, 413);
  let doc;
  try { doc = JSON.parse(text); } catch { return json({ error: "bad_request", message: "Send JSON." }, 400); }
  // version 2 templates carry the parts they were saved with in "data"; older ones a whole "project"
  const v2 = doc && typeof doc === "object" && doc.data && typeof doc.data === "object";
  if (!doc || typeof doc !== "object" || (!v2 && !(doc.project && Array.isArray(doc.project.words)))) {
    return json({ error: "bad_request", message: "That isn't a Lyric Studio template." }, 400);
  }
  const base = { id, name: String(doc.name || "Untitled").slice(0, 120), savedAt: Number(doc.savedAt) || Date.now() };
  const clean = v2 ? { ...base, v: 2, parts: doc.parts || {}, data: doc.data, preview: typeof doc.preview === "string" && doc.preview.length < 200000 ? doc.preview : "" } : { ...base, project: doc.project };
  await env.TEMPLATES.put("tpl:" + id, JSON.stringify(clean));
  return json({ ok: true, template: clean });
}

async function deleteTemplate(env, id) {
  if (!env.TEMPLATES) return json({ error: "no_storage", message: "Template storage isn't set up." }, 503);
  await env.TEMPLATES.delete("tpl:" + id);
  return json({ ok: true });
}

/* ---------- helpers ---------- */

function num(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

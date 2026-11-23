/**
 * Stellar Lyric Studio backend (Cloudflare Worker).
 *
 * Static files in ./public are served by Cloudflare directly. Everything under /api/ lands here:
 *
 *   GET    /api/health            is the backend up, and is it configured? (no passcode needed)
 *   POST   /api/session           check the studio passcode
 *   POST   /api/transcribe        one chunk of audio in, words with timings out (Workers AI Whisper)
 *   GET    /api/templates         the team's shared templates
 *   PUT    /api/templates/:id     save a template
 *   DELETE /api/templates/:id     delete a template
 *   GET    /api/stock/search      free stock videos (Pixabay, Pexels)          } see src/media.js
 *   GET    /api/media             relays a video file the backend vouched for   }
 *   POST   /api/bg/prompts        lyrics in, background video ideas out         }
 *   POST   /api/bg/estimate       price of an AI background video (Higgsfield)  }
 *   POST   /api/bg/generate       start an AI background video                  }
 *   GET    /api/bg/status/:id     is it done yet                                }
 *
 * Every route except /api/health needs the studio passcode in an "Authorization: Bearer ..." header.
 * The passcode is the SLS_PASSCODE secret (set with `npx wrangler secret put SLS_PASSCODE`).
 */

import { mediaRoute, mediaHealth } from "./media.js";

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
    return json({ ok: true, ai: hasAI(env), locked: !!env.SLS_PASSCODE, templates: !!env.TEMPLATES, ...mediaHealth(env) });
  }

  // Everything below is private.
  const denied = await guard(request, env);
  if (denied) return denied;

  if (path === "/api/session" && method === "POST") return json({ ok: true });
  if (path === "/api/transcribe" && method === "POST") return transcribe(request, env);

  if (path === "/api/templates" && method === "GET") return listTemplates(env);
  const m = path.match(/^\/api\/templates\/([A-Za-z0-9_-]{1,64})$/);
  if (m && method === "PUT") return saveTemplate(request, env, m[1]);
  if (m && method === "DELETE") return deleteTemplate(env, m[1]);

  const media = await mediaRoute(request, env, url, path, method, { hasAI: hasAI(env), runModel, json });
  if (media) return media;

  return json({ error: "not_found", message: "No such endpoint." }, 404);
}

/* ---------- access ---------- */

async function guard(request, env) {
  if (!env.SLS_PASSCODE) {
    return json({ error: "not_configured", message: "The studio passcode hasn't been set on the server yet." }, 503);
  }
  // Slows down passcode guessing and runaway scripts: a cap on requests per visitor.
  if (env.API_LIMIT) {
    const ip = request.headers.get("cf-connecting-ip") || "local";
    const { success } = await env.API_LIMIT.limit({ key: ip });
    if (!success) return json({ error: "rate_limited", message: "Too many requests. Wait a minute and try again." }, 429);
  }
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!given || !(await sameSecret(given, env.SLS_PASSCODE))) {
    return json({ error: "unauthorized", message: "That passcode isn't right." }, 401);
  }
  return null;
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
    words: (s.words || []).map(w => ({ w: String(w.word || "").trim(), s: num(w.start), e: num(w.end) })).filter(w => w.w),
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

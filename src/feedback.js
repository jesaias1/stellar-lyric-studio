/**
 * Feedback from the internal demo round, into Ana's Google Sheet ("SLS Feedback Responses (Internal Demo)").
 *
 *   POST /api/feedback {id, source, template, song, version, ease, quality, again, confusing, broke, change, other}
 *        -> {ok}  or 503 {error: "not_configured"} (the studio then keeps the answers and sends them later)
 *
 * Anonymous: nothing about who sent it is added (no username, no email, no IP).
 * The answers are checked here (ratings 0-5, text lengths), sent on to the Sheet's Apps Script web app
 * (FEEDBACK_URL, with FEEDBACK_KEY so only this server can add rows), which appends one row to the Responses tab
 * in the Sheet's column order: Timestamp, Source, Template, Song, SLS version, the three ratings, the four answers.
 * `id` is made by the browser per submission: the same one twice (a double click, a resend) is only added once.
 * The script to paste into the Sheet is docs/feedback-apps-script.gs.
 */
const seen = new Map();   // submission id -> time, per server instance (the Apps Script checks again)
const SOURCES = { button: "Feedback button", export: "After export" };

export const feedbackReady = env => !!env.FEEDBACK_URL;

export async function feedbackRoute(request, env, path, method, { json }) {
  if (path !== "/api/feedback") return null;
  if (method !== "POST") return json({ error: "method" }, 405);
  let b = {}; try { b = await request.json(); } catch {}
  const id = String(b.id || "").replace(/[^\w-]/g, "").slice(0, 64);
  const rate = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null; };
  const txt = (v, n = 2000) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, n);
  const row = { id, at: new Date().toISOString(), source: SOURCES[b.source] || SOURCES.button, template: txt(b.template, 80), song: txt(b.song, 160),
    version: txt(b.version, 24), ease: rate(b.ease), quality: rate(b.quality), again: rate(b.again),
    confusing: txt(b.confusing), broke: txt(b.broke), change: txt(b.change), other: txt(b.other) };
  if (!id) return json({ error: "bad_request", message: "Something went wrong with the form. Reload the page and try again." }, 400);
  if (row.ease == null || row.quality == null || row.again == null) return json({ error: "bad_request", message: "Pick a number from 0 to 5 for each of the three questions." }, 400);
  if (!feedbackReady(env)) return json({ error: "not_configured", message: "The feedback sheet isn't connected yet." }, 503);
  if (seen.has(id)) return json({ ok: true, again: true });
  let r, d = {};
  try {
    // Apps Script answers a POST with a redirect to its result; text/plain keeps it a simple request
    r = await fetch(env.FEEDBACK_URL, { method: "POST", redirect: "follow", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...row, key: env.FEEDBACK_KEY || "" }) });
    d = await r.json().catch(() => ({}));
  } catch { return json({ error: "sheet_unreachable", message: "The feedback sheet didn't answer. Your answers are kept and sent later." }, 502); }
  if (!r.ok || !d.ok) return json({ error: "sheet_refused", message: "The feedback sheet didn't take the answers. They're kept and sent later." }, 502);
  seen.set(id, Date.now()); if (seen.size > 2000) seen.delete(seen.keys().next().value);
  return json({ ok: true });
}

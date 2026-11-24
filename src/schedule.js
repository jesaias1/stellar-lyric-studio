/**
 * Posting at a set time (the calendar), checking on posts that are still processing, and reading back results.
 *
 *   POST|GET /api/cron   called every 5 minutes by pg_cron in Supabase (see supabase/schema.sql). No login: it
 *                        only does what is due, and runs at most every 20 seconds.
 *
 * Each run:
 *   1. Posts that are due (status "scheduled", publish_at passed): claimed one by one (status "posting", so two
 *      runs never post the same one), posted with the account's saved login, then "posted", or "working" while the
 *      platform still processes it. A failure is tried again twice, 5 and 10 minutes later, then "failed".
 *   2. Posts still processing ("working"): asked about again until posted or failed.
 *   3. Results: views, likes and comments of posts from the last 30 days, at most every 6 hours per post.
 * The stored video (Vercel Blob) is deleted once a post is through.
 *   4. Once a day, from 18:00 Copenhagen time: ONE summary email to the studio's owner of the posts that went out or
 *      failed since the last summary (src/mail.js). Nothing happened: no email.
 *
 * Needs SUPABASE_SECRET_KEY (the project's secret key): the server reads every person's due posts and their
 * sealed account logins, which row-level security otherwise keeps to their owner.
 */
import { openAccount, postWith, statusWith, statsWith, seal } from "./publish.js";
import { sendMail, copenhagen } from "./mail.js";

const NAMES = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
const MAX_BYTES = 95 * 1024 * 1024;
let lastRun = 0;

export async function cronRoute(request, env, url, path, method, { json }) {
  if (path !== "/api/cron" || (method !== "POST" && method !== "GET")) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return json({ ok: false, message: "SUPABASE_SECRET_KEY isn't set, so scheduled posts can't be sent." }, 503);
  if (Date.now() - lastRun < 20000) return json({ ok: true, skipped: "ran moments ago" });
  lastRun = Date.now();
  const db = admin(env), report = { posted: 0, working: 0, failed: 0, retried: 0, stats: 0, errors: [] };
  const started = Date.now(), timeLeft = () => 45000 - (Date.now() - started);
  try {
    await recoverStuck(db);
    const due = await db.get(`posts?select=*&status=eq.scheduled&publish_at=lte.${iso()}&order=publish_at.asc&limit=3`);
    for (const row of due) { if (timeLeft() < 15000) break; await postOne(env, url, db, row, report); }
    const working = await db.get(`posts?select=*&status=eq.working&order=updated_at.asc&limit=6`);
    for (const row of working) { if (timeLeft() < 8000) break; await checkOne(env, db, row, report); }
    const since = iso(Date.now() - 30 * 864e5), stale = iso(Date.now() - 6 * 3600e3);
    const results = await db.get(`posts?select=*&status=eq.posted&ref=not.is.null&publish_at=gte.${since}&or=(stats_at.is.null,stats_at.lt.${stale})&order=stats_at.asc.nullsfirst&limit=6`);
    for (const row of results) { if (timeLeft() < 5000) break; await statsOne(env, db, row, report); }
    if (timeLeft() > 3000) report.digest = await digest(env, db);
  } catch (err) { report.errors.push(String(err && err.message || err)); console.error("cron failed:", err); }
  return json({ ok: true, ...report });
}

/* ---------- Supabase with the secret key ---------- */
function admin(env) {
  const base = String(env.SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/", key = env.SUPABASE_SECRET_KEY;
  const headers = { apikey: key, "content-type": "application/json" };
  if (/^eyJ/.test(key)) headers.authorization = "Bearer " + key;      // an old-style service_role key is a JWT
  const call = async (path, method = "GET", body, prefer) => {
    const r = await fetch(base + path, { method, headers: { ...headers, ...(prefer ? { prefer } : {}) }, body: body != null ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`database ${method} ${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  return {
    get: path => call(path),
    // changes rows matching the filter and gives back the ones it changed (empty when none matched)
    patch: (path, body) => call(path, "PATCH", { ...body, updated_at: iso() }, "return=representation"),
    upsert: (table, row) => call(table, "POST", row, "resolution=merge-duplicates,return=minimal"),
  };
}
const iso = (t = Date.now()) => new Date(t).toISOString();

/* a run that crashed mid-post leaves a row "posting": after 15 minutes it's tried again (or given up on) */
async function recoverStuck(db) {
  const stuck = await db.get(`posts?select=id,attempts&status=eq.posting&updated_at=lt.${iso(Date.now() - 15 * 60e3)}&limit=10`);
  for (const r of stuck) await db.patch(`posts?id=eq.${r.id}&status=eq.posting`, r.attempts >= 3
    ? { status: "failed", note: "Posting didn't finish. Try again from the calendar." } : { status: "scheduled" });
}

async function accountFor(env, db, row) {
  const rows = await db.get(`social_accounts?select=sealed&user_id=eq.${row.user_id}&id=eq.${encodeURIComponent(row.account_id)}`);
  if (!rows.length) throw Object.assign(new Error(`The ${NAMES[row.platform]} account isn't linked anymore. Link it again, then try again.`), { final: true });
  return openAccount(env, rows[0].sealed, row.platform, { id: row.user_id });
}
// a login the platform renewed is sealed again and saved over the old one
async function keepAccount(env, db, row, a) {
  await db.patch(`social_accounts?user_id=eq.${row.user_id}&id=eq.${encodeURIComponent(row.account_id)}`, { sealed: await seal(env, a) }).catch(e => console.error("saving the renewed login failed:", e.message));
}
// several accounts scheduled at once share one stored video: it's deleted when the last of them is through
async function dropVideo(env, db, row) {
  if (!row.video_url || !env.deleteBlob) return;
  const others = await db.get(`posts?select=id&video_url=eq.${encodeURIComponent(row.video_url)}&id=neq.${row.id}&status=in.(scheduled,posting,working)&limit=1`).catch(() => [{}]);
  if (others.length) return;
  try { await env.deleteBlob(row.video_url); } catch (e) { console.error("deleting the stored video failed:", e.message); }
}

async function postOne(env, url, db, row, report) {
  const claimed = await db.patch(`posts?id=eq.${row.id}&status=eq.scheduled`, { status: "posting", attempts: (row.attempts || 0) + 1 });
  if (!claimed.length) return;                                   // another run took it
  try {
    const src = String(row.video_url || "");
    if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/sls-posts\//i.test(src) || !src.includes(`/sls-posts/${row.user_id}/`))
      throw Object.assign(new Error("The video for this post is missing. Post it again from the project."), { final: true });
    const a0 = await accountFor(env, db, row);
    let bytes = new ArrayBuffer(1);
    if (row.platform !== "instagram") {                            // Instagram fetches the link itself
      const r = await fetch(src);
      if (!r.ok) throw Object.assign(new Error(`The stored video couldn't be read (${r.status}). Post it again from the project.`), { final: r.status === 404 });
      if (+r.headers.get("content-length") > MAX_BYTES) throw Object.assign(new Error("The video is larger than 95 MB."), { final: true });
      bytes = await r.arrayBuffer();
    }
    const { out, a, changed } = await postWith(env, url, row.platform, a0, bytes, row.video_type || "video/mp4", row.meta || {}, src);
    if (changed) await keepAccount(env, db, row, a);
    if (out.state === "done") { await finish(env, db, row, "posted", out); report.posted++; }
    else { await db.patch(`posts?id=eq.${row.id}`, { status: "working", ref: out.ref || null, note: out.note || null, result_url: out.url || null }); report.working++; }
  } catch (err) {
    const msg = String(err && err.message || err), final = err.final || err.code === "relink" || (err.status >= 400 && err.status < 500);
    if (!final && (row.attempts || 0) + 1 < 3) {
      await db.patch(`posts?id=eq.${row.id}`, { status: "scheduled", publish_at: iso(Date.now() + 5 * 60e3 * ((row.attempts || 0) + 1)), note: "Trying again soon: " + msg.slice(0, 300) });
      report.retried++;
    } else { await finish(env, db, row, "failed", { note: msg }); report.failed++; }
    report.errors.push(msg.slice(0, 200));
  }
}

async function checkOne(env, db, row, report) {
  try {
    const a0 = await accountFor(env, db, row);
    const { out, a, changed } = await statusWith(env, row.platform, a0, row.ref);
    if (changed) await keepAccount(env, db, row, a);
    if (out.state === "done") { await finish(env, db, row, "posted", out); report.posted++; }
    else if (out.state === "failed") { await finish(env, db, row, "failed", out); report.failed++; }
    else if (Date.now() - new Date(row.publish_at).getTime() > 6 * 3600e3) { await finish(env, db, row, "failed", { note: `${NAMES[row.platform]} was still processing it after 6 hours.` }); report.failed++; }
    else await db.patch(`posts?id=eq.${row.id}`, {});               // touch it, so the others get their turn
  } catch (err) { report.errors.push(String(err && err.message || err).slice(0, 200)); }
}

/* a post is through: save the outcome and delete the stored video (the daily summary email reports it) */
async function finish(env, db, row, status, out) {
  await db.patch(`posts?id=eq.${row.id}`, { status, ref: out.ref || row.ref || null, result_url: out.url || row.result_url || null, note: (out.note || "").slice(0, 900) || null, video_url: status === "posted" || status === "failed" ? null : row.video_url });
  await dropVideo(env, db, row);
}

/* one email a day at most: from 18:00 Copenhagen time, what went out and what didn't since the last one */
async function digest(env, db, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (+parts.hour < 18) return "not yet";
  const last = await db.get("studio_state?select=value&key=eq.last_digest");
  if (last[0] && last[0].value === today) return "sent today";
  const rows = await db.get(`posts?select=id,platform,account_name,project_name,publish_at,status,result_url,note&mailed=eq.false&status=in.(posted,failed)&order=publish_at.asc&limit=200`);
  if (rows.length) {
    const line = r => `- ${copenhagen(r.publish_at)} · ${r.project_name || "Lyric video"} · ${r.account_name || ""} (${NAMES[r.platform]})${r.status === "posted" ? (r.result_url ? "\n  " + r.result_url : "") : "\n  Why: " + (r.note || "unknown")}`;
    const ok = rows.filter(r => r.status === "posted"), bad = rows.filter(r => r.status === "failed");
    const text = (ok.length ? `Posted (${ok.length}):\n${ok.map(line).join("\n")}\n\n` : "") + (bad.length ? `Didn't post (${bad.length}):\n${bad.map(line).join("\n")}\n\nOpen the calendar in the studio to try those again.\n` : "");
    const sent = await sendMail(env, `Stellar Lyric Studio today: ${ok.length} posted${bad.length ? `, ${bad.length} didn't post` : ""}`, text);
    if (!sent && env.RESEND_API_KEY) return "email failed, trying again next run";
    for (let i = 0; i < rows.length; i += 50) await db.patch(`posts?id=in.(${rows.slice(i, i + 50).map(r => r.id).join(",")})`, { mailed: true });
  }
  await db.upsert("studio_state", { key: "last_digest", value: today, updated_at: iso(now) });
  return rows.length ? `${rows.length} in the summary` : "nothing to report";
}
export const _test = { digest };

async function statsOne(env, db, row, report) {
  try {
    const a0 = await accountFor(env, db, row);
    const { stats, a, changed } = await statsWith(env, row.platform, a0, row.ref);
    if (changed) await keepAccount(env, db, row, a);
    await db.patch(`posts?id=eq.${row.id}`, stats ? { stats: { ...stats, at: iso() }, stats_at: iso() } : { stats_at: iso() });
    if (stats) report.stats++;
  } catch (err) {
    await db.patch(`posts?id=eq.${row.id}`, { stats_at: iso() }).catch(() => {});
    report.errors.push(String(err && err.message || err).slice(0, 200));
  }
}

/**
 * Vercel entry for the studio backend. It runs the same code as the Cloudflare Worker (src/worker.js).
 * vercel.json sends every /api/... request here.
 *
 * Runs on Vercel's Node.js runtime: its Edge runtime crashes on uploads the size of a 30 second audio piece.
 *
 * Set these in the Vercel project (Settings > Environment Variables):
 *   TEAM_CODE       the code people type with their username to log in (no passwords; see src/login.js)
 *   SUPABASE_SECRET_KEY  the Supabase project's secret key: the scheduler posts everyone's scheduled posts with it
 *   RESEND_API_KEY  optional: an email to NOTIFY_EMAIL (default linas@stellarmusic.dk) for every new account
 *   SUPABASE_URL    } logins: each person has their own account (see src/auth.js). Both values are public.
 *   SUPABASE_KEY    }   Without them the studio asks for one shared passcode instead:
 *   SLS_PASSCODE    the passcode (only used when SUPABASE_URL/KEY aren't set)
 *   CF_ACCOUNT_ID   a Cloudflare account ID          } the lyric AI (Whisper) runs on Cloudflare Workers AI,
 *   CF_API_TOKEN    a token with "Workers AI" access  } reached from here over Cloudflare's API
 * Optional:
 *   PIXABAY_KEY     free key from pixabay.com/api/docs  } stock video search
 *   PEXELS_KEY      key from pexels.com/api             }
 *   HF_KEY_ID       Higgsfield API key ID and secret, from console.higgsfield.ai (AI background videos)
 *   HF_KEY_SECRET
 *   SERPAPI_KEY     Pinterest in the image grabber
 *   GOOGLE_*, INSTAGRAM_*, TIKTOK_*, TOKEN_KEY   posting to YouTube, Instagram and TikTok (see src/publish.js).
 *                   On Vercel a request can carry at most 4.5 MB, so posting only works for very short videos,
 *                   and Instagram needs Cloudflare KV storage: post from the Cloudflare version of the site.
 */
import worker from "../src/worker.js";
import { authConfigured, userFrom } from "../src/auth.js";

// trimmed: a value pasted or piped in often carries a stray newline
const NAMES = ["SLS_PASSCODE", "CF_ACCOUNT_ID", "CF_API_TOKEN", "PIXABAY_KEY", "PEXELS_KEY", "SERPAPI_KEY", "HF_KEY_ID", "HF_KEY_SECRET", "MEDIA_SECRET",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_AUDITED", "TIKTOK_SCOPES", "TOKEN_KEY", "PUBLIC_URL",
  "BLOB_READ_WRITE_TOKEN", "SUPABASE_URL", "SUPABASE_KEY", "TEAM_CODE", "LOGIN_SECRET", "RESEND_API_KEY", "NOTIFY_EMAIL", "NOTIFY_FROM", "SUPABASE_SECRET_KEY"];
const env = () => ({ ...Object.fromEntries(NAMES.map(n => [n, (process.env[n] || "").trim() || undefined])),
  // the scheduler deletes a stored video once it's posted (src/schedule.js)
  deleteBlob: async u => { const { del } = await import("@vercel/blob"); await del(u); } });

export default {
  fetch(request) {
    // the rewrite passes the original path along as ?p=..., so put it back
    const url = new URL(request.url), p = url.searchParams.get("p");
    if (p != null) {
      url.searchParams.delete("p"); url.pathname = "/api/" + p;
      request = new Request(url, { method: request.method, headers: request.headers, body: request.body, duplex: "half" });
    }
    if (url.pathname === "/api/publish/blob" && request.method === "POST") return blobToken(request);
    if (url.pathname === "/api/publish/blob-done" && request.method === "POST") return blobDone(request);
    return worker.fetch(request, env());
  },
};

/* Posting on Vercel: a request can carry at most 4.5 MB, so the browser uploads the exported video straight to
   Vercel Blob (a Blob store with Public access connected to this project, which sets BLOB_READ_WRITE_TOKEN).
   This route hands the browser a short-lived upload token, only to a logged-in user (or with the passcode).
   The video is deleted again once posting is over (blob-done). */
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
function samePass(given) {
  const want = (process.env.SLS_PASSCODE || "").trim();
  if (!want || typeof given !== "string" || given.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
/* who sent this: the logged-in user ({ id }), {} with the passcode when accounts are off, or null */
async function whoIs(given) {
  const e = env();
  if (authConfigured(e)) return await userFrom(e, given || "");
  return samePass(given) ? {} : null;
}
// each user's uploads live under their own folder, so nobody can touch anyone else's
const folder = who => "sls-posts/" + (who && who.id ? who.id + "/" : "");
async function blobToken(request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: "not_configured", message: "Vercel Blob isn't connected to this project yet." }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  try {
    const { handleUpload } = await import("@vercel/blob/client");
    const out = await handleUpload({
      body, request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let pass = ""; try { pass = JSON.parse(clientPayload || "{}").pass; } catch {}
        const who = await whoIs(pass);
        if (!who) throw new Error("Your login has run out. Log in again.");
        if (!pathname.startsWith(folder(who)) || pathname.includes("..")) throw new Error("Wrong upload path.");
        // tokenPayload "": the login token sent along must not travel on inside the upload token
        return { allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: true, tokenPayload: "" };
      },
      onUploadCompleted: async () => {},
    });
    return json(out);
  } catch (err) { return json({ error: "blob_failed", message: (err && err.message) || "The upload couldn't start." }, 400); }
}
async function blobDone(request) {
  const auth = request.headers.get("authorization") || "";
  const who = await whoIs(auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (!who) return json({ error: "unauthorized", message: "Your login has run out. Log in again." }, 401);
  let body; try { body = await request.json(); } catch { body = {}; }
  const url = String(body.url || ""), m = url.match(/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/(sls-posts\/[^?#]*)$/i);
  if (!m || !m[1].startsWith(folder(who))) return json({ ok: false });
  try { const { del } = await import("@vercel/blob"); await del(url); return json({ ok: true }); }
  catch (err) { return json({ ok: false, message: err && err.message }); }
}

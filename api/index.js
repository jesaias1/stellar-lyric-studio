/**
 * Vercel entry for the studio backend. It runs the same code as the Cloudflare Worker (src/worker.js).
 * vercel.json sends every /api/... request here.
 *
 * Set these in the Vercel project (Settings > Environment Variables):
 *   SLS_PASSCODE    the passcode the studio asks for
 *   CF_ACCOUNT_ID   a Cloudflare account ID          } the lyric AI (Whisper) runs on Cloudflare Workers AI,
 *   CF_API_TOKEN    a token with "Workers AI" access  } reached from here over Cloudflare's API
 */
import worker from "../src/worker.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  // the rewrite passes the original path along as ?p=..., so put it back
  const url = new URL(request.url), p = url.searchParams.get("p");
  if (p != null) { url.searchParams.delete("p"); url.pathname = "/api/" + p; request = new Request(url, request); }
  return worker.fetch(request, {
    // trimmed: a value pasted or piped in often carries a stray newline
    SLS_PASSCODE: (process.env.SLS_PASSCODE || "").trim() || undefined,
    CF_ACCOUNT_ID: (process.env.CF_ACCOUNT_ID || "").trim() || undefined,
    CF_API_TOKEN: (process.env.CF_API_TOKEN || "").trim() || undefined,
  });
}

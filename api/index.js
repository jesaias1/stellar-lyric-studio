/**
 * Vercel entry for the studio backend. It runs the same code as the Cloudflare Worker (src/worker.js).
 * vercel.json sends every /api/... request here.
 *
 * Runs on Vercel's Node.js runtime: its Edge runtime crashes on uploads the size of a 30 second audio piece.
 *
 * Set these in the Vercel project (Settings > Environment Variables):
 *   SLS_PASSCODE    the passcode the studio asks for
 *   CF_ACCOUNT_ID   a Cloudflare account ID          } the lyric AI (Whisper) runs on Cloudflare Workers AI,
 *   CF_API_TOKEN    a token with "Workers AI" access  } reached from here over Cloudflare's API
 */
import worker from "../src/worker.js";

// trimmed: a value pasted or piped in often carries a stray newline
const env = () => ({
  SLS_PASSCODE: (process.env.SLS_PASSCODE || "").trim() || undefined,
  CF_ACCOUNT_ID: (process.env.CF_ACCOUNT_ID || "").trim() || undefined,
  CF_API_TOKEN: (process.env.CF_API_TOKEN || "").trim() || undefined,
});

export default {
  fetch(request) {
    // the rewrite passes the original path along as ?p=..., so put it back
    const url = new URL(request.url), p = url.searchParams.get("p");
    if (p != null) {
      url.searchParams.delete("p"); url.pathname = "/api/" + p;
      request = new Request(url, { method: request.method, headers: request.headers, body: request.body, duplex: "half" });
    }
    return worker.fetch(request, env());
  },
};

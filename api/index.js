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
 * Optional:
 *   PIXABAY_KEY     free key from pixabay.com/api/docs  } stock video search
 *   PEXELS_KEY      key from pexels.com/api             }
 *   HF_KEY_ID       Higgsfield API key ID and secret, from console.higgsfield.ai (AI background videos)
 *   HF_KEY_SECRET
 */
import worker from "../src/worker.js";

// trimmed: a value pasted or piped in often carries a stray newline
const NAMES = ["SLS_PASSCODE", "CF_ACCOUNT_ID", "CF_API_TOKEN", "PIXABAY_KEY", "PEXELS_KEY", "HF_KEY_ID", "HF_KEY_SECRET", "MEDIA_SECRET"];
const env = () => Object.fromEntries(NAMES.map(n => [n, (process.env[n] || "").trim() || undefined]));

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

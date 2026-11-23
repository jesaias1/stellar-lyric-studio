/**
 * Local development entry (npm run dev). It wraps the real Worker and, when no lyric AI is reachable,
 * answers /api/transcribe from a canned Whisper result so the whole app can be exercised offline.
 * The sample is a real Whisper reply for a 20 second spoken clip (dev/whisper-sample.json).
 */
import worker from "../src/worker.js";
import sample from "./whisper-sample.json";

/* Stand-ins for Pixabay and Higgsfield when their keys aren't in .dev.vars, so the footage panel can be tried
   locally. They hand back a real free video file (Pexels CDN), so downloading and importing is exercised too. */
const SAMPLE_VIDEO = "https://videos.pexels.com/video-files/3195394/3195394-uhd_2560_1440_25fps.mp4";
const realFetch = globalThis.fetch, hfPolls = new Map();
async function fakeFetch(input, init) {
  const u = String(input && input.url || input);
  const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
  if (u.startsWith("https://pixabay.com/api/videos/")) {
    const q = new URL(u).searchParams.get("q") || "clip";
    return j({ total: 3, totalHits: 3, hits: [1, 2, 3].map(n => ({ id: 1000 + n, pageURL: "https://pixabay.com/videos/", tags: `${q}, sample ${n}`, duration: 12 + n, user: "Sample creator",
      videos: { medium: { url: SAMPLE_VIDEO, width: 2560, height: 1440, size: 4802869, thumbnail: "https://images.pexels.com/videos/3195394/free-video-3195394.jpg?w=320" }, tiny: { url: SAMPLE_VIDEO, width: 2560, height: 1440, size: 4802869 } } })) });
  }
  if (u.startsWith("https://api.higgsfield.ai/estimate/")) return j({ usd: "0.35" });
  if (u.startsWith("https://api.higgsfield.ai/requests/")) {
    const id = u.split("/")[4], n = (hfPolls.get(id) || 0) + 1; hfPolls.set(id, n);
    return j(n < 2 ? { status: "in_progress", request_id: id } : { status: "completed", request_id: id, video: { url: SAMPLE_VIDEO } });
  }
  if (u.startsWith("https://api.higgsfield.ai/")) return j({ status: "queued", request_id: crypto.randomUUID() });
  return realFetch(input, init);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.PIXABAY_KEY && !env.PEXELS_KEY && !env.HF_KEY_ID) { env = { ...env, PIXABAY_KEY: "dev-sample", HF_KEY_ID: "dev", HF_KEY_SECRET: "dev" }; globalThis.fetch = fakeFetch; }
    const real = env.AI || (env.CF_API_TOKEN && env.CF_ACCOUNT_ID);
    if (real || url.pathname !== "/api/transcribe" || request.method !== "POST") return worker.fetch(request, env, ctx);
    let meta = {};
    try { const b = await request.clone().json(); meta = { at: Number(b.at) || 0, len: Number(b.len) || 30 }; } catch {}
    return worker.fetch(request, { ...env, AI: { run: async () => { await new Promise(r => setTimeout(r, 500 + Math.random() * 600)); return fake(meta.at, meta.len); } } }, ctx);
  },
};

// The part of the sample that falls inside this chunk, with times made relative to the chunk start.
// Every second listening pass mishears two words, so the "unsure" review flow has something to show.
function fake(at, len) {
  const second = Math.round(at) % 28 !== 0;
  const swap = { water: "waiter", river: "reaper" };
  const segments = sample.segments.map(s => {
    const words = s.words.filter(w => w.start >= at - 0.01 && w.start < at + len)
      .map(w => ({ word: second && swap[w.word.trim()] ? " " + swap[w.word.trim()] : w.word, start: +(w.start - at).toFixed(2), end: +(Math.min(w.end, at + len) - at).toFixed(2) }));
    if (!words.length) return null;
    return { ...s, start: words[0].start, end: words[words.length - 1].end, text: words.map(w => w.word).join(""), words, word_count: words.length };
  }).filter(Boolean);
  return { transcription_info: { ...sample.transcription_info, duration: len }, text: segments.map(s => s.text).join("").trim(), segments };
}

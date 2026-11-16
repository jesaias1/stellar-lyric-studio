/**
 * Local development entry (npm run dev). It wraps the real Worker and, when no lyric AI is reachable,
 * answers /api/transcribe from a canned Whisper result so the whole app can be exercised offline.
 * The sample is a real Whisper reply for a 20 second spoken clip (dev/whisper-sample.json).
 */
import worker from "../src/worker.js";
import sample from "./whisper-sample.json";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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

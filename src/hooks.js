/**
 * Which part of a song to post: a second opinion on the lyrics of the best-sounding candidates.
 *
 *   POST /api/hooks   {title, lyrics, parts: [{id, text, repeats}]}  ->  {scores: [{id, score, why}], ai}
 *
 * The browser finds candidate clips from the audio (repetition, energy, where the vocal comes in) and sends the
 * lyrics of each. An AI reads them the way a social media lead at a label would: is this a line people would
 * lip-sync, caption or build a trend on? score is 0 to 10, why is a few words for the card.
 * Without the AI (or when it fails) the answer is {scores: [], ai: false} and the studio uses the audio alone.
 */

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM = `You are the social media lead at a record label. You choose which 10 to 30 second part of a song to post as a TikTok or Instagram Reels sound.
What works there:
- the hook or a line people sing along to, often repeated
- a quotable or relatable line people can lip-sync, put a caption over or use for a "POV" or trend video
- clear emotion or attitude that lands without the rest of the song
- simple, catchy wording; not a long story line that needs context
- counting, call-and-response, names, a question or a punchline are a plus
You get candidate clips (their lyrics) from one song. Rate each from 0 to 10 for how likely it is to work as a sound, comparing them with each other, so use the full range. Write the reason in English, at most 10 words, about the lyrics (for example: "Relatable breakup line, made for POV captions"). The lyrics can be in any language.
Answer with a JSON array and nothing else: [{"id": "...", "score": 0-10, "why": "..."}]`;

export async function hooksRoute(request, env, path, method, { hasAI, runModel, json }) {
  if (path !== "/api/hooks" || method !== "POST") return null;
  let b; try { b = await request.json(); } catch { return json({ error: "bad_request", message: "Send JSON." }, 400); }
  const parts = (Array.isArray(b && b.parts) ? b.parts : []).slice(0, 10)
    .map(p => ({ id: String(p && p.id || "").slice(0, 12), text: String(p && p.text || "").replace(/\s+/g, " ").trim().slice(0, 500), repeats: Math.max(0, Math.min(20, +(p && p.repeats) || 0)) }))
    .filter(p => p.id && p.text);
  if (!parts.length) return json({ scores: [], ai: false });
  if (!hasAI) return json({ scores: [], ai: false });
  const title = String(b.title || "").slice(0, 120), lyrics = String(b.lyrics || "").slice(0, 3500);
  const user = (title ? `Song: ${title}\n\n` : "") + (lyrics ? `All the lyrics, for context:\n${lyrics}\n\n` : "")
    + "Candidate clips:\n" + parts.map(p => `id ${p.id}${p.repeats > 1 ? ` (these lines come back ${p.repeats} times in the song)` : ""}: "${p.text}"`).join("\n");
  try {
    const out = await runModel(env, MODEL, { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], max_tokens: 700, temperature: 0.2 });
    const resp = out && (out.response ?? out.result?.response ?? out);
    let arr = Array.isArray(resp) ? resp : null;
    if (!arr) { const text = typeof resp === "string" ? resp : JSON.stringify(resp); arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)); }
    const ids = new Set(parts.map(p => p.id));
    const scores = arr.map(x => ({ id: String(x && x.id || ""), score: Math.max(0, Math.min(10, +(x && x.score))), why: String(x && x.why || "").replace(/\s+/g, " ").trim().slice(0, 90) }))
      .filter(x => ids.has(x.id) && Number.isFinite(x.score));
    return json({ scores, ai: scores.length > 0 });
  } catch (err) {
    console.error("hook rating failed:", String(err && err.message || err));
    return json({ scores: [], ai: false });
  }
}

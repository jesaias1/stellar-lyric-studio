/**
 * A post text for a lyric video, written by an AI only when someone asks for it ("Write a caption").
 *
 *   POST /api/caption  {platform, title, artist, lyrics, language}  ->  {caption, hashtags: [...]}
 *
 * Short, in the artist's voice, in the language of the lyrics (or English), with a few hashtags that fit the
 * platform. Nothing is posted: the text goes into the caption box, where it can be changed.
 */

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LIMITS = { tiktok: 2200, instagram: 2200, youtube: 5000 };

export async function captionRoute(request, env, path, method, { hasAI, runModel, json }) {
  if (path !== "/api/caption" || method !== "POST") return null;
  let b; try { b = await request.json(); } catch { b = {}; }
  const platform = ["tiktok", "instagram", "youtube"].includes(b.platform) ? b.platform : "tiktok";
  const title = String(b.title || "").replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 120), artist = String(b.artist || "").slice(0, 80);
  const lyrics = String(b.lyrics || "").replace(/\s+/g, " ").slice(0, 1200), language = String(b.language || "").slice(0, 8);
  if (!hasAI) return json({ error: "no_ai", message: "The AI isn't connected, so the caption can't be written." }, 503);
  const where = { tiktok: "TikTok", instagram: "an Instagram Reel", youtube: "YouTube Shorts" }[platform];
  const sys = `You write the post text for a short lyric video an artist posts on ${where}. Write like the artist talking to their fans: short, warm or bold to match the lyrics, no corporate tone, no "check out", no quotation marks around the whole thing, at most one or two emojis. 1 to 3 short lines; you may quote a few words of the lyrics. Write in ${language && language !== "en" ? `the same language as the lyrics (language code "${language}")` : "the language of the lyrics (English if unsure)"}. Then 3 to 6 hashtags that fit ${where} and the song (no spaces, no # sign, mix one or two broad ones like lyrics or newmusic with specific ones). Answer with JSON only: {"caption": "...", "hashtags": ["...", "..."]}`;
  const user = (title ? `Song: ${title}\n` : "") + (artist ? `Artist: ${artist}\n` : "") + (lyrics ? `Lyrics in the video: ${lyrics}` : "No lyrics given.");
  try {
    const out = await runModel(env, MODEL, { messages: [{ role: "system", content: sys }, { role: "user", content: user }], max_tokens: 400, temperature: 0.8 });
    const resp = out && (out.response ?? out.result?.response ?? out);
    let d = resp && typeof resp === "object" && !Array.isArray(resp) ? resp : null;
    if (!d) { const t = typeof resp === "string" ? resp : JSON.stringify(resp); d = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); }
    const caption = String(d.caption || "").trim().replace(/^"|"$/g, "").slice(0, LIMITS[platform] - 200);
    const hashtags = (Array.isArray(d.hashtags) ? d.hashtags : []).map(h => String(h).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean).slice(0, 8);
    if (!caption) throw new Error("empty");
    return json({ caption, hashtags });
  } catch (err) {
    console.error("caption failed:", String(err && err.message || err));
    return json({ error: "ai_failed", message: "The caption couldn't be written right now. Try again." }, 502);
  }
}

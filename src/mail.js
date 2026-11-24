/**
 * Emails to the studio's owner (NOTIFY_EMAIL, default linas@stellarmusic.dk) through Resend: a new account, a
 * scheduled post that went live or didn't. Only when RESEND_API_KEY is set; a failure here never stops anything.
 * Without a verified domain Resend sends from onboarding@resend.dev, and only to the address the Resend account
 * was made with, so make that account with the address that should get the emails.
 */
export async function sendMail(env, subject, text) {
  if (!env.RESEND_API_KEY) return false;
  const to = env.NOTIFY_EMAIL || "linas@stellarmusic.dk", from = env.NOTIFY_FROM || "Stellar Lyric Studio <onboarding@resend.dev>";
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", signal: ctl.signal, headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: String(subject).slice(0, 200), text }) });
    if (!r.ok) console.error("email failed:", r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (err) { console.error("email failed:", String(err && err.message || err)); return false; }
  finally { clearTimeout(timer); }
}
export const copenhagen = d => new Date(d).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen", dateStyle: "medium", timeStyle: "short" });

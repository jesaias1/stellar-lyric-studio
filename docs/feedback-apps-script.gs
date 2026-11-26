/**
 * SLS feedback -> the "Responses" tab of "SLS Feedback Responses (Internal Demo)".
 *
 * Setup (once, by the Sheet's owner):
 *   1. In the Sheet: Extensions > Apps Script. Replace everything in Code.gs with this file and save.
 *   2. Project Settings (the gear) > Script properties > Add: SLS_KEY = a long random password of your own.
 *      Put the same value in Vercel as FEEDBACK_KEY. (It stops anyone else who finds the URL from adding rows.)
 *   3. Deploy > New deployment > type Web app. Execute as: Me. Who has access: Anyone. Deploy, allow access.
 *   4. Copy the Web app URL (ends in /exec) into Vercel as FEEDBACK_URL, then redeploy the site.
 * The web app only adds rows; the Sheet itself stays private to you. The Summary tab updates by itself.
 *
 * Row: Timestamp, Source, Template, Song, SLS version, Ease of use, Video quality, Would use again,
 *      Confusing or hard to find, Broke or didn't work, One thing to add or change, Any other feedback.
 */
function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: "bad_json" }); }
  var key = PropertiesService.getScriptProperties().getProperty("SLS_KEY");
  if (key && d.key !== key) return out({ ok: false, error: "key" });
  // the same submission twice (a double click, a resend) is added once
  var cache = CacheService.getScriptCache(), id = String(d.id || "").slice(0, 64);
  if (id && cache.get("fb:" + id)) return out({ ok: true, again: true });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Responses");
    sheet.appendRow([
      d.at ? new Date(d.at) : new Date(), clean(d.source), clean(d.template), clean(d.song), clean(d.version),
      num(d.ease), num(d.quality), num(d.again),
      clean(d.confusing), clean(d.broke), clean(d.change), clean(d.other)
    ]);
  } finally { lock.releaseLock(); }
  if (id) cache.put("fb:" + id, "1", 21600);
  return out({ ok: true });
}
function doGet() { return out({ ok: true, info: "SLS feedback endpoint" }); }

function num(v) { var n = Number(v); return n >= 0 && n <= 5 && Math.round(n) === n ? n : ""; }
// text as text: a leading = + - @ would make Sheets read it as a formula
function clean(v) { var s = String(v == null ? "" : v).slice(0, 2000); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

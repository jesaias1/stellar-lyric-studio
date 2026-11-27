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

/**
 * Makes the Sheet easy to read: run once from the Apps Script editor (pick tidySheets, press Run).
 * Only changes how things look (widths, wrapping, colours, frozen header). It never changes or removes answers.
 */
function tidySheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var INK = "#1d1b2e", WHITE = "#ffffff", SOFT = "#f4f2fb", LINE = "#d9d5ea";

  var r = ss.getSheetByName("Responses");
  if (r) {
    var rows = r.getMaxRows(), cols = 12;
    r.setFrozenRows(1); r.setFrozenColumns(1);
    var head = r.getRange(1, 1, 1, cols);
    head.setBackground(INK).setFontColor(WHITE).setFontWeight("bold").setFontSize(10)
        .setWrap(true).setVerticalAlignment("middle").setHorizontalAlignment("center");
    r.setRowHeight(1, 48);
    var widths = [150, 120, 140, 180, 110, 95, 95, 95, 320, 320, 320, 320];
    for (var i = 0; i < cols; i++) r.setColumnWidth(i + 1, widths[i]);
    var body = r.getRange(2, 1, rows - 1, cols);
    body.setVerticalAlignment("top").setWrap(true).setFontSize(10);
    r.getRange(2, 1, rows - 1, 1).setNumberFormat("d mmm yyyy, hh:mm");
    r.getRange(2, 6, rows - 1, 3).setHorizontalAlignment("center").setNumberFormat("0");
    r.getRange(2, 2, rows - 1, 4).setHorizontalAlignment("left");
    r.getBandings().forEach(function (b) { b.remove(); });
    r.getRange(1, 1, rows, cols).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
     .setHeaderRowColor(INK).setFirstRowColor(WHITE).setSecondRowColor(SOFT);
    // ratings: red (0) to amber to green (5)
    var ratings = r.getRange(2, 6, rows - 1, 3);
    var rules = r.getConditionalFormatRules().filter(function (x) {
      return !x.getRanges().some(function (g) { return g.getA1Notation() === ratings.getA1Notation(); });
    });
    rules.push(SpreadsheetApp.newConditionalFormatRule().setRanges([ratings])
      .setGradientMinpointWithValue("#f4c7c3", SpreadsheetApp.InterpolationType.NUMBER, "0")
      .setGradientMidpointWithValue("#fce8b2", SpreadsheetApp.InterpolationType.NUMBER, "2.5")
      .setGradientMaxpointWithValue("#b7e1cd", SpreadsheetApp.InterpolationType.NUMBER, "5").build());
    r.setConditionalFormatRules(rules);
  }

  // text tabs: one wide wrapped column, a clear title, section lines in bold
  ["Questions", "Setup for Linas"].forEach(function (name) {
    var s = ss.getSheetByName(name); if (!s) return;
    var last = Math.max(s.getLastRow(), 1);
    s.setColumnWidth(1, 860);
    s.getRange(1, 1, last, 1).setWrap(true).setVerticalAlignment("middle").setFontSize(11);
    s.getRange(1, 1).setFontSize(14).setFontWeight("bold").setFontColor(INK);
    s.setRowHeight(1, 40);
    if (last > 1) s.setRowHeights(2, last - 1, 26);
    var vals = s.getRange(1, 1, last, 1).getValues();
    vals.forEach(function (v, k) {
      if (k > 0 && /:\s*$/.test(String(v[0]))) s.getRange(k + 1, 1).setFontWeight("bold").setBackground(SOFT);
    });
    s.setHiddenGridlines(true);
  });

  var m = ss.getSheetByName("Summary");
  if (m) {
    var n = Math.max(m.getLastRow(), 2);
    m.setFrozenRows(1);
    m.setColumnWidth(1, 280); m.setColumnWidth(2, 120);
    m.getRange(1, 1, 1, 2).setBackground(INK).setFontColor(WHITE).setFontWeight("bold").setVerticalAlignment("middle");
    m.setRowHeight(1, 34);
    m.getRange(2, 1, n - 1, 2).setFontSize(11).setVerticalAlignment("middle");
    if (n > 1) m.setRowHeights(2, n - 1, 28);
    m.getRange(2, 2, n - 1, 1).setHorizontalAlignment("center").setFontWeight("bold");
    m.getRange(3, 2, Math.max(n - 2, 1), 1).setNumberFormat("0.0");
    m.getRange(1, 1, n, 2).setBorder(true, true, true, true, true, true, LINE, SpreadsheetApp.BorderStyle.SOLID);
    m.setHiddenGridlines(true);
  }
}

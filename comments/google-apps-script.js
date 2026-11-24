/**
 * Anonymous comments for Thoithoi's Tales, stored in YOUR Google Sheet.
 *
 * One-time setup (about 5 minutes):
 *  1. Go to https://sheets.new and name the spreadsheet "Story comments".
 *  2. Menu: Extensions -> Apps Script. Delete what's there, paste this whole file, click Save.
 *  3. Click Deploy -> New deployment -> gear icon -> Web app.
 *       Execute as: Me        Who has access: Anyone
 *     Click Deploy and allow access when Google asks.
 *  4. Copy the "Web app URL" (ends in /exec) and paste it into the studio:
 *     Site panel -> "Comments link" -> Save. Then commit + push.
 *
 * Moderating: comments appear as rows in the "Comments" sheet.
 *   - Delete a row to remove a comment.
 *   - Type anything (for example "x") in the "hidden" column to hide it.
 *
 * If you edit this script later, use Deploy -> Manage deployments -> Edit -> New version,
 * so the same link keeps working.
 */

const SHEET_NAME = "Comments";
const MAX_PER_10_MIN = 40; // simple flood protection for the whole site

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["time", "page", "name", "comment", "hidden"]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Stop spreadsheet formulas sneaking in through a comment.
function safe_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function doGet(e) {
  const page = String((e.parameter && e.parameter.page) || "").slice(0, 200);
  const rows = sheet_().getDataRange().getValues().slice(1);
  const comments = rows
    .filter((r) => r[1] === page && !r[4])
    .map((r) => ({ time: new Date(r[0]).toISOString(), name: String(r[2]), text: String(r[3]).replace(/^'/, "") }));
  return json_({ comments: comments });
}

function doPost(e) {
  let data = {};
  try { data = JSON.parse((e.postData && e.postData.contents) || "{}"); } catch (err) { return json_({ ok: false, error: "Bad request" }); }
  if (data.website) return json_({ ok: true }); // hidden field only robots fill in

  const page = String(data.page || "").slice(0, 200);
  const name = String(data.name || "").trim().slice(0, 60) || "Anonymous";
  const text = String(data.text || "").trim().slice(0, 2000);
  if (!/^(book|journal):[a-z0-9-]+$/.test(page) || !text) return json_({ ok: false, error: "Empty comment" });

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get("recent") || 0);
    if (count >= MAX_PER_10_MIN) return json_({ ok: false, error: "Too many comments right now, try again later" });
    cache.put("recent", String(count + 1), 600);
    sheet_().appendRow([new Date(), page, safe_(name), safe_(text), ""]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

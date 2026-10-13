/**
 * MyTalents Tutor Workday - Google Sheets storage service.
 *
 * Bind this script to the Google Sheet that acts as the database, run setup() once,
 * then deploy as a web app (see SETUP.md). The browser talks to it through
 * packages/contract/sheets-db.js; pages never call it directly.
 *
 * Layout of every table tab:
 *   row 1  field names (id, _rev, ...)
 *   row 2  column types (s string, n number, b boolean, j JSON) - hidden
 *   row 3+ records, all cells stored as plain text so Sheets never reinterprets them
 *
 * The _revs tab keeps one revision number per table. A commit names the revisions it
 * read; if any table changed in between, the commit is rejected and the client retries.
 * All requests run under one script lock, so commits are applied one at a time.
 *
 * Demo access control: shared token only. This is NOT real authentication.
 */

var PROTOCOL = 1;
var REVS_TAB = '_revs';
var DRIVE_SUFFIX = '__drive';

function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid());
  if (!props.getProperty('FOLDER_ID')) {
    props.setProperty('FOLDER_ID', DriveApp.createFolder('MyTalents scans (demo)').getId());
  }
  if (!ss.getSheetByName(REVS_TAB)) writeRevs_({});
  Logger.log('Setup done. Token for config.local.json: ' + props.getProperty('TOKEN'));
}

function doGet() {
  return out_({ ok: true, service: 'mytalents-sheets-db', protocol: PROTOCOL });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'BAD_REQUEST', message: 'Body must be JSON' }); }
  if (!req || req.token !== prop_('TOKEN')) return out_({ error: 'UNAUTHORIZED', message: 'Wrong or missing token' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return out_({ error: 'BUSY', message: 'Storage is busy, try again' }); }
  try {
    switch (req.op) {
      case 'snapshot': return out_(snapshot_(req.stores || []));
      case 'revs': return out_({ revs: readRevs_() });
      case 'blobs': return out_({ rows: blobs_(req.store, req.field, req.value) });
      case 'commit': return out_(commit_(req.expect || {}, req.ops || []));
      case 'views': return out_(views_(req.views || []));
      default: return out_({ error: 'UNKNOWN_OP', message: String(req.op) });
    }
  } catch (err) {
    return out_({ error: 'SERVER', message: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- operations ----------

function snapshot_(stores) {
  var rows = {};
  stores.forEach(function (s) { rows[s] = readTable_(s).rows; });
  return { rows: rows, revs: readRevs_() };
}

// Records of `store` whose `field` equals `value`, with Drive file contents attached as base64.
function blobs_(store, field, value) {
  return readTable_(store).rows
    .filter(function (r) { return r[field] === value; })
    .map(function (r) {
      var out = {};
      Object.keys(r).forEach(function (k) {
        if (k.slice(-DRIVE_SUFFIX.length) === DRIVE_SUFFIX) {
          var file = DriveApp.getFileById(r[k]);
          var blob = file.getBlob();
          out[k.slice(0, -DRIVE_SUFFIX.length)] = { __blob: Utilities.base64Encode(blob.getBytes()), type: blob.getContentType() };
        } else {
          out[k] = r[k];
        }
      });
      return out;
    });
}

// expect: { store: rev } read by the client. ops: [{ store, put } | { store, del } | { store, clear: true }]
function commit_(expect, ops) {
  var revs = readRevs_();
  var stores = Object.keys(expect);
  for (var i = 0; i < stores.length; i++) {
    if ((revs[stores[i]] || 0) !== expect[stores[i]]) return { conflict: true, revs: revs };
  }

  // Build every new table in memory first; only write once everything succeeded.
  var tables = {};
  var trash = [];
  var created = [];
  try {
    ops.forEach(function (op) {
      if (!tables[op.store]) tables[op.store] = toMap_(readTable_(op.store).rows);
      var map = tables[op.store];
      if (op.clear) {
        map.forEach(function (r) { trash = trash.concat(driveIds_(r)); });
        map.clear();
      } else if (op.put) {
        if (op.put.id === undefined || op.put.id === null || op.put.id === '') throw new Error('Record without id in ' + op.store);
        var old = map.get(String(op.put.id));
        var rec = storeBlobs_(op.put, created);
        delete rec._rev;
        rec._rev = (old && old._rev ? old._rev : 0) + 1;
        if (old) driveIds_(old).forEach(function (id) { if (driveIds_(rec).indexOf(id) < 0) trash.push(id); });
        map.set(String(rec.id), rec);
      } else if (op.del !== undefined) {
        var gone = map.get(String(op.del));
        if (gone) { trash = trash.concat(driveIds_(gone)); map.delete(String(op.del)); }
      }
    });
  } catch (err) {
    created.forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* best effort */ } });
    throw err;
  }

  Object.keys(tables).forEach(function (s) {
    writeTable_(s, Array.from(tables[s].values()));
    revs[s] = (revs[s] || 0) + 1;
  });
  writeRevs_(revs);
  trash.forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ } });
  return { ok: true, revs: revs };
}

// ---------- read-only views (Exhibits 1-3, today's lessons) ----------
// The browser builds these with the app's own derive functions and sends them after each change.
// They are for people looking at the Sheet; the app never reads them back. Only "View - " tabs can be written.

var VIEW_PREFIX = 'View - ';

function views_(views) {
  var ss = ss_();
  views.forEach(function (v) {
    var title = String((v && v.title) || '');
    if (title.indexOf(VIEW_PREFIX) !== 0) throw new Error('View titles must start with "' + VIEW_PREFIX + '"');
    var rows = v.rows || [];
    if (!rows.length) return;
    var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
    var fill = function (r, blank) { var out = r.slice(); while (out.length < width) out.push(blank); return out; };
    var grid = rows.map(function (r) { return fill(r.map(function (c) { return c === null || c === undefined ? '' : String(c); }), ''); });
    var sh = ss.getSheetByName(title) || ss.insertSheet(title);
    sh.clear();
    var range = sh.getRange(1, 1, grid.length, width);
    range.setNumberFormat('@');
    range.setValues(grid);
    if (v.colors) range.setBackgrounds(rows.map(function (r, i) { return fill((v.colors[i] || []).slice(0, width), null); }));
    sh.getRange(1, 1, 1, width).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  return { ok: true, views: views.length };
}

// ---------- tables ----------

function readTable_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) return { fields: [], rows: [] };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { fields: values[0] ? values[0].map(String) : [], rows: [] };
  var fields = values[0].map(String);
  var types = values[1].map(String);
  var rows = [];
  for (var r = 2; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var rec = {};
    for (var c = 0; c < fields.length; c++) {
      if (!fields[c]) continue;
      var v = decode_(row[c], types[c]);
      if (v !== undefined) rec[fields[c]] = v;
    }
    rows.push(rec);
  }
  return { fields: fields, rows: rows };
}

function writeTable_(name, rows) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  var isNew = !sh;
  if (isNew) sh = ss.insertSheet(name);
  var existing = isNew ? [] : readTable_(name).fields.filter(String);
  var fields = ['id', '_rev'];
  existing.forEach(function (f) { if (fields.indexOf(f) < 0) fields.push(f); });
  rows.forEach(function (r) { Object.keys(r).forEach(function (f) { if (fields.indexOf(f) < 0) fields.push(f); }); });
  var types = fields.map(function (f) { return inferType_(rows.map(function (r) { return r[f]; })); });
  var grid = [fields, types].concat(rows.map(function (r) {
    return fields.map(function (f, i) { return encode_(r[f], types[i]); });
  }));
  sh.clearContents();
  var range = sh.getRange(1, 1, grid.length, fields.length);
  range.setNumberFormat('@');
  range.setValues(grid);
  if (isNew) { sh.setFrozenRows(1); sh.hideRows(2); sh.getRange(1, 1, 1, fields.length).setFontWeight('bold'); }
}

function readRevs_() {
  var sh = ss_().getSheetByName(REVS_TAB);
  var revs = {};
  if (!sh) return revs;
  sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) revs[String(r[0])] = Number(r[1]) || 0; });
  return revs;
}

function writeRevs_(revs) {
  var ss = ss_();
  var sh = ss.getSheetByName(REVS_TAB) || ss.insertSheet(REVS_TAB);
  var grid = [['table', 'rev']].concat(Object.keys(revs).sort().map(function (k) { return [k, String(revs[k])]; }));
  sh.clearContents();
  var range = sh.getRange(1, 1, grid.length, 2);
  range.setNumberFormat('@');
  range.setValues(grid);
}

// ---------- values ----------

function inferType_(values) {
  var seen = {};
  values.forEach(function (v) {
    if (v === undefined || v === null) return;
    if (typeof v === 'number') seen.n = true;
    else if (typeof v === 'boolean') seen.b = true;
    else if (typeof v === 'string') { if (v.charAt(0) === '=') seen.j = true; else seen.s = true; }
    else seen.j = true;
  });
  var kinds = Object.keys(seen);
  if (kinds.length === 1) return kinds[0];
  return kinds.length === 0 ? 's' : 'j';
}

function encode_(v, type) {
  if (v === undefined || v === null) return '';
  if (type === 'j') return JSON.stringify(v);
  if (type === 'b') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function decode_(cell, type) {
  if (cell === '' || cell === null || cell === undefined) return undefined;
  var s = String(cell);
  if (type === 'n') return Number(s);
  if (type === 'b') return s === 'TRUE' || s === 'true';
  if (type === 'j') { try { return JSON.parse(s); } catch (e) { return s; } }
  return s;
}

// ---------- Drive files ----------

// Fields holding { __blob: base64, type } are saved to Drive and replaced by <field>__drive = fileId.
function storeBlobs_(record, created) {
  var out = {};
  Object.keys(record).forEach(function (k) {
    var v = record[k];
    if (v && typeof v === 'object' && typeof v.__blob === 'string') {
      var bytes = Utilities.base64Decode(v.__blob);
      var name = String(record.name || record.id || 'file');
      var file = DriveApp.getFolderById(prop_('FOLDER_ID')).createFile(Utilities.newBlob(bytes, v.type || 'application/octet-stream', name));
      created.push(file.getId());
      out[k + DRIVE_SUFFIX] = file.getId();
    } else {
      out[k] = v;
    }
  });
  return out;
}

function driveIds_(record) {
  return Object.keys(record).filter(function (k) { return k.slice(-DRIVE_SUFFIX.length) === DRIVE_SUFFIX; })
    .map(function (k) { return record[k]; });
}

// ---------- helpers ----------

function toMap_(rows) {
  var m = new Map();
  rows.forEach(function (r) { m.set(String(r.id), r); });
  return m;
}

function ss_() { return SpreadsheetApp.openById(prop_('SPREADSHEET_ID')); }

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

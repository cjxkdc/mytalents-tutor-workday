// In-memory stand-ins for the Apps Script services Code.gs uses (SpreadsheetApp, DriveApp, ...).
// Dev and testing only: runs the real Code.gs in the browser so the Sheets path can be checked
// without deploying. Open any page with ?storage=sim to use it (data lives in memory only).

class FakeSheet {
  constructor(name) { this.name = name; this.cells = []; this.hidden = new Set(); }
  getDataRange() {
    const width = Math.max(1, ...this.cells.map(r => r.length));
    const rows = this.cells.length ? this.cells : [[]];
    return { getValues: () => rows.map(r => Array.from({ length: width }, (_, i) => (r[i] === undefined ? '' : r[i]))) };
  }
  clearContents() { this.cells = []; }
  clear() { this.cells = []; this.backgrounds = []; }
  getRange(row, col, nRows, nCols) {
    const sheet = this;
    return {
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
      setBackgrounds(grid) {
        if (grid.length !== nRows || grid.some(r => r.length !== nCols)) throw new Error('setBackgrounds: grid size does not match range');
        sheet.backgrounds = sheet.backgrounds || [];
        grid.forEach((r, i) => { sheet.backgrounds[row - 1 + i] = r.slice(); });
        return this;
      },
      setValues(grid) {
        if (grid.length !== nRows || grid.some(r => r.length !== nCols)) throw new Error('setValues: grid size does not match range');
        grid.forEach((r, i) => {
          const target = (sheet.cells[row - 1 + i] = sheet.cells[row - 1 + i] || []);
          r.forEach((v, j) => { target[col - 1 + j] = String(v); }); // plain-text format: Sheets keeps strings
        });
        return this;
      },
    };
  }
  setFrozenRows() {}
  hideRows(r) { this.hidden.add(r); }
}

function fakeServices() {
  const sheets = new Map();
  const props = new Map();
  const files = new Map();
  let nextId = 1;
  const spreadsheet = {
    getId: () => 'sim-spreadsheet',
    getSheetByName: n => sheets.get(n) || null,
    insertSheet: n => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
  };
  const blob = (bytes, type, name) => ({ getBytes: () => bytes, getContentType: () => type, getName: () => name });
  const fileOf = b => {
    const id = `file-${nextId++}`;
    const f = { id, blob: b, trashed: false, getId: () => id, getBlob: () => f.blob, setTrashed: v => { f.trashed = v; } };
    files.set(id, f);
    return f;
  };
  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: {
      createFolder: () => ({ getId: () => 'sim-folder' }),
      getFolderById: () => ({ createFile: b => fileOf(b) }),
      getFileById: id => { const f = files.get(id); if (!f) throw new Error('No file ' + id); return f; },
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b & 255); return btoa(s); },
      base64Decode: str => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
      newBlob: blob,
    },
    ContentService: { createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }), MimeType: { JSON: 'json' } },
    Logger: { log: (...a) => console.log('[Code.gs]', ...a) },
  };
  return { services, inspect: { sheets, props, files } };
}

export async function createSimServer() {
  const { services, inspect } = fakeServices();
  const src = await (await fetch(new URL('../Code.gs', import.meta.url), { cache: 'no-store' })).text();
  const names = Object.keys(services);
  const server = new Function(...names, `${src}\nreturn { setup, doGet, doPost };`)(...names.map(n => services[n]));
  server.setup();
  const token = inspect.props.get('TOKEN');
  const transport = async payload => {
    await new Promise(r => setTimeout(r, 5)); // let concurrent requests interleave like real network calls
    return JSON.parse(server.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
  };
  return { server, token, transport, inspect };
}

// Google Sheets storage adapter. Same interface as db.js (IndexedDB): STORES, get, getAll, transact.
// Talks to the Apps Script web app in backend/google-apps-script/Code.gs.
//
// transact() uses optimistic concurrency: it reads a fresh snapshot of the named tables, runs the
// business logic locally against that snapshot, then sends the writes together with the table
// revisions it read. If another tab or device changed one of those tables in between, the server
// rejects the commit and the whole transaction is re-run on fresh data.

import { STORES } from './db.js';

const clone = v => (v === undefined ? undefined : structuredClone(v));

export function create({ url, token, transport, pollMs = 15000, cacheMs = 4000, maxRetries = 4 }) {
  if (!transport && !url) throw new Error('Sheets storage needs a web app url');

  const send = transport || (async payload => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`Sheets service HTTP ${res.status}`);
    return res.json();
  });

  async function post(op, body = {}) {
    const data = await send({ op, token, ...body });
    if (data && data.error) {
      const e = new Error(`Sheets service: ${data.message || data.error}`);
      e.code = data.error === 'UNAUTHORIZED' ? 'FORBIDDEN' : 'STORAGE';
      throw e;
    }
    return data;
  }

  // ---------- cached snapshot for plain reads ----------
  let cache = null;      // { at, rows, revs }
  let inflight = null;
  let lastRevs = null;

  async function snapshot(fresh = false) {
    if (!fresh && cache && Date.now() - cache.at < cacheMs) return cache;
    if (!fresh && inflight) return inflight;
    const p = post('snapshot', { stores: STORES }).then(d => {
      const snap = { at: Date.now(), rows: d.rows, revs: d.revs };
      cache = snap; lastRevs = JSON.stringify(d.revs);
      return snap;
    });
    if (!fresh) {
      inflight = p;
      // Clear the shared request when it settles; callers handle the error through `p` itself.
      p.then(() => {}, () => {}).finally(() => { if (inflight === p) inflight = null; });
    }
    return p;
  }

  const hasDriveField = r => Object.keys(r).some(k => k.endsWith('__drive'));
  const fromWire = r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v && typeof v === 'object' && typeof v.__blob === 'string' ? base64ToBlob(v.__blob, v.type) : v;
    }
    return out;
  };

  async function get(store, id) {
    const snap = await snapshot();
    return clone((snap.rows[store] || []).find(r => r.id === id));
  }

  async function getAll(store, index, key) {
    const snap = await snapshot();
    let rows = snap.rows[store] || [];
    if (index) rows = rows.filter(r => r[index] === key);
    // Records with files stored in Drive (e.g. scan pages): fetch the contents.
    if (index && rows.some(hasDriveField)) {
      const d = await post('blobs', { store, field: index, value: key });
      return d.rows.map(fromWire);
    }
    return clone(rows);
  }

  async function transact(names, fn) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const snap = await snapshot(true);
      const maps = {};
      for (const s of names) maps[s] = new Map((snap.rows[s] || []).map(r => [r.id, structuredClone(r)]));
      const ops = [];
      const need = s => { if (!maps[s]) throw new Error(`Table ${s} is not part of this transaction`); return maps[s]; };
      const t = {
        get: async (s, id) => clone(need(s).get(id)),
        getAll: async (s, index, key) => [...need(s).values()].filter(r => !index || r[index] === key).map(clone),
        put: async (s, v) => { need(s).set(v.id, clone(v)); ops.push({ store: s, put: v }); },
        del: async (s, id) => { need(s).delete(id); ops.push({ store: s, del: id }); },
        clear: async s => { need(s).clear(); ops.push({ store: s, clear: true }); },
      };
      const out = await fn(t); // business errors propagate; nothing is sent
      if (!ops.length) return out;

      const expect = Object.fromEntries(names.map(s => [s, snap.revs[s] || 0]));
      const res = await post('commit', { expect, ops: await Promise.all(ops.map(toWire)) });
      if (res.conflict) { await new Promise(r => setTimeout(r, 150 * (attempt + 1))); continue; }
      cache = null;
      lastRevs = JSON.stringify(res.revs);
      return out;
    }
    const e = new Error('Someone else changed the same records. Refresh and try again.');
    e.code = 'CONFLICT';
    throw e;
  }

  // ---------- changes made on other devices: poll table revisions ----------
  const remoteListeners = new Set();
  let timer = null;
  function onRemoteChange(fn) {
    remoteListeners.add(fn);
    if (!timer && pollMs > 0) {
      timer = setInterval(async () => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        try {
          const { revs } = await post('revs');
          const now = JSON.stringify(revs);
          if (lastRevs !== null && now !== lastRevs) { cache = null; remoteListeners.forEach(f => f()); }
          lastRevs = now;
        } catch { /* offline or service busy: try again next tick */ }
      }, pollMs);
    }
    return () => remoteListeners.delete(fn);
  }

  return { kind: 'sheets', label: 'Google Sheets', autoReseed: false, STORES, get, getAll, transact, onRemoteChange };
}

// ---------- wire format for files ----------

async function toWire(op) {
  if (!op.put) return op;
  const put = {};
  for (const [k, v] of Object.entries(op.put)) {
    put[k] = v instanceof Blob ? { __blob: await blobToBase64(v), type: v.type || 'application/octet-stream' } : v;
  }
  return { store: op.store, put };
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/octet-stream' });
}

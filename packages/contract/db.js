// Minimal IndexedDB wrapper for demo mode. One object store per fact table.
// Business rules that read-then-write use transact(), so the check and the write happen in one
// readwrite transaction and a second tab sees the first tab's committed result.

const DB_NAME = 'tutor-workday-demo';
const DB_VERSION = 2;
export const STORES = ['meta', 'results', 'submissions', 'pages', 'corrections', 'examRecords', 'audit', 'lessonChanges', 'attendance'];

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (name === 'results') store.createIndex('studentId', 'studentId');
        if (name === 'pages') store.createIndex('submissionId', 'submissionId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app (e.g. after a pull that adds stores) is upgrading in another tab:
      // let it through instead of leaving it hanging. This tab reopens on its next request.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Database is open in another tab with an older version. Close other tabs and retry.')); };
  });
  return dbPromise;
}

export const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function getAll(store, index, key) {
  const db = await openDb();
  const s = db.transaction(store).objectStore(store);
  return request(index ? s.index(index).getAll(key) : s.getAll());
}

export async function get(store, id) {
  const db = await openDb();
  return request(db.transaction(store).objectStore(store).get(id));
}

// Run `fn(t)` inside one readwrite transaction over `names`.
// t.get / t.getAll / t.put / t.del only await IndexedDB requests, which keeps the transaction alive.
// Anything thrown inside fn aborts the transaction, so nothing is written.
export async function transact(names, fn) {
  const db = await openDb();
  const tx = db.transaction(names, 'readwrite');
  const finished = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
  const t = {
    get: (store, id) => request(tx.objectStore(store).get(id)),
    getAll: (store, index, key) => { const s = tx.objectStore(store); return request(index ? s.index(index).getAll(key) : s.getAll()); },
    put: (store, value) => request(tx.objectStore(store).put(value)),
    del: (store, id) => request(tx.objectStore(store).delete(id)),
    clear: store => request(tx.objectStore(store).clear()),
  };
  let out;
  try {
    out = await fn(t);
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    finished.catch(() => {});
    throw e;
  }
  await finished;
  return out;
}

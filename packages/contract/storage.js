// Chooses where the API stores facts.
//   - Default: IndexedDB in this browser (offline demo, nothing to set up).
//   - Google Sheets: create packages/contract/config.local.json (gitignored), see config.example.json:
//       { "backend": "sheets", "url": "<Apps Script web app URL>", "token": "<token from setup()>" }
// For a one-off check, ?storage=indexeddb in the page URL forces the local mode.
// Developers: ?storage=sim runs the real Apps Script code against an in-memory spreadsheet (no Google
// account needed; data is lost on reload). See backend/google-apps-script/sim/.

import * as idb from './db.js';

async function readConfig() {
  const forced = new URLSearchParams(location.search).get('storage');
  if (forced === 'indexeddb' || forced === 'sim') return { backend: forced };
  try {
    const res = await fetch(new URL('./config.local.json', import.meta.url), { cache: 'no-store' });
    if (res.ok) return { backend: 'indexeddb', ...(await res.json()) };
  } catch { /* no local config: stay on IndexedDB */ }
  return { backend: 'indexeddb' };
}

export const config = await readConfig();

async function createDb() {
  if (config.backend === 'sheets') return (await import('./sheets-db.js')).create(config);
  if (config.backend === 'sim') {
    const { createSimServer } = await import('../../backend/google-apps-script/sim/fake-google.js');
    const sim = await createSimServer();
    const adapter = (await import('./sheets-db.js')).create({ transport: sim.transport, token: sim.token, pollMs: 0 });
    return { ...adapter, kind: 'sheets', label: 'simulated Google Sheet (memory only)', sim };
  }
  return { kind: 'indexeddb', label: 'this browser', ...idb };
}

export const db = await createDb();

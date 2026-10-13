// Scenario tests for the Google Sheets storage path: API -> sheets-db.js -> Code.gs -> fake Sheets/Drive.
import { createMockApi, demoUsers, storage } from '../../../packages/contract/mock-api.js';
import { db } from '../../../packages/contract/storage.js';
import { create as createSheetsDb } from '../../../packages/contract/sheets-db.js';

const list = document.getElementById('results');
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.textContent = name + (detail ? ` - ${detail}` : '');
  list.append(li);
  ok ? passed++ : failed++;
}
const code = p => p.then(() => 'ok', e => e.code || e.message);
const settle = () => new Promise(r => setTimeout(r, 1300)); // view tabs refresh 800 ms after a write
const cell = (tab, row, col) => sheets.get(tab)?.cells[row]?.[col];

if (storage.kind !== 'sheets' || !db.sim) {
  document.getElementById('summary').textContent = 'Open this page with ?storage=sim';
  throw new Error('not in sim mode');
}

const tutor = createMockApi(demoUsers.staff[0]);
const manager = createMockApi(demoUsers.staff[1]);
const amy = createMockApi(demoUsers.students[0]);
const chloe = createMockApi(demoUsers.students[2]);
const sheets = db.sim.inspect.sheets;
const files = db.sim.inspect.files;
const img = (text = 'x') => [{ blob: new Blob([text], { type: 'image/jpeg' }), name: 'p.jpg', type: 'image/jpeg' }];
const allDone = () => [2, 2, 3, 3, 4, 4].map((m, i) => ({ qNo: i + 1, outcome: 'DONE', score: m }));

try {
  // 1. First use seeds the sheet
  const subs = await tutor.listSubmissions();
  check('seed: submissions readable through Sheets', subs.length === 3, `${subs.length} rows`);
  check('seed: results tab created with typed header rows', sheets.get('results')?.cells[0][0] === 'id' && sheets.get('results').hidden.has(2));
  const ex = await tutor.getExhibits();
  const amyM1 = ex.stats.find(s => s.studentId === 's01').tests['T-M1'];
  check('derived Exhibit 3 from Sheets data', amyM1?.score === 15 && amyM1.pct === 83, JSON.stringify(amyM1 && { score: amyM1.score, pct: amyM1.pct }));

  // 2. Upload with a scan page: file goes to Drive, comes back as a Blob
  const sub = await amy.submitTest({ testId: 'T-M3', suggestedAttempt: 2, files: img('scan-bytes-123') });
  const pageRow = sheets.get('pages').cells[2];
  const header = sheets.get('pages').cells[0];
  check('page stored in Drive, sheet keeps only the file id', header.includes('blob__drive') && !header.includes('blob') && files.size === 1);
  const detail = await tutor.getSubmission(sub.id);
  const text = await detail.pages[0].blob.text();
  check('scan page round-trips as a Blob', text === 'scan-bytes-123', text);

  // 3. Marking writes results; numbers stay numbers
  await tutor.confirmMarking(sub.id, { attempt: 2, items: allDone() });
  const mine = (await amy.listMySubmissions()).find(s => s.id === sub.id);
  check('confirm marking updates submission', mine.status === 'marked' && mine.attempt === 2 && typeof mine.attempt === 'number');

  // 3b. View tabs: Exhibits 1-3 and today's lessons, refreshed after the write
  await settle();
  const viewTabs = [...sheets.keys()].filter(k => k.startsWith('View - '));
  check('view tabs written', viewTabs.length === 4, viewTabs.join(', '));
  const e3 = sheets.get('View - Exhibit 3 Exam stats');
  const amyRow = e3?.cells.find(r => r[0] === 'Amy Chen');
  const m3col = e3?.cells[0].indexOf('Module 3 Test');
  check('Exhibit 3 tab shows the new marking', amyRow?.[m3col] === '100% (18/18, attempt 2)', amyRow?.[m3col]);
  check('Exhibit 3 tab is colour-coded by band', e3?.backgrounds?.[e3.cells.indexOf(amyRow)]?.[m3col] === '#e7f6ec');
  const e1 = sheets.get('View - Exhibit 1 Marking');
  check('Exhibit 1 tab has a row per attempt plus header and note', e1?.cells.length === 10 + 1 + 2, `${e1?.cells.length} rows`);
  const tl = [...sheets.keys()].find(k => k.startsWith('View - Timetable'));
  check("today's timetable tab lists today's lessons", sheets.get(tl)?.cells.length === 6 + 2, `${sheets.get(tl)?.cells.length} rows`);
  check('timetable facts stored in their own tabs', cell('lessonChanges', 0, 0) === 'id' && sheets.get('lessonChanges').cells.length === 2 + 3);
  check('views op cannot overwrite fact tabs', await code(db.writeViews([{ title: 'results', rows: [['x']] }])) === 'STORAGE');
  await tutor.markAttendance('L01|2026-10-13', '2026-10-13', 'present');
  await settle();
  check('attendance shows in the timetable tab', sheets.get(tl).cells.some(r => r[1] === 'Amy Chen' && r[6] === 'Present'));

  // 4. Two staff confirm the same submission at once: one wins, the other sees the new state after retry
  const s2 = await amy.submitTest({ testId: 'T-M1', suggestedAttempt: 2, files: img() });
  const race = await Promise.all([
    code(tutor.confirmMarking(s2.id, { attempt: 2, items: allDone() })),
    code(manager.confirmMarking(s2.id, { attempt: 2, items: allDone() })),
  ]);
  check('concurrent confirm: exactly one succeeds', race.filter(r => r === 'ok').length === 1 && race.includes('INVALID_STATE'), race.join(', '));

  // 5. Business validation still applies
  check('validation errors unchanged', await code(tutor.confirmMarking((await amy.submitTest({ testId: 'T-M1', files: img() })).id, { attempt: 3, items: [] })) === 'VALIDATION');
  check('student cannot spoof another student', await code(amy.submitCorrection('s03|T-M1|1|1', 'x', 'seed')) === 'NOT_FOUND');

  // 6. Correction versions survive the round trip
  const mid = 's01|T-M2|1|3';
  const m = (await amy.getMyMistakes()).find(x => x.id === mid);
  await amy.submitCorrection(mid, 'fixed the sign', m.resultVersion);
  const c = (await tutor.listCorrections()).find(x => x.id === mid);
  check('stale correction version rejected', await code(tutor.reviewCorrection(mid, { accept: true, version: 'old' })) === 'CONFLICT');
  check('current correction version accepted', await code(tutor.reviewCorrection(mid, { accept: true, version: c.version })) === 'ok');

  // 7. Strings that look like formulas or dates are stored verbatim
  await chloe.addExamRecord({ date: '2026-10-01', paper: '=SUM(A1:A9) paper', start: '16:00', endFirst: '16:30', endSecond: '16:40', checks: 1, score: 5, outOf: 10 });
  const rec = (await chloe.listMyExamRecords()).find(r => r.paper.startsWith('='));
  check('formula-like and date strings stay text', rec?.paper === '=SUM(A1:A9) paper' && rec.date === '2026-10-01' && rec.start === '16:00');

  // 8. Wrong token is refused
  const intruder = createSheetsDb({ transport: db.sim.transport, token: 'wrong', pollMs: 0 });
  check('wrong token refused', await code(intruder.getAll('results')) === 'FORBIDDEN');

  // 9. Reset rewrites the sheet and trashes stored scan files
  await tutor.resetDemo();
  check('reset: back to seed data', (await tutor.listSubmissions()).length === 3);
  check('reset: old scan files trashed', [...files.values()].every(f => f.trashed));

  const rows = sheets.get('results').cells.slice(0, 5).map(r => r.join(' | ')).join('\n');
  document.getElementById('sheet').textContent = rows;
} catch (e) {
  check('unexpected error', false, `${e.code || ''} ${e.message}`);
  console.error(e);
}
document.getElementById('summary').textContent = `${passed} passed, ${failed} failed`;
window.__testSummary = { passed, failed };

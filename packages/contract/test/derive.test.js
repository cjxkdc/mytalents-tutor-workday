// Rules behind Exhibits 1-3 (packages/contract/derive.js). Run: node --test packages/contract/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as derive from '../derive.js';
import * as data from '../mock-data.js';

const ref = derive.indexReference(data);
const policy = data.policy;
const student = { id: 'x1', completedModules: ['M1'], currentModule: 'M2' };
// One result row. Test T-M1: Q4 tests ['1.2', '1.1'] (primary 1.2), Q1/Q2 test 1.1 only.
const r = (qNo, outcome, attempt = 1, markedAt = '2026-10-01', testId = 'T-M1') => ({
  id: `${student.id}|${testId}|${attempt}|${qNo}`, studentId: student.id, testId, attempt, qNo, outcome,
  score: outcome === 'DONE' ? 2 : 0, markedAt,
});

test('Blank is "not attempted": never counted as W, and alone gives insufficient evidence', () => {
  const cell = derive.masteryCell([r(1, 'BLANK'), r(2, 'BLANK')], student, '1.1', ref, policy);
  assert.equal(cell.status, 'insufficient');
  assert.ok(cell.evidence.every(e => !e.counts && e.why === 'Blank = not attempted'));
});

test('C is shown separately and does not count toward mastery', () => {
  const cell = derive.masteryCell([r(1, 'C'), r(2, 'DONE')], student, '1.1', ref, policy);
  assert.equal(cell.cCount, 1);
  assert.equal(cell.status, 'insufficient'); // only one valid item (the DONE)
});

test('W on a multi-knowledge-point question only counts against the primary point', () => {
  const results = [r(4, 'W'), r(1, 'DONE'), r(2, 'DONE')];
  assert.equal(derive.masteryCell(results, student, '1.1', ref, policy).status, 'mastered');
  const secondary = derive.evidenceFor(results, student.id, '1.1', ref, policy).find(e => e.qNo === 4);
  assert.equal(secondary.counts, false);
});

test('Mostly W in the window means not understood; some W means partial', () => {
  assert.equal(derive.masteryCell([r(1, 'W'), r(2, 'W'), r(1, 'DONE', 2, '2026-09-01')], student, '1.1', ref, policy).status, 'not-understood');
  assert.equal(derive.masteryCell([r(1, 'W'), r(2, 'DONE'), r(1, 'DONE', 2, '2026-09-01')], student, '1.1', ref, policy).status, 'partial');
});

test('A module not yet started and without evidence is "not covered"', () => {
  assert.equal(derive.masteryCell([], student, '4.1', ref, policy).status, 'not-covered');
});

test('Exhibit 3 uses the latest attempt and counts attempts once each', () => {
  const test1 = data.tests.find(t => t.id === 'T-M1');
  const first = test1.questions.map(q => r(q.no, 'W', 1, '2026-09-01'));
  const second = test1.questions.map(q => ({ ...r(q.no, 'DONE', 2, '2026-09-08'), score: q.marks }));
  const row = derive.examStats([...first, ...second], [student], data.tests, policy)[0].tests['T-M1'];
  assert.equal(row.attempts, 2);
  assert.equal(row.latest, 2);
  assert.equal(row.pct, 100);
  assert.equal(row.band, 'green');
  assert.equal(derive.nextAttempt([...first, ...second], student.id, 'T-M1'), 3);
});

test('Exhibit 1 has one row per student x test x attempt', () => {
  const rows = derive.markingSheet([r(1, 'DONE'), r(2, 'W'), r(1, 'DONE', 2)], ref);
  assert.deepEqual(rows.map(x => [x.attempt, Object.keys(x.cells).length]), [[1, 2], [2, 1]]);
});

test('Score bands follow policy thresholds', () => {
  assert.equal(derive.band(policy.bands.green, policy), 'green');
  assert.equal(derive.band(policy.bands.amber, policy), 'amber');
  assert.equal(derive.band(policy.bands.amber - 1, policy), 'red');
});

test('Mistake bank lists W and C only, newest first', () => {
  const list = derive.mistakes([r(1, 'W', 1, '2026-09-01'), r(2, 'C', 1, '2026-09-02'), r(3, 'DONE'), r(5, 'BLANK')], student.id, ref, []);
  assert.deepEqual(list.map(m => m.type), ['C', 'W']);
  assert.ok(list.every(m => m.correction.status === 'open'));
});

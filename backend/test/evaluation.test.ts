import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/scanning/evaluation.js';
test('evaluation includes missing answers as failures and never calls synthetic data milestone evidence', () => {
  const gold = { datasetId: 'sample', kind: 'synthetic', items: [
    { pageId: 'p1', questionId: 'q1', score: 2, outcome: 'DONE', transcript: 'x = 3' },
    { pageId: 'p2', questionId: 'q2', score: 0, outcome: 'W', transcript: 'x = 10' },
  ] };
  const predicted = { ...gold, items: [gold.items[0]] };
  const report = evaluate(gold, predicted);
  assert.equal(report.outcomeAccuracy, 0.5); assert.equal(report.missingPredictions, 1);
  assert.equal(report.recognitionExactAccuracy, 0.5); assert.equal(report.milestoneSampleSizeMet, false);
  assert.throws(() => evaluate(gold, { ...predicted, items: [...predicted.items, ...predicted.items] }));
  assert.equal(evaluate(gold, { ...predicted, items: [] }).outcomeAccuracy, 0);
});

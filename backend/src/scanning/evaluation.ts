import { z } from 'zod';
import { Id, Outcome } from '../../../packages/contracts/src/index.js';
import { assertUnique } from '../domain/validate.js';
import { requireCondition } from '../domain/errors.js';
const Item = z.object({ pageId: Id, questionId: Id, outcome: Outcome,
  score: z.number().nonnegative(), transcript: z.string().optional() }).strict();
export const EvaluationSetSchema = z.object({
  datasetId: Id, kind: z.enum(['synthetic', 'real_scans']), items: z.array(Item),
}).strict();
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function evaluate(goldInput: unknown, predictionsInput: unknown) {
  const gold = EvaluationSetSchema.parse(goldInput);
  const predicted = EvaluationSetSchema.parse(predictionsInput);
  requireCondition(gold.items.length > 0, 'EMPTY_GOLD_DATASET', 'Gold dataset must contain questions');
  requireCondition(gold.datasetId === predicted.datasetId && gold.kind === predicted.kind, 'DATASET_MISMATCH', 'Gold and predictions must use the same dataset');
  const key = (item: z.infer<typeof Item>) => `${item.pageId}/${item.questionId}`;
  assertUnique(gold.items.map(key), 'gold'); assertUnique(predicted.items.map(key), 'predictions');
  const expectedKeys = new Set(gold.items.map(key));
  requireCondition(predicted.items.every(item => expectedKeys.has(key(item))), 'UNKNOWN_PREDICTION', 'Predictions contain questions outside the gold dataset');
  const actual = new Map(predicted.items.map(item => [key(item), item]));
  let correctOutcome = 0, exactScore = 0, scoreError = 0, recognized = 0, textCount = 0, missing = 0;
  const differences = [];
  for (const expected of gold.items) {
    const prediction = actual.get(key(expected));
    if (!prediction) missing++;
    if (prediction?.outcome === expected.outcome) correctOutcome++;
    if (prediction?.score === expected.score) exactScore++;
    if (prediction) scoreError += Math.abs(prediction.score - expected.score);
    if (expected.transcript !== undefined) {
      textCount++;
      if (prediction?.transcript !== undefined && normalize(prediction.transcript) === normalize(expected.transcript)) recognized++;
    }
    if (!prediction || prediction.outcome !== expected.outcome || prediction.score !== expected.score) differences.push({ pageId: expected.pageId, questionId: expected.questionId });
  }
  const pageCount = new Set(gold.items.map(item => item.pageId)).size;
  return { datasetId: gold.datasetId, kind: gold.kind, pageCount, questionCount: gold.items.length,
    milestoneSampleSizeMet: gold.kind === 'real_scans' && pageCount >= 20 && pageCount <= 30,
    missingPredictions: missing, outcomeAccuracy: correctOutcome / gold.items.length, scoreExactAccuracy: exactScore / gold.items.length,
    // Missing predictions are failures in accuracy; MAE is explicitly over matched predictions only.
    scoreMaeOnMatchedPredictions: actual.size ? scoreError / actual.size : null,
    recognitionExactAccuracy: textCount ? recognized / textCount : null, differences };
}

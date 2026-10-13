import { readFile } from 'node:fs/promises';
import { evaluate } from '../backend/src/scanning/evaluation.js';
const [goldPath, predictedPath] = process.argv.slice(2);
if (!goldPath || !predictedPath) {
  console.error('Usage: pnpm evaluate path/to/gold.json path/to/predictions.json'); process.exitCode = 1;
} else {
  const gold = JSON.parse(await readFile(goldPath, 'utf8'));
  const predicted = JSON.parse(await readFile(predictedPath, 'utf8'));
  console.log(JSON.stringify(evaluate(gold, predicted), null, 2));
}

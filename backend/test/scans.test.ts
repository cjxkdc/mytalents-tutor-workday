import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture, manager, student } from './fixtures.js';
import { MemoryRepository } from '../src/repositories/repository.js';
import { ImportService } from '../src/services/imports.js';
import { ScanService } from '../src/services/scans.js';
import { answerSheets, cropAnswers } from '../src/scanning/templates.js';
import type { AiProvider } from '../src/integrations/ai.js';

const identity = { studentId: 'demo-student-1', examId: 'algebra-test-1', attemptId: 'scan-attempt' };
async function page() {
  const template = await answerSheets(fixture().exams[0]!, identity);
  return (await sharp(Buffer.from(template.pages[0]!.svg)).png().toBuffer()).toString('base64');
}
test('printed answer template round-trips through QR verification and four question crops', async () => {
  const image = await page();
  const crops = await cropAnswers(image, fixture().exams[0]!, identity, 1);
  assert.equal(crops.length, 4);
  assert.deepEqual(crops.map(c => c.questionId), ['q1', 'q2', 'q3', 'q4']);
  const metadata = await sharp(Buffer.from(crops[0]!.imageBase64, 'base64')).metadata();
  assert.equal(metadata.width, 834); assert.equal(metadata.height, 209);
  await assert.rejects(cropAnswers(image, fixture().exams[0]!, { ...identity, studentId: 'demo-student-2' }, 1), { code: 'QR_MISMATCH' });
  await assert.rejects(cropAnswers('invalid base64', fixture().exams[0]!, identity, 1), { code: 'INVALID_IMAGE' });
});
const mockAi: AiProvider = {
  available: true,
  async recognize({ questionId }) { return { text: `synthetic answer ${questionId}`, confidence: 1 }; },
  async grade({ question }) { return { outcome: 'DONE', score: question.maxScore, feedback: 'synthetic provider', confidence: 1 }; },
};
test('two-stage scan job automatically imports validated marks and produces no teacher review state', async () => {
  const repo = new MemoryRepository(); const imports = new ImportService(repo); await imports.ingest(fixture(), manager);
  const scans = new ScanService(repo, mockAi, imports);
  const input = { ...identity, jobId: 'scan-job', revision: 1, completedAt: '2026-10-12T00:00:00Z', pages: [{ pageNumber: 1, imageBase64: await page() }] };
  assert.equal((await scans.submit(input, student)).status, 'queued');
  await scans.idle();
  const state = await repo.read();
  assert.equal(state.scanJobs['scan-job']!.status, 'completed');
  assert.equal(state.projections.examStatistics.find(e => e.attemptId === identity.attemptId)!.score, 8);
  assert.equal((await scans.submit(input, student)).status, 'completed');
  assert.equal(Object.keys((await repo.read()).attempts).length, 2);
  // Simulate a crash after the grades commit but before the job status commit.
  await repo.transact(draft => { draft.scanJobs['scan-job']!.status = 'processing'; });
  await scans.recoverInterrupted();
  assert.equal((await repo.read()).scanJobs['scan-job']!.status, 'completed');
  assert.equal((await scans.submit(input, student)).status, 'completed');
});
test('low-confidence scan fails without publishing partial grades', async () => {
  const repo = new MemoryRepository(); const imports = new ImportService(repo); await imports.ingest(fixture(), manager);
  const ai: AiProvider = { ...mockAi, async recognize() { return { text: '?', confidence: 0.1 }; } };
  const scans = new ScanService(repo, ai, imports);
  await scans.submit({ ...identity, jobId: 'uncertain-job', revision: 1, completedAt: '2026-10-12T00:00:00Z', pages: [{ pageNumber: 1, imageBase64: await page() }] }, student);
  await scans.idle();
  const state = await repo.read();
  assert.equal(state.scanJobs['uncertain-job']!.status, 'failed');
  assert.equal(state.scanJobs['uncertain-job']!.error!.code, 'LOW_RECOGNITION_CONFIDENCE');
  assert.equal(state.attempts[identity.attemptId], undefined);
});
test('parallel scan submissions respect the two-job capacity and drain cleanly', async () => {
  const repo = new MemoryRepository(); const imports = new ImportService(repo); await imports.ingest(fixture(), manager);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ai: AiProvider = { ...mockAi, async recognize(input) { await gate; return mockAi.recognize(input); } };
  const scans = new ScanService(repo, ai, imports);
  const input = { ...identity, revision: 1, completedAt: '2026-10-12T00:00:00Z', pages: [{ pageNumber: 1, imageBase64: await page() }] };
  const results = await Promise.allSettled(['one', 'two', 'three'].map(jobId => scans.submit({ ...input, jobId }, manager)));
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal((results[2] as PromiseRejectedResult).reason.code, 'SCAN_QUEUE_FULL');
  release(); await scans.idle();
});
test('scan job cannot overwrite an attempt created while a student job is running', async () => {
  const repo = new MemoryRepository(); const imports = new ImportService(repo); await imports.ingest(fixture(), manager);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ai: AiProvider = { ...mockAi, async recognize(input) { await gate; return mockAi.recognize(input); } };
  const scans = new ScanService(repo, ai, imports);
  await scans.submit({ ...identity, jobId: 'race-job', revision: 3, completedAt: '2026-10-12T00:00:00Z', pages: [{ pageNumber: 1, imageBase64: await page() }] }, student);
  const attempt = { ...fixture().attempts[0]!, id: identity.attemptId };
  await imports.ingest({ schemaVersion: '1.0', source: 'teacher', batchId: 'teacher-race', attempts: [attempt] }, manager);
  release(); await scans.idle();
  const state = await repo.read();
  assert.equal(state.scanJobs['race-job']!.error!.code, 'ATTEMPT_ALREADY_EXISTS');
  assert.equal(state.attempts[identity.attemptId]!.revision, 1);
});

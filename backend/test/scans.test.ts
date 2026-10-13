import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture, manager, student, teacher } from './fixtures.js';
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
const scanInput = async (jobId: string, revision = 1) => ({ ...identity, jobId, revision, completedAt: '2026-10-12T00:00:00Z', pages: [{ pageNumber: 1, imageBase64: await page() }] });
const teacherMarks = [
  { questionId: 'q1', outcome: 'DONE' as const, score: 2 },
  { questionId: 'q2', outcome: 'W' as const, score: 0, feedback: 'Move the constant first.' },
  { questionId: 'q3', outcome: 'C' as const, score: 1 },
  { questionId: 'q4', outcome: 'BLANK' as const, score: 0 },
];
async function setup(ai: AiProvider = mockAi) {
  const repo = new MemoryRepository(); const imports = new ImportService(repo); await imports.ingest(fixture(), manager);
  return { repo, imports, scans: new ScanService(repo, ai, imports) };
}

test('AI scan grading waits for tutor review: nothing official until a tutor confirms', async () => {
  const { repo, scans } = await setup();
  const input = await scanInput('scan-job');
  assert.equal((await scans.submit(input, student)).status, 'queued');
  await scans.idle();
  let state = await repo.read();
  assert.equal(state.scanJobs['scan-job']!.status, 'awaiting_review');
  assert.equal(state.attempts[identity.attemptId], undefined, 'no attempt before review');
  assert.equal(state.projections.examStatistics.some(e => e.attemptId === identity.attemptId), false, 'three tables untouched before review');
  const review = state.reviews['scan-job']!;
  assert.equal(review.status, 'pending');
  assert.deepEqual(review.suggestions.map(s => [s.questionId, s.status, s.outcome]), [['q1', 'suggested', 'DONE'], ['q2', 'suggested', 'DONE'], ['q3', 'suggested', 'DONE'], ['q4', 'suggested', 'DONE']]);
  // Resubmitting the same job while it waits does not grade it again.
  assert.equal((await scans.submit(input, student)).status, 'awaiting_review');

  const out = await scans.confirm('scan-job', { version: review.version, marks: teacherMarks }, teacher);
  assert.equal(out.review.status, 'confirmed');
  assert.deepEqual(out.review.changedQuestionIds, ['q2', 'q3', 'q4']);
  state = await repo.read();
  assert.equal(state.scanJobs['scan-job']!.status, 'completed');
  assert.equal(state.attempts[identity.attemptId]!.source, 'ai-scan');
  assert.equal(state.projections.examStatistics.find(e => e.attemptId === identity.attemptId)!.score, 3);
  assert.ok(state.audit.some(a => a.action === 'review.confirmed'));
  assert.equal((await scans.submit(input, student)).status, 'completed');
});

test('unreadable or low-confidence answers are flagged for the tutor, never failed or scored as zero', async () => {
  const ai: AiProvider = { ...mockAi, async recognize({ questionId }) {
    return questionId === 'q2' ? { text: '?', confidence: 0.1 } : { text: `answer ${questionId}`, confidence: 1 };
  }, async grade({ question }) {
    return { outcome: 'W', score: 0, feedback: 'unsure', confidence: question.id === 'q3' ? 0.5 : 1 };
  } };
  const { repo, scans } = await setup(ai);
  await scans.submit(await scanInput('uncertain-job'), student);
  await scans.idle();
  const state = await repo.read();
  assert.equal(state.scanJobs['uncertain-job']!.status, 'awaiting_review');
  const byQ = Object.fromEntries(state.reviews['uncertain-job']!.suggestions.map(s => [s.questionId, s]));
  assert.equal(byQ.q2!.status, 'unreadable'); assert.equal(byQ.q2!.score, undefined);
  assert.equal(byQ.q3!.status, 'uncertain');
  assert.equal(state.attempts[identity.attemptId], undefined);
});

test('confirm is atomic: invalid marks, stale versions and double confirms change nothing', async () => {
  const { repo, scans } = await setup();
  await scans.submit(await scanInput('scan-job'), student); await scans.idle();
  const version = (await repo.read()).reviews['scan-job']!.version;
  const partialDone = teacherMarks.map(m => m.questionId === 'q1' ? { ...m, score: 1 } : m);
  await assert.rejects(scans.confirm('scan-job', { version, marks: partialDone }, teacher), { code: 'INVALID_SCORE' });
  await assert.rejects(scans.confirm('scan-job', { version, marks: teacherMarks.slice(0, 3) }, teacher), { code: 'INCOMPLETE_MARKS' });
  await assert.rejects(scans.confirm('scan-job', { version: version + 1, marks: teacherMarks }, teacher), { code: 'REVIEW_VERSION_CONFLICT' });
  let state = await repo.read();
  assert.equal(state.reviews['scan-job']!.status, 'pending'); assert.equal(state.attempts[identity.attemptId], undefined);
  const results = await Promise.allSettled([
    scans.confirm('scan-job', { version, marks: teacherMarks }, teacher),
    scans.confirm('scan-job', { version, marks: teacherMarks }, manager),
  ]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
  assert.equal((results[1] as PromiseRejectedResult).reason.code, 'REVIEW_NOT_PENDING');
  state = await repo.read();
  assert.equal(state.audit.filter(a => a.action === 'review.confirmed').length, 1);
});

test('tutor can reject an AI result; nothing is recorded and the job cannot be confirmed later', async () => {
  const { repo, scans } = await setup();
  await scans.submit(await scanInput('scan-job'), student); await scans.idle();
  await assert.rejects(scans.reject('scan-job', { version: 1, reason: '' }, teacher));
  const rejected = await scans.reject('scan-job', { version: 1, reason: 'Pages photographed out of order' }, teacher);
  assert.equal(rejected.status, 'rejected');
  const state = await repo.read();
  assert.equal(state.scanJobs['scan-job']!.status, 'rejected');
  assert.equal(state.scanJobs['scan-job']!.error!.code, 'REVIEW_REJECTED');
  assert.equal(state.attempts[identity.attemptId], undefined);
  await assert.rejects(scans.confirm('scan-job', { version: 2, marks: teacherMarks }, teacher), { code: 'REVIEW_NOT_PENDING' });
});

test('reviews are staff-only and scoped to assigned students', async () => {
  const { scans } = await setup();
  await scans.submit(await scanInput('scan-job'), student); await scans.idle();
  await assert.rejects(scans.listReviews(student), { code: 'FORBIDDEN' });
  await assert.rejects(scans.getReview('scan-job', student), { code: 'FORBIDDEN' });
  const outsider = { id: 'other-teacher', role: 'teacher' as const, studentIds: ['demo-student-2'] };
  assert.equal((await scans.listReviews(outsider)).items.length, 0);
  await assert.rejects(scans.confirm('scan-job', { version: 1, marks: teacherMarks }, outsider), { code: 'FORBIDDEN' });
  assert.equal((await scans.listReviews(teacher, 'pending')).items.length, 1);
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

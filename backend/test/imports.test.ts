import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository, FileRepository } from '../src/repositories/repository.js';
import { ImportService, reportFacts } from '../src/services/imports.js';
import { fixture, manager, teacher, student } from './fixtures.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('one import derives all three tables, suggestions, evidence and explicit unknowns', async () => {
  const repo = new MemoryRepository();
  const result = await new ImportService(repo).ingest(fixture(), manager);
  const state = await repo.read();
  assert.equal(result.status, 'completed');
  assert.equal(state.projections.marking.length, 4);
  assert.equal(state.projections.examStatistics[0]!.score, 3);
  assert.equal(state.projections.examStatistics[0]!.maxScore, 8);
  const rows = state.projections.progress.filter(p => p.studentId === 'demo-student-1');
  assert.equal(rows.find(p => p.knowledgePointId === 'linear')!.mastery, 'partial');
  assert.equal(rows.find(p => p.knowledgePointId === 'functions')!.mastery, null);
  assert.equal(rows.find(p => p.knowledgePointId === 'graphs')!.mastery, 'not_covered');
  assert.equal(state.projections.followUps.length, 3);
  assert.deepEqual(state.projections.followUps.find(f => f.kind === 'concept_review')!.resourceIds, ['demo-resource-1']);
  assert.equal(state.audit.length, 1);
  assert.equal(state.outbox.length, 1);
});
test('duplicate imports are idempotent, including simultaneous requests', async () => {
  const repo = new MemoryRepository();
  const service = new ImportService(repo);
  const results = await Promise.all([service.ingest(fixture(), manager), service.ingest(fixture(), manager)]);
  assert.deepEqual(results.map(r => r.replayed), [false, true]);
  const state = await repo.read();
  assert.equal(state.audit.length, 1);
  assert.equal(state.revision, 1);
});
test('a correction replaces evidence and score without adding an attempt', async () => {
  const repo = new MemoryRepository(); const service = new ImportService(repo);
  const batch = fixture(); await service.ingest(batch, manager);
  const attempt = structuredClone(batch.attempts[0]!);
  attempt.revision = 2;
  attempt.marks[1] = { questionId: 'q2', outcome: 'DONE', score: 2 };
  await service.ingest({ schemaVersion: '1.0', source: 'correction', batchId: 'v2', attempts: [attempt] }, teacher);
  const state = await repo.read();
  assert.equal(state.projections.examStatistics.length, 1);
  assert.equal(state.projections.examStatistics[0]!.score, 5);
  assert.equal(state.projections.examStatistics[0]!.attemptNumber, 1);
  assert.equal(state.projections.followUps.some(f => f.kind === 'concept_review'), false);
  assert.equal(state.projections.progress.find(p => p.studentId === 'demo-student-1' && p.knowledgePointId === 'linear')!.mastery, 'mastered');
});
test('same batch different payload, stale revision and same-revision mutations conflict', async () => {
  const repo = new MemoryRepository(); const service = new ImportService(repo);
  await service.ingest(fixture(), manager);
  const batch = fixture(); batch.students[0]!.name = 'Changed';
  await assert.rejects(service.ingest(batch, manager), { code: 'IDEMPOTENCY_CONFLICT' });
  batch.batchId = 'different-id';
  await assert.rejects(service.ingest(batch, manager), { code: 'REVISION_CONFLICT' });
  batch.students[0]!.revision = 2; await service.ingest(batch, manager);
  await assert.rejects(service.ingest({ ...fixture(), batchId: 'stale' }, manager), { code: 'STALE_REVISION' });
});
test('validation failure rolls back all records and does not block the next transaction', async () => {
  const repo = new MemoryRepository(); const service = new ImportService(repo);
  const bad = fixture(); bad.attempts[0]!.marks.pop();
  await assert.rejects(service.ingest(bad, manager), { code: 'INCOMPLETE_MARKS' });
  assert.equal(Object.keys((await repo.read()).students).length, 0);
  await service.ingest(fixture(), manager);
  assert.equal((await repo.read()).revision, 1);
});
test('invalid score, duplicate question IDs and reserved IDs cannot enter storage', async () => {
  const service = new ImportService(new MemoryRepository());
  const bad = fixture(); bad.attempts[0]!.marks[0]!.score = 99;
  await assert.rejects(service.ingest(bad, manager), { code: 'INVALID_SCORE' });
  bad.attempts[0]!.marks[0]!.score = 2; bad.attempts[0]!.marks[1]!.questionId = 'q1';
  await assert.rejects(service.ingest(bad, manager), { code: 'DUPLICATE_ID' });
  const prototype = fixture(); prototype.students[0]!.id = 'constructor';
  await assert.rejects(service.ingest(prototype, manager));
});
test('teachers cannot import another student and students cannot publish grades', async () => {
  const service = new ImportService(new MemoryRepository());
  await assert.rejects(service.ingest(fixture(), teacher), { code: 'FORBIDDEN' });
  await assert.rejects(service.ingest(fixture(), student), { code: 'FORBIDDEN' });
});
test('historical exam rubric cannot be replaced after recording an attempt', async () => {
  const repo = new MemoryRepository(); const service = new ImportService(repo);
  await service.ingest(fixture(), manager);
  const exam = fixture().exams[0]!; exam.revision = 2; exam.questions[0]!.maxScore = 10;
  await assert.rejects(service.ingest({ schemaVersion: '1.0', source: 'tests', batchId: 'new-rubric', exams: [exam] }, manager), { code: 'EXAM_IN_USE' });
});
test('retakes use latest attempt as progress evidence while preserving exam history', async () => {
  const repo = new MemoryRepository(); const service = new ImportService(repo);
  await service.ingest(fixture(), manager);
  const attempt = fixture().attempts[0]!;
  attempt.id = 'retake'; attempt.completedAt = '2026-10-14T10:00:00Z'; attempt.markedAt = '2026-10-14T11:00:00Z';
  attempt.marks = attempt.marks.map(m => ({ ...m, outcome: 'DONE', score: 2 }));
  await service.ingest({ schemaVersion: '1.0', source: 'tests', batchId: 'retake', attempts: [attempt] }, teacher);
  const state = await repo.read();
  assert.equal(state.projections.examStatistics[1]!.attemptNumber, 2);
  assert.equal(state.projections.marking.length, 8);
  assert.equal(state.projections.followUps.length, 0);
});
test('careless results do not imply concept misunderstanding', async () => {
  const batch = fixture(); batch.attempts[0]!.marks[0] = { questionId: 'q1', score: 0, outcome: 'C' };
  batch.attempts[0]!.marks[1] = { questionId: 'q2', score: 0, outcome: 'C' };
  const repo = new MemoryRepository(); await new ImportService(repo).ingest(batch, manager);
  const progress = (await repo.read()).projections.progress.find(p => p.studentId === 'demo-student-1' && p.knowledgePointId === 'linear')!;
  assert.equal(progress.mastery, 'partial'); assert.equal(progress.reason, 'careless_errors');
});
test('versioned policy changes rederive records and reject edits to an old version', async () => {
  const repo = new MemoryRepository(); const service = new ImportService(repo);
  await service.ingest(fixture(), manager);
  const policy = { ...(await repo.read()).policies['policy-1']!, version: 'policy-2', masteredMinRatio: 0.5 };
  await service.activatePolicy(policy, manager);
  assert.equal((await repo.read()).projections.progress.find(p => p.studentId === 'demo-student-1' && p.knowledgePointId === 'linear')!.mastery, 'mastered');
  await assert.rejects(service.activatePolicy({ ...policy, masteredMinRatio: 0.6 }, manager), { code: 'POLICY_VERSION_CONFLICT' });
  await assert.rejects(service.activatePolicy({ ...policy, version: 'policy-3' }, teacher), { code: 'FORBIDDEN' });
});
test('report facts follow Sydney dates and preserve evidence IDs without invented activity', async () => {
  const repo = new MemoryRepository(); await new ImportService(repo).ingest(fixture(), manager);
  const facts = reportFacts(await repo.read(), '2026-10-13', () => true);
  assert.equal(facts.markedAttempts.length, 1); assert.equal(facts.activities.length, 3);
  assert.equal(reportFacts(await repo.read(), '2026-10-14', () => true).activities.length, 0);
  assert.equal(facts.coverage.activities, 'imported_records_only');
});
test('local repository survives reopen and refuses a second writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mytalents-test-')); const file = join(directory, 'state.json');
  try {
    const repo = await FileRepository.create(file);
    await assert.rejects(FileRepository.create(file), { code: 'REPOSITORY_LOCKED' });
    await new ImportService(repo).ingest(fixture(), manager); await repo.close();
    const reopened = await FileRepository.create(file);
    assert.equal((await reopened.read()).projections.examStatistics[0]!.score, 3);
    assert.equal((await new ImportService(reopened).ingest(fixture(), manager)).replayed, true);
    await reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

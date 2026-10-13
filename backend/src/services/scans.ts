import { randomUUID } from 'node:crypto';
import { ScanRequestSchema, RecognitionSchema, AiGradeSchema, type Principal, type ScanJob } from '../../../packages/contracts/src/index.js';
import { requireStudent } from '../auth/permissions.js';
import { AppError, requireCondition } from '../domain/errors.js';
import type { Repository } from '../repositories/repository.js';
import type { State } from '../domain/state.js';
import type { AiProvider } from '../integrations/ai.js';
import { answerSheets, cropAnswers, pageCount } from '../scanning/templates.js';
import { hash, ImportService } from './imports.js';

export class ScanService {
  private active = new Map<string, Promise<void>>();
  private submissions: Promise<unknown> = Promise.resolve();
  constructor(private repository: Repository, private ai: AiProvider, private imports: ImportService) {}
  async recoverInterrupted() {
    await this.repository.transact(state => {
      for (const job of Object.values(state.scanJobs)) {
        if (job.status === 'processing' || job.status === 'queued') {
          if (this.restoreCommitted(state, job)) continue;
          job.status = 'failed'; job.updatedAt = new Date().toISOString();
          job.error = { code: 'PROCESS_RESTARTED', message: 'Resubmit the same job and images to retry after restart' };
        }
      }
    });
  }
  async template(input: { studentId: string; examId: string; attemptId: string }, actor: Principal) {
    requireStudent(actor, input.studentId);
    const state = await this.repository.read();
    requireCondition(state.students[input.studentId], 'UNKNOWN_STUDENT', 'Student does not exist', 404);
    const exam = state.exams[input.examId];
    requireCondition(exam, 'UNKNOWN_EXAM', 'Exam does not exist', 404);
    return answerSheets(exam, input);
  }
  submit(input: unknown, actor: Principal): Promise<ScanJob> {
    const next = this.submissions.then(() => this.submitSerial(input, actor));
    this.submissions = next.catch(() => undefined);
    return next;
  }
  private async submitSerial(input: unknown, actor: Principal): Promise<ScanJob> {
    const request = ScanRequestSchema.parse(input);
    requireStudent(actor, request.studentId);
    requireCondition(this.ai.available, 'AI_NOT_CONFIGURED', 'Configure an AI provider before requesting scan grading', 503);
    const digest = hash(request);
    const receipt = await this.repository.transact(state => {
      const old = state.scanJobs[request.jobId];
      if (old) {
        requireCondition(old.requestedBy === actor.id || actor.role === 'manager', 'FORBIDDEN', 'Job belongs to another actor', 403);
        requireCondition(old.hash === digest, 'IDEMPOTENCY_CONFLICT', 'Reuse job ID only with identical content', 409);
        if (this.restoreCommitted(state, old)) return { job: old, start: false };
        if (old.status === 'completed' || this.active.has(old.id)) return { job: old, start: false };
      }
      requireCondition(this.active.size < 2, 'SCAN_QUEUE_FULL', 'Two scan jobs are already running; retry later', 429);
      requireCondition(state.students[request.studentId], 'UNKNOWN_STUDENT', 'Student does not exist', 404);
      const exam = state.exams[request.examId];
      requireCondition(exam, 'UNKNOWN_EXAM', 'Exam does not exist', 404);
      requireCondition(pageCount(exam) <= 4, 'SCAN_EXAM_TOO_LARGE', 'Scanning supports up to 16 questions');
      requireCondition(request.pages.length === pageCount(exam) && new Set(request.pages.map(p => p.pageNumber)).size === request.pages.length &&
        request.pages.every(p => p.pageNumber <= pageCount(exam)), 'INCOMPLETE_PAGES', 'Provide every page once');
      requireCondition(request.pages.reduce((sum, page) => sum + page.imageBase64.length, 0) <= 8_000_000, 'IMAGE_TOO_LARGE', 'Combined base64 pages exceed 8 MB', 413);
      requireCondition(exam.questions.every(q => q.rubric?.trim()), 'RUBRIC_REQUIRED', 'Every question needs a rubric before AI grading');
      const existingAttempt = state.attempts[request.attemptId];
      if (existingAttempt) {
        requireCondition(existingAttempt.studentId === request.studentId && existingAttempt.examId === request.examId,
          'IMMUTABLE_IDENTITY', 'Attempt ID belongs to another student or exam', 409);
        requireCondition(actor.role !== 'student', 'FORBIDDEN', 'Students cannot regrade an already recorded attempt', 403);
      }
      const now = new Date().toISOString();
      const job: ScanJob = { id: request.jobId, hash: digest, studentId: request.studentId, examId: request.examId,
        attemptId: request.attemptId, requestedBy: actor.id, status: 'queued', createdAt: old?.createdAt ?? now,
        policyVersion: old?.policyVersion ?? state.activePolicy, examRevision: old?.examRevision ?? exam.revision,
        updatedAt: now, tries: (old?.tries ?? 0) + 1 };
      requireCondition(job.examRevision === exam.revision, 'EXAM_REVISION_CHANGED', 'Exam changed; generate new answer sheets and a new job ID', 409);
      state.scanJobs[job.id] = job;
      return { job, start: true };
    });
    if (!receipt.start) return receipt.job;
    // Buffers remain in memory only. The restart path explicitly asks for resubmission.
    const task = this.process(request, actor).finally(() => this.active.delete(request.jobId));
    this.active.set(request.jobId, task);
    return receipt.job;
  }
  private async process(request: ReturnType<typeof ScanRequestSchema.parse>, actor: Principal) {
    try {
      await this.update(request.jobId, { status: 'processing' });
      const state = await this.repository.read();
      const exam = state.exams[request.examId]!;
      const job = state.scanJobs[request.jobId]!;
      requireCondition(exam.revision === job.examRevision, 'EXAM_REVISION_CHANGED', 'Exam changed before processing', 409);
      const threshold = state.policies[job.policyVersion]!.aiMinimumConfidence;
      const marks = [];
      for (const page of [...request.pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
        const crops = await cropAnswers(page.imageBase64, exam, request, page.pageNumber);
        for (const crop of crops) {
          const recognized = RecognitionSchema.parse(await this.ai.recognize(crop));
          requireCondition(recognized.confidence >= threshold, 'LOW_RECOGNITION_CONFIDENCE', `Unable to read ${crop.questionId} reliably; rescan`);
          const question = exam.questions.find(q => q.id === crop.questionId)!;
          const grade = AiGradeSchema.parse(await this.ai.grade({ question, transcript: recognized.text }));
          requireCondition(grade.confidence >= threshold, 'LOW_GRADING_CONFIDENCE', `Unable to grade ${crop.questionId} reliably`);
          marks.push({ questionId: crop.questionId, outcome: grade.outcome, score: grade.score,
            feedback: grade.feedback, studentAnswer: recognized.text });
        }
      }
      // Only validated provider output crosses into the import pipeline; callers cannot submit their own grade here.
      const importResult = await this.imports.ingest({ schemaVersion: '1.0', source: 'ai-scan', batchId: request.jobId,
        attempts: [{ id: request.attemptId, revision: request.revision, studentId: request.studentId, examId: request.examId,
          completedAt: request.completedAt, markedAt: receiptTime(state.scanJobs[request.jobId]!), marks }] },
      { id: actor.id, role: 'teacher', studentIds: [request.studentId] },
      { requireNewAttempts: actor.role === 'student', examRevisions: { [exam.id]: job.examRevision }, trustedAi: true });
      await this.update(request.jobId, { status: 'completed', importId: importResult.id });
    } catch (error) {
      // A commit can succeed before the response fails. Recover from the durable import receipt first.
      const persisted = await this.repository.read().catch(() => undefined);
      const receipt = persisted?.imports[`ai-scan/${request.jobId}`];
      const attempt = persisted?.attempts[request.attemptId];
      if (receipt?.createdBy === actor.id && attempt?.importId === receipt.id &&
        attempt.studentId === request.studentId && attempt.examId === request.examId) {
        await this.update(request.jobId, { status: 'completed', importId: `ai-scan/${request.jobId}` }).catch(() => undefined);
        return;
      }
      const safeError = error instanceof AppError ? { code: error.code, message: error.message } :
        { code: 'SCAN_PROCESSING_FAILED', message: 'Scan processing failed; check provider output or resubmit' };
      await this.update(request.jobId, { status: 'failed', error: safeError }).catch(() => undefined);
    }
  }
  private async update(id: string, patch: Partial<ScanJob>) {
    await this.repository.transact(state => {
      const job = state.scanJobs[id]!;
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      if (patch.status === 'completed' || patch.status === 'failed') {
        state.audit.push({ id: randomUUID(), at: job.updatedAt, actorId: job.requestedBy,
          action: `scan.${patch.status}`, recordIds: [id], policyVersion: job.policyVersion });
      }
    });
  }
  private restoreCommitted(state: State, job: ScanJob): boolean {
    const receipt = state.imports[`ai-scan/${job.id}`];
    const attempt = state.attempts[job.attemptId];
    if (!receipt || receipt.createdBy !== job.requestedBy || attempt?.importId !== receipt.id ||
      attempt.studentId !== job.studentId || attempt.examId !== job.examId) return false;
    if (job.status !== 'completed') {
      job.status = 'completed'; job.importId = receipt.id; job.updatedAt = new Date().toISOString(); delete job.error;
      state.audit.push({ id: randomUUID(), at: job.updatedAt, actorId: job.requestedBy, action: 'scan.recovered',
        recordIds: [job.id], importId: receipt.id, policyVersion: job.policyVersion });
    }
    return true;
  }
  async idle() { await this.submissions; await Promise.all([...this.active.values()]); }
}
function receiptTime(job: ScanJob) { return job.createdAt; }

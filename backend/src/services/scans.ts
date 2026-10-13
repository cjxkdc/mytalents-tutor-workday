import { randomUUID } from 'node:crypto';
import { ScanRequestSchema, RecognitionSchema, AiGradeSchema, ReviewConfirmSchema, ReviewRejectSchema,
  type MarkingReview, type Principal, type ReviewSuggestion, type ScanJob } from '../../../packages/contract/src/index.js';
import { canReadStudent, requireStaff, requireStudent } from '../auth/permissions.js';
import { AppError, requireCondition } from '../domain/errors.js';
import type { Repository } from '../repositories/repository.js';
import type { State } from '../domain/state.js';
import type { AiProvider } from '../integrations/ai.js';
import { answerSheets, cropAnswers, pageCount } from '../scanning/templates.js';
import { hash, ImportService } from './imports.js';

/**
 * Scan pipeline: QR check and crop -> AI recognition -> AI grading -> tutor review -> import.
 * AI output never becomes an official mark on its own (DESIGN_CONSENSUS.md v1.4). Each processed job
 * ends in a pending MarkingReview; the attempt, mistakes and three tables are written only when a tutor
 * confirms it. Unreadable or low-confidence questions are flagged for the tutor, never scored as zero.
 */
export class ScanService {
  private active = new Map<string, Promise<void>>();
  private submissions: Promise<unknown> = Promise.resolve();
  constructor(private repository: Repository, private ai: AiProvider, private imports: ImportService) {}
  async recoverInterrupted() {
    await this.repository.transact(state => {
      for (const job of Object.values(state.scanJobs)) {
        if (job.status === 'processing' || job.status === 'queued') {
          if (this.restoreCommitted(state, job)) continue;
          if (job.reviewId && state.reviews[job.reviewId]) { job.status = 'awaiting_review'; continue; }
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
        // Finished, waiting for a tutor, or rejected: resubmitting the same job does not grade it again.
        if (['completed', 'awaiting_review', 'rejected'].includes(old.status) || this.active.has(old.id)) return { job: old, start: false };
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
      const suggestions: ReviewSuggestion[] = [];
      for (const page of [...request.pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
        const crops = await cropAnswers(page.imageBase64, exam, request, page.pageNumber);
        for (const crop of crops) {
          const recognized = RecognitionSchema.parse(await this.ai.recognize(crop));
          if (recognized.confidence < threshold) {
            // Unreadable is not "not attempted" and not zero: the tutor decides from the scan.
            suggestions.push({ questionId: crop.questionId, status: 'unreadable', recognitionConfidence: recognized.confidence,
              ...(recognized.text ? { transcript: recognized.text } : {}) });
            continue;
          }
          const question = exam.questions.find(q => q.id === crop.questionId)!;
          const grade = AiGradeSchema.parse(await this.ai.grade({ question, transcript: recognized.text }));
          suggestions.push({ questionId: crop.questionId, status: grade.confidence >= threshold ? 'suggested' : 'uncertain',
            transcript: recognized.text, recognitionConfidence: recognized.confidence,
            outcome: grade.outcome, score: Math.min(grade.score, question.maxScore), feedback: grade.feedback, gradingConfidence: grade.confidence });
        }
      }
      await this.repository.transact(draft => {
        const current = draft.scanJobs[request.jobId]!;
        requireCondition(draft.exams[request.examId]?.revision === current.examRevision, 'EXAM_REVISION_CHANGED', 'Exam changed during AI processing; generate new answer sheets', 409);
        if (actor.role === 'student') {
          requireCondition(!draft.attempts[request.attemptId], 'ATTEMPT_ALREADY_EXISTS', 'A recorded attempt cannot be replaced by a student scan', 409);
        }
        const now = new Date().toISOString();
        const review: MarkingReview = { id: request.jobId, jobId: request.jobId, studentId: request.studentId, examId: request.examId,
          examRevision: current.examRevision, attemptId: request.attemptId, attemptRevision: request.revision, completedAt: request.completedAt,
          requestedBy: actor.id, requestedByRole: actor.role, status: 'pending', version: 1, suggestions,
          policyVersion: current.policyVersion, createdAt: now };
        draft.reviews[review.id] = review;
        Object.assign(current, { status: 'awaiting_review', reviewId: review.id, updatedAt: now });
        delete current.error;
        draft.audit.push({ id: randomUUID(), at: now, actorId: current.requestedBy, action: 'scan.awaiting_review',
          recordIds: [current.id, `reviews/${review.id}`], policyVersion: current.policyVersion });
        draft.outbox.push({ id: randomUUID(), at: now, type: 'review.requested', referenceId: review.id,
          studentIds: [review.studentId], policyVersion: current.policyVersion });
      });
    } catch (error) {
      const persisted = await this.repository.read().catch(() => undefined);
      if (persisted?.reviews[request.jobId]) return; // review was saved before the failure surfaced
      const safeError = error instanceof AppError ? { code: error.code, message: error.message } :
        { code: 'SCAN_PROCESSING_FAILED', message: 'Scan processing failed; check provider output or resubmit' };
      await this.update(request.jobId, { status: 'failed', error: safeError }).catch(() => undefined);
    }
  }

  // ---------- tutor review ----------

  async listReviews(actor: Principal, status?: MarkingReview['status']) {
    requireStaff(actor);
    const state = await this.repository.read();
    const items = Object.values(state.reviews)
      .filter(r => canReadStudent(actor, r.studentId) && (!status || r.status === status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { items, stateRevision: state.revision };
  }
  async getReview(id: string, actor: Principal) {
    requireStaff(actor);
    const state = await this.repository.read();
    const review = state.reviews[id];
    requireCondition(review, 'NOT_FOUND', 'Review was not found', 404);
    requireStudent(actor, review.studentId);
    return review;
  }
  /** Tutor confirms (and may correct) every question; this is the moment marks become official. */
  async confirm(id: string, input: unknown, actor: Principal) {
    requireStaff(actor);
    const body = ReviewConfirmSchema.parse(input);
    const snapshot = await this.repository.read();
    const review = snapshot.reviews[id];
    requireCondition(review, 'NOT_FOUND', 'Review was not found', 404);
    requireStudent(actor, review.studentId);
    const decidedAt = new Date().toISOString();
    const result = await this.imports.ingest({ schemaVersion: '1.0', source: 'ai-scan', batchId: review.jobId,
      attempts: [{ id: review.attemptId, revision: review.attemptRevision, studentId: review.studentId, examId: review.examId,
        completedAt: review.completedAt, markedAt: decidedAt, marks: body.marks }] },
    actor, { trustedAi: true, examRevisions: { [review.examId]: review.examRevision },
      requireNewAttempts: review.requestedByRole === 'student',
      within: (draft, importId) => {
        const current = this.pendingReview(draft, id, body.version);
        const changed = current.suggestions.filter(s => {
          const mark = body.marks.find(m => m.questionId === s.questionId);
          return s.status !== 'suggested' || !mark || mark.outcome !== s.outcome || mark.score !== s.score;
        }).map(s => s.questionId);
        Object.assign(current, { status: 'confirmed', version: current.version + 1, decidedAt, decidedBy: actor.id,
          importId, changedQuestionIds: changed });
        const job = draft.scanJobs[current.jobId];
        if (job) { Object.assign(job, { status: 'completed', importId, updatedAt: decidedAt }); delete job.error; }
        draft.audit.push({ id: randomUUID(), at: decidedAt, actorId: actor.id, action: 'review.confirmed',
          recordIds: [`reviews/${id}`, ...changed.map(q => `changed/${q}`)], importId, policyVersion: current.policyVersion });
      } });
    return { review: (await this.repository.read()).reviews[id]!, import: result };
  }
  /** Tutor rejects the AI result (e.g. wrong pages, unusable scan). Nothing is recorded as a mark. */
  async reject(id: string, input: unknown, actor: Principal) {
    requireStaff(actor);
    const body = ReviewRejectSchema.parse(input);
    return this.repository.transact(draft => {
      const review = draft.reviews[id];
      requireCondition(review, 'NOT_FOUND', 'Review was not found', 404);
      requireStudent(actor, review.studentId);
      const current = this.pendingReview(draft, id, body.version);
      const decidedAt = new Date().toISOString();
      Object.assign(current, { status: 'rejected', version: current.version + 1, decidedAt, decidedBy: actor.id, reason: body.reason });
      const job = draft.scanJobs[current.jobId];
      if (job) Object.assign(job, { status: 'rejected', updatedAt: decidedAt, error: { code: 'REVIEW_REJECTED', message: body.reason } });
      draft.audit.push({ id: randomUUID(), at: decidedAt, actorId: actor.id, action: 'review.rejected',
        recordIds: [`reviews/${id}`], policyVersion: current.policyVersion });
      return current;
    });
  }
  private pendingReview(draft: State, id: string, version: number) {
    const review = draft.reviews[id];
    requireCondition(review, 'NOT_FOUND', 'Review was not found', 404);
    requireCondition(review.status === 'pending', 'REVIEW_NOT_PENDING', `Review is already ${review.status}`, 409);
    requireCondition(review.version === version, 'REVIEW_VERSION_CONFLICT', 'Review changed since you opened it; reload and try again', 409);
    return review;
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
  /** A confirmed review commits the import and the job together; repair a job left behind by an older version. */
  private restoreCommitted(state: State, job: ScanJob): boolean {
    const receipt = state.imports[`ai-scan/${job.id}`];
    const attempt = state.attempts[job.attemptId];
    if (!receipt || attempt?.importId !== receipt.id || attempt.studentId !== job.studentId || attempt.examId !== job.examId) return false;
    if (job.status !== 'completed') {
      job.status = 'completed'; job.importId = receipt.id; job.updatedAt = new Date().toISOString(); delete job.error;
      state.audit.push({ id: randomUUID(), at: job.updatedAt, actorId: job.requestedBy, action: 'scan.recovered',
        recordIds: [job.id], importId: receipt.id, policyVersion: job.policyVersion });
    }
    return true;
  }
  async idle() { await this.submissions; await Promise.all([...this.active.values()]); }
}

import { createHash, randomUUID } from 'node:crypto';
import { ImportSchema, PolicySchema, type Principal } from '../../../packages/contract/src/index.js';
import { derive } from '../domain/derive.js';
import { AppError, requireCondition } from '../domain/errors.js';
import { assertUnique, validateReferences } from '../domain/validate.js';
import type { State } from '../domain/state.js';
import type { Repository } from '../repositories/repository.js';
import { requireManager, requireStaff, requireStudent } from '../auth/permissions.js';

export function stable(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}
export const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');

export class ImportService {
  constructor(private repository: Repository, private now = () => new Date().toISOString()) {}
  /**
   * constraints.within runs first inside the same transaction as the import. The review flow uses it to check
   * and close the review atomically with writing the attempt: if either fails, nothing is saved.
   */
  async ingest(input: unknown, actor: Principal, constraints: { requireNewAttempts?: boolean; examRevisions?: Record<string, number>;
    trustedAi?: boolean; within?: (draft: State, importId: string) => void } = {}) {
    requireStaff(actor);
    const batch = ImportSchema.parse(input);
    requireCondition(batch.source !== 'ai-scan' || constraints.trustedAi, 'RESERVED_SOURCE', 'ai-scan is reserved for the configured scan service', 403);
    const id = `${batch.source}/${batch.batchId}`;
    const digest = hash(batch);
    const studentIds = [...new Set([...batch.students.map(s => s.id), ...batch.attempts.map(a => a.studentId),
      ...batch.activities.map(a => a.studentId), ...batch.masteryObservations.map(o => o.studentId)])].sort();
    for (const studentId of studentIds) requireStudent(actor, studentId);
    // Shared curriculum is global. Only managers may create or change it; teachers may repeat identical snapshots.
    return this.repository.transact(state => {
      constraints.within?.(state, id);
      const existing = state.imports[id];
      if (existing) {
        requireCondition(existing.hash === digest, 'IDEMPOTENCY_CONFLICT', 'Reuse the batch ID only with identical content', 409);
        if (existing.createdBy !== actor.id && actor.role !== 'manager') throw new AppError(403, 'FORBIDDEN', 'Import belongs to another actor');
        return { ...existing, replayed: true };
      }
      for (const [examId, revision] of Object.entries(constraints.examRevisions ?? {})) {
        requireCondition(state.exams[examId]?.revision === revision, 'EXAM_REVISION_CHANGED', 'Exam changed during AI processing; generate new answer sheets', 409);
      }
      if (constraints.requireNewAttempts) {
        for (const attempt of batch.attempts) requireCondition(!state.attempts[attempt.id], 'ATTEMPT_ALREADY_EXISTS', 'A recorded attempt cannot be replaced by a student scan', 409);
      }
      const recordIds: string[] = [];
      let changedRecords = 0;
      const groups = ['students', 'knowledgePoints', 'exams', 'attempts', 'masteryObservations', 'activities', 'resources'] as const;
      for (const group of groups) {
        assertUnique(batch[group].map(record => record.id), group);
        const target = state[group] as Record<string, { id: string; revision: number; [key: string]: unknown }>;
        for (const record of batch[group]) {
          const old = target[record.id];
          const { source: _source, importId: _importId, ...oldValue } = (old ?? {}) as Record<string, unknown>;
          if (old) {
            requireCondition(record.revision >= old.revision, 'STALE_REVISION', `${group}/${record.id} has a newer revision`, 409);
            if (record.revision === old.revision) {
              requireCondition(stable(record) === stable(oldValue), 'REVISION_CONFLICT', `Changed ${group}/${record.id} requires a higher revision`, 409);
              continue;
            }
          }
          if (['knowledgePoints', 'exams', 'resources'].includes(group)) requireManager(actor);
          if (old && 'studentId' in old) {
            requireStudent(actor, old.studentId as string);
            requireCondition(!('studentId' in record) || old.studentId === record.studentId,
              'IMMUTABLE_IDENTITY', 'A record cannot move between students', 409);
          }
          if (group === 'attempts' && old && 'examId' in record) {
            requireCondition(old.examId === record.examId, 'IMMUTABLE_IDENTITY', 'An attempt cannot move between exams', 409);
          }
          if (group === 'exams' && old && Object.values(state.attempts).some(a => a.examId === record.id)) {
            throw new AppError(409, 'EXAM_IN_USE', 'Create a new exam ID after attempts exist; historical scores must retain their rubric');
          }
          target[record.id] = { ...record, ...(group === 'attempts' ? { source: batch.source, importId: id } : {}) };
          changedRecords += 1;
          recordIds.push(`${group}/${record.id}`);
        }
      }
      validateReferences(state);
      state.projections = derive(state);
      const completedAt = this.now();
      const result = { id, source: batch.source, batchId: batch.batchId, hash: digest,
        createdBy: actor.id, status: 'completed' as const, completedAt, changedRecords,
        studentIds, policyVersion: state.activePolicy };
      state.imports[id] = result;
      state.audit.push({ id: randomUUID(), at: completedAt, actorId: actor.id, action: 'import.completed',
        recordIds, importId: id, policyVersion: state.activePolicy });
      state.outbox.push({ id: randomUUID(), at: completedAt, type: 'import.completed', referenceId: id, studentIds, policyVersion: state.activePolicy });
      return { ...result, replayed: false };
    });
  }
  async activatePolicy(input: unknown, actor: Principal) {
    requireManager(actor);
    const policy = PolicySchema.parse(input);
    return this.repository.transact(state => {
      const old = state.policies[policy.version];
      requireCondition(!old || stable(old) === stable(policy), 'POLICY_VERSION_CONFLICT', 'Policy versions are immutable', 409);
      if (state.activePolicy === policy.version) return policy;
      state.policies[policy.version] = policy;
      state.activePolicy = policy.version;
      state.projections = derive(state);
      state.audit.push({ id: randomUUID(), at: this.now(), actorId: actor.id, action: 'policy.activated', recordIds: [policy.version], policyVersion: policy.version });
      state.outbox.push({ id: randomUUID(), at: this.now(), type: 'policy.activated', referenceId: policy.version, studentIds: [], policyVersion: policy.version });
      return policy;
    });
  }
}

/** Facts for the teammate-owned report assembler. No attendance or feedback is inferred from marking. */
export function reportFacts(state: State, date: string, studentIds: (id: string) => boolean) {
  const day = (instant: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(instant));
  const attempts = Object.values(state.attempts).filter(a => studentIds(a.studentId));
  return { date, timeZone: 'Australia/Sydney',
    markedAttempts: attempts.filter(a => day(a.markedAt) === date).map(a => ({ id: a.id, studentId: a.studentId, examId: a.examId, revision: a.revision, markedAt: a.markedAt })),
    completedAssessments: attempts.filter(a => day(a.completedAt) === date).map(a => ({ id: a.id, studentId: a.studentId, kind: state.exams[a.examId]!.kind, completedAt: a.completedAt })),
    activities: Object.values(state.activities).filter(a => studentIds(a.studentId) && day(a.occurredAt) === date),
    followUps: state.projections.followUps.filter(f => studentIds(f.studentId)),
    coverage: { activities: 'imported_records_only', assessments: 'imported_records_only' },
    policyVersion: state.activePolicy, stateRevision: state.revision };
}

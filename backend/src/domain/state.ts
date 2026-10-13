import type { Activity, Attempt, Exam, KnowledgePoint, MarkingReview, MasteryObservation, Policy,
  Projections, Resource, ScanJob, Student } from '../../../packages/contract/src/index.js';
export interface StoredAttempt extends Attempt { source: string; importId: string }
export interface ImportResult {
  id: string; source: string; batchId: string; hash: string; createdBy: string;
  status: 'completed'; completedAt: string; changedRecords: number;
  studentIds: string[]; policyVersion: string;
}
export interface AuditEntry {
  id: string; at: string; actorId: string; action: string; recordIds: string[];
  importId?: string; policyVersion: string;
}
export interface DomainEvent {
  id: string; at: string; type: 'import.completed' | 'policy.activated' | 'notification.requested' | 'review.requested';
  referenceId: string; studentIds: string[]; policyVersion: string;
}
export interface State {
  schemaVersion: 1; revision: number; activePolicy: string;
  students: Record<string, Student>;
  knowledgePoints: Record<string, KnowledgePoint>;
  exams: Record<string, Exam>;
  attempts: Record<string, StoredAttempt>;
  masteryObservations: Record<string, MasteryObservation>;
  activities: Record<string, Activity>;
  resources: Record<string, Resource>;
  policies: Record<string, Policy>;
  imports: Record<string, ImportResult>;
  audit: AuditEntry[];
  outbox: DomainEvent[];
  scanJobs: Record<string, ScanJob>;
  /** AI scan results waiting for, or decided by, a tutor. */
  reviews: Record<string, MarkingReview>;
  projections: Projections;
}
export const defaultPolicy: Policy = {
  version: 'policy-1', masteredMinRatio: 0.8, partialMinRatio: 0.4, minimumEvidence: 2,
  highScoreMinRatio: 0.8, mediumScoreMinRatio: 0.5, aiMinimumConfidence: 0.8,
};
export function emptyState(): State {
  return { schemaVersion: 1, revision: 0, activePolicy: defaultPolicy.version,
    students: {}, knowledgePoints: {}, exams: {}, attempts: {}, masteryObservations: {},
    activities: {}, resources: {}, policies: { [defaultPolicy.version]: structuredClone(defaultPolicy) },
    imports: {}, audit: [], outbox: [], scanJobs: {}, reviews: {},
    projections: { marking: [], progress: [], examStatistics: [], followUps: [] } };
}
/** Fill collections added after a state was first saved (e.g. reviews), so older data files still load. */
export function withDefaults(state: State): State {
  const base = emptyState();
  for (const key of Object.keys(base) as (keyof State)[]) {
    if (state[key] === undefined) (state as unknown as Record<string, unknown>)[key] = base[key];
  }
  return state;
}

import { z } from 'zod';

export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/)
  .refine(value => !Object.hasOwn(Object.prototype, value), 'Reserved identifier');
export const Instant = z.iso.datetime({ offset: true });
const Revision = z.number().int().positive();
const Text = z.string().min(1).max(500);
export const Role = z.enum(['teacher', 'manager', 'student']);
export const PrincipalSchema = z.object({
  id: Id, role: Role, studentIds: z.array(Id).max(1000),
}).strict();
export type Principal = z.infer<typeof PrincipalSchema>;

export const StudentSchema = z.object({
  id: Id, revision: Revision, name: z.string().min(1).max(120),
  yearLevel: z.number().int().min(1).max(13).optional(),
}).strict();
export const KnowledgePointSchema = z.object({
  id: Id, revision: Revision, moduleId: Id, name: Text,
}).strict();
export const QuestionSchema = z.object({
  id: Id, knowledgePointIds: z.array(Id).min(1).max(10),
  maxScore: z.number().positive().max(1000), prompt: z.string().max(2000),
  rubric: z.string().max(6000).optional(),
}).strict();
export const ExamSchema = z.object({
  id: Id, revision: Revision, moduleId: Id, title: Text,
  kind: z.enum(['module_test', 'sac', 'practice_sac']),
  questions: z.array(QuestionSchema).min(1).max(100),
}).strict();
export const Outcome = z.enum(['DONE', 'W', 'C', 'BLANK']);
export const MarkSchema = z.object({
  questionId: Id, outcome: Outcome, score: z.number().min(0).max(1000),
  studentAnswer: z.string().max(6000).optional(),
  feedback: z.string().max(2000).optional(),
}).strict();
export const AttemptSchema = z.object({
  id: Id, revision: Revision, studentId: Id, examId: Id,
  completedAt: Instant, markedAt: Instant,
  marks: z.array(MarkSchema).min(1).max(100),
}).strict();
export const Mastery = z.enum(['mastered', 'partial', 'not_understood', 'not_covered']);
export const MasteryObservationSchema = z.object({
  id: Id, revision: Revision, studentId: Id, knowledgePointId: Id,
  mastery: Mastery, assessedAt: Instant, reason: Text,
}).strict();
export const ResourceSchema = z.object({
  id: Id, revision: Revision, title: Text,
  knowledgePointIds: z.array(Id).min(1).max(30),
  url: z.url().max(2000).refine(value => value.startsWith('https://'), 'Use an HTTPS resource URL'),
}).strict();
const activityBase = { id: Id, revision: Revision, studentId: Id, occurredAt: Instant };
export const ActivitySchema = z.discriminatedUnion('kind', [
  z.object({ ...activityBase, kind: z.literal('attendance'), mode: z.enum(['onsite', 'online']) }).strict(),
  z.object({ ...activityBase, kind: z.literal('qa_completed'), questionCount: z.number().int().min(1).max(500) }).strict(),
  z.object({ ...activityBase, kind: z.literal('parent_feedback_completed'), referenceId: Id }).strict(),
]);
export const PolicySchema = z.object({
  version: Id,
  masteredMinRatio: z.number().min(0).max(1),
  partialMinRatio: z.number().min(0).max(1),
  minimumEvidence: z.number().int().min(1).max(20),
  highScoreMinRatio: z.number().min(0).max(1),
  mediumScoreMinRatio: z.number().min(0).max(1),
  aiMinimumConfidence: z.number().min(0).max(1),
}).strict().refine(p => p.masteredMinRatio > p.partialMinRatio && p.highScoreMinRatio > p.mediumScoreMinRatio,
  'Upper thresholds must be greater than lower thresholds');
export const ImportSchema = z.object({
  schemaVersion: z.literal('1.0'), source: Id, batchId: Id,
  students: z.array(StudentSchema).max(500).default([]),
  knowledgePoints: z.array(KnowledgePointSchema).max(500).default([]),
  exams: z.array(ExamSchema).max(50).default([]),
  attempts: z.array(AttemptSchema).max(200).default([]),
  masteryObservations: z.array(MasteryObservationSchema).max(1000).default([]),
  activities: z.array(ActivitySchema).max(1000).default([]),
  resources: z.array(ResourceSchema).max(500).default([]),
}).strict().refine(v => v.students.length + v.knowledgePoints.length + v.exams.length + v.attempts.length +
  v.masteryObservations.length + v.activities.length + v.resources.length > 0, 'Import must contain records');

export type Student = z.infer<typeof StudentSchema>;
export type KnowledgePoint = z.infer<typeof KnowledgePointSchema>;
export type Exam = z.infer<typeof ExamSchema>;
export type Mark = z.infer<typeof MarkSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type MasteryObservation = z.infer<typeof MasteryObservationSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type ImportBatch = z.infer<typeof ImportSchema>;

export interface Evidence { attemptId: string; questionId: string; revision: number }
export interface MarkingRow extends Evidence {
  studentId: string; examId: string; knowledgePointIds: string[];
  outcome: Mark['outcome']; score: number; maxScore: number;
  feedback?: string; studentAnswer?: string; source: string; importId: string; policyVersion: string;
}
export interface ProgressRow {
  studentId: string; knowledgePointId: string; mastery: z.infer<typeof Mastery> | null;
  ratio: number | null; evidence: Evidence[]; observationId?: string;
  reason: string; policyVersion: string;
}
export interface ExamStatisticsRow {
  attemptId: string; studentId: string; examId: string; moduleId: string;
  kind: Exam['kind']; attemptNumber: number; score: number; maxScore: number;
  ratio: number; band: 'high' | 'medium' | 'low'; completedAt: string;
  markedAt: string; revision: number; policyVersion: string;
}
export interface FollowUp {
  id: string; studentId: string; knowledgePointId: string;
  kind: 'concept_review' | 'careless_check' | 'finish_questions';
  instruction: string; evidence: Evidence[]; resourceIds: string[]; policyVersion: string;
}
export interface Projections {
  marking: MarkingRow[]; progress: ProgressRow[]; examStatistics: ExamStatisticsRow[];
  followUps: FollowUp[];
}

export const AnswerSheetRequestSchema = z.object({
  studentId: Id, examId: Id, attemptId: Id,
}).strict();
export const ScanRequestSchema = AnswerSheetRequestSchema.extend({
  jobId: Id, revision: Revision, completedAt: Instant,
  pages: z.array(z.object({ pageNumber: z.number().int().min(1).max(4),
    imageBase64: z.string().min(1).max(8_400_000) }).strict()).min(1).max(4),
}).strict();
export type ScanRequest = z.infer<typeof ScanRequestSchema>;
export interface ScanJob {
  id: string; hash: string; studentId: string; examId: string; attemptId: string;
  requestedBy: string; status: 'queued' | 'processing' | 'completed' | 'failed';
  policyVersion: string; examRevision: number;
  createdAt: string; updatedAt: string; importId?: string;
  error?: { code: string; message: string }; tries: number;
}
export const RecognitionSchema = z.object({
  text: z.string().max(6000), confidence: z.number().min(0).max(1),
}).strict();
export const AiGradeSchema = z.object({
  outcome: Outcome, score: z.number().nonnegative().max(1000),
  feedback: z.string().max(2000), confidence: z.number().min(0).max(1),
}).strict();

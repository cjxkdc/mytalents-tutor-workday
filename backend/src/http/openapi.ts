import { z } from 'zod';
import { AnswerSheetRequestSchema, ImportSchema, PolicySchema, ScanRequestSchema,
  StudentSchema, KnowledgePointSchema, ExamSchema, AttemptSchema, MasteryObservationSchema,
  ActivitySchema, ResourceSchema, RecognitionSchema, AiGradeSchema, ReviewConfirmSchema, ReviewRejectSchema } from '../../../packages/contract/src/index.js';
const schemas = { ImportBatch: ImportSchema, Policy: PolicySchema, AnswerSheetRequest: AnswerSheetRequestSchema,
  ScanRequest: ScanRequestSchema, Student: StudentSchema, KnowledgePoint: KnowledgePointSchema,
  Exam: ExamSchema, Attempt: AttemptSchema, MasteryObservation: MasteryObservationSchema,
  Activity: ActivitySchema, Resource: ResourceSchema, Recognition: RecognitionSchema, AiGrade: AiGradeSchema,
  ReviewConfirm: ReviewConfirmSchema, ReviewReject: ReviewRejectSchema };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (description: string) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
const pathParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
function operation(summary: string, body?: string, parameters: unknown[] = [], status = '200') {
  return { summary, security: [{ bearerAuth: [] }, { demoUser: [] }], parameters,
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(body) } } } } : {}),
    responses: { [status]: response('Success; see docs/api.md for typed response envelopes'),
      '400': response('Malformed request'), '401': response('Authentication required'), '403': response('Outside assigned role or student scope'),
      '409': response('ID, revision or schema conflict'), '422': response('Validation failure'), '503': response('Provider unavailable; retry identical request') } };
}
export function openApi() {
  return { openapi: '3.1.0', info: { title: 'MyTalents backend', version: '1.0.0',
    description: 'Backend contracts. AI scan grading waits for tutor review before marks become official. Default demo auth is loopback-only.' },
  servers: [{ url: 'http://127.0.0.1:3100' }], paths: {
    '/health': { get: { summary: 'Process liveness', responses: { '200': response('Alive') } } },
    '/api/v1/me': { get: operation('Authenticated principal') },
    '/api/v1/imports': { post: operation('Atomic import and automatic derivation', 'ImportBatch', [], '201') },
    '/api/v1/imports/{source}/{batchId}': { get: operation('Durable import receipt', undefined, [pathParam('source'), pathParam('batchId')]) },
    '/api/v1/students': { get: operation('Assigned students') },
    '/api/v1/exams': { get: operation('Exam catalog; student responses omit rubrics') },
    '/api/v1/knowledge-points': { get: operation('Knowledge point catalog') },
    '/api/v1/resources': { get: operation('Supplemental learning resources') },
    '/api/v1/students/{studentId}/learning-state': { get: operation('Progress, exams, follow-ups and resources', undefined, [pathParam('studentId')]) },
    '/api/v1/students/{studentId}/mistakes': { get: operation('Incorrect, careless and blank answers with evidence', undefined, [pathParam('studentId')]) },
    '/api/v1/tables/{name}': { get: operation('Three derived exhibits', undefined, [
      { name: 'name', in: 'path', required: true, schema: { enum: ['marking', 'progress', 'examStatistics'] } },
      { name: 'studentId', in: 'query', schema: { type: 'string' } },
      { name: 'cursor', in: 'query', schema: { type: 'integer', minimum: 0 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
    ]) },
    '/api/v1/policies': { get: operation('Versioned policies'), post: operation('Activate immutable policy version', 'Policy') },
    '/api/v1/audit': { get: operation('Manager-only audit log') },
    '/api/v1/events': { get: operation('Notification outbox; no external sends') },
    '/api/v1/report-facts': { get: operation('Evidence for teammate-owned daily report assembly', undefined, [
      { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
    ]) },
    '/api/v1/sheets-schema': { get: operation('App-owned Sheets tab names and columns') },
    '/api/v1/answer-sheets': { post: operation('Generate printable SVG answer sheets with QR identity', 'AnswerSheetRequest') },
    '/api/v1/scan-jobs': { post: operation('Queue scan recognition and AI grading; result waits for tutor review', 'ScanRequest', [], '202') },
    '/api/v1/scan-jobs/{jobId}': { get: operation('Read scan status or retry instructions', undefined, [pathParam('jobId')]) },
    '/api/v1/reviews': { get: operation('Staff: AI scan results to review', undefined, [
      { name: 'status', in: 'query', schema: { enum: ['pending', 'confirmed', 'rejected'] } },
      { name: 'cursor', in: 'query', schema: { type: 'integer', minimum: 0 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
    ]) },
    '/api/v1/reviews/{reviewId}': { get: operation('Staff: one review with per-question AI suggestions', undefined, [pathParam('reviewId')]) },
    '/api/v1/reviews/{reviewId}/confirm': { post: operation('Tutor confirms or corrects every mark; writes the attempt and three tables', 'ReviewConfirm', [pathParam('reviewId')]) },
    '/api/v1/reviews/{reviewId}/reject': { post: operation('Tutor rejects the AI result; nothing is recorded', 'ReviewReject', [pathParam('reviewId')]) },
  }, components: { securitySchemes: {
    bearerAuth: { type: 'http', scheme: 'bearer' },
    demoUser: { type: 'apiKey', in: 'header', name: 'X-Demo-User', description: 'Only enabled on loopback in demo mode' },
  }, schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })])) } };
}

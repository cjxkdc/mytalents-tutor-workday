import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z, ZodError } from 'zod';
import { AnswerSheetRequestSchema, Id, type Principal } from '../../../packages/contract/src/index.js';
import type { Authenticator } from '../auth/authenticator.js';
import { canReadStudent, requireManager, requireStaff, requireStudent } from '../auth/permissions.js';
import { AppError, requireCondition } from '../domain/errors.js';
import { emptyState } from '../domain/state.js';
import type { Repository } from '../repositories/repository.js';
import { stateTables } from '../repositories/sheets.js';
import { ImportService, reportFacts } from '../services/imports.js';
import { ScanService } from '../services/scans.js';
import { UnconfiguredAi, type AiProvider } from '../integrations/ai.js';
import { openApi } from './openapi.js';
import { moduleDependencies, type BackendModule } from '../modules.js';

declare module 'fastify' { interface FastifyRequest { principal: Principal } }
const Page = z.object({ cursor: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(100) });
function paginate<T>(items: T[], query: unknown, revision: number) {
  const { cursor, limit } = Page.parse(query);
  return { items: items.slice(cursor, cursor + limit), total: items.length,
    nextCursor: cursor + limit < items.length ? cursor + limit : null, stateRevision: revision };
}
export function createApp(options: { repository: Repository; auth: Authenticator; corsOrigins?: string[]; ai?: AiProvider; modules?: BackendModule[] }) {
  const app = Fastify({ logger: false, bodyLimit: 9_000_000, requestTimeout: 30_000 });
  const repository = options.repository;
  const imports = new ImportService(repository);
  const ai = options.ai ?? new UnconfiguredAi();
  const scans = new ScanService(repository, ai, imports);
  const dependencies = moduleDependencies(repository, ai, imports);
  app.register(cors, { origin: options.corsOrigins ?? [], methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Demo-User'] });
  app.decorateRequest('principal');
  app.addHook('onRequest', async request => {
    if (request.method === 'OPTIONS' || ['/health', '/openapi.json'].includes(request.url.split('?')[0]!)) return;
    request.principal = options.auth.authenticate(request.headers);
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ error: { code: 'VALIDATION_FAILED', message: 'Request does not match the contract',
      issues: error.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })), requestId: request.id } });
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, requestId: request.id } });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: 'BAD_REQUEST', message: error.statusCode === 413 ? 'Request body is too large' : 'Malformed request', requestId: request.id } });
    }
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Operation failed; use the request ID for diagnostics', requestId: request.id } });
  });
  app.get('/health', async () => ({ status: 'ok', service: 'mytalents-backend', repository: repository.kind }));
  app.get('/openapi.json', async () => openApi());
  app.get('/api/v1/me', async request => request.principal);
  app.post('/api/v1/imports', async (request, reply) => {
    const result = await imports.ingest(request.body, request.principal);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
  app.get('/api/v1/imports/:source/:batchId', async request => {
    requireStaff(request.principal);
    const { source, batchId } = z.object({ source: Id, batchId: Id }).parse(request.params);
    const state = await repository.read();
    const result = state.imports[`${source}/${batchId}`];
    requireCondition(result, 'NOT_FOUND', 'Import was not found', 404);
    if (result.createdBy !== request.principal.id) requireManager(request.principal);
    return result;
  });
  app.get('/api/v1/students', async request => {
    const state = await repository.read();
    return paginate(Object.values(state.students).filter(s => canReadStudent(request.principal, s.id)), request.query, state.revision);
  });
  app.get('/api/v1/exams', async request => {
    const state = await repository.read();
    return paginate(Object.values(state.exams).map(exam => request.principal.role === 'student' ? {
      ...exam, questions: exam.questions.map(({ rubric: _rubric, ...question }) => question),
    } : exam), request.query, state.revision);
  });
  app.get('/api/v1/knowledge-points', async request => {
    const state = await repository.read();
    return paginate(Object.values(state.knowledgePoints), request.query, state.revision);
  });
  app.get('/api/v1/resources', async request => {
    const state = await repository.read();
    return paginate(Object.values(state.resources), request.query, state.revision);
  });
  app.get('/api/v1/students/:studentId/learning-state', async request => {
    const { studentId } = z.object({ studentId: Id }).parse(request.params);
    requireStudent(request.principal, studentId);
    const state = await repository.read();
    requireCondition(state.students[studentId], 'NOT_FOUND', 'Student was not found', 404);
    const followUps = state.projections.followUps.filter(r => r.studentId === studentId);
    const resourceIds = new Set(followUps.flatMap(f => f.resourceIds));
    return { student: state.students[studentId], progress: state.projections.progress.filter(r => r.studentId === studentId),
      exams: state.projections.examStatistics.filter(r => r.studentId === studentId), followUps,
      resources: Object.values(state.resources).filter(r => resourceIds.has(r.id)), policyVersion: state.activePolicy, stateRevision: state.revision };
  });
  app.get('/api/v1/students/:studentId/mistakes', async request => {
    const { studentId } = z.object({ studentId: Id }).parse(request.params);
    requireStudent(request.principal, studentId);
    const state = await repository.read();
    requireCondition(state.students[studentId], 'NOT_FOUND', 'Student was not found', 404);
    return paginate(state.projections.marking.filter(r => r.studentId === studentId && r.outcome !== 'DONE'), request.query, state.revision);
  });
  app.get('/api/v1/tables/:name', async request => {
    const { name } = z.object({ name: z.enum(['marking', 'progress', 'examStatistics']) }).parse(request.params);
    const { studentId } = z.object({ studentId: Id.optional() }).parse(request.query);
    if (studentId) requireStudent(request.principal, studentId);
    const state = await repository.read();
    const rows = state.projections[name].filter(r => canReadStudent(request.principal, r.studentId) && (!studentId || r.studentId === studentId));
    return paginate(rows, request.query, state.revision);
  });
  app.get('/api/v1/policies', async request => {
    requireStaff(request.principal);
    const state = await repository.read();
    return { activeVersion: state.activePolicy, items: Object.values(state.policies) };
  });
  app.post('/api/v1/policies', async request => imports.activatePolicy(request.body, request.principal));
  app.get('/api/v1/audit', async request => {
    requireManager(request.principal);
    const state = await repository.read();
    return paginate(state.audit, request.query, state.revision);
  });
  app.get('/api/v1/events', async request => {
    requireStaff(request.principal);
    const state = await repository.read();
    const events = state.outbox.filter(e => !e.studentIds.length || e.studentIds.some(id => canReadStudent(request.principal, id)))
      .map(e => ({ ...e, studentIds: e.studentIds.filter(id => canReadStudent(request.principal, id)) }));
    return paginate(events, request.query, state.revision);
  });
  app.get('/api/v1/report-facts', async request => {
    requireStaff(request.principal);
    const { date } = z.object({ date: z.iso.date() }).parse(request.query);
    return reportFacts(await repository.read(), date, id => canReadStudent(request.principal, id));
  });
  app.get('/api/v1/sheets-schema', async request => {
    requireStaff(request.principal);
    return { schemaVersion: 1, tables: stateTables(emptyState()).map(t => ({ name: t.title, columns: t.rows[0] })) };
  });
  app.post('/api/v1/answer-sheets', async request => scans.template(AnswerSheetRequestSchema.parse(request.body), request.principal));
  app.post('/api/v1/scan-jobs', async (request, reply) => reply.code(202).send(await scans.submit(request.body, request.principal)));
  app.get('/api/v1/scan-jobs/:jobId', async request => {
    const { jobId } = z.object({ jobId: Id }).parse(request.params);
    const state = await repository.read();
    const job = state.scanJobs[jobId];
    requireCondition(job, 'NOT_FOUND', 'Scan job was not found', 404);
    requireStudent(request.principal, job.studentId);
    return job;
  });
  app.addHook('onClose', async () => { await scans.idle(); await repository.close(); });
  for (const register of options.modules ?? []) {
    app.register(async instance => { await register(instance, dependencies); });
  }
  return { app, imports, scans };
}

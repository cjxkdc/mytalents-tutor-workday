import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { MemoryRepository } from '../src/repositories/repository.js';
import { DemoAuthenticator, TokenAuthenticator } from '../src/auth/authenticator.js';
import { readConfig } from '../src/config.js';
import { fixture } from './fixtures.js';

test('HTTP workflow imports once, serves three tables, scopes students and hides rubrics', async () => {
  const { app } = createApp({ repository: new MemoryRepository(), auth: new DemoAuthenticator() });
  try {
    const headers = { 'x-demo-user': 'demo-manager' };
    assert.equal((await app.inject('/health')).statusCode, 200);
    assert.equal((await app.inject('/api/v1/students')).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/imports', headers, payload: fixture() })).statusCode, 201);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/imports', headers, payload: fixture() })).statusCode, 200);
    for (const name of ['marking', 'progress', 'examStatistics']) {
      const response = await app.inject({ url: `/api/v1/tables/${name}?limit=1`, headers });
      assert.equal(response.statusCode, 200); assert.equal(response.json().items.length, 1);
    }
    const learnerHeaders = { 'x-demo-user': 'demo-student-1' };
    const students = await app.inject({ url: '/api/v1/students', headers: learnerHeaders });
    assert.deepEqual(students.json().items.map((s: { id: string }) => s.id), ['demo-student-1']);
    assert.equal((await app.inject({ url: '/api/v1/students/demo-student-2/learning-state', headers: learnerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/v1/tables/marking?studentId=demo-student-2', headers: learnerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/v1/audit', headers: learnerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/imports', headers: learnerHeaders, payload: fixture() })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/v1/exams', headers: learnerHeaders })).body.includes('rubric'), false);
    assert.equal((await app.inject({ url: '/api/v1/students/demo-student-1/mistakes', headers: learnerHeaders })).json().total, 3);
    assert.equal((await app.inject({ url: '/api/v1/report-facts?date=2026-10-13', headers })).json().markedAttempts.length, 1);
    assert.equal((await app.inject({ url: '/api/v1/tables/marking?limit=-1', headers })).statusCode, 422);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/imports', headers, payload: { invalid: true } })).statusCode, 422);
    const schema = await app.inject('/openapi.json');
    assert.equal(schema.statusCode, 200); assert.equal(schema.json().openapi, '3.1.0');
    assert.ok(schema.json().components.schemas.ImportBatch);
  } finally { await app.close(); }
});
test('token auth takes identity only from server configuration, not forged role headers', () => {
  const token = 'a'.repeat(40);
  const auth = new TokenAuthenticator(JSON.stringify([{ token, id: 'learner', role: 'student', studentIds: ['demo-student-1'] }]));
  assert.throws(() => auth.authenticate({ 'x-demo-user': 'demo-manager' }), { code: 'UNAUTHENTICATED' });
  assert.throws(() => auth.authenticate({ authorization: 'Bearer wrong' }), { code: 'UNAUTHENTICATED' });
  assert.equal(auth.authenticate({ authorization: `Bearer ${token}`, 'x-role': 'manager' }).role, 'student');
});
test('demo auth cannot bind publicly, serve real Sheets or run in production', () => {
  assert.throws(() => readConfig({ HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ NODE_ENV: 'production' }));
  assert.throws(() => readConfig({ REPOSITORY: 'sheets', GOOGLE_SPREADSHEET_ID: 'id' }));
  assert.throws(() => readConfig({ AUTH_MODE: 'token' }));
  assert.equal(readConfig({}).HOST, '127.0.0.1');
});
test('failed storage does not return a successful import or expose provider credentials', async () => {
  class FailedRepository extends MemoryRepository {
    override async transact<T>(): Promise<T> { throw new Error('private-service-account-credential'); }
  }
  const { app } = createApp({ repository: new FailedRepository(), auth: new DemoAuthenticator() });
  try {
    const result = await app.inject({ method: 'POST', url: '/api/v1/imports', headers: { 'x-demo-user': 'demo-manager' }, payload: fixture() });
    assert.equal(result.statusCode, 500); assert.equal(result.body.includes('private-service-account'), false);
  } finally { await app.close(); }
});
test('missing AI configuration fails explicitly instead of fabricating grades', async () => {
  const { app } = createApp({ repository: new MemoryRepository(), auth: new DemoAuthenticator() });
  try {
    const result = await app.inject({ method: 'POST', url: '/api/v1/scan-jobs', headers: { 'x-demo-user': 'demo-manager' }, payload: {
      studentId: 'demo-student-1', examId: 'algebra-test-1', attemptId: 'new-attempt', jobId: 'new-job', revision: 1,
      completedAt: '2026-10-13T04:00:00Z', pages: [{ pageNumber: 1, imageBase64: 'AAAA' }],
    } });
    assert.equal(result.statusCode, 503); assert.equal(result.json().error.code, 'AI_NOT_CONFIGURED');
  } finally { await app.close(); }
});

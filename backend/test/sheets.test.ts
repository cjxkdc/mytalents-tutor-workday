import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SheetsRepository, type SheetsTransport } from '../src/repositories/sheets.js';
import { ImportService } from '../src/services/imports.js';
import { fixture, manager } from './fixtures.js';
import { AppError } from '../src/domain/errors.js';

class FakeSheets implements SheetsTransport {
  sheets = [{ properties: { sheetId: 0, title: 'Unrelated', gridProperties: { rowCount: 100, columnCount: 10 } } }];
  values = new Map<number, unknown[][]>([[0, [['keep this data']]]]);
  writes = 0;
  failBefore = false;
  failAfter = false;
  lastRequests: any[] = [];
  async request<T>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
    if (method === 'GET' && path.includes('values:batchGet')) {
      const params = new URLSearchParams(path.split('?')[1]);
      return { valueRanges: params.getAll('ranges').map(range => {
        const title = range.split("'")[1];
        const sheet = this.sheets.find(s => s.properties.title === title);
        return { values: sheet ? this.values.get(sheet.properties.sheetId) : undefined };
      }) } as T;
    }
    if (method === 'GET') return { sheets: structuredClone(this.sheets) } as T;
    if (this.failBefore) { this.failBefore = false; throw new AppError(503, 'SHEETS_UNAVAILABLE', 'Retry'); }
    this.writes++; this.lastRequests = body.requests;
    for (const request of body.requests) {
      if (request.addSheet) this.sheets.push(request.addSheet);
      if (request.updateSheetProperties) Object.assign(this.sheets.find(s => s.properties.sheetId === request.updateSheetProperties.properties.sheetId)!.properties, request.updateSheetProperties.properties);
      if (request.updateCells) {
        this.values.set(request.updateCells.range.sheetId, request.updateCells.rows.map((row: any) => row.values.map((cell: any) => {
          const value = cell.userEnteredValue;
          assert.equal('formulaValue' in value, false);
          return value.stringValue ?? value.numberValue ?? value.boolValue;
        })));
      }
    }
    if (this.failAfter) { this.failAfter = false; throw new AppError(503, 'SHEETS_UNAVAILABLE', 'Response lost after commit'); }
    return {} as T;
  }
}
test('Sheets commits canonical records, receipt, audit and all three exhibits in one batch and preserves unrelated tabs', async () => {
  const transport = new FakeSheets(); const repo = new SheetsRepository('sheet-id', transport);
  await new ImportService(repo).ingest(fixture(), manager);
  assert.equal(transport.writes, 1);
  assert.deepEqual(transport.values.get(0), [['keep this data']]);
  for (const title of ['MT_Marking', 'MT_Progress', 'MT_ExamStatistics', 'MT_audit', 'MT_imports']) {
    assert.ok(transport.sheets.find(s => s.properties.title === title));
  }
  const state = await repo.read();
  assert.equal(state.projections.marking.length, 4);
  assert.equal(state.projections.examStatistics[0]!.score, 3);
  const replay = await new ImportService(repo).ingest(fixture(), manager);
  assert.equal(replay.replayed, true); assert.equal(transport.writes, 1);
});
test('retry recovers an ambiguous successful Sheets write without duplicate records', async () => {
  const transport = new FakeSheets(); transport.failAfter = true;
  const service = new ImportService(new SheetsRepository('sheet-id', transport));
  await assert.rejects(service.ingest(fixture(), manager), { code: 'SHEETS_UNAVAILABLE' });
  assert.equal((await service.ingest(fixture(), manager)).replayed, true);
  assert.equal(transport.writes, 1);
});
test('failed Sheets write leaves no import, and an identical retry completes', async () => {
  const transport = new FakeSheets(); transport.failBefore = true;
  const repo = new SheetsRepository('sheet-id', transport); const service = new ImportService(repo);
  await assert.rejects(service.ingest(fixture(), manager), { code: 'SHEETS_UNAVAILABLE' });
  assert.equal(Object.keys((await repo.read()).imports).length, 0);
  await service.ingest(fixture(), manager);
  assert.equal((await repo.read()).audit.length, 1);
});
test('existing reserved tabs without ownership marker are never overwritten', async () => {
  const transport = new FakeSheets(); transport.sheets[0]!.properties.title = 'MT_Marking';
  const repo = new SheetsRepository('sheet-id', transport);
  await assert.rejects(repo.read(), { code: 'SHEETS_SCHEMA_CONFLICT' });
  assert.equal(transport.writes, 0);
});
test('older workbook without the MT_reviews tab still loads, and the tab is created on the next write', async () => {
  const transport = new FakeSheets(); const repo = new SheetsRepository('sheet-id', transport);
  await new ImportService(repo).ingest(fixture(), manager);
  assert.ok(transport.sheets.find(s => s.properties.title === 'MT_reviews'));
  // Simulate a workbook written before reviews existed.
  transport.sheets = transport.sheets.filter(s => s.properties.title !== 'MT_reviews');
  const old = await new SheetsRepository('sheet-id', transport).read();
  assert.deepEqual(old.reviews, {});
  assert.equal(old.projections.marking.length, 4);
});

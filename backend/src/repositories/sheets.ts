import { GoogleAuth } from 'google-auth-library';
import { AppError, requireCondition } from '../domain/errors.js';
import { derive } from '../domain/derive.js';
import { emptyState, type State } from '../domain/state.js';
import { validateReferences } from '../domain/validate.js';
import { SerialRepository } from './repository.js';

export interface SheetsTransport { request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> }
export class GoogleSheetsTransport implements SheetsTransport {
  private auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    try {
      const token = await this.auth.getAccessToken();
      if (!token) throw new Error('No credential');
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Sheets status ${response.status}`);
      return await response.json() as T;
    } catch {
      throw new AppError(503, 'SHEETS_UNAVAILABLE', 'Google Sheets could not confirm the operation. Retry the identical import to recover safely.');
    }
  }
}
type Cell = string | number | boolean;
interface Table { title: string; rows: Cell[][] }
interface Sheet { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }
export const collections = ['students', 'knowledgePoints', 'exams', 'attempts', 'masteryObservations',
  'activities', 'resources', 'policies', 'imports', 'audit', 'outbox', 'scanJobs', 'reviews'] as const;
export const sheetTitles = ['MT_Meta', ...collections.map(name => `MT_${name}`), 'MT_Marking', 'MT_Progress', 'MT_ExamStatistics'];
function json(value: unknown) {
  const encoded = JSON.stringify(value);
  requireCondition(encoded.length <= 45_000, 'SHEETS_CELL_TOO_LARGE', 'A record exceeds the supported Sheets cell size');
  return encoded;
}
export function stateTables(state: State): Table[] {
  const tables: Table[] = [{ title: 'MT_Meta', rows: [['key', 'json'], ['meta', json({
    owner: 'mytalents-tutor-workday', schemaVersion: 1, revision: state.revision, activePolicy: state.activePolicy,
  })]] }];
  for (const key of collections) {
    tables.push({ title: `MT_${key}`, rows: [['id', 'json'], ...Object.values(state[key]).map(record => [
      'id' in record ? record.id : record.version, json(record),
    ] as Cell[])] });
  }
  tables.push({ title: 'MT_Marking', rows: [
    ['attemptId', 'questionId', 'studentId', 'examId', 'knowledgePointIds', 'result', 'score', 'maxScore', 'revision', 'source', 'importId', 'policyVersion'],
    ...state.projections.marking.map(r => [r.attemptId, r.questionId, r.studentId, r.examId, json(r.knowledgePointIds),
      r.outcome === 'BLANK' ? '' : r.outcome, r.score, r.maxScore, r.revision, r.source, r.importId, r.policyVersion]),
  ] });
  tables.push({ title: 'MT_Progress', rows: [
    ['studentId', 'knowledgePointId', 'mastery', 'ratio', 'reason', 'evidence', 'observationId', 'policyVersion'],
    ...state.projections.progress.map(r => [r.studentId, r.knowledgePointId, r.mastery ?? '', r.ratio ?? '', r.reason, json(r.evidence), r.observationId ?? '', r.policyVersion]),
  ] });
  tables.push({ title: 'MT_ExamStatistics', rows: [
    ['attemptId', 'studentId', 'examId', 'moduleId', 'kind', 'attemptNumber', 'score', 'maxScore', 'ratio', 'band', 'completedAt', 'markedAt', 'revision', 'policyVersion'],
    ...state.projections.examStatistics.map(r => [r.attemptId, r.studentId, r.examId, r.moduleId, r.kind, r.attemptNumber,
      r.score, r.maxScore, r.ratio, r.band, r.completedAt, r.markedAt, r.revision, r.policyVersion]),
  ] });
  return tables;
}

/** App-owned tabs in ONE workbook. Deploy one writer; Sheets has no compare-and-swap transaction API. */
export class SheetsRepository extends SerialRepository {
  readonly kind = 'sheets';
  private sheets: Sheet[] = [];
  constructor(private spreadsheetId: string, private transport: SheetsTransport = new GoogleSheetsTransport()) {
    super();
    requireCondition(/^[a-zA-Z0-9_-]+$/.test(spreadsheetId), 'CONFIGURATION_ERROR', 'Invalid spreadsheet ID', 500);
  }
  protected async load(): Promise<State> {
    const metadata = await this.transport.request<{ sheets: Sheet[] }>('GET', `${this.spreadsheetId}?fields=sheets.properties`);
    this.sheets = metadata.sheets ?? [];
    const owned = this.sheets.filter(s => sheetTitles.includes(s.properties.title));
    if (!owned.length) return emptyState();
    requireCondition(owned.some(s => s.properties.title === 'MT_Meta'), 'SHEETS_SCHEMA_CONFLICT', 'Reserved MT_ tabs exist without an app ownership marker', 409);
    // Tabs for collections added later (e.g. MT_reviews) may not exist yet in an older workbook: read them as empty.
    const titles = new Set(this.sheets.map(s => s.properties.title));
    const present = collections.filter(k => titles.has(`MT_${k}`));
    const ranges = ['MT_Meta', ...present.map(k => `MT_${k}`)].map(name => `ranges=${encodeURIComponent(`'${name}'!A:B`)}`).join('&');
    const data = await this.transport.request<{ valueRanges: { values?: string[][] }[] }>('GET', `${this.spreadsheetId}/values:batchGet?${ranges}`);
    const metaRows = data.valueRanges[0]?.values;
    requireCondition(metaRows?.[0]?.[0] === 'key' && metaRows?.[1]?.[0] === 'meta', 'SHEETS_SCHEMA_CONFLICT', 'Invalid app ownership marker', 409);
    const meta = JSON.parse(metaRows[1]![1]!);
    requireCondition(meta.owner === 'mytalents-tutor-workday' && meta.schemaVersion === 1, 'SHEETS_SCHEMA_CONFLICT', 'Unsupported spreadsheet schema', 409);
    const state = emptyState();
    state.revision = meta.revision;
    state.activePolicy = meta.activePolicy;
    present.forEach((key, index) => {
      const rows = data.valueRanges[index + 1]?.values;
      requireCondition(rows?.[0]?.[0] === 'id' && rows?.[0]?.[1] === 'json', 'SHEETS_SCHEMA_CONFLICT', `Invalid header in MT_${key}`, 409);
      const entries = rows.slice(1).filter(row => row[0]).map(row => [row[0]!, JSON.parse(row[1]!)]);
      requireCondition(new Set(entries.map(entry => entry[0])).size === entries.length, 'SHEETS_SCHEMA_CONFLICT', `Duplicate rows in MT_${key}`, 409);
      Object.assign(state, { [key]: ['audit', 'outbox'].includes(key) ? entries.map(entry => entry[1]) : Object.fromEntries(entries) });
    });
    requireCondition(state.policies[state.activePolicy], 'SHEETS_SCHEMA_CONFLICT', 'Active policy is missing', 409);
    validateReferences(state);
    state.projections = derive(state);
    return state;
  }
  protected async save(state: State) {
    const tables = stateTables(state);
    const requests: unknown[] = [];
    let nextId = Math.max(0, ...this.sheets.map(s => s.properties.sheetId)) + 1;
    for (const table of tables) {
      const found = this.sheets.find(s => s.properties.title === table.title)?.properties;
      const sheetId = found?.sheetId ?? nextId++;
      const rowCount = Math.max(found?.gridProperties.rowCount ?? 100, table.rows.length);
      const columnCount = Math.max(found?.gridProperties.columnCount ?? 2, table.rows[0]!.length);
      if (!found) requests.push({ addSheet: { properties: { sheetId, title: table.title, gridProperties: { rowCount, columnCount } } } });
      else if (rowCount > found.gridProperties.rowCount || columnCount > found.gridProperties.columnCount) {
        requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount, columnCount } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } });
      }
      requests.push({ updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
        rows: table.rows.map(row => ({ values: row.map(value => ({ userEnteredValue:
          typeof value === 'number' ? { numberValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: value },
        })) })), fields: 'userEnteredValue',
      } });
    }
    requireCondition(Buffer.byteLength(JSON.stringify({ requests })) <= 1_800_000, 'SHEETS_CAPACITY_EXCEEDED',
      'Demo repository exceeds its atomic batch limit. Migrate to a database adapter before adding more records.', 413);
    // One batch commits canonical records, audit, import receipt and all three projections together.
    // Explicit stringValue prevents formula execution for text beginning with =, +, -, or @.
    await this.transport.request('POST', `${this.spreadsheetId}:batchUpdate`, { requests });
  }
}

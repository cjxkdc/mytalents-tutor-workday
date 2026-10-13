import { mkdir, open, readFile, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyState, type State } from '../domain/state.js';
import { AppError } from '../domain/errors.js';

export interface Repository {
  readonly kind: string;
  read(): Promise<State>;
  transact<T>(change: (draft: State) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}
/** One serial queue per repository instance; rejected transactions cannot poison the queue. */
export abstract class SerialRepository implements Repository {
  abstract readonly kind: string;
  private tail: Promise<unknown> = Promise.resolve();
  protected abstract load(): Promise<State>;
  protected abstract save(state: State): Promise<void>;
  protected serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => undefined);
    return next;
  }
  read() { return this.serial(async () => structuredClone(await this.load())); }
  transact<T>(change: (draft: State) => T | Promise<T>) {
    return this.serial(async () => {
      const draft = structuredClone(await this.load());
      const before = JSON.stringify(draft);
      const result = await change(draft);
      if (JSON.stringify(draft) !== before) {
        draft.revision += 1;
        await this.save(draft);
      }
      return structuredClone(result);
    });
  }
  async close() { await this.tail; }
}
export class MemoryRepository extends SerialRepository {
  readonly kind = 'memory';
  private state: State;
  constructor(initial = emptyState()) { super(); this.state = structuredClone(initial); }
  protected async load() { return this.state; }
  protected async save(state: State) { this.state = state; }
}
export class FileRepository extends SerialRepository {
  readonly kind = 'local';
  private constructor(private filename: string, private lock: FileHandle) { super(); }
  static async create(filename: string) {
    await mkdir(dirname(filename), { recursive: true });
    let lock: FileHandle;
    try { lock = await open(`${filename}.lock`, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError(503, 'REPOSITORY_LOCKED', 'Another backend owns the data file; see recovery instructions');
      throw error;
    }
    await lock.writeFile(String(process.pid));
    return new FileRepository(filename, lock);
  }
  protected async load(): Promise<State> {
    try {
      const state = JSON.parse(await readFile(this.filename, 'utf8')) as State;
      if (state.schemaVersion !== 1 || !state.policies?.[state.activePolicy]) throw new Error('Unsupported state file');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw error;
    }
  }
  protected async save(state: State) {
    const temp = `${this.filename}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, this.filename);
    } finally { await unlink(temp).catch(() => undefined); }
  }
  override async close() {
    await super.close();
    await this.lock.close();
    await unlink(`${this.filename}.lock`);
  }
}

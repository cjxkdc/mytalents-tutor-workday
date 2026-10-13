import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Policy } from '../../packages/contract/src/index.js';
import type { AuditEntry, DomainEvent, State } from './domain/state.js';
import { derive } from './domain/derive.js';
import { canReadStudent, requireManager, requireStaff, requireStudent } from './auth/permissions.js';
import type { Repository } from './repositories/repository.js';
import type { AiProvider } from './integrations/ai.js';
import type { ImportService } from './services/imports.js';
import { reportFacts } from './services/imports.js';

/** Owner B exports register(app, deps). All routes inherit the server authentication hook. */
export type BackendModule = (app: FastifyInstance, deps: BackendDependencies) => void | Promise<void>;
export interface BackendDependencies {
  repo: Repository;
  derive: typeof derive;
  reportFacts: typeof reportFacts;
  imports: ImportService;
  policy: { current(state: State): Policy };
  ai: AiProvider;
  notify: { enqueue(state: State, event: Omit<DomainEvent, 'id' | 'at' | 'policyVersion'>): DomainEvent };
  audit: { append(state: State, entry: Omit<AuditEntry, 'id' | 'at' | 'policyVersion'>): AuditEntry };
  access: { canReadStudent: typeof canReadStudent; requireManager: typeof requireManager;
    requireStaff: typeof requireStaff; requireStudent: typeof requireStudent };
}
export function moduleDependencies(repo: Repository, ai: AiProvider, imports: ImportService): BackendDependencies {
  return { repo, ai, imports, derive, reportFacts,
    policy: { current: state => state.policies[state.activePolicy]! },
    access: { canReadStudent, requireManager, requireStaff, requireStudent },
    notify: { enqueue(state, event) {
      const record = { ...event, id: randomUUID(), at: new Date().toISOString(), policyVersion: state.activePolicy };
      state.outbox.push(record); return record;
    } },
    audit: { append(state, entry) {
      const record = { ...entry, id: randomUUID(), at: new Date().toISOString(), policyVersion: state.activePolicy };
      state.audit.push(record); return record;
    } },
  };
}

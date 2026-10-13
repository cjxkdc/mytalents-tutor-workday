import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PrincipalSchema, type Principal } from '../../../packages/contract/src/index.js';
import { AppError } from '../domain/errors.js';
export interface Authenticator { authenticate(headers: Record<string, string | string[] | undefined>): Principal }
const demoUsers: Record<string, Principal> = {
  'demo-manager': { id: 'demo-manager', role: 'manager', studentIds: [] },
  'demo-teacher': { id: 'demo-teacher', role: 'teacher', studentIds: ['demo-student-1', 'demo-student-2'] },
  'demo-student-1': { id: 'demo-student-1', role: 'student', studentIds: ['demo-student-1'] },
  'demo-student-2': { id: 'demo-student-2', role: 'student', studentIds: ['demo-student-2'] },
};
export class DemoAuthenticator implements Authenticator {
  authenticate(headers: Record<string, string | string[] | undefined>) {
    const id = headers['x-demo-user'];
    const user = typeof id === 'string' && Object.hasOwn(demoUsers, id) ? demoUsers[id] : undefined;
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Set X-Demo-User to an explicit demo principal');
    return structuredClone(user);
  }
}
const TokenSchema = PrincipalSchema.extend({ token: z.string().min(32).max(256) });
const digest = (text: string) => createHash('sha256').update(text).digest();
export class TokenAuthenticator implements Authenticator {
  private accounts: { digest: Buffer; principal: Principal }[];
  constructor(json: string) {
    const rows = z.array(TokenSchema).min(1).parse(JSON.parse(json));
    if (new Set(rows.map(r => r.token)).size !== rows.length) throw new Error('Duplicate API token');
    this.accounts = rows.map(({ token, ...principal }) => {
      if (principal.role === 'student' && principal.studentIds.length !== 1) throw new Error('Student principal must have one student ID');
      return { digest: digest(token), principal };
    });
  }
  authenticate(headers: Record<string, string | string[] | undefined>) {
    const header = headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Bearer token required');
    const candidate = digest(header.slice(7));
    const account = this.accounts.find(row => timingSafeEqual(candidate, row.digest));
    if (!account) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid bearer token');
    return structuredClone(account.principal);
  }
}

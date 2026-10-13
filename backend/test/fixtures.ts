import { readFileSync } from 'node:fs';
import { ImportSchema, type Principal } from '../../packages/contracts/src/index.js';
export const fixture = () => ImportSchema.parse(JSON.parse(readFileSync(new URL('../../examples/import.synthetic.json', import.meta.url), 'utf8')));
export const manager: Principal = { id: 'manager', role: 'manager', studentIds: [] };
export const teacher: Principal = { id: 'teacher', role: 'teacher', studentIds: ['demo-student-1'] };
export const student: Principal = { id: 'demo-student-1', role: 'student', studentIds: ['demo-student-1'] };

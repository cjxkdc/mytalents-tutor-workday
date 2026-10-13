import type { Principal } from '../../../packages/contracts/src/index.js';
import { AppError } from '../domain/errors.js';
export const canReadStudent = (principal: Principal, studentId: string) =>
  principal.role === 'manager' || principal.studentIds.includes(studentId);
export function requireStudent(principal: Principal, studentId: string) {
  if (!canReadStudent(principal, studentId)) throw new AppError(403, 'FORBIDDEN', 'Student is outside your assigned scope');
}
export function requireStaff(principal: Principal) {
  if (principal.role === 'student') throw new AppError(403, 'FORBIDDEN', 'Staff permission is required');
}
export function requireManager(principal: Principal) {
  if (principal.role !== 'manager') throw new AppError(403, 'FORBIDDEN', 'Manager permission is required');
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function requireCondition(condition: unknown, code: string, message: string, status = 422): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}

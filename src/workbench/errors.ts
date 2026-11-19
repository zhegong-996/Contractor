export class WorkbenchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function requireValue<T>(value: T | undefined | null, message: string, status = 404): T {
  if (value == null || value === false) throw new WorkbenchError(message, status);
  return value;
}

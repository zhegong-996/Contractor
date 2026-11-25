// A late receipt may finish only the value that was submitted from this editor.
export function writeStoredValue(previous: Record<string, unknown>, key: string, value: unknown, expected?: unknown) {
  if (expected !== undefined && previous[key] !== expected) return previous;
  return { ...previous, [key]: value };
}

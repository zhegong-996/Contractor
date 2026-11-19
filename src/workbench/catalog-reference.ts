type CatalogKind = 'resource' | 'system' | 'component' | 'user';

/** Persisted references keep their original kind:project/name wire format. */
export const catalogReference = (kind: CatalogKind, project: string, name: string) =>
  (kind + ':' + project + '/' + name).toLowerCase();

export function projectResourceRef(project: string, value: string) {
  const match = /^resource:([^/:\s]+)\/([^/:\s]+)$/.exec(value);
  return !!match && match[1] === project && value === value.toLowerCase();
}

export type Branch<T> = { item: T; children: Branch<T>[] };

export function forest<T extends { id: string }>(items: T[], parentOf: (item: T) => string | undefined): Branch<T>[] {
  const branches = new Map(items.map(item => [item.id, { item, children: [] } as Branch<T>]));
  const roots: Branch<T>[] = [];
  for (const branch of branches.values()) {
    const parent = parentOf(branch.item);
    const ancestors = new Set([branch.item.id]);
    let next = parent;
    while (next && branches.has(next) && !ancestors.has(next)) {
      ancestors.add(next);
      next = parentOf(branches.get(next)!.item);
    }
    const owner = parent && (!next || !ancestors.has(next)) ? branches.get(parent) : undefined;
    if (owner) owner.children.push(branch);
    else roots.push(branch);
  }
  return roots;
}

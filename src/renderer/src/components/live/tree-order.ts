/** Orders agents as a tree, root first, each followed by its children. */
export function treeOrder<T>(items: T[], name: (t: T) => string, parent: (t: T) => string | null): { item: T; depth: number }[] {
  const names = new Set(items.map(name))
  const children = new Map<string | null, T[]>()
  for (const t of items) {
    const p = parent(t)
    const key = p && names.has(p) && p !== name(t) ? p : null
    children.set(key, [...(children.get(key) ?? []), t])
  }
  const out: { item: T; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (key: string | null, depth: number) => {
    for (const t of children.get(key) ?? []) {
      if (seen.has(name(t))) continue
      seen.add(name(t))
      out.push({ item: t, depth })
      walk(name(t), depth + 1)
    }
  }
  walk(null, 0)
  for (const t of items) if (!seen.has(name(t))) out.push({ item: t, depth: 0 })
  return out
}

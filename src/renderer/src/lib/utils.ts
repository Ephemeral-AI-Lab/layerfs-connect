// shadcn components import `cn` straight from the `cn` package; this
// re-export keeps the path components.json names working for our own code.
export { cn } from 'cn'

/** Sort translated navigation labels, preserving the original order for equal lengths. */
export function sortByLabelLength<T extends { label: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Array.from(a.label).length - Array.from(b.label).length)
}

/** Fills `{name}` slots in a string chosen at runtime (a plural, a label table): `fill('{n} Stores', { n: 3 })`. */
export function fill(text: string, values?: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (slot, key: string) => (values?.[key] === undefined ? slot : String(values[key])))
}

/** Keep byte labels exact; only bounded chart coordinates become Numbers. */
export function integer(value: unknown): bigint | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
  if (value && typeof value === 'object' && '$layerfs' in value && value.$layerfs === 'i64-v1' && 'decimal' in value && typeof value.decimal === 'string' && /^\d+$/.test(value.decimal)) return BigInt(value.decimal)
  return null
}
export function maximum(values: unknown[]): bigint {
  return values.reduce<bigint>((max, value) => { const n = integer(value); return n !== null && n > max ? n : max }, 0n)
}
export function coordinate(value: unknown, max: bigint): number | null {
  const v = integer(value)
  return v === null ? null : max === 0n ? 0 : Number((v * 1000000n) / max) / 1000000
}
export function compositionMatches(parts: unknown[], total: unknown): boolean {
  const measured = parts.map(integer), t = integer(total)
  return t !== null && measured.every(v => v !== null) && measured.reduce<bigint>((sum, value) => sum + value!, 0n) === t
}
export function encodingRatio(canonical: unknown, stored: unknown): string | null {
  const c = integer(canonical), s = integer(stored)
  if (c === null || s === null || c === 0n || s === 0n) return null
  const hundredths = (c * 100n + s / 2n) / s
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`
}

/** Share of canonical references reused within exactly one selected population. */
export function canonicalReuse(referenced: unknown, unique: unknown): number | null {
  const r = integer(referenced), u = integer(unique)
  if (r === null || u === null || r === 0n || u > r) return null
  return Number(((r - u) * 1000000n) / r) / 1000000
}

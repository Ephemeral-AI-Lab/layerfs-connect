/** JSON wire representation of integers outside JavaScript's safe range. */
export type WireInteger = number | { $layerfs: 'i64-v1'; decimal: string }
export function exactCount(value: unknown): string {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value.toLocaleString('en-US') : 'Unavailable'
  if (value && typeof value === 'object' && '$layerfs' in value && value.$layerfs === 'i64-v1' && 'decimal' in value && typeof value.decimal === 'string' && /^-?\d+$/.test(value.decimal)) return BigInt(value.decimal).toLocaleString('en-US')
  return 'Unavailable'
}
/** Large totals stay exact rather than being coerced to a lossy Number. */
export function exactBytes(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    if (value < 1000) return `${value} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let n = value / 1000, i = 0
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++ }
    return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
  }
  const count = exactCount(value)
  return count === 'Unavailable' ? count : `${count} B`
}
export function safeEncodingRatio(canonical: unknown, stored: unknown): string | null {
  return typeof canonical === 'number' && typeof stored === 'number' && Number.isSafeInteger(canonical) && Number.isSafeInteger(stored) && canonical > 0 && stored > 0 ? (canonical / stored).toFixed(2) : null
}

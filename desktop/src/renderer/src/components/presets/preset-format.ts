export const count = (value: number) => value.toLocaleString()
export function elapsed(start: number | undefined, end: number | undefined, now: number) {
  if (!start) return ''
  const seconds = Math.max(0, Math.floor(((end ?? now) - start) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

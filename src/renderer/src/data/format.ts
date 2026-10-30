import { t, localeTag } from '@/i18n'
// Small formatters shared by the project, storage and compute pages.

import { agentColors } from '@/components/runs/run-format'

/** A host time as epoch milliseconds: the host may answer seconds or milliseconds. */
export const toMs = (at: number | null | undefined): number | null =>
  at === null || at === undefined || !Number.isFinite(at) ? null : at < 1e12 ? at * 1000 : at

/** "just now", "4 min ago", "2 h ago", "yesterday", "3 days ago". */
export function ago(at: number | null | undefined, now = Date.now()): string {
  const ms = toMs(at)
  if (ms === null) return '—'
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 45) return t('just now')
  const m = Math.round(s / 60)
  if (m < 60) return new Intl.RelativeTimeFormat(localeTag(), {numeric: 'always'}).format(-Math.max(m, 1), 'minute')
  if (m < 24 * 60) return new Intl.RelativeTimeFormat(localeTag(), {numeric: 'always'}).format(-Math.round(m / 60), 'hour')
  if (m < 48 * 60) return t('yesterday')
  return new Intl.RelativeTimeFormat(localeTag(), {numeric: 'always'}).format(-Math.round(m / (24 * 60)), 'day')
}

/** A local date and time, for tooltips. */
export const when = (at: number | null | undefined) => {
  const ms = toMs(at)
  return ms === null ? t('unknown time') : new Date(ms).toLocaleString(localeTag())
}

/** "1.2 MB", "340 KB", "12 B". Decimal units, like Docker and Finder. */
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/**
 * Saved ids are long hex strings; eight characters tell them apart on screen.
 * A tagged id's first byte says what it is (0x12 a Commit, 0x32 a Layer), so
 * the eight come after it.
 */
export const shortId = (id: string | null | undefined) =>
  !id ? '—' : id.length <= 12 ? id : /^(12|32)[0-9a-f]{64}$/.test(id) ? id.slice(2, 10) : id.slice(0, 8)

/** A Docker image digest, cut to its first twelve hex digits. */
export const shortDigest = (digest: string | null | undefined) =>
  !digest ? '—' : digest.replace(/^(sha256:)?([0-9a-f]{12})[0-9a-f]+$/, (_, p: string | undefined, h: string) => `${p ?? ''}${h}…`)

/**
 * An agent's colour as a CSS value, for SVG and inline styles: the run pages'
 * colour (components/runs/run-format agentColors) by its place in `names`.
 */
export function agentColor(names: string[], name: string): string {
  const dot = agentColors(names)(name).dot
  const token = dot.match(/^bg-\(--([\w-]+)\)$/)?.[1] ?? dot.replace(/^bg-/, '')
  return `var(--${token})`
}

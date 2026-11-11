import { readFileSync, statSync } from 'node:fs'

const sensitive = /password|passwd|secret|token|authorization|credential|api.?key|access.?key|private.?key|^--key$/i
const LIMIT = 32 * 1024

/** A per-invocation sanitizer: no secrets or unbounded data reach the writer. */
export function sanitizer(argv = [], env = process.env) {
  const secrets = new Set(Object.entries(env).filter(([key, value]) => sensitive.test(key) && typeof value === 'string' && value.length >= 4).map(([, value]) => value))
  for (const word of argv) {
    if (typeof word !== 'string') continue
    if (word.startsWith('env:')) { const value = env[word.slice(4)]; if (value) secrets.add(value) }
    if (word.startsWith('file:')) {
      try { if (statSync(word.slice(5)).size <= 65536) { const value = readFileSync(word.slice(5), 'utf8').trim(); if (value) secrets.add(value) } } catch { /* Missing references remain the CLI's concern. */ }
    }
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length)
  const clean = (value) => {
    let text = String(value ?? '')
    for (const secret of ordered) text = text.replaceAll(secret, '[REDACTED]')
    return text
      .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1[REDACTED]@')
      .replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[REDACTED]')
      .replace(/((?:["']?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization)["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, '$1"[REDACTED]"')
  }
  const bounded = (value, limit = LIMIT) => {
    const text = clean(value)
    const bytes = Buffer.from(text)
    return { text: bytes.subarray(0, limit).toString('utf8'), truncated: bytes.length > limit, bytes: Buffer.byteLength(String(value ?? '')) }
  }
  const words = argv.map((word, i) => {
    if (sensitive.test(argv[i - 1] ?? '') && /^--/.test(argv[i - 1]) && !String(word).startsWith('--')) return '[REDACTED]'
    if (/^--[^=]+=/.test(word) && sensitive.test(word.split('=')[0])) return `${word.split('=')[0]}=[REDACTED]`
    return bounded(word, 2048).text
  })
  return { clean, bounded, argv: words }
}

export function capture(limit = LIMIT) {
  const chunks = []
  let size = 0, kept = 0
  return {
    write(data) { const bytes = Buffer.from(data); size += bytes.length; if (kept < limit) { const part = bytes.subarray(0, limit - kept); chunks.push(part); kept += part.length } },
    finish(scrub) { const value = scrub.bounded(Buffer.concat(chunks).toString('utf8')); return { ...value, bytes: size, truncated: value.truncated || size > kept } },
  }
}

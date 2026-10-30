import { validateHeaderName, validateHeaderValue } from 'node:http'

/** Settings entered through Connect are literal HTTP values, never Pi commands or env references. */
export function requestHeaders(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request headers must contain names and string values.')
  const entries = Object.entries(value)
  try {
    for (const [name, header] of entries) {
      if (typeof header !== 'string') throw new Error()
      validateHeaderName(name)
      validateHeaderValue(name, header)
    }
  } catch { throw new Error('Request headers must use valid HTTP names and string values without line breaks.') }
  return Object.fromEntries(entries.map(([name, header]) => [name.toLowerCase(), header]))
}

/** Pi's native config supports $$ and $! literal escapes. */
export function nativeHeaders(value) {
  const headers = requestHeaders(value)
  if (headers === undefined) return undefined
  return Object.fromEntries(Object.entries(headers).map(([name, header]) => {
    const escaped = header.replaceAll('$', () => '$$')
    return [name, escaped.startsWith('!') ? `$!${escaped.slice(1)}` : escaped]
  }))
}

export function savedHeaders(value) {
  if (value === undefined) return undefined
  return Object.fromEntries(Object.entries(value).map(([name, header]) => [name, header.replace(/\$(\$|!)/g, '$1')]))
}

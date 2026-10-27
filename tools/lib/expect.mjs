// A bash step's `expect` against its call's trace lines (ported from
// dsh-layerfs packages/mock/src/expect.js). The engine checks it live; the
// tools check a finished run's lines again. The code grammar is in
// scenarios/README.md.

/** A trace line's code: method:kind (ok when the answer has none), or method:code for a refusal. */
export const codeOf = (line) => `${line.method}:${line.ok ? (line.kind ?? 'ok') : line.code}`

/**
 * Whether trace code `code` matches the expected entry `want`: a code
 * ("Committed"), method:code, or alternatives sharing what precedes the last
 * ":" before the first "|" ("workspace.commit:Committed|UpToDate",
 * "workspace.exec:exit:1|0").
 */
export const matches = (code, want) => {
  const bar = want.indexOf('|')
  if (bar < 0) return code === want || code.endsWith(`:${want}`)
  const head = want.slice(0, want.lastIndexOf(':', bar) + 1)
  return want
    .slice(head.length)
    .split('|')
    .some((kind) => matches(code, head + kind))
}

/** Whether `want` appears in `codes` in order (other codes may come between). */
export const inOrder = (codes, want) => {
  let i = 0
  for (const c of codes) if (i < want.length && matches(c, want[i])) i++
  return i === want.length
}

/** The codes of one call's trace lines that `expect` is checked against: finished calls, no Sandbox service calls. */
export const callCodes = (lines) => lines.filter((line) => line.ok !== undefined && line.ok !== null && line.method !== 'sandbox.service').map(codeOf)

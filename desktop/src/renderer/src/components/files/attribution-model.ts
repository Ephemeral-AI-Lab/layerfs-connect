import type { BlameOrigin } from './FileBlame'
import type { FileDiffLine } from './FileDiff'

export interface AttributionLine {
  op: FileDiffLine['op']
  text: string
  left: number | null
  right: number | null
  before: BlameOrigin | null
  after: BlameOrigin | null
  ownerChanged: boolean | null
}

/** Align saved blame windows using the content diff; attribution-only means equal aligned text. */
export function alignAttribution(lines: FileDiffLine[], before: { owner: BlameOrigin }[], after: { owner: BlameOrigin }[]): AttributionLine[] {
  return lines.map(line => {
    const from = line.left === null ? null : before[line.left - 1]?.owner ?? null
    const to = line.right === null ? null : after[line.right - 1]?.owner ?? null
    return { ...line, before: from, after: to, ownerChanged: line.op === ' ' ? from && to ? from.id !== to.id : null : false }
  })
}

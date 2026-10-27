// What an agent has seen, as dsh-layerfs's scripted model reads it from the
// agent's conversation (plan.js): the last Sandbox number ("sandbox":"N")
// and Workspace ("ws":"<sandbox>:<path>") in any tool result or message it
// received, the Commit ids its `commits` steps printed, and the Commit ids
// messages it received carry where the sender's text names a ref. Its
// placeholders ({{sandbox}}, {{ws}}, {{commit:<ref>}}) are filled from it.
import { PLACEHOLDER } from '../../tools/lib/scenario.mjs'

const SANDBOX = /"sandbox"\s*:\s*"([^"]+)"/g
const WS = /"ws"\s*:\s*"([^"]+)"/g

export class Seen {
  constructor(templates = []) {
    this.templates = templates
    this.sandbox = null
    this.ws = null
    this.commits = new Map()
  }

  /** A tool result's line or text. */
  look(text) {
    for (const m of text.matchAll(SANDBOX)) this.sandbox = m[1]
    for (const m of text.matchAll(WS)) this.ws = m[1]
  }

  /** A message the agent received: its prompt, a parent's message, a child's reply. */
  receive(text) {
    this.look(text)
    for (const { pattern, refs } of this.templates) {
      const found = text.match(pattern)
      if (found) refs.forEach((ref, i) => this.commits.set(ref, found[i + 1]))
    }
  }

  /** `text` with its placeholders filled: { text, missing: [placeholder…] }. */
  fill(text) {
    const missing = []
    const out = text.replace(PLACEHOLDER, (all, what, ref) => {
      const value = what === 'sandbox' ? this.sandbox : what === 'ws' ? this.ws : this.commits.get(ref)
      if (value == null) missing.push(all)
      return value ?? all
    })
    return { text: out, missing }
  }
}

/** Reads a stream's lines for the values a bash step captures. */
export class Capture {
  constructor() {
    this.sandbox = null
    this.ws = null
    /** heads of Committed/Merged JSON lines, in order (plan.js commitsIn) */
    this.commits = []
  }

  line(line) {
    if (line.includes('"sandbox"')) for (const m of line.matchAll(SANDBOX)) this.sandbox = m[1]
    if (line.includes('"ws"')) for (const m of line.matchAll(WS)) this.ws = m[1]
    const t = line.trim()
    if (!t.startsWith('{') || !t.includes('"head"')) return
    let value
    try {
      value = JSON.parse(t)
    } catch {
      return
    }
    if ((value?.kind === 'Committed' || value?.kind === 'Merged') && typeof value.head === 'string') this.commits.push(value.head)
  }
}

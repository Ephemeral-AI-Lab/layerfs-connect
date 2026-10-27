// A small Markdown subset for agent messages: paragraphs, bullet and numbered
// lists, fenced code, and inline `code`, **bold**, *em* and [links](url).
// Text streamed in word by word degrades to plain text, never broken markup.
// LayerFS calls (`fs.edit`) and file paths (`/app/page.tsx`) read as code
// even when the text does not mark them.

export type Inline = { t: 'text' | 'code' | 'strong' | 'em'; s: string } | { t: 'link'; s: string; href: string }

export type Block =
  | { t: 'p'; inl: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'code'; lang: string; text: string }

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<![\w*])[*_]([^*_\n]+)[*_](?![\w*])|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g

// a LayerFS method, a path from the root, or a relative path with a file extension
const AUTO =
  /\b(?:workspace|fs|branch|sandbox|project|backend)\.[a-z_]+\b|(?<![\w/.])\/[\w.@-]+(?:\/[\w.@[\]-]+)*|\b[\w.-]+(?:\/[\w.@[\]-]+)*\.(?:tsx?|jsx?|mjs|json|md|sh|css|html|toml|ya?ml)\b/g

function auto(s: string, out: Inline[]) {
  let last = 0
  for (const m of s.matchAll(AUTO)) {
    if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) })
    out.push({ t: 'code', s: m[0] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) })
}

export function inline(s: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) auto(s.slice(last, m.index), out)
    if (m[1] != null) out.push({ t: 'code', s: m[1] })
    else if (m[2] != null) out.push({ t: 'strong', s: m[2] })
    else if (m[3] != null) out.push({ t: 'em', s: m[3] })
    else out.push({ t: 'link', s: m[4], href: m[5] })
    last = m.index + m[0].length
  }
  if (last < s.length) auto(s.slice(last), out)
  return out
}

const ITEM = /^\s*([-*]|\d+[.)])\s+/
const FENCE = /^\s*```/

export function blocks(text: string): Block[] {
  const out: Block[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]
    const fence = /^\s*```(\w*)/.exec(l)
    if (fence) {
      const end = lines.findIndex((x, k) => k > i && /^\s*```\s*$/.test(x))
      const stop = end < 0 ? lines.length : end
      out.push({ t: 'code', lang: fence[1], text: lines.slice(i + 1, stop).join('\n') })
      i = stop + 1
      continue
    }
    if (ITEM.test(l)) {
      const ordered = /\d/.test(l.trim()[0])
      const items: Inline[][] = []
      while (i < lines.length && ITEM.test(lines[i]) && /\d/.test(lines[i].trim()[0]) === ordered) items.push(inline(lines[i++].replace(ITEM, '')))
      out.push({ t: 'list', ordered, items })
      continue
    }
    if (!l.trim()) {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !ITEM.test(lines[i]) && !FENCE.test(lines[i])) para.push(lines[i++])
    out.push({ t: 'p', inl: inline(para.join('\n')) })
  }
  return out
}

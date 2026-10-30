import { useI18n } from '@/i18n'
import '@/components/projects/history/history.css'

import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

// Colours come from CSS variables, so light and dark follow the app.
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--hl-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--hl-function)' },
  { tag: [t.typeName, t.className, t.tagName, t.angleBracket], color: 'var(--hl-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--hl-property)' },
  { tag: [t.heading], color: 'var(--hl-keyword)', fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--hl-function)', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '600' },
])

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent', color: 'var(--foreground)', height: '100%' },
  '.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', lineHeight: '1.7', fontVariantLigatures: 'none' },
  '.cm-content': { padding: '12px 0', caretColor: 'transparent' },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in oklab, var(--muted) 30%, transparent)',
    border: 'none',
    color: 'color-mix(in oklab, var(--faint) 75%, transparent)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 18px', minWidth: '48px', fontVariantNumeric: 'tabular-nums', fontSize: '11.5px' },
  '.cm-line': { padding: '0 16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 18%, transparent) !important',
  },
})

function language(path: string): Extension {
  if (/\.(tsx?|jsx?|mjs)$/.test(path)) return javascript({ typescript: true, jsx: true })
  if (path.endsWith('.json')) return json()
  if (path.endsWith('.md')) return markdown()
  if (path.endsWith('.sh')) return StreamLanguage.define(shell)
  return []
}

/** A read-only file view. */
export function CodeView({ path, text }: { path: string; text: string }) {
  useI18n()
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          language(path),
          syntaxHighlighting(highlight),
          theme,
        ],
      }),
    })
    return () => view.destroy()
  }, [path, text])

  return <div ref={host} className="code-view h-full min-h-0 overflow-hidden [&_.cm-editor]:h-full" />
}

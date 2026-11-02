import { decodeHTMLStrict } from 'entities'
import { Marked, type Token } from 'marked'
import markedCjkFriendly from 'marked-cjk-friendly'

export type { MarkedToken, Token } from 'marked'

// Parse only: React renders the tokens, including untrusted HTML as plain text.
const markdown = new Marked({ gfm: true }, markedCjkFriendly())

export function blocks(text: string): Token[] {
  return markdown.lexer(text)
}

/** CommonMark entities in prose and link attributes; code keeps its literal text. */
export const decodeText = decodeHTMLStrict

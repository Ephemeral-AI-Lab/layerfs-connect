// What the steps of a transcript need from around them: the chat they belong
// to, its subagents (a subagent step links to its children), the step to
// open and scroll to (?at=, from the Trace), and whether this is a
// subagent's own conversation (it has no Trace rows to link to).
import { createContext, useContext } from 'react'
import type { ChildRun } from '@/layerfs/agent-api'

export interface TranscriptScope {
  chatId: string
  children: ChildRun[]
  focus: string | null
  inChild: boolean
}

export const ScopeContext = createContext<TranscriptScope>({ chatId: '', children: [], focus: null, inChild: false })
export const useScope = () => useContext(ScopeContext)

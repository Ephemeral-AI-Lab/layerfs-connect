// What the steps of a transcript need from around them: the chat they belong
// to, its subagents (a subagent step links to its children), the step to
// open and scroll to (?at=, from the Trace), and the selected child's
// identity when links should stay in its own conversation and Trace.
import { createContext, useContext } from 'react'
import type { ChildRun } from '@/layerfs/agent-api'

export interface TranscriptScope {
  chatId: string
  children: ChildRun[]
  focus: string | null
  inChild: boolean
  childId?: string
}

export const ScopeContext = createContext<TranscriptScope>({ chatId: '', children: [], focus: null, inChild: false })
export const useScope = () => useContext(ScopeContext)

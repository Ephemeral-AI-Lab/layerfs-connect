import { GitBranch } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { chatProject, type ChatDetail } from '@/layerfs/agent-api'
import { Empty } from '@/components/layerfs/States'
import { ProjectHistory, type HistoryTrace } from '@/components/history/ProjectHistory'
import { sourcesOf, type Source } from '@/components/history/model'
import { traceHost } from '@/layerfs/trace-api'
import { useTrace } from '@/layerfs/use-trace'

export function HistoryTab({ chat, childId }: { chat: ChatDetail; childId?: string }) {
  const project = chatProject(chat)
  if (!project) return <Empty icon={GitBranch} title="No LayerFS project linked">Start a chat with a LayerFS project to explore its history.</Empty>
  return <ChatHistory key={`${chat.id}:${childId ?? 'main'}`} project={project} chat={chat} childId={childId} />
}

function ChatHistory({ project, chat, childId }: { project: string; chat: ChatDetail; childId?: string }) {
  const trace = useTrace(chat.id, childId)
  const sources = useMemo(() => sourcesOf(trace.records, childId), [trace.page, trace.earlier, childId])
  const children = chat.children.map(c => c.id).join('\n')
  const findSource = useCallback(async (commit: string, signal: AbortSignal) => {
    if (!trace.page) return new Map<string, Source>()
    const agents = [...new Set([childId, undefined, ...children.split('\n').filter(Boolean)])]
    for (const agent of agents) {
      let before: number | null = agent === childId ? trace.page.from : null
      if (before === 0) continue
      do {
        if (signal.aborted) return new Map<string, Source>()
        const page = await traceHost.page(chat.id, before, 300, agent)
        if (signal.aborted) return new Map<string, Source>()
        const found = sourcesOf(page.records, agent)
        if (found.has(commit)) return found
        if (page.from === 0 || page.from === before) break
        before = page.from
      } while (true)
    }
    return new Map<string, Source>()
  }, [chat.id, children, childId, trace.page?.from])
  const enrichment: HistoryTrace = {
    sources, findSource, childId, revision: trace.page,
    earlier: trace.earlier, loadEarlier: trace.loadEarlier, loadingOlder: trace.loadingOlder, error: trace.error,
    href: source => `/chat/${encodeURIComponent(chat.id)}${source.child ? `/subagents/${encodeURIComponent(source.child)}` : ''}/trace?${new URLSearchParams({ at: source.row.callId ?? source.row.id, ...(source.checkpoint !== null ? { checkpoint: String(source.checkpoint) } : {}) })}`,
  }
  return <ProjectHistory project={project} viewKey={`chat:${chat.id}:${childId ?? 'main'}`} trace={enrichment} example={chat.id === 'ui-example-chat'} />
}

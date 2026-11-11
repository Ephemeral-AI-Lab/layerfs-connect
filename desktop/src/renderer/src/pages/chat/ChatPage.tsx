// Views and agent selection share a stable parent conversation. A child can
// replace the main view or open alongside it through the URL's aside parameter.
import { LoaderCircle } from 'lucide-react'
import { useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLayout } from '@/components/shell/layout-context'
import { useChat } from '@/layerfs/use-chat'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { ChatHeader } from './ChatHeader'
import { ChatTabs, type ChatTab } from './ChatTabs'
import { ConversationTab } from './conversation/ConversationTab'
import { SubagentsTab } from './subagents/SubagentsTab'
import { HistoryTab } from './history/HistoryTab'
import { TraceTab } from './trace/TraceTab'
import { ChatFilesTab } from './FilesTab'
import { SandboxesTab } from './SandboxesTab'
import { ChildConversation } from './subagents/ChildConversation'
import { SubagentPanel } from './subagents/SubagentPanel'

export function ChatPage() {
  const { id = '', '*': rest = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const navigationTrigger = useRef<HTMLButtonElement>(null)
  const [section, encodedChild, childTab] = rest.split('/')
  const viewingChildren = section === 'subagents'
  const tab = viewingChildren && encodedChild ? childTab : section
  const child = viewingChildren && encodedChild ? safeDecode(encodedChild) : undefined
  const current: ChatTab = tab === 'files' || tab === 'sandboxes' || tab === 'trace' || tab === 'history' || tab === 'subagents' ? tab : 'chat'
  const historyVisited = useRef(false)
  const traceVisited = useRef(false)
  if (current === 'history') historyVisited.current = true
  if (current === 'trace') traceVisited.current = true
  const { chat, error, take } = useChat(id, current === 'chat' && !viewingChildren)
  const selected = chat?.children.find(item => item.id === child)
  const asideId = params.get('aside')
  const base = `/chat/${encodeURIComponent(id)}`
  const { sidebarOpen } = useLayout()
  const lead = Math.max(20, sidebarOpen ? 0 : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX)

  function openChild(childId: string) {
    const search = new URLSearchParams(params)
    search.delete('at')
    if (search.get('aside') === childId) search.delete('aside')
    const view = current === 'chat' || current === 'subagents' ? '' : `/${current}`
    navigate(`${base}/subagents/${encodeURIComponent(childId)}${view}${search.size ? `?${search}` : ''}`)
  }

  function openAside(childId: string) {
    const search = new URLSearchParams(params)
    search.set('aside', childId)
    // Inspecting from a child restores the coordinating parent alongside it.
    if (viewingChildren) {
      search.delete('at')
      navigate(`${base}?${search}`)
    } else setParams(search)
  }

  function closeAside() {
    const search = new URLSearchParams(params)
    search.delete('aside')
    setParams(search)
    requestAnimationFrame(() => navigationTrigger.current?.focus())
  }

  function selectAside(childId: string) {
    const search = new URLSearchParams(params)
    search.set('aside', childId)
    setParams(search)
  }

  return (
    <div className="@container/chat flex min-h-0 flex-1 flex-col">
      <ChatHeader
        chat={chat} lead={lead} child={selected} viewingChildren={viewingChildren}
        onParent={() => navigate(`${base}${asideId ? `?aside=${encodeURIComponent(asideId)}` : ''}`)}
        onOpenChild={openChild} onOpenAside={openAside} onOverview={() => navigate(`${base}/subagents`)}
        triggerRef={navigationTrigger}
      />
      {!chat ? (
        <div className="flex flex-1 items-center justify-center text-13 text-[var(--text-tertiary)]">
          {error ? `This chat could not load: ${error}` : <LoaderCircle className="size-4 animate-spin" />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${asideId ? '@max-[819px]/chat:hidden' : ''}`}>
            {(!viewingChildren || selected) && <ChatTabs chat={chat} child={selected} current={current} lead={lead} />}
            <div className={current === 'chat' && !viewingChildren ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <ConversationTab key={chat.id} chat={chat} onChange={take} shown={current === 'chat' && !viewingChildren} />
            </div>
            {selected && <div className={current === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <ChildConversation key={selected.id} chat={chat} child={selected} onChange={take} shown={current === 'chat'} />
            </div>}
            {(!viewingChildren || selected) && <>
              {historyVisited.current && <div className={current === 'history' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}><HistoryTab key={`${chat.id}:${selected?.id ?? 'main'}`} chat={chat} childId={selected?.id} shown={current === 'history'} /></div>}
              {traceVisited.current && <div className={current === 'trace' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}><TraceTab key={`${chat.id}:${selected?.id ?? 'main'}`} chat={chat} childId={selected?.id} shown={current === 'trace'} /></div>}
              {current === 'files' && <ChatFilesTab key={chat.id} chat={chat} />}
              {current === 'sandboxes' && <SandboxesTab chat={chat} childId={selected?.id} />}
            </>}
            {viewingChildren && !selected && <SubagentsTab key={chat.id} chat={chat} childId={child ?? null} onChange={take} />}
          </div>
          {asideId && <SubagentPanel key={chat.id} chat={chat} childId={asideId} onChange={take} onSelect={selectAside} onOpen={openChild} onClose={closeAside} />}
        </div>
      )}
    </div>
  )
}

/** The router hands params decoded already; an id that still holds an escape is decoded once more. */
function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

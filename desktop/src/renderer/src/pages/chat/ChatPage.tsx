// /chat/:id[/trace | /subagents[/:child]]: one chat. The header names it; the tab row under it
// switches between its parts (the conversation, its Trace, its subagents),
// and more parts can join that row. The Chat tab stays mounted while another
// is shown, so its scroll place and an unsent reply survive a look at Trace.
import { LoaderCircle } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { useLayout } from '@/components/shell/layout-context'
import { useChat } from '@/layerfs/use-chat'
import { CHROME_CLUSTER_PX, macChrome, TRAFFIC_LIGHTS_PX } from '@/lib/platform'
import { ChatHeader } from './ChatHeader'
import { ChatTabs, type ChatTab } from './ChatTabs'
import { ConversationTab } from './conversation/ConversationTab'
import { SubagentsTab } from './subagents/SubagentsTab'
import { TraceTab } from './trace/TraceTab'

export function ChatPage() {
  const { id = '', '*': rest = '' } = useParams()
  const [tab, encodedChild] = rest.split('/')
  const child = tab === 'subagents' && encodedChild ? safeDecode(encodedChild) : undefined
  const current: ChatTab = child || tab === 'subagents' ? 'subagents' : tab === 'trace' ? 'trace' : 'chat'
  const { chat, error, take } = useChat(id)
  const { sidebarOpen } = useLayout()
  const lead = Math.max(20, sidebarOpen ? 0 : (macChrome ? TRAFFIC_LIGHTS_PX : 8) + CHROME_CLUSTER_PX)

  return (
    <div className="@container/chat flex min-h-0 flex-1 flex-col">
      <ChatHeader chat={chat} lead={lead} />
      <ChatTabs chat={chat} current={current} lead={lead} />
      {!chat ? (
        <div className="flex flex-1 items-center justify-center text-13 text-[var(--text-tertiary)]">
          {error ? `This chat could not load: ${error}` : <LoaderCircle className="size-4 animate-spin" />}
        </div>
      ) : (
        <>
          <div className={current === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <ConversationTab key={chat.id} chat={chat} onChange={take} shown={current === 'chat'} />
          </div>
          {current === 'trace' && <TraceTab key={chat.id} chat={chat} />}
          {current === 'subagents' && <SubagentsTab key={chat.id} chat={chat} childId={child ?? null} onChange={take} />}
        </>
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

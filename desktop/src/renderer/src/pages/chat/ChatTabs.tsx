// The chat's tab row: Chat, Trace, Subagents (with how many, and a pulsing
// dot while one works). The row's far end keeps the quiet facts: context
// used and the model.
import { Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Tab, TabBar, TabCount } from '@/components/layerfs/motion/tabs'
import { childActive, type ChatDetail } from '@/layerfs/agent-api'

export type ChatTab = 'chat' | 'trace' | 'subagents'

const TABS: { id: ChatTab; label: string; path: string }[] = [
  { id: 'chat', label: 'Chat', path: '' },
  { id: 'trace', label: 'Trace', path: '/trace' },
  { id: 'subagents', label: 'Subagents', path: '/subagents' },
]

export function ChatTabs({ chat, current, lead }: { chat: ChatDetail | null; current: ChatTab; lead: number }) {
  const navigate = useNavigate()
  const children = chat?.children ?? []
  const working = children.some(childActive)
  return (
    <div className="shrink-0 pr-4" style={{ paddingLeft: lead }}>
      <TabBar
        aria-label="Chat"
        variant="line"
        end={
          chat && (
            <span className="flex items-center gap-3 text-12 tabular-nums text-[var(--text-tertiary)]">
              {chat.contextUsage?.percent != null && <span title="Context used">{Math.round(chat.contextUsage.percent)}% context</span>}
              {chat.modelId && chat.provider !== 'scenario' && (
                <span className="flex items-center gap-1">
                  <Sparkles className="size-3" /> {chat.modelId}
                </span>
              )}
            </span>
          )
        }
      >
        {TABS.map((tab) => (
          <Tab key={tab.id} active={current === tab.id} onClick={() => chat && navigate(`/chat/${encodeURIComponent(chat.id)}${tab.path}`)}>
            {tab.label}
            {tab.id === 'subagents' && children.length > 0 && <TabCount>{children.length}</TabCount>}
            {tab.id === 'subagents' && working && <span aria-label="working" className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-[var(--ring)]" />}
          </Tab>
        ))}
      </TabBar>
    </div>
  )
}

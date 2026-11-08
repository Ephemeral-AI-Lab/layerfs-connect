// Conversation views live here; agent hierarchy navigation lives in the header.
import { Sparkles } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Tab, TabBar } from '@/components/layerfs/motion/tabs'
import type { ChatDetail, ChildRun } from '@/layerfs/agent-api'

export type ChatTab = 'chat' | 'files' | 'sandboxes' | 'trace' | 'history' | 'subagents'

const TABS: { id: ChatTab; label: string; path: string }[] = [
  { id: 'chat', label: 'Chat', path: '' },
  { id: 'files', label: 'Files', path: '/files' },
  { id: 'sandboxes', label: 'Sandbox', path: '/sandboxes' },
  { id: 'trace', label: 'Trace', path: '/trace' },
  { id: 'history', label: 'History', path: '/history' },
]

export function ChatTabs({ chat, current, lead, child, onSelect }: { chat: ChatDetail | null; current: ChatTab; lead: number; child?: ChildRun; onSelect?: (tab: ChatTab) => void }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const aside = params.get('aside')
  const base = chat ? `/chat/${encodeURIComponent(chat.id)}${child ? `/subagents/${encodeURIComponent(child.id)}` : ''}` : ''
  const model = child ? child.model : chat?.provider !== 'scenario' ? chat?.modelId : null
  return (
    <div className="shrink-0 pr-4" style={{ paddingLeft: lead }}>
      <TabBar
        aria-label="Chat"
        variant="line"
        end={
          chat && (
            <span className="flex items-center gap-3 text-12 tabular-nums text-[var(--text-tertiary)]">
              {!child && chat.contextUsage?.percent != null && <span title="Context used">{Math.round(chat.contextUsage.percent)}% context</span>}
              {model && (
                <span className="flex items-center gap-1">
                  <Sparkles className="size-3" /> {model}
                </span>
              )}
            </span>
          )
        }
      >
        {TABS.map((tab) => (
          <Tab key={tab.id} active={current === tab.id} onClick={() => onSelect ? onSelect(tab.id) : chat && navigate(`${base}${tab.path}${aside ? `?aside=${encodeURIComponent(aside)}` : ''}`)}>
            {tab.label}
          </Tab>
        ))}
      </TabBar>
    </div>
  )
}

// The new-chat composer's chips: which LayerFS project the chat works with,
// which folder it works in (a new scratch folder, or one chosen), and its model.
import { Check, ChevronDown, FolderOpen, Sparkles, SquareDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { LfsProject } from '@/components/layerfs/LfsIcons'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ChatModel } from '@/layerfs/agent-api'
import { splitProjectKey } from '@/layerfs/chat-groups'
import type { ProjectSummary } from '@/layerfs/host-api'
import { cn } from '@/lib/utils'

const CHIP =
  'inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 text-12 text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:border-ring data-[state=open]:bg-[var(--surface-hover)] disabled:opacity-50'

function Chip({ icon, label, disabled }: { icon: ReactNode; label: string; disabled?: boolean }) {
  return (
    <DropdownMenuTrigger className={CHIP} disabled={disabled}>
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </DropdownMenuTrigger>
  )
}

function Option({ on, onSelect, children, hint }: { on: boolean; onSelect: () => void; children: ReactNode; hint?: string }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2">
      <Check className={cn('size-3.5', !on && 'invisible')} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-12 text-[var(--text-tertiary)]">{hint}</span>}
    </DropdownMenuItem>
  )
}

/** The LayerFS project: none (a scratch-only chat), or one of the home's projects, grouped by Store. */
export function ProjectPicker({ value, projects, onChange }: { value: string; projects: ProjectSummary[]; onChange: (key: string) => void }) {
  const stores = new Map<string, ProjectSummary[]>()
  for (const p of projects) stores.set(p.store, [...(stores.get(p.store) ?? []), p])
  const chosen = value ? splitProjectKey(value) : null
  return (
    <DropdownMenu>
      <Chip
        icon={<LfsProject className="size-3.5 shrink-0" />}
        label={chosen ? `${chosen.name} · ${chosen.store}` : 'No project'}
      />
      <DropdownMenuContent align="start" className="max-h-80 min-w-60 overflow-y-auto">
        <Option on={!value} onSelect={() => onChange('')} hint="scratch only">No project</Option>
        {[...stores].map(([store, list]) => (
          <div key={store}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-11 font-medium text-[var(--text-tertiary)]">{store}</DropdownMenuLabel>
            {list.map((p) => (
              <Option key={p.key} on={value === p.key} onSelect={() => onChange(p.key)} hint={p.machine ?? undefined}>
                {p.name}
              </Option>
            ))}
          </div>
        ))}
        {!projects.length && <p className="px-2 py-1.5 text-12 text-[var(--text-tertiary)]">No LayerFS projects yet.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type WorkspaceChoice = { kind: 'scratch' } | { kind: 'folder'; path: string }

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path

/** Where the chat works: a new empty scratch folder (the default), or a folder the user picks. */
export function WorkspacePicker({ value, canChoose, onChange, onChoose }: {
  value: WorkspaceChoice
  /** The system folder dialog exists (the desktop app, not the browser preview). */
  canChoose: boolean
  onChange: (choice: WorkspaceChoice) => void
  onChoose: () => void
}) {
  return (
    <DropdownMenu>
      <Chip
        icon={value.kind === 'scratch' ? <SquareDashed className="size-3.5 shrink-0" /> : <FolderOpen className="size-3.5 shrink-0" />}
        label={value.kind === 'scratch' ? 'Scratch' : lastPart(value.path)}
      />
      <DropdownMenuContent align="start" className="min-w-64">
        <Option on={value.kind === 'scratch'} onSelect={() => onChange({ kind: 'scratch' })} hint="new empty folder">
          Scratch
        </Option>
        {value.kind === 'folder' && (
          <Option on onSelect={() => undefined} hint={value.path}>
            {lastPart(value.path)}
          </Option>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canChoose} onSelect={onChoose} className="gap-2">
          <FolderOpen className="size-3.5" />
          <span className="flex-1">Choose folder…</span>
          {!canChoose && <span className="text-12 text-[var(--text-tertiary)]">desktop app</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The model: those of providers with a key or sign-in, grouped by provider. */
export function ModelPicker({ value, models, onChange }: {
  value: { provider: string; modelId: string } | null
  models: ChatModel[]
  onChange: (model: ChatModel) => void
}) {
  const navigate = useNavigate()
  const providers = new Map<string, ChatModel[]>()
  for (const m of models) providers.set(m.provider, [...(providers.get(m.provider) ?? []), m])
  const chosen = value && models.find((m) => m.provider === value.provider && m.id === value.modelId)
  return (
    <DropdownMenu>
      <Chip icon={<Sparkles className="size-3.5 shrink-0" />} label={chosen ? chosen.name : value ? value.modelId : 'Choose model'} />
      <DropdownMenuContent align="end" className="max-h-80 min-w-60 overflow-y-auto">
        {[...providers].map(([provider, list], i) => (
          <div key={provider}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-11 font-medium text-[var(--text-tertiary)]">{provider}</DropdownMenuLabel>
            {list.map((m) => (
              <Option key={m.id} on={!!value && value.provider === m.provider && value.modelId === m.id} onSelect={() => onChange(m)}>
                {m.name}
              </Option>
            ))}
          </div>
        ))}
        {!models.length && (
          <p className="max-w-64 px-2 py-1.5 text-12 text-[var(--text-tertiary)]">
            No model is set up. Connect a provider to start chatting.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>Manage models…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

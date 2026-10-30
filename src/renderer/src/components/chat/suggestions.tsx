import { useI18n } from '@/i18n'
import { ArrowUpRight, FolderSearch, GitFork, ListChecks, Terminal } from 'lucide-react'
import { spotlight } from '@/components/motion/spotlight'
import { cn } from '@/lib/utils'

export interface Suggestion {
  title: string
  prompt: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

export const SUGGESTIONS: Suggestion[] = [
  {
    title: 'Explore codebase',
    prompt: 'Read the workspace instructions and explore this project. Explain its architecture, how to run it, and the most useful place to start. Do not change files yet.',
    icon: FolderSearch,
    description: 'Architecture & entry points',
  },
  {
    title: 'Run checks',
    prompt: 'Inspect the project scripts and workspace instructions, run the relevant checks, and report any failures with their causes.',
    icon: ListChecks,
    description: 'Verify tests & scripts',
  },
  {
    title: 'Code review',
    prompt: 'Review this project using subagents for independent areas. Focus on concrete bugs and missing behavior, then combine their findings with file references. Do not edit files.',
    icon: GitFork,
    description: 'Multi-agent inspection',
  },
  {
    title: 'Git changes',
    prompt: 'Use bash to inspect the current Git changes, summarize the intent, and identify anything incomplete. Preserve all existing work.',
    icon: Terminal,
    description: 'Inspect uncommitted diffs',
  },
]

interface SuggestionsProps {
  onSelect: (prompt: string) => void
  className?: string
}

export function Suggestions({ onSelect, className }: SuggestionsProps) {
  const { t } = useI18n()
  return (
    <div aria-label={t("Suggested tasks")} className={cn('mx-auto grid w-full max-w-2xl auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,17.5rem),1fr))] gap-3', className)}>
      {SUGGESTIONS.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.title}
            type="button"
            onClick={() => onSelect(t(item.prompt))}
            onPointerMove={spotlight}
            className="glass-liquid sheen-sweep card-hover spotlight group flex min-h-22 min-w-0 items-center gap-3 rounded-2xl px-4 py-4 text-left text-foreground outline-none transition-all duration-(--dur-base) hover:border-primary/20 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring *:relative *:z-2 sm:px-5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04] text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"><Icon className="size-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium leading-5">{t(item.title)}</span><span className="mt-1 block text-xs font-normal leading-[18px] text-muted-foreground">{t(item.description)}</span></span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
          </button>
        )
      })}
    </div>
  )
}

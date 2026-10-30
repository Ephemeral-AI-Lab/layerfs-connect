// The project page's "Play scenario" button: a menu of the host's scenarios
// (title and blurb), then "All scenarios". Each plays on this project in a
// folder of its own; the caller opens the new run.
import type { DemoSummary } from '@shared/host-api'
import { ChevronDown, Layers, LoaderCircle, Play } from 'lucide-react'

import { ALL } from '@/components/runs/use-runs'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { plural } from '@/components/runs/run-format'
import { host } from '@/host/client'
import { useHostQuery } from '@/host/use-host'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** The host's scenarios, in their order; shared by every page that lists them. */
export function useDemos() {
  return useHostQuery(() => host.demos().then((all) => [...all].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))), [], 'demos')
}

interface ScenarioPickerProps {
  /** Plays scenario `demo` (or ALL) on the project. */
  onPlay: (demo: string) => void
  /** The scenario starting now, or ALL; null when none. */
  starting: string | null
  disabled?: boolean
  /** The project's own scenario, listed first. */
  own?: string | null
  /** 'primary' in an empty state, 'outline' beside other header actions. */
  variant?: 'primary' | 'outline'
}

export function ScenarioPicker({ onPlay, starting, disabled, own, variant = 'outline' }: ScenarioPickerProps) {
  const { t } = useI18n()
  const demos = useDemos()
  const list = demos.data ?? []
  const ordered = own ? [...list.filter((d) => d.id === own), ...list.filter((d) => d.id !== own)] : list
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant === 'primary' ? 'default' : 'outline'} size="sm" className="rounded-xl" disabled={disabled || starting !== null}>
          {starting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {starting ? t('Starting…') : t('Play scenario')}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(30rem,var(--radix-dropdown-menu-content-available-height))] w-80">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('Play on this project, in a folder of its own')}</DropdownMenuLabel>
        {demos.error && !demos.data ? (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            {t('Could not read the scenarios: {message}', { message: demos.error.message })}
          </p>
        ) : !demos.data ? (
          <p role="status" className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {t('Reading the scenarios…')}
          </p>
        ) : ordered.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('The host has no scenarios.')}</p>
        ) : (
          <>
            {ordered.map((demo) => (
              <ScenarioItem key={demo.id} demo={demo} own={demo.id === own} onSelect={() => onPlay(demo.id)} />
            ))}
            {ordered.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onPlay(ALL)} className="items-start gap-2.5 rounded-xl px-2.5 py-2">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Layers className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{t('All scenarios')}</span>
                    <span className="block text-xs text-muted-foreground">{t('{n} scenarios at once, each in its own folder; heavy ones wait their turn', { n: ordered.length })}</span>
                  </span>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ScenarioItem({ demo, own, onSelect }: { demo: DemoSummary; own: boolean; onSelect: () => void }) {
  const { t } = useI18n()
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-2.5 rounded-xl px-2.5 py-2">
      <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg', own ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05] text-muted-foreground')}>
        <Play className="size-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{demo.title}</span>
          {own && <span className="shrink-0 text-[10px] font-semibold tracking-wider text-primary uppercase">{t('This project’s')}</span>}
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{plural(demo.agents.length, 'agent')}</span>
        </span>
        {demo.blurb && <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{demo.blurb}</span>}
      </span>
    </DropdownMenuItem>
  )
}

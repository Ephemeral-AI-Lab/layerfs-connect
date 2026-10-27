// Cloud Sandbox providers: shown, not usable yet. Quiet "not yet" cards in a
// grid that rises in; a mark takes its colour back on hover.
import { Clock, Database, Link2 } from 'lucide-react'

import { TargetIcon } from '@/components/compute/target-parts'
import { revealStyle } from '@/components/motion'
import { Chip } from '@/components/storage/chips'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { CLOUD, STORAGE_FIT, TARGET_LABEL } from '@/data/compute'

import '@/components/storage/storage.css'

/** Cloud Sandbox providers: shown, not usable yet. */
export function CloudCards() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CLOUD.map((p, i) => (
        <section key={p.id} className="sc-soon reveal flex flex-col gap-4 rounded-xl p-4" style={revealStyle(i)}>
          <header className="flex items-start gap-3">
            <span className="sc-soon-mark">
              <TargetIcon id={p.id} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-foreground/80">{TARGET_LABEL[p.id]}</h3>
                <Chip tone="neutral" icon={Clock}>
                  Not available yet
                </Chip>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{p.blurb}</p>
            </div>
          </header>
          <div className="mt-auto flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-faint">
              <Database aria-hidden="true" className="size-3.5" />
              {STORAGE_FIT[p.id]}
            </span>
            <Unavailable reason="Cloud Sandboxes need PostgreSQL storage and LayerFS support (#446)">
              <Button variant="outline" size="sm" disabled>
                <Link2 /> Connect
              </Button>
            </Unavailable>
          </div>
        </section>
      ))}
    </div>
  )
}

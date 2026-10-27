import { Database, Link2 } from 'lucide-react'

import { TargetIcon } from '@/components/compute/target-parts'
import { Chip } from '@/components/storage/chips'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { CLOUD, STORAGE_FIT, TARGET_LABEL } from '@/data/compute'

/** Cloud Sandbox providers: shown, not usable yet. */
export function CloudCards() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CLOUD.map((p) => (
        <section key={p.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <header className="flex items-start gap-3">
            <span className="opacity-60">
              <TargetIcon id={p.id} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-muted-foreground">{TARGET_LABEL[p.id]}</h3>
                <Chip tone="neutral">Not available yet</Chip>
              </div>
              <p className="text-[13px] text-muted-foreground">{p.blurb}</p>
            </div>
          </header>
          <div className="mt-auto flex items-center justify-between gap-2">
            <Chip tone="neutral" icon={Database}>
              {STORAGE_FIT[p.id]}
            </Chip>
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

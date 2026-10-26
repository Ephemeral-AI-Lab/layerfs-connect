import { Database, Link2 } from 'lucide-react'

import { DefaultChip, TargetIcon, TargetSwitch } from '@/components/compute/target-parts'
import { Chip } from '@/components/storage/chips'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { CLOUD, type CloudId, STORAGE_FIT, TARGET_LABEL, type TargetId } from '@/data/compute'

interface CloudCardsProps {
  enabled: Record<TargetId, boolean>
  defaultTarget: TargetId
  lockOf: (id: CloudId) => string | undefined
  onToggle: (id: CloudId, on: boolean) => void
}

export function CloudCards({ enabled, defaultTarget, lockOf, onToggle }: CloudCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CLOUD.map((p) => {
        const connected = p.account !== undefined
        return (
          <section key={p.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <header className="flex items-start gap-3">
              <TargetIcon id={p.id} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold">{TARGET_LABEL[p.id]}</h3>
                  {defaultTarget === p.id && <DefaultChip />}
                </div>
                <p className="text-[13px] text-muted-foreground">{p.blurb}</p>
              </div>
              {connected && (
                <div className="pt-1">
                  <TargetSwitch
                    id={p.id}
                    checked={enabled[p.id]}
                    onChange={(on) => onToggle(p.id, on)}
                    locked={lockOf(p.id)}
                  />
                </div>
              )}
            </header>

            <div className="mt-auto flex items-center justify-between gap-2">
              <Chip tone="neutral" icon={Database}>
                {STORAGE_FIT[p.id]}
              </Chip>
              {connected ? (
                <span className="truncate text-xs text-muted-foreground">
                  {p.account} · {p.region}
                </span>
              ) : (
                <Unavailable reason="Cloud Sandboxes need LayerFS support (#446)">
                  <Button variant="outline" size="sm" disabled>
                    <Link2 /> Connect
                  </Button>
                </Unavailable>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

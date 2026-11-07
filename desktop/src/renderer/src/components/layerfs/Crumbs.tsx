// Where a page sits (docs/ui/README.md): an optional Back chevron (tab
// history: where you came from, named in its tooltip) and the page's place
// in the model, `Storage / shop / api` or `Machines / native`. A step with
// `onClick` is a link; a last one without is the page itself (a page whose
// title shows below may end on its parent). Back and the steps differ
// on purpose: Back retraces your path, the steps climb the model.
import { ChevronLeft } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/shadcn-tooltip'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: ReactNode
  icon?: ReactNode
  /** Opens this step; the page itself has none. */
  onClick?: () => void
  title?: string
}

export function Crumbs({ items, back, className }: { items: Crumb[]; back?: { label: string; onBack: () => void }; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      {back && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Back to ${back.label}`} onClick={back.onBack} className="-ml-2 rounded-full text-muted-foreground hover:text-foreground">
              <ChevronLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">{`Back to ${back.label}`}</TooltipContent>
        </Tooltip>
      )}
      <nav aria-label={'Breadcrumb'} className="min-w-0">
        <ol className="flex min-w-0 items-center gap-1 text-md text-muted-foreground">
          {items.map((c, i) => {
            const last = i === items.length - 1
            return (
              <Fragment key={i}>
                {i > 0 && <li aria-hidden="true" className="shrink-0 text-faint">/</li>}
                <li className={cn('flex min-w-0 items-center', last ? 'shrink' : 'shrink-0')}>
                  {c.onClick ? (
                    <button type="button" onClick={c.onClick} title={c.title} className="inline-flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {c.icon}
                      <span className="truncate">{c.label}</span>
                    </button>
                  ) : (
                    <span aria-current={last ? 'page' : undefined} className={cn('inline-flex min-w-0 items-center gap-1 px-1', last && 'text-foreground/85')}>
                      {c.icon}
                      <span className="truncate">{c.label}</span>
                    </span>
                  )}
                </li>
              </Fragment>
            )
          })}
        </ol>
      </nav>
    </div>
  )
}

// One header for every page: an optional row above (a back link, a
// breadcrumb), the title with badges beside it, a line of description or
// facts, actions on the right, then anything else (an alert) and the page's
// tabs. `sticky` pins it to the top of its scroller, frosting once content
// scrolls under it; put it as a direct child of the scroller. A hero header
// adds an `icon` tile before the title; `back` puts a back button before that,
// in the title row, so going back costs no row of its own; `live` runs a line
// of brand light along its bottom edge.
import { ChevronLeft } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'


interface PageHeaderProps {
  /** A row above the title: <BackLink>, a breadcrumb. With no title it is the header's one row, beside the actions. */
  eyebrow?: ReactNode
  /** The page's h1. Omit when the page names itself elsewhere (the Session page's breadcrumb). */
  title?: ReactNode
  /** Beside the title: chips, a live badge. */
  badges?: ReactNode
  /** One line under the title: what the page is, or its facts. */
  description?: ReactNode
  /** Before the title block: the page's mark in a lit tile (<HeroTile>). */
  icon?: ReactNode
  /** A back button at the start of the title row; `label` (where it goes) is its tooltip. */
  back?: { label: string; onBack: () => void }
  /** Something is playing: a slim animated line of brand light runs under the header. */
  live?: boolean
  /** Right side: buttons, a search box. */
  actions?: ReactNode
  /** Under everything: the page's <TabBar>. */
  tabs?: ReactNode
  /** Between the title row and the tabs: alerts. */
  children?: ReactNode
  /** 'lg' for top-level pages (Projects, Storage, Compute), 'md' for a project or session. */
  size?: 'lg' | 'md'
  /** Turn off entrance effects on data-heavy project pages. */
  motion?: boolean
  sticky?: boolean
  /** The inner width, to line up with the page body: 'max-w-6xl', … Full width when absent. */
  width?: string
  className?: string
}

export function PageHeader({ eyebrow, title, badges, description, icon, back, live, actions, tabs, children, size = 'lg', motion = true, sticky, width, className }: PageHeaderProps) {
  const sentinel = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const s = sentinel.current
    if (!sticky || !s) return
    const io = new IntersectionObserver(([e]) => header.current?.toggleAttribute('data-stuck', !e.isIntersecting))
    io.observe(s)
    return () => io.disconnect()
  }, [sticky])

  return (
    <>
      {sticky && <div ref={sentinel} aria-hidden="true" className="h-px shrink-0" />}
      <header
        ref={header}
        data-live={live || undefined}
        className={cn(
          'page-header @container/page-header relative z-20 shrink-0 app-drag',
          sticky && 'sticky top-0 -mt-px',
          className
        )}
      >
        <div className={cn('mx-auto flex w-full min-w-0 flex-col px-6 @min-[56rem]/workspace:px-8 app-no-drag', width, size === 'lg' ? 'gap-1 pt-7' : 'gap-2 pt-4', !tabs && (size === 'lg' ? 'pb-6' : 'pb-4'))}>
          {eyebrow && !title ? (
            <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">{eyebrow}</div>
              {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
            </div>
          ) : (
            <>
              {eyebrow && <div className={cn('flex min-w-0 items-center', motion && 'reveal')}>{eyebrow}</div>}
              <div className={cn('flex min-w-0 flex-wrap gap-x-5 gap-y-4', icon || back ? 'items-center' : 'items-end')}>
                {(icon || back) && (
                  <div className="flex shrink-0 items-center gap-1">
                    {back && <BackButton {...back} />}
                    {icon && <div className={cn('shrink-0', motion && 'reveal-scale')}>{icon}</div>}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5', motion && 'reveal')}>
                    {title && (
                      <h1 className={cn('truncate font-semibold tracking-[-0.022em]', size === 'lg' ? 'text-[26px] leading-9' : icon ? 'text-[22px] leading-8' : 'text-xl leading-7')}>{title}</h1>
                    )}
                    {badges}
                  </div>
                  {description && (
                    <p
                      className={cn('text-muted-foreground', motion && 'reveal', size === 'lg' ? 'mt-1.5 max-w-2xl text-sm leading-relaxed text-pretty' : 'mt-0.5 truncate text-xs tabular-nums')}
                      style={{ '--i': 1 } as CSSProperties}
                    >
                      {description}
                    </p>
                  )}
                </div>
                {actions && (
                  <div className={cn('flex max-w-full flex-wrap items-center gap-2 @max-[46rem]/page-header:w-full', motion && 'reveal')} style={{ '--i': 2 } as CSSProperties}>
                    {actions}
                  </div>
                )}
              </div>
            </>
          )}
          {children}
          {tabs && <div className={cn('min-w-0', size === 'lg' ? 'mt-4' : icon ? 'mt-3' : 'mt-1')}>{tabs}</div>}
        </div>
        {live && <span aria-hidden="true" className="live-line" />}
      </header>
    </>
  )
}

/** A round chevron that goes back; where it goes is its tooltip and its name. */
function BackButton({ label, onBack }: { label: string; onBack: () => void }) {
  const name = t('Back to {value1}', { value1: label })
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={name} onClick={onBack} className="group/back -ml-2.5 rounded-full text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-5 transition-transform duration-(--dur-base) ease-out-expo group-hover/back:-translate-x-0.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-80 text-pretty">{name}</TooltipContent>
    </Tooltip>
  )
}

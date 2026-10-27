// One header for every page: an optional row above (a back link, a
// breadcrumb), the title with badges beside it, a line of description or
// facts, actions on the right, then anything else (an alert) and the page's
// tabs. `sticky` pins it to the top of its scroller, frosting once content
// scrolls under it; put it as a direct child of the scroller.
import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react'

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
  /** Right side: buttons, a search box. */
  actions?: ReactNode
  /** Under everything: the page's <TabBar>. */
  tabs?: ReactNode
  /** Between the title row and the tabs: alerts. */
  children?: ReactNode
  /** 'lg' for top-level pages (Projects, Storage, Compute), 'md' for a project or session. */
  size?: 'lg' | 'md'
  sticky?: boolean
  /** The inner width, to line up with the page body: 'max-w-6xl', … Full width when absent. */
  width?: string
  className?: string
}

export function PageHeader({ eyebrow, title, badges, description, actions, tabs, children, size = 'lg', sticky, width, className }: PageHeaderProps) {
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
      <header ref={header} className={cn('page-header z-20 shrink-0 px-8', sticky && 'sticky top-0 -mt-px', className)}>
        <div className={cn('mx-auto flex w-full flex-col', width, size === 'lg' ? 'gap-1 pt-7' : 'gap-2 pt-4', !tabs && (size === 'lg' ? 'pb-5' : 'pb-3'))}>
          {eyebrow && !title ? (
            <div className="flex min-h-11 items-center gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">{eyebrow}</div>
              {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
          ) : (
            <>
              {eyebrow && <div className="reveal flex min-w-0 items-center">{eyebrow}</div>}
              <div className="flex items-end gap-6">
                <div className="min-w-0 flex-1">
                  <div className="reveal flex min-w-0 items-center gap-3">
                    {title && (
                      <h1 className={cn('truncate font-semibold tracking-[-0.022em]', size === 'lg' ? 'text-[26px] leading-9' : 'text-xl leading-7')}>{title}</h1>
                    )}
                    {badges}
                  </div>
                  {description && (
                    <p
                      className={cn('reveal text-muted-foreground', size === 'lg' ? 'mt-1 max-w-3xl text-sm text-pretty' : 'mt-0.5 truncate text-xs tabular-nums')}
                      style={{ '--i': 1 } as CSSProperties}
                    >
                      {description}
                    </p>
                  )}
                </div>
                {actions && (
                  <div className="reveal flex shrink-0 items-center gap-2" style={{ '--i': 2 } as CSSProperties}>
                    {actions}
                  </div>
                )}
              </div>
            </>
          )}
          {children}
          {tabs && <div className={size === 'lg' ? 'mt-4' : 'mt-1'}>{tabs}</div>}
        </div>
      </header>
    </>
  )
}

// Page navigation uses quiet glass buttons, or line tabs: text on a hairline
// with one thin underline that glides to the chosen tab. <TabPanel> fades a
// tab's content in when the tab changes. Segmented controls keep their sliding
// selection and support arrow keys, Home and End.
import { createContext, useContext, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'

import { useIndicator } from '@/components/layerfs/motion/indicator'
import { cn } from '@/lib/utils'
import '@/components/layerfs/motion/tabs.css'

type TabBarVariant = 'glass' | 'line'
const VariantContext = createContext<TabBarVariant>('glass')

interface TabBarProps {
  'aria-label': string
  className?: string
  /** 'glass' (buttons) or 'line' (text tabs on a hairline, the chosen one underlined: a compact header's). */
  variant?: TabBarVariant
  /** Page navigation buttons. */
  children: ReactNode
  /** The line variant: quiet facts at the row's far end, on the same hairline. */
  end?: ReactNode
}

/** A horizontally scrollable row of page tabs. */
export function TabBar({ className, variant = 'glass', children, end, ...aria }: TabBarProps) {
  const { container, indicator } = useIndicator<HTMLElement>({ selector: '[aria-current="page"]', axis: 'x' })
  const line = variant === 'line'
  return (
    <nav ref={line ? container : undefined} {...aria} className={cn('view-nav scrollbar-none', line && 'view-nav-line', className)}>
      <VariantContext.Provider value={variant}>{children}</VariantContext.Provider>
      {line && end && <div className="view-nav-end">{end}</div>}
      {line && <span ref={indicator} aria-hidden="true" className="indicator view-tab-indicator" />}
    </nav>
  )
}

/** A tab's count, after its label: small tabular figures. */
export function TabCount({ children }: { children: ReactNode }) {
  return <span className="view-tab-count">{children}</span>
}

/** A tab's content: fades and rises in whenever `id` (the chosen tab) changes. */
export function TabPanel({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <div key={id} className={cn('tab-panel', className)}>
      {children}
    </div>
  )
}

/** A thin rule between groups of tabs. */
export function TabDivider() {
  return <span aria-hidden="true" className="view-nav-divider" />
}

interface TabProps {
  active: boolean
  /** A smaller, fainter tab, for the secondary ones at the end of the row. */
  quiet?: boolean
  onClick: () => void
  title?: string
  className?: string
  children: ReactNode
}

/** One page tab: a button that marks itself `aria-current="page"` when active. */
export function Tab({ active, quiet, onClick, title, className, children }: TabProps) {
  const variant = useContext(VariantContext)
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-active={active}
      onClick={onClick}
      title={title}
      className={cn(
        variant === 'glass' && 'glass-liquid',
        'view-button',
        quiet && 'view-button-quiet',
        className,
      )}
    >
      {children}
    </button>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ComponentType<{ className?: string }>
  /** A count after the label, in tabular figures. */
  count?: number
  title?: string
  disabled?: boolean
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  'aria-label': string
  /** 'radiogroup' (a filter or view switch) or 'tablist' (parts of one page). */
  role?: 'radiogroup' | 'tablist'
  size?: 'sm' | 'md'
  className?: string
}

/** A segmented control: options on a muted track, a raised pill gliding behind the chosen one. */
export function Segmented<T extends string>({ value, onChange, options, role = 'radiogroup', size = 'sm', className, ...aria }: SegmentedProps<T>) {
  const { container, indicator } = useIndicator<HTMLDivElement>()
  const enabled = options.filter((o) => !o.disabled)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.findIndex((o) => o.value === value)
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (at + 1) % enabled.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (at - 1 + enabled.length) % enabled.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? enabled.length - 1
              : -1
    if (to < 0 || !enabled[to]) return
    e.preventDefault()
    onChange(enabled[to].value)
    container.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(enabled[to].value)}"]`)?.focus()
  }
  return (
    <div
      ref={container}
      role={role}
      {...aria}
      onKeyDown={onKeyDown}
      className={cn('relative isolate flex w-fit gap-0.5 rounded-lg-plus bg-muted p-1 shadow-(--pressed)', className)}
    >
      <span ref={indicator} aria-hidden="true" className="indicator -z-10 rounded-md bg-card shadow-[var(--highlight),var(--elev-1)] ring-1 ring-foreground/[0.06]" />
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role={role === 'tablist' ? 'tab' : 'radio'}
            aria-checked={role === 'radiogroup' ? on : undefined}
            aria-selected={role === 'tablist' ? on : undefined}
            data-active={on}
            data-value={o.value}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-sm font-medium outline-none transition-colors duration-(--dur-fast) focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              size === 'sm' ? 'px-2.5 py-1 text-sm [&_svg]:size-3.5' : 'px-3 py-1 text-md [&_svg]:size-4',
              on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.icon && <o.icon aria-hidden="true" />}
            {o.label}
            {o.count !== undefined && <span className="text-faint tabular-nums">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

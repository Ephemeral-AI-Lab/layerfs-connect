import { useRef, useState, type ReactNode } from 'react'
import type { SandboxDetailProps } from './types'

type Navigation = SandboxDetailProps['navigation']

/** Chat's map -> detail -> back flow, shared by every project sandbox view. */
export function ProjectSandboxNavigation({ map, detail, onOpen, onBack, standaloneHref }: {
  map: (open: (name: string) => void) => ReactNode
  detail: (name: string, navigation: Navigation) => ReactNode
  onOpen?: () => void; onBack?: () => void
  standaloneHref?: (name: string) => string | undefined
}) {
  const host = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  const [selected, setSelected] = useState<string | null>(null)
  const open = (name: string) => {
    scroll.current = host.current?.querySelector<HTMLElement>('.sandbox-page')?.scrollTop ?? 0
    onOpen?.(); setSelected(name)
  }
  const back = () => {
    setSelected(null); onBack?.()
    requestAnimationFrame(() => {
      const page = host.current?.querySelector<HTMLElement>('.sandbox-page')
      if (page) page.scrollTop = scroll.current
    })
  }
  return <>
    <div ref={host} style={{ display: selected ? 'none' : 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>{map(open)}</div>
    {selected && <div className="sandbox-page" data-project-sandbox-detail>{detail(selected, { backLabel: 'Project activity', onBack: back, standaloneHref: standaloneHref?.(selected) })}</div>}
  </>
}

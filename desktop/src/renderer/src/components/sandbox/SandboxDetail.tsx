// Shared presentation and inspection state. Pages supply data, source controls and navigation.
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight, Box, Monitor, Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyValue } from './CopyValue'
import { SandboxDetailContext } from './detail-context'
import { useSandboxDetailModel } from './use-sandbox-detail'
import { SandboxOverview } from './SandboxOverview'
import { SandboxWorkspaces } from './SandboxWorkspaces'
import type { SandboxDetailProps, SandboxTab as Tab } from './types'
import './detail.css'
const TABS: { id: Tab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'workspaces', label: 'Workspaces' }]

export function SandboxDetail(props: SandboxDetailProps) {
  const instanceId = useId()
  const detail = useSandboxDetailModel(props)
  const { s, tab, openTab, closed, state, mounted, workspacesKnown } = detail
  const { navigation, onRefresh, controls, notice, simulation = false } = props
  return <SandboxDetailContext.Provider value={detail}><article className="sandbox-detail" data-playing={props.playing} aria-label={`Sandbox ${s.name} details`}>
    <div className="sd-breadcrumb"><button onClick={navigation.onBack}><ArrowLeft size={13} />{navigation.backLabel}</button><span>/</span><strong>{s.name}</strong>{navigation.standaloneHref && <Link className="sd-open-standalone" to={navigation.standaloneHref}>Open standalone <ArrowUpRight size={11} /></Link>}{simulation && <span className="sd-simulation"><Radio size={11} />Simulation</span>}</div>
    <header className="sd-header"><div className="sd-identity"><span className="sd-box-icon"><Box size={23} /></span><div><h1>{s.name}<span className={`sd-state ${!closed && state === 'Running' ? 'sd-success' : ''}`}><i />{state}</span></h1><p>Project <Link to={`/storage/${s.project.split('/').map(encodeURIComponent).join('/')}/files`}>{s.project}<ArrowUpRight size={11} /></Link></p></div></div><div className="sd-header-actions">{s.runtimeId && <CopyValue value={s.runtimeId} label="Copy reference" />}<Button variant="outline" size="sm" onClick={() => { onRefresh?.() }}><RefreshCw size={13} />Refresh</Button></div></header>
    {s.recorded?.op && <p role="status">{s.recorded.op.name} · {s.recorded.op.phase}{s.recorded.op.uncertain ? ' · Outcome unknown' : ''}</p>}
    <div className="sd-machine"><span className="sd-machine-label">Parent machine</span><Link to={s.machine.href}><Monitor size={15} /><strong>{s.machine.name}</strong><ArrowUpRight size={12} /></Link><span className="sd-machine-state"><i />{s.machine.state}</span><span>{s.machine.platform} / {s.machine.architecture}</span><span>{s.machine.description}</span></div>
    <div className="sd-tabs" role="tablist" aria-label="Sandbox detail views">{TABS.map((item,i) => <button key={item.id} id={`${instanceId}-${item.id}`} data-detail-tab={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`${instanceId}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => openTab(item.id)} onKeyDown={e => {
      const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
      if (next < 0) return
      e.preventDefault(); openTab(TABS[next].id); (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus()
    }}>{item.label}{item.id === 'workspaces' && <span>{workspacesKnown ? mounted.length : '?'}</span>}</button>)}</div>
    <div className="sd-panel" id={`${instanceId}-panel`} role="tabpanel" aria-labelledby={`${instanceId}-${tab}`}>
      {tab === 'overview' && <SandboxOverview />}
      {tab === 'workspaces' && <SandboxWorkspaces />}
    </div>
    {controls && <footer className="sd-footer">{controls}{notice && <p>{notice}</p>}</footer>}
  </article></SandboxDetailContext.Provider>
}

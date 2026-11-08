import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSimulation } from '@/components/layerfs/Simulation'
import { connectBridge } from '@/layerfs/bridge'

// Illustrative scenario, independent of the Store being viewed. Packed bytes
// already include metadata packs; never add metadata to that total again.
const stages = [
  { label: 'Full snapshots', value: '12 GiB', fraction: 1, hint: 'Each retained snapshot counted in full; a comparison baseline, not disk usage.' },
  { label: 'Distinct objects', value: '3 GiB', fraction: 1 / 4, hint: 'Canonical objects after content identity reuse.' },
  { label: 'Encoded packs', value: '1.125 GiB', fraction: 1.125 / 12, hint: 'Payload and metadata packs after full/delta encoding and compression.' },
]
const disk = [
  { label: 'Payload packs', value: '1 GiB', mib: 1024, className: 'payload' },
  { label: 'Metadata packs', value: '128 MiB', mib: 128, className: 'metadata' },
  { label: 'Tables / indexes', value: '256 MiB', mib: 256, className: 'indexes' },
  { label: 'Free pages', value: '128 MiB', mib: 128, className: 'free' },
]

export function StoreBreakdownSample({ postgresql }: { postgresql: boolean }) {
  const simulation = useSimulation()
  const available = import.meta.env.DEV && (connectBridge.mode === 'sim' || !!simulation)
  const [hidden, setHidden] = useState(false)
  const shown = available && !hidden
  const parts = postgresql ? disk.slice(0, 2) : disk
  return <section className="store-breakdown" aria-label="Store storage breakdown">
    <div className="store-section-heading">
      <h2>Storage breakdown</h2>
      <div className="store-breakdown-controls">
        <span>{shown ? 'Simulated · illustrative values' : 'Not available yet'}</span>
        {available && <Button size="xs" variant="ghost" onClick={() => setHidden(!hidden)}>{shown ? 'Hide sample' : 'Show sample'}</Button>}
      </div>
    </div>
    {shown ? <>
      <CompactStorageFlow postgresql={postgresql} />
      <details className="store-composition-details">
        <summary>{postgresql ? 'Pack composition' : 'File composition'} <span>{postgresql ? '1.125 GiB packs' : '1.5 GiB SQLite file'}</span></summary>
        <div className="store-disk-diagram">
          <div className="store-disk-stack" role="img" aria-label={postgresql ? 'Simulated packs: 1 GiB payload packs and 128 MiB metadata packs. PostgreSQL database overhead is not modeled.' : 'Simulated SQLite file: 1 GiB payload packs, 128 MiB metadata packs, 256 MiB tables and indexes, 128 MiB free pages. Total 1.5 GiB.'}>
            {parts.map(part => <span key={part.label} className={part.className} style={{ flex: part.mib }} title={`${part.label}: ${part.value}`} />)}
          </div>
          <ul className="store-disk-legend">{parts.map(part => <li key={part.label}><i aria-hidden="true" className={part.className} /><span>{part.label}</span><strong>{part.value}</strong></li>)}</ul>
        </div>
      </details>
      <p className="store-breakdown-note">Sample scenario, not this Store’s measurements. Encoded packs include metadata packs.{postgresql ? ' PostgreSQL table/index overhead is not modeled.' : ' WAL is separate from the SQLite file.'}</p>
    </> : <div className="store-breakdown-empty">Store-wide storage measurements are not available yet.</div>}
  </section>
}

/** Compact sibling of project storage's DiskFlow, with explicit file overhead. */
function CompactStorageFlow({ postgresql }: { postgresql: boolean }) {
  const flow = postgresql ? stages : [...stages, { label: 'SQLite file', value: '1.5 GiB', fraction: 1.5 / 12, hint: 'Encoded packs plus SQLite tables, indexes, and free pages. WAL is separate.' }]
  const center = (i: number) => (i + 0.5) * 1000 / flow.length
  const height = (i: number) => flow[i].fraction * 48
  const transitions = postgresql ? ['4.0× dedup', '2.7× encoding'] : ['4.0× dedup', '2.7× encoding', '+384 MiB file space']
  return <div className="store-compact-flow" role="img" aria-label={`Illustrative storage flow: ${flow.map(s => `${s.label} ${s.value}`).join(', ')}. ${transitions.join('; ')}. Ribbon thickness uses one linear scale.`}>
    <div className="store-flow-stages" style={{ gridTemplateColumns: `repeat(${flow.length}, minmax(0, 1fr))` }}>
      {flow.map(stage => <div key={stage.label} title={stage.hint}><span>{stage.label}</span><strong>{stage.value}</strong></div>)}
    </div>
    <div className="store-flow-ribbon">
      <svg viewBox="0 0 1000 64" preserveAspectRatio="none" aria-hidden="true">
        {flow.slice(1).map((_, i) => {
          const x0 = center(i) + 3, x1 = center(i + 1) - 3, mid = (x0 + x1) / 2
          const top0 = 32 - height(i) / 2, top1 = 32 - height(i + 1) / 2
          const bottom0 = 32 + height(i) / 2, bottom1 = 32 + height(i + 1) / 2
          return <path key={i} d={`M ${x0} ${top0} C ${mid} ${top0}, ${mid} ${top1}, ${x1} ${top1} L ${x1} ${bottom1} C ${mid} ${bottom1}, ${mid} ${bottom0}, ${x0} ${bottom0} Z`} fill="var(--link)" opacity={0.18 + i * 0.1} />
        })}
        {flow.map((stage, i) => <rect key={stage.label} x={center(i) - 3} y={32 - height(i) / 2} width="6" height={height(i)} rx="2" fill="var(--link)" />)}
      </svg>
      {transitions.map((label, i) => <span key={label} className="store-flow-step" title={i === 1 ? 'Distinct canonical bytes divided by encoded packs; includes delta encoding and compression.' : i === 2 ? '256 MiB tables/indexes plus 128 MiB free pages. Metadata packs are already included in encoded packs.' : 'Full snapshots divided by distinct canonical objects.'} style={{ left: `${(i + 1) * 100 / flow.length}%` }}>{label}</span>)}
    </div>
  </div>
}

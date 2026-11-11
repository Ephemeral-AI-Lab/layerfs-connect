import { useId } from 'react'
import { CountUp } from '@/components/layerfs/motion'
import { exactBytes, exactCount, type WireInteger } from '@/layerfs/exact-count'
import { compositionMatches, coordinate, encodingRatio, integer, maximum } from './measures'
import { StagedStorageFlow, ratioStep } from './StagedStorageFlow'
import './real-storage.css'

/** Safe values animate; large integers retain their exact wire representation. */
export function MeasuredValue({ value, bytes = false }: { value: unknown; bytes?: boolean }) {
  const format = bytes ? exactBytes : exactCount
  return typeof value === 'number' && integer(value) !== null
    ? <CountUp value={value} format={shown => format(Math.round(shown))} ms={650} />
    : <span className="tabular-nums">{format(value)}</span>
}

export function EncodingRibbon({ canonical, stored, allocation }: { canonical: WireInteger; stored: WireInteger; allocation?: WireInteger }) {
  const packed = integer(stored), total = integer(allocation)
  const overhead = packed !== null && total !== null && total >= packed ? total - packed : null
  const overheadWire = overhead === null ? null : overhead <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(overhead) : { $layerfs: 'i64-v1' as const, decimal: overhead.toString() }
  const stages = [
    { label: 'Canonical objects', caption: 'Entire Store', value: canonical, tone: 'canonical' as const },
    { label: 'Encoded packs', caption: 'Compression + delta encoding', value: stored, tone: 'stored' as const },
    ...(allocation === undefined ? [] : [{ label: 'Database pages', caption: 'Store-wide allocation', value: allocation, tone: 'allocation' as const }]),
  ]
  return <StagedStorageFlow stages={stages} steps={[ratioStep(canonical, stored, 'encoding'), ...(allocation === undefined ? [] : [overheadWire === null ? 'Overhead unavailable' : `+ ${exactBytes(overheadWire)} overhead / free`])]} label="Store encoding and allocation" />
}
export function MeasuredRibbon({ left, right, ratioLabel }: { left: { label: string; value: WireInteger }; right: { label: string; value: WireInteger }; ratioLabel: string }) {
  const id = useId().replace(/:/g, '')
  const max = maximum([left.value, right.value])
  const c = coordinate(left.value, max), s = coordinate(right.value, max)
  const ratio = encodingRatio(left.value, right.value)
  return <div className="real-encoding">
    <div className="real-encoding-labels"><div><span>{left.label}</span><strong><MeasuredValue value={left.value} bytes /></strong></div><div><span>{right.label}</span><strong><MeasuredValue value={right.value} bytes /></strong></div></div>
    {c !== null && s !== null && max > 0n ? <svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label={`${left.label}: ${exactBytes(left.value)}; ${right.label}: ${exactBytes(right.value)}`}>
      <defs><linearGradient id={`encoding-${id}`}><stop stopColor="var(--storage-canonical)" stopOpacity=".72" /><stop offset="1" stopColor="var(--storage-stored)" stopOpacity=".8" /></linearGradient></defs>
      <path className="real-ribbon" d={`M8 ${50 - c * 42} C260 ${50 - c * 42} 340 ${50 - s * 42} 592 ${50 - s * 42} L592 ${50 + s * 42} C340 ${50 + s * 42} 260 ${50 + c * 42} 8 ${50 + c * 42} Z`} fill={`url(#encoding-${id})`} />
      <line x1="8" x2="8" y1={50 - c * 42} y2={50 + c * 42} stroke="var(--storage-canonical)" strokeWidth="5" strokeLinecap="round" /><line x1="592" x2="592" y1={50 - s * 42} y2={50 + s * 42} stroke="var(--storage-stored)" strokeWidth="5" strokeLinecap="round" />
    </svg> : <p className="real-storage-note">{max === 0n ? 'No measured object bytes.' : 'Measurements unavailable.'}</p>}
    <p className="real-storage-note">{ratio ? <><strong>{ratio}×</strong> {ratioLabel}</> : 'Ratio unavailable for empty or unknown totals.'}</p>
  </div>
}

export interface Allocation {
  accounting_version?: number
  data_pack_bytes?: WireInteger
  metadata_pack_bytes?: WireInteger
  database_overhead_bytes?: WireInteger
  free_page_bytes?: WireInteger | null
  database_page_bytes?: WireInteger
  composition_complete?: boolean
  composition_reason?: string
}

export interface FileMeasurements { observedAt: number; bytes: WireInteger | null; walBytes: WireInteger | null; incomingBytes: WireInteger | null }
export function FileLengthBars({ measurement, error }: { measurement?: FileMeasurements | null; error?: string }) {
  if (!measurement) return error ? <p className="real-storage-note">File lengths unavailable: {error}</p> : null
  const values = [{ label: 'Database file', value: measurement.bytes }, { label: 'WAL file', value: measurement.walBytes }, { label: 'Incoming file', value: measurement.incomingBytes }]
  const max = maximum(values.map(value => value.value))
  return <div className="real-allocation"><div className="real-storage-heading"><h3>SQLite file lengths</h3><span className="real-storage-note">{new Date(measurement.observedAt).toLocaleString()}</span></div><dl className="real-file-lengths">{values.map(value => <div key={value.label}><dt>{value.label}</dt><dd><div className="real-file-track" aria-hidden="true"><span style={{ transform: `scaleX(${coordinate(value.value, max) ?? 0})` }} /></div><span>{exactBytes(value.value)}</span></dd></div>)}</dl><p className="real-storage-note">Separately observed file lengths. Database-page accounting above and physical disk allocation are different measurements.</p></div>
}

export function AllocationComposition({ stats, postgresql }: { stats: Allocation; postgresql: boolean }) {
  const parts = [
    { label: 'Data packs', value: stats.data_pack_bytes, tone: 'var(--storage-stored)' },
    { label: 'Metadata packs', value: stats.metadata_pack_bytes, tone: 'var(--storage-metadata)' },
    { label: 'Database overhead', value: stats.database_overhead_bytes, tone: 'var(--storage-overhead)' },
    { label: 'Free pages', value: stats.free_page_bytes, tone: 'var(--storage-free)' },
  ]
  const total = integer(stats.database_page_bytes)
  const complete = stats.accounting_version === 1 && stats.composition_complete === true && total !== null && compositionMatches(parts.map(p => p.value), stats.database_page_bytes)
  if (!complete) return <p className="real-storage-note">{postgresql ? 'Full database composition unavailable: PostgreSQL free space is not measured.' : stats.composition_reason ?? (stats.accounting_version === undefined ? 'Database composition is unavailable with this LayerFS version.' : 'Database composition is incomplete.')} Independent counters remain below.</p>
  return <div className="real-allocation"><div className="real-storage-heading"><h3>Database allocation</h3><span className="real-storage-note">{exactBytes(stats.database_page_bytes)}</span></div>
    {total! > 0n ? <div className="real-composition-bar" role="img" aria-label={parts.map(p => `${p.label}: ${exactBytes(p.value)}`).join('; ')}>{parts.map(p => <span key={p.label} style={{ flexGrow: coordinate(p.value, total!) ?? 0, background: p.tone }} title={`${p.label}: ${exactBytes(p.value)}`} />)}</div> : <p className="real-storage-note">No allocated database pages.</p>}
    <dl className="real-composition-legend">{parts.map(p => <div key={p.label}><dt><i style={{ background: p.tone }} />{p.label}</dt><dd>{exactBytes(p.value)}</dd></div>)}</dl>
    <p className="real-storage-note">Non-overlapping database-page components. WAL file length is a separate measurement.</p>
  </div>
}

export function MeasurementLine({ values, label, points, times, selectedIndex, onSelect }: { values: unknown[]; label: string; points?: string[]; times?: number[]; selectedIndex?: number; onSelect?: (index: number) => void }) {
  if (!values.some(value => integer(value) !== null)) return <p className="real-storage-note">Measurements are unavailable for these observations.</p>
  const max = maximum(values)
  const start = times?.[0] ?? 0, duration = times ? times.at(-1)! - start : 0
  const coords = values.map((v, i) => ({ x: values.length < 2 ? 300 : 8 + (duration > 0 ? (times![i] - start) / duration : i / (values.length - 1)) * 584, y: coordinate(v, max) }))
  const paths: string[] = []
  let current = ''
  coords.forEach(p => { if (p.y === null) { if (current) paths.push(current); current = '' } else current += `${current ? ' L' : 'M'}${p.x},${142 - p.y * 126}` })
  if (current) paths.push(current)
  return <div className="real-line-chart"><div className="real-chart-scale"><span>{exactBytes(max <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(max) : { $layerfs: 'i64-v1', decimal: max.toString() })}</span><span>0 B</span></div><svg viewBox="0 0 600 156" preserveAspectRatio="none" role={onSelect ? "group" : "img"} aria-label={label}>
    {[16, 79, 142].map(y => <line key={y} x1="8" x2="592" y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 5" />)}
    {paths.map((d, i) => { const matches = [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)]; return matches.length > 1 ? <path key={`area:${i}`} d={`${d} L${matches.at(-1)![1]},142 L${matches[0][1]},142 Z`} fill="var(--storage-canonical)" fillOpacity=".08" /> : null })}
    {selectedIndex !== undefined && coords[selectedIndex]?.y !== null && coords[selectedIndex] && <line x1={coords[selectedIndex].x} x2={coords[selectedIndex].x} y1="8" y2="148" stroke="var(--storage-canonical)" strokeOpacity=".45" strokeDasharray="3 4" />}
    {paths.map((d, i) => <path className="real-history-line" key={i} d={d} fill="none" stroke="var(--storage-canonical)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
    {coords.map((p, i) => p.y === null ? null : <circle key={i} cx={p.x} cy={142 - p.y * 126} r={selectedIndex === i ? 5 : 3.5} className={onSelect ? 'storage-revision-point' : undefined} tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'button' : undefined} aria-label={onSelect ? `Inspect revision ${points?.[i] ?? i + 1}: ${exactBytes(values[i])}` : undefined} aria-pressed={onSelect ? selectedIndex === i : undefined} onClick={onSelect ? () => onSelect(i) : undefined} onKeyDown={onSelect ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) } } : undefined} stroke="var(--storage-canonical)" strokeWidth={onSelect ? 14 : 0} strokeOpacity="0" fill="var(--storage-canonical)"><title>{points?.[i] ?? `Revision ${i + 1}`}: {exactBytes(values[i])}</title></circle>)}
  </svg></div>
}

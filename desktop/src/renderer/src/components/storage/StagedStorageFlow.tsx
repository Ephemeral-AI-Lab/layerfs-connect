import { useEffect, useId, useState, type CSSProperties } from 'react'
import { CountUp, useReducedMotion } from '@/components/layerfs/motion'
import { exactBytes, type WireInteger } from '@/layerfs/exact-count'
import { canonicalReuse, coordinate, encodingRatio, integer, maximum } from './measures'
import './real-storage.css'

export interface StorageStage {
  label: string
  caption: string
  value: WireInteger | null | undefined
  tone: 'referenced' | 'canonical' | 'stored' | 'allocation'
}
const tone = (name: StorageStage['tone']) => `var(--storage-${name === 'allocation' ? 'overhead' : name})`
const delay = (ms: number) => ({ '--storage-delay': `${ms}ms` }) as CSSProperties

function StageBytes({ value, wait }: { value: StorageStage['value']; wait: number }) {
  const reduced = useReducedMotion()
  const [arrived, setArrived] = useState(reduced || wait === 0)
  useEffect(() => {
    if (reduced) return
    const timer = setTimeout(() => setArrived(true), wait)
    return () => clearTimeout(timer)
  }, [reduced, wait])
  if (!reduced && !arrived) return <span aria-hidden="true">{exactBytes(value)}</span>
  return typeof value === 'number' && integer(value) !== null
    ? <CountUp value={value} format={shown => exactBytes(Math.round(shown))} ms={650} />
    : <span className={integer(value) === null ? 'storage-stage-unknown' : undefined}>{exactBytes(value)}</span>
}

/** Stages share one linear byte scale. Missing values never produce a band. */
export function StagedStorageFlow({ stages, steps, label }: { stages: StorageStage[]; steps: string[]; label: string }) {
  const id = useId().replace(/[^\w-]/g, '')
  const [replay, setReplay] = useState(0)
  const max = maximum(stages.map(stage => stage.value))
  const center = (index: number) => (index + .5) * 900 / stages.length
  const height = (index: number) => (coordinate(stages[index].value, max) ?? 0) * 120
  return <div className="storage-staged-flow">
    <div key={replay} className="storage-flow-sequence">
      <div className="storage-flow-labels" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>{stages.map((stage, index) => <div className="storage-stage-label" key={stage.label} style={delay(index * 260)}><span><i style={{ background: tone(stage.tone) }} />{stage.label}</span><strong><StageBytes value={stage.value} wait={index * 260} /></strong><small>{stage.caption}</small></div>)}</div>
      <svg className="storage-flow-svg" viewBox="0 0 900 150" preserveAspectRatio="none" role="img" aria-label={`${label}. ${stages.map(stage => `${stage.label}: ${exactBytes(stage.value)}`).join('; ')}`}>
        <defs>{stages.slice(1).map((stage, index) => <linearGradient key={stage.label} id={`${id}-${index}`}><stop stopColor={tone(stages[index].tone)} stopOpacity=".65" /><stop offset="1" stopColor={tone(stage.tone)} stopOpacity=".75" /></linearGradient>)}</defs>
        {stages.slice(1).map((stage, index) => {
          if (integer(stages[index].value) === null || integer(stage.value) === null || max === 0n) return null
          const x0 = center(index) + 3, x1 = center(index + 1) - 3, mid = (x0 + x1) / 2
          const h0 = height(index), h1 = height(index + 1)
          const d = `M${x0},${75-h0/2} C${mid},${75-h0/2} ${mid},${75-h1/2} ${x1},${75-h1/2} L${x1},${75+h1/2} C${mid},${75+h1/2} ${mid},${75+h0/2} ${x0},${75+h0/2} Z`
          return <g className="storage-flow-band" key={stage.label} style={delay(index * 260 + 130)}><path d={d} fill={`url(#${id}-${index})`} />{[-.24, 0, .24].map((offset, k) => <path key={offset} className="storage-flow-stroke" d={`M${x0},${75+offset*h0} C${mid},${75+offset*h0} ${mid},${75+offset*h1} ${x1},${75+offset*h1}`} fill="none" stroke={tone(stage.tone)} strokeWidth="1.2" pathLength="1" vectorEffect="non-scaling-stroke" style={delay(index * 260 + k * 100 + 300)} />)}</g>
        })}
        {stages.map((stage, index) => integer(stage.value) === null ? null : <rect className="storage-flow-pillar" key={stage.label} style={delay(index * 260)} x={center(index)-3} y={75-height(index)/2} width="6" height={height(index)} rx="3" fill={tone(stage.tone)} />)}
      </svg>
      <div className="storage-flow-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, marginInline: `${50 / stages.length}%` }}>{steps.map((step, index) => <span className="storage-stage-label" key={index} style={delay(index * 260 + 400)}>{step}</span>)}</div>
    </div>
    <div className="storage-flow-replay"><button onClick={() => setReplay(value => value + 1)} aria-label={`Replay ${label.toLowerCase()} animation`}>↻ Replay</button></div>
  </div>
}

export function ReuseRing({ referenced, unique }: { referenced: unknown; unique: unknown }) {
  const fraction = canonicalReuse(referenced, unique)
  const percent = fraction === null ? null : Math.round(fraction * 1000) / 10
  return <div className="storage-reuse-ring" role="img" aria-label={percent === null ? 'Canonical reuse unavailable' : `${percent}% canonical bytes reused within the selected snapshots`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--border)" strokeWidth="7" /><circle className="storage-reuse-arc" cx="50" cy="50" r="42" fill="none" stroke="var(--storage-stored)" strokeWidth="7" pathLength="1" strokeDasharray="1" strokeDashoffset={1-(fraction ?? 0)} strokeLinecap="round" /></svg>
    <div><strong>{percent === null ? '—' : <CountUp value={percent} format={value => `${Math.round(value * 10) / 10}%`} ms={950} />}</strong><span>canonical reuse</span></div>
  </div>
}

export function ratioStep(left: unknown, right: unknown, label: string) {
  const ratio = encodingRatio(left, right)
  return ratio ? `${ratio}× ${label}` : `${label} unavailable`
}

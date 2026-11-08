import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SandboxMap, type SandboxMapData } from '@/components/sandbox/SandboxMap'
import { DURATION, SCENARIOS, scene, type Scenario } from './sandbox-scenarios'
import { detailSnapshot } from './sandbox'
import { SandboxDetailPreview } from './SandboxDetailPreview'
import { ProjectSandboxNavigation } from '@/components/sandbox/ProjectSandboxNavigation'

export function ProjectSandboxPreview({ project, title = 'Example project', chatId, childId, sampleChildId }: {
  project: string; title?: string; chatId?: string; childId?: string; sampleChildId?: string
}) {
  const [scenario, setScenario] = useState<Scenario>('parallel')
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [resume, setResume] = useState(false)
  const data = useMemo<SandboxMapData>(() => ({
    ...scene(scenario, title),
    branches: scenario === 'empty' ? [] : [{ name: 'main' }, { name: 'search', commits: 2 }, { name: 'search-tests', commits: 1 }],
    sandboxes: scenario === 'empty' ? [] : ['dev', 'checks'].map(name => ({ name, machine: 'docker', backend: 'docker', state: 'running' })),
    links: chatId ? { main: `/chat/${encodeURIComponent(chatId)}`, ...(sampleChildId ? { reviewer: `/chat/${encodeURIComponent(chatId)}/subagents/${encodeURIComponent(sampleChildId)}` } : {}) } : {},
  }), [scenario, title, chatId, sampleChildId])
  useEffect(() => {
    if (!playing || scenario === 'empty') return
    let last = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now(); const delta = (now - last) / 1000; last = now
      setTime(t => Math.min(DURATION, t + delta))
    }, 100)
    return () => clearInterval(timer)
  }, [playing, scenario])
  useEffect(() => { if (time >= DURATION) setPlaying(false) }, [time])
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [])
  function reset(next = scenario) { setScenario(next); setTime(0); setPlaying(next !== 'empty' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) }
  return <ProjectSandboxNavigation onOpen={() => { setResume(playing); setPlaying(false) }} onBack={() => setPlaying(resume)}
    standaloneHref={name => `/machines/docker/sandboxes/${encodeURIComponent(name)}`}
    detail={(name, navigation) => <SandboxDetailPreview snapshot={detailSnapshot(name, project, data, data.links)} initialTime={time} initialPlaying={resume} highlightedConversation={chatId} navigation={navigation} />}
    map={open => <SandboxMap key={scenario} project={project} data={data} time={time} playing={playing} simulation
      chatActorId={chatId ? 'main' : undefined} focusActorId={childId && childId === sampleChildId ? 'reviewer' : undefined} onOpenSandbox={open}
    controls={<div className="sb-controls"><label className="sb-scenario"><span className="sr-only">Simulation scenario</span><select value={scenario} onChange={e => reset(e.target.value as Scenario)}>{SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select><ChevronDown size={12} /></label>
      <Button variant="outline" size="sm" disabled={scenario === 'empty'} onClick={() => time >= DURATION ? reset() : setPlaying(p => !p)}>{playing ? <Pause /> : <Play />}{playing ? 'Pause' : time >= DURATION ? 'Play again' : 'Play'}</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Replay simulation" disabled={scenario === 'empty'} onClick={() => reset()}><RotateCcw /></Button></div>}
    playback={<div className="sb-playback"><span>{scenario === 'empty' ? 'Empty scene' : playing ? 'Playing scenario' : 'Paused'}</span><label className="sb-scrubber"><span className="sr-only">Simulation position</span><input aria-label="Simulation position" type="range" min="0" max={DURATION} step=".1" value={time} disabled={scenario === 'empty'} onChange={e => { setPlaying(false); setTime(Number(e.target.value)) }} /></label><span className="sb-time">0:{Math.floor(time).toString().padStart(2, '0')} / 0:36</span></div>} />} />
}

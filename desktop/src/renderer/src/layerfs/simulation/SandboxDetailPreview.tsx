import { useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { SandboxDetail } from '@/components/sandbox/SandboxDetail'
import { clock } from '@/components/sandbox/model'
import type { SandboxDetailProps } from '@/components/sandbox/types'
import { useSandboxPlayback } from './use-sandbox-playback'

/** Shared simulation adapter. Conversation and machine wrappers supply only their navigation context. */
export function SandboxDetailPreview({ snapshot, initialTime = 0, initialPlaying = false, navigation, highlightedConversation }: {
  snapshot: SandboxDetailProps['snapshot']; initialTime?: number; initialPlaying?: boolean
  navigation: SandboxDetailProps['navigation']; highlightedConversation?: string
}) {
  const playback = useSandboxPlayback(snapshot.duration,initialTime,initialPlaying)
  const [observedAt, setObservedAt] = useState(initialTime)
  const [message, setMessage] = useState('')
  const controls = <>{snapshot.duration > 0 && <div className="sd-detail-playback">
    <button aria-label={playback.playing ? 'Pause detail simulation' : 'Play detail simulation'} onClick={playback.toggle}>{playback.playing ? <Pause size={13} /> : <Play size={13} />}</button>
    <button aria-label="Replay detail simulation" onClick={playback.replay}><RotateCcw size={12} /></button>
    <input aria-label="Detail simulation position" type="range" min="0" max={playback.duration} step=".1" value={playback.time} onChange={e => playback.seek(Number(e.target.value))} />
    <span>{clock(playback.time)} / {clock(playback.duration)}</span>
  </div>}<span className="sd-observation-message" role="status">{message}</span></>
  return <SandboxDetail simulation snapshot={snapshot} time={playback.time} playing={playback.playing}
    observedAt={observedAt} onRefresh={() => { setObservedAt(playback.time); setMessage(`Sample refreshed at ${clock(playback.time)}`) }}
    navigation={navigation} highlightedConversation={highlightedConversation} controls={controls}
    notice="Simulated SDK / CLI data. No agents, commands, or resources are started." />
}

import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function CopyValue({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return <button type="button" className="sd-copy" aria-label={`${label}: ${value}`} title={state === 'failed' ? 'Clipboard unavailable. Select and copy the visible value.' : `${label}: ${value}`} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setState('copied') }
    catch { setState('failed') }
    clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), 2200)
  }}>{state === 'copied' ? <Check size={12} /> : <Copy size={12} />}<span role="status">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy unavailable' : label}</span></button>
}

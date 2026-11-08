import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { chatHost, type ChatModels, type ChatProvider, type ModelLogin } from '@/layerfs/agent-api'

const active = (login: ModelLogin | null) => login?.state === 'starting' || login?.state === 'waiting'

/** Uses the host's native Pi OAuth flow; browser approval stays with the user. */
export function ProviderSignIn({ provider, onSignedIn, disabled }: { provider: ChatProvider; onSignedIn: (snapshot: ChatModels) => void; disabled: boolean }) {
  const [login, setLogin] = useState<ModelLogin | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const liveId = active(login) ? login!.id : null
  const ref = useRef(liveId)
  ref.current = liveId

  useEffect(() => {
    if (!liveId) return
    let stopped = false
    let pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void chatHost.login(liveId).then(async (next) => {
        if (stopped) return
        setLogin(next)
        if (next.state === 'done') { const snapshot = await chatHost.models(); if (!stopped) onSignedIn(snapshot) }
      }).catch((cause: Error) => { if (!stopped) setError(cause.message) }).finally(() => { pending = false })
    }, 1000)
    return () => { stopped = true; clearInterval(timer) }
  }, [liveId, onSignedIn])
  useEffect(() => () => { if (ref.current) void chatHost.cancelLogin(ref.current).catch(() => {}) }, [])

  async function act(action: Promise<ModelLogin>) {
    setBusy(true); setError(null)
    try { setLogin(await action); setAnswer('') }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  const step = liveId ? login?.step : null
  const prompt = liveId ? login?.prompt : null

  return <section aria-label="Provider sign-in" className="space-y-3 rounded-xs border border-[var(--border-default)] p-4 text-13">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span>{provider.signedIn ? `Signed in to ${provider.signIn?.plan}` : `Use your ${provider.signIn?.plan} subscription`}</span>
      {liveId ? <Button type="button" variant="outline" disabled={busy} onClick={() => void act(chatHost.cancelLogin(liveId))}>Cancel sign-in</Button> : <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void act(chatHost.startLogin(provider.id))}>{provider.signIn?.label ?? 'Sign in'}</Button>}
    </div>
    {step && <div className="space-y-2">
      {step.type === 'device_code' ? <p>Enter <code className="select-all font-semibold">{step.userCode}</code> on the sign-in page.</p> : step.instructions && <p>{step.instructions}</p>}
      <Button type="button" variant="outline" disabled={busy} onClick={() => void act(chatHost.openLogin(login!.id))}>Open sign-in page</Button>
    </div>}
    {prompt?.type === 'select' ? <div className="flex flex-wrap gap-2">{prompt.options?.map((option) => <Button key={option.id} type="button" variant="outline" disabled={busy} onClick={() => void act(chatHost.respondLogin(login!.id, option.id))}>{option.label}</Button>)}</div> : prompt ? <label className="block space-y-2"><span>{prompt.message}</span><input aria-label="Sign-in response" className="h-9 w-full rounded-xs border border-input bg-card px-3" value={answer} placeholder={prompt.placeholder} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (answer.trim()) void act(chatHost.respondLogin(login!.id, answer)) } }} /><Button type="button" variant="outline" disabled={busy || !answer.trim()} onClick={() => void act(chatHost.respondLogin(login!.id, answer))}>Continue sign-in</Button></label> : null}
    {liveId && <p role="status" className="text-[var(--text-secondary)]">{login?.progress ?? 'Waiting for sign-in…'}</p>}
    {login?.state === 'done' && <p role="status">Signed in. Choose a model and save it below.</p>}
    {(error || login?.state === 'failed') && <p role="alert" className="break-words text-destructive">{error ?? login?.error ?? 'Sign-in failed. Try again.'}</p>}
  </section>
}

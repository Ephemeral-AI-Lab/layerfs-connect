import { useI18n } from '@/i18n'
import { Check, Copy, ExternalLink, LoaderCircle, LogIn, LogOut, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentModels, AgentProvider, ModelLogin } from '@shared/agent-api'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { agentHost } from '@/host/agent-client'
import { cn } from '@/lib/utils'

/** How often a running sign-in is polled. */
const POLL_MS = 1000

const running = (login: ModelLogin | null) => Boolean(login && (login.state === 'starting' || login.state === 'waiting'))

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Providers that offer a subscription sign-in and have no credential or saved connection yet. */
export function SubscriptionShortcuts({ providers, disabled, onSignIn }: {
  providers: AgentProvider[]
  disabled?: boolean
  onSignIn: (provider: string) => void
}) {
  const { t } = useI18n()
  if (providers.length === 0) return null
  return <section aria-label={t("Subscriptions")} className="space-y-2">
    <span className="text-[11px] font-medium text-muted-foreground">{t("Use a subscription")}</span>
    <div className="flex flex-wrap gap-2">
      {providers.map((p) => <button
        key={p.id}
        type="button"
        disabled={disabled}
        title={t("Sign in to {plan}", { plan: p.signIn!.plan })}
        onClick={() => onSignIn(p.id)}
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-foreground/[0.07] bg-background/50 px-3 text-[11px] font-medium text-foreground/85 outline-none backdrop-blur-xs transition-colors hover:border-primary/25 hover:bg-primary/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <LogIn className="size-3.5 shrink-0 text-(--icon-accent)" />
        <span className="truncate">{t(p.signIn!.label)}</span>
      </button>)}
    </div>
  </section>
}

/**
 * A provider's subscription sign-in (Sign in with ChatGPT, Claude, …), run by
 * the host on Pi's OAuth flow. Choose a method, then follow its step: a page
 * that opens in the system browser, or a device code to enter on the
 * provider's page. Polled while it runs; unmounting (another provider, or the
 * dialog closes) cancels a sign-in still running.
 */
export function ModelSignIn({ provider: p, autoStart, onAutoStarted, onSignedIn, onSignOut, disabled }: {
  provider: AgentProvider
  /** Start the sign-in as soon as this renders (the user chose it from a shortcut). */
  autoStart?: boolean
  onAutoStarted?: () => void
  onSignedIn: (models: AgentModels) => void
  onSignOut: () => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [login, setLogin] = useState<ModelLogin | null>(null)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState('')
  const [copied, setCopied] = useState(false)
  const [acting, setActing] = useState(false)
  const opened = useRef<string | null>(null)
  const live = running(login) ? login!.id : null
  const signIn = p.signIn!

  // follow the sign-in while it runs; when it is done, the models snapshot is read again
  useEffect(() => {
    if (!live) return
    let stop = false
    const timer = setInterval(() => {
      void (async () => {
        try {
          const next = await agentHost.login(live)
          if (stop) return
          setLogin(next)
          if (next.state === 'done') onSignedIn(await agentHost.models())
        } catch (e) {
          if (!stop) setError((e as Error).message)
        }
      })()
    }, POLL_MS)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [live])

  // leaving cancels a sign-in still running
  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => () => {
    if (liveRef.current) void agentHost.cancelLogin(liveRef.current).catch(() => {})
  }, [])

  // the browser method opens its page once, as soon as there is one
  useEffect(() => {
    if (login?.step?.type === 'auth_url' && running(login) && opened.current !== login.step.url) {
      opened.current = login.step.url
      void agentHost.openLogin(login.id).catch((e) => setError((e as Error).message))
    }
  }, [login])

  // a shortcut's sign-in starts once, even when effects run twice in development
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart) {
      autoStarted.current = false
      return
    }
    onAutoStarted?.()
    if (autoStarted.current || live) return
    autoStarted.current = true
    start()
  }, [autoStart])

  async function act(call: () => Promise<ModelLogin>) {
    setError('')
    setActing(true)
    try {
      setLogin(await call())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  function start() {
    opened.current = null
    setAnswer('')
    setCopied(false)
    void act(() => agentHost.startLogin(p.id))
  }

  function respond(value: string) {
    if (!login || !value.trim()) return
    void act(() => agentHost.respondLogin(login.id, value.trim())).then(() => setAnswer(''))
  }

  function answerKey(event: KeyboardEvent<HTMLInputElement>) {
    // the panel sits inside the settings form: Enter answers the sign-in, not "Save model"
    if (event.key !== 'Enter') return
    event.preventDefault()
    respond(answer)
  }

  const step = live ? login?.step : null
  const prompt = live ? login?.prompt : null
  const choice = prompt?.type === 'select' && prompt.options ? prompt : null
  const question = prompt && prompt.type !== 'select' ? prompt : null
  const expiresIn = step?.type === 'device_code' && step.expires ? Math.max(0, Math.ceil((step.expires - Date.now()) / 60000)) : null

  const answerField = question && <div className="space-y-1.5">
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      {step?.type === 'auth_url' ? t("If the browser cannot reach Connect, paste the address it ended on:") : t(question.message)}
    </p>
    <div className="flex gap-2">
      <Input
        aria-label={t(question.message)}
        type={question.type === 'secret' ? 'password' : 'text'}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={answerKey}
        placeholder={question.placeholder ? t(question.placeholder) : undefined}
        spellCheck={false}
        autoComplete="off"
        disabled={acting}
        className="h-8.5 font-mono text-xs"
      />
      <Button type="button" variant="outline" size="sm" className="h-8.5 shrink-0 rounded-xl px-3.5 text-xs" disabled={acting || !answer.trim()} onClick={() => respond(answer)}>
        {t("Submit")}
      </Button>
    </div>
  </div>

  return <div className="space-y-3 rounded-2xl border border-primary/15 bg-primary/[0.035] px-3.5 py-3">
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-(--icon-accent)">
        <LogIn className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium" title={signIn.plan}>{t(signIn.plan)}</span>
          {p.signedIn && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" />{t("Signed in")}
          </span>}
        </span>
        <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted-foreground">
          {p.signedIn ? t("Connect has its own sign-in; other apps on this machine stay signed in.") : t("Use your subscription instead of an API key. Other apps on this machine stay signed in.")}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {live ? (
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3 text-xs" disabled={acting} onClick={() => void act(() => agentHost.cancelLogin(live))}>
            <X className="size-3.5" /> {t("Cancel")}
          </Button>
        ) : <>
          {p.signedIn && <Button type="button" variant="ghost" size="sm" className="h-8 rounded-xl px-2.5 text-xs text-muted-foreground hover:text-destructive" disabled={disabled || acting} onClick={onSignOut}>
            <LogOut className="size-3.5" /> {t("Sign out")}
          </Button>}
          <Button type="button" variant={p.signedIn ? 'outline' : 'default'} size="sm" className={cn('h-8 rounded-xl px-3 text-xs', !p.signedIn && 'btn-primary')} disabled={disabled || acting} onClick={start}>
            {acting && !login ? <LoaderCircle className="size-3.5 animate-spin" /> : <LogIn className="size-3.5" />}
            {p.signedIn ? t("Sign in again") : t(signIn.label)}
          </Button>
        </>}
      </span>
    </div>

    {live && login && <div className="space-y-3 border-t border-foreground/[0.06] pt-3 animate-in fade-in duration-(--dur-base)">
      {choice ? <div className="space-y-2">
        <span className="text-[11px] font-medium text-muted-foreground">{choice.message ? t(choice.message) : t("How to sign in")}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {choice.options!.map((o) => <button
            key={o.id}
            type="button"
            disabled={acting}
            onClick={() => void act(() => agentHost.respondLogin(login.id, o.id))}
            className="flex flex-col items-start gap-0.5 rounded-xl border border-foreground/[0.07] bg-background/50 px-3 py-2.5 text-left outline-none transition-colors hover:border-primary/25 hover:bg-background/80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <span className="text-xs font-medium">{o.id === 'browser' ? t("Browser") : o.id === 'device_code' ? t("Device code") : t(o.label)}</span>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground">
              {o.id === 'browser' ? t("Opens your browser; finishes by itself.") : o.id === 'device_code' ? t("Enter a short code on the sign-in page.") : o.description ? t(o.description) : ''}
            </span>
          </button>)}
        </div>
      </div> : step?.type === 'device_code' ? <div className="space-y-2.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("Open the sign-in page, sign in, and enter this code:")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-xl border border-foreground/[0.07] bg-background/70 px-3 py-1.5 font-mono text-lg font-semibold tracking-[0.12em] select-all">{step.userCode}</code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? t("Copied") : t("Copy the code")}
            title={copied ? t("Copied") : t("Copy the code")}
            className="rounded-lg"
            onClick={() => {
              void navigator.clipboard?.writeText(step.userCode).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }).catch(() => {})
            }}
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3 text-xs" disabled={acting} onClick={() => void act(() => agentHost.openLogin(login.id))}>
            <ExternalLink className="size-3.5" /> {t("Open {host}", { host: hostOf(step.verificationUri) })}
          </Button>
        </div>
        <Waiting text={expiresIn !== null ? t("Waiting for you to approve it… The code expires in {minutes} min.", { minutes: expiresIn }) : t("Waiting for you to approve it…")} />
        {answerField}
      </div> : step?.type === 'auth_url' ? <div className="space-y-2.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("Your browser opened {host}. Sign in there and come back; this finishes by itself.", { host: hostOf(step.url) })}
        </p>
        {step.instructions && <p className="text-[11px] leading-relaxed text-muted-foreground">{t(step.instructions)}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl px-3 text-xs" disabled={acting} onClick={() => void act(() => agentHost.openLogin(login.id))}>
            <ExternalLink className="size-3.5" /> {t("Open again")}
          </Button>
          <Waiting text={t("Waiting for the browser…")} />
        </div>
        {answerField}
      </div> : question ? answerField : <Waiting text={login.progress ? t(login.progress) : t("Starting the sign-in…")} />}
      {login.progress && (step || choice || question) && <p className="text-[10.5px] text-faint">{t(login.progress)}</p>}
    </div>}

    {login?.state === 'done' && <p role="status" className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/[0.08] px-3 py-2 text-xs font-medium text-success">
      <Check className="size-3.5 shrink-0" />{t("Signed in to {plan}. Its models are ready to use.", { plan: signIn.plan })}
    </p>}
    {login?.state === 'failed' && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/[0.07] px-3 py-2 text-xs break-words text-destructive">
      {t("Sign-in failed: {error}", { error: login.error ? t(login.error) : t("unknown error") })}
    </p>}
    {login?.state === 'cancelled' && <p role="status" className="text-[11px] text-muted-foreground">{t("Sign-in cancelled.")}</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/[0.07] px-3 py-2 text-xs break-words text-destructive">{t(error)}</p>}
  </div>
}

function Waiting({ text }: { text: string }) {
  return <span role="status" className="flex items-center gap-2 text-[11px] text-muted-foreground">
    <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" /> {text}
  </span>
}

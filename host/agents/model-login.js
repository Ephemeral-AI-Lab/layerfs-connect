// Subscription sign-in (ChatGPT for openai-codex, Claude, GitHub Copilot, …)
// for the agents' model providers (models.js AgentModels). Each sign-in runs
// pi's OAuth flow (ModelRuntime.login) through an interaction that keeps its
// steps (a URL to open, a device code) and its open question (a method to
// choose, a pasted redirect URL) for the Models dialog to poll and answer
// under /api/agent/logins/:id (routes.js). pi stores the credential in the
// agents' auth.json; Connect signs in with its own name and install ID
// (<agentDir>/device-id), never another app's. No key or token is ever in a
// view.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A sign-in still waiting after this long is cancelled. */
const LOGIN_MS = 15 * 60 * 1000
/** How long a finished sign-in stays readable. */
const KEEP_LOGIN_MS = 2 * 60 * 1000
/** The longest answer (a pasted code or redirect URL). */
const ANSWER_MAX = 8192
/** The URLs a sign-in may ask the host to open: the providers' own sign-in pages. */
const OPENABLE = /^https:\/\/([a-z0-9-]+\.)*(openai\.com|chatgpt\.com|anthropic\.com|claude\.ai|github\.com|x\.ai|moonshot\.cn|kimi\.com|meta\.com|openrouter\.ai)(\/|$)/i
/** Sign-in button labels pi leaves out. */
const SIGN_IN = { 'openai-codex': 'Sign in with ChatGPT', anthropic: 'Sign in with Claude', 'github-copilot': 'Sign in with GitHub' }

const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
const bad = (message) => fail(400, 'invalid-input', message)

/** A provider's sign-in, for the providers list: its button's label and the plan's name; null when it takes keys only. */
export function signInOf(provider) {
  const oauth = provider?.auth?.oauth
  return oauth ? { label: oauth.loginLabel ?? SIGN_IN[provider.id] ?? 'Sign in', plan: oauth.name ?? provider.id } : null
}

export class ModelLogins {
  /**
   * @param {object} models the AgentModels whose pi runtime signs in
   * @param {{ openUrl?: (url: string) => void, log?: (line: string) => void }} [options] how a sign-in page opens (default: the system browser)
   */
  constructor(models, { openUrl = openInBrowser, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
    this.models = models
    this.openUrl = openUrl
    this.log = log
    /** login id -> Login */
    this.logins = new Map()
  }

  /** Starts a provider's subscription sign-in: LoginView. A running one for the provider is cancelled first. */
  start(providerId) {
    const runtime = this.models.runtime
    const provider = typeof providerId === 'string' ? runtime.getProvider(providerId) : undefined
    if (!provider) throw fail(404, 'not-found', `no provider ${providerId}`)
    if (!provider.auth?.oauth) throw bad(`${providerId} has no sign-in; it takes an API key`)
    for (const l of this.logins.values()) if (l.provider === providerId && l.active) l.cancel()
    const login = new Login(providerId, provider.auth.oauth.name ?? providerId)
    this.logins.set(login.id, login)
    let flow
    try {
      flow = runtime.login(providerId, 'oauth', login.interaction(), { agentName: 'LayerFS Connect', getDeviceId: () => this.deviceId() })
    } catch (error) {
      flow = Promise.reject(error)
    }
    login.run(
      flow,
      // the credential is in auth.json: the providers' auth state is read again
      () => this.models.enqueueWrite(() => this.models.reload(providerId)).catch((error) => this.log(`[agents] after signing in to ${providerId}: ${error?.message ?? error}`)),
      () => setTimeout(() => this.logins.delete(login.id), KEEP_LOGIN_MS).unref(),
    )
    return login.view()
  }

  get(loginId) {
    const login = this.logins.get(loginId)
    if (!login) throw fail(404, 'not-found', `no sign-in ${loginId}`)
    return login
  }

  view(loginId) {
    return this.get(loginId).view()
  }

  /** Answers the sign-in's open question: a method's ID, or a pasted code or redirect URL. */
  respond(loginId, body = {}) {
    const login = this.get(loginId)
    const value = body?.value
    if (typeof value !== 'string') throw bad('the answer must be text')
    if (value.length > ANSWER_MAX) throw bad('the answer is too long')
    login.answer(value.trim())
    return login.view()
  }

  cancel(loginId) {
    const login = this.get(loginId)
    login.cancel()
    return login.view()
  }

  /** Opens the sign-in's page (its URL, or the device-code page) in the system browser. */
  open(loginId) {
    const login = this.get(loginId)
    const url = login.step?.url ?? login.step?.verificationUri
    if (!url) throw fail(409, 'Conflict', 'the sign-in has no page to open yet')
    if (!OPENABLE.test(url)) throw bad(`not a sign-in page Connect opens: ${url}`)
    this.openUrl(url)
    return login.view()
  }

  /** Cancels every running sign-in (the host is closing). */
  close() {
    for (const login of this.logins.values()) login.cancel()
  }

  /** This install's stable ID, made on first use. */
  deviceId() {
    const dir = this.models.agentDir
    const file = join(dir, 'device-id')
    if (existsSync(file)) return readFileSync(file, 'utf8').trim()
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const id = randomUUID()
    writeFileSync(file, `${id}\n`, { mode: 0o600 })
    return id
  }
}

/**
 * One sign-in: pi's flow driven through an interaction that keeps its steps.
 * `step` is what to show (a URL, a device code); `prompt` the question it
 * waits on (a method to choose, a code to paste), answered by `answer()`.
 */
class Login {
  constructor(provider, name) {
    this.id = randomUUID()
    this.provider = provider
    this.name = name
    this.state = 'starting'
    this.step = null
    this.prompt = null
    this.progress = null
    this.error = null
    this.started = Date.now()
    this.ended = null
    this.controller = new AbortController()
    this.pending = null
  }

  get active() {
    return this.state === 'starting' || this.state === 'waiting'
  }

  view() {
    const { id, provider, name, state, step, progress, error, started, ended } = this
    const prompt = this.prompt && { type: this.prompt.type, message: this.prompt.message, ...(this.prompt.placeholder ? { placeholder: this.prompt.placeholder } : {}), ...(this.prompt.options ? { options: this.prompt.options } : {}) }
    return { id, provider, name, state, step, prompt, progress, error, started, ended }
  }

  interaction() {
    return {
      signal: this.controller.signal,
      notify: (event) => {
        if (event.type === 'auth_url') this.step = { type: 'auth_url', url: event.url, ...(event.instructions ? { instructions: event.instructions } : {}) }
        else if (event.type === 'device_code')
          this.step = { type: 'device_code', userCode: event.userCode, verificationUri: event.verificationUri, ...(event.expiresInSeconds ? { expires: Date.now() + event.expiresInSeconds * 1000 } : {}) }
        else if (event.type === 'progress' || event.type === 'info') this.progress = event.message
        if (this.active) this.state = 'waiting'
      },
      prompt: (p) =>
        new Promise((resolve, reject) => {
          const options = p.type === 'select' ? p.options.map((o) => ({ id: o.id, label: o.label, ...(o.description ? { description: o.description } : {}) })) : undefined
          const entry = { type: p.type, message: p.message, placeholder: p.placeholder, options, resolve, reject }
          this.pending = entry
          this.prompt = entry
          this.state = 'waiting'
          // the flow withdraws its question (the browser callback came first): it goes from the view
          const withdraw = () => {
            if (this.pending !== entry) return
            this.pending = null
            this.prompt = null
            reject(new Error('withdrawn'))
          }
          p.signal?.addEventListener('abort', withdraw, { once: true })
          this.controller.signal.addEventListener('abort', withdraw, { once: true })
        }),
    }
  }

  answer(value) {
    if (!this.active || !this.pending) throw fail(409, 'Conflict', 'the sign-in is not asking anything now')
    const entry = this.pending
    if (entry.options && !entry.options.some((o) => o.id === value)) throw bad(`choose one of ${entry.options.map((o) => o.id).join(', ')}`)
    if (!value) throw bad('the answer is empty')
    this.pending = null
    this.prompt = null
    entry.resolve(value)
  }

  cancel() {
    if (!this.active) return
    this.finish('cancelled', null)
    this.controller.abort()
  }

  /** Follows pi's login promise to its end; `stored` runs once a credential is saved. */
  run(promise, stored, ended) {
    const timer = setTimeout(() => {
      if (!this.active) return
      this.finish('failed', `the sign-in did not finish within ${LOGIN_MS / 60000} minutes`)
      this.controller.abort()
    }, LOGIN_MS)
    timer.unref()
    promise
      .then(
        () => {
          if (this.active) this.finish('done', null)
          stored()
        },
        (error) => {
          if (this.active) this.finish('failed', error?.message ?? String(error))
        },
      )
      .finally(() => {
        clearTimeout(timer)
        ended()
      })
  }

  finish(state, error) {
    const waiting = this.pending
    this.state = state
    this.error = error
    this.prompt = null
    this.pending = null
    this.ended = Date.now()
    // a question still open ends with the sign-in, so pi's flow ends too
    waiting?.reject(new Error(`the sign-in ${state === 'done' ? 'finished' : 'was ' + state}`))
  }
}

/** Opens a URL in the system browser. */
function openInBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

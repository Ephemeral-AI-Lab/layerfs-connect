// The model providers live agents may use, on pi's ModelRuntime
// (@earendil-works/pi-coding-agent). Connect keeps pi's files under its own
// state, never ~/.pi:
//   <state>/pi/auth.json     credentials (pi writes it owner-only); keys are
//                            write-only here: no route ever answers one
//   <state>/pi/models.json   custom providers, and base URL overrides of built-in ones
//   <state>/pi/connect.json  Connect's default model and thinking level
//   <state>/pi/device-id     this install's ID, for sign-ins that ask for one
// A subscription sign-in (ChatGPT for openai-codex, …) runs as a login: pi's
// OAuth flow, its steps (a URL to open, a device code, a question such as
// which method or a pasted redirect URL) kept for the dialog to poll and
// answer. Connect signs in with its own token, never another app's.
// A provider is listed once it has something: a stored key or sign-in, a key
// in the host's environment (OPENAI_API_KEY, …), or a models.json entry.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { httpError } from './server.js'

/** The API protocols a custom provider may speak (pi's `api` names). */
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']
const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const ID = /^[a-z][a-z0-9-]{0,63}$/
/** An environment where every variable is set: pi's env lookup then names every variable it reads. */
const EVERY = new Proxy({}, { get: () => 'x', has: () => true })
const HIDDEN = new Set(['faux'])
/** Names clearer than pi's for Connect's dialog. */
const NAMES = { 'openai-codex': 'OpenAI Codex (ChatGPT plan)' }
/** Sign-in button labels pi leaves out. */
const SIGN_IN = { 'openai-codex': 'Sign in with ChatGPT', anthropic: 'Sign in with Claude', 'github-copilot': 'Sign in with GitHub' }
/** A sign-in still waiting after this long is cancelled. */
const LOGIN_MS = 15 * 60 * 1000
/** How long a finished sign-in stays readable. */
const KEEP_LOGIN_MS = 2 * 60 * 1000
/** The URLs a sign-in may ask the host to open: the providers' own sign-in pages. */
const OPENABLE = /^https:\/\/([a-z0-9-]+\.)*(openai\.com|chatgpt\.com|anthropic\.com|claude\.ai|github\.com|x\.ai|moonshot\.cn|kimi\.com|meta\.com|openrouter\.ai)(\/|$)/i

const bad = (message) => httpError(400, 'invalid-input', message)
const text = (v, what, max = 2048) => {
  if (typeof v !== 'string') throw bad(`${what} must be text`)
  if (v.length > max) throw bad(`${what} is too long`)
  return v.trim()
}
const url = (v, what) => {
  const s = text(v, what)
  if (!/^https?:\/\/[^\s]+$/.test(s)) throw bad(`${what} must be an http or https URL`)
  return s
}
/** A key as typed: one line, printable, no spaces inside. */
const apiKey = (v) => {
  const s = text(v, 'the API key', 8192)
  if (s && !/^[\x21-\x7e]+$/.test(s)) throw bad('the API key has characters a key cannot have')
  return s
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw httpError(500, 'bad-config', `${file} is not JSON: ${error.message}`)
  }
}

function writeJson(file, value) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
  chmodSync(file, 0o600)
}

export class Models {
  /** @param {{ state: string }} spec Connect's deployment (config.js) */
  /**
   * @param {{ state: string }} spec
   * @param {NodeJS.ProcessEnv} [env]
   * @param {{ openUrl?: (url: string) => void }} [o] how a sign-in page opens (default: the system browser)
   */
  constructor(spec, env = process.env, { openUrl = openInBrowser } = {}) {
    this.openUrl = openUrl
    /** login id -> Login */
    this.logins = new Map()
    this.dir = join(spec.state, 'pi')
    this.authPath = join(this.dir, 'auth.json')
    this.modelsPath = join(this.dir, 'models.json')
    this.prefsPath = join(this.dir, 'connect.json')
    this.env = env
    this.rt = null
    /** Environment keys of hidden providers, kept to put back when one is added again. */
    this.held = {}
  }

  /**
   * Hides the environment's keys of the providers removed in Models
   * (connect.json `hidden`): they leave this process's environment, which pi
   * reads, until the provider is added again. The shell's environment is not
   * touched.
   */
  async hideEnv() {
    const hidden = this.prefs().hidden ?? []
    if (!hidden.length) return
    const { findEnvKeys } = await import('@earendil-works/pi-ai/compat')
    for (const id of hidden)
      for (const name of findEnvKeys(id, EVERY) ?? [])
        if (this.env[name] !== undefined) {
          this.held[name] = this.env[name]
          delete this.env[name]
        }
  }

  /** pi's ModelRuntime, made once and again after models.json changes. */
  async runtime() {
    if (!this.rt) {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
      this.rt = this.hideEnv().then(() => ModelRuntime.create({ authPath: this.authPath, modelsPath: this.modelsPath }))
      this.rt.catch(() => (this.rt = null))
    }
    return this.rt
  }

  reload() {
    this.rt = null
  }

  config() {
    const value = readJson(this.modelsPath, {})
    return { ...value, providers: { ...(value.providers ?? {}) } }
  }

  prefs() {
    return readJson(this.prefsPath, {})
  }

  /** Every provider, what it has, its models, and the default. No key is ever in it. */
  async view() {
    const rt = await this.runtime()
    const { findEnvKeys } = await import('@earendil-works/pi-ai/compat')
    const levels = await thinkingLevels()
    const config = this.config().providers
    const stored = new Map((await rt.listCredentials()).map((c) => [c.providerId, c.type]))
    const providers = rt
      .getProviders()
      .filter((p) => !HIDDEN.has(p.id))
      .map((p) => {
        const entry = config[p.id] ?? null
        const custom = !!entry?.api || !!entry?.models?.length
        const status = rt.getProviderAuthStatus(p.id)
        const envVars = findEnvKeys(p.id, EVERY) ?? []
        const envFound = findEnvKeys(p.id, this.env) ?? []
        const credential = stored.get(p.id) ?? null
        return {
          id: p.id,
          name: entry?.name ?? NAMES[p.id] ?? p.name ?? p.id,
          custom,
          baseUrl: entry?.baseUrl ?? null,
          defaultBaseUrl: custom ? null : (p.baseUrl ?? null),
          api: entry?.api ?? null,
          keyAuth: !!p.auth?.apiKey,
          signIn: p.auth?.oauth ? { label: p.auth.oauth.loginLabel ?? SIGN_IN[p.id] ?? 'Sign in', plan: p.auth.oauth.name ?? p.id } : null,
          credential,
          envVars,
          envFound,
          configured: status.configured,
          source: status.source ?? null,
          listed: !!credential || envFound.length > 0 || !!entry,
          models: rt.getModels(p.id).map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            reasoning: !!m.reasoning,
            contextWindow: m.contextWindow ?? null,
            maxTokens: m.maxTokens ?? null,
            input: m.input ?? ['text'],
            thinking: levels(m),
          })),
        }
      })
    const prefs = this.prefs()
    const usable = new Set(providers.filter((p) => p.configured).map((p) => p.id))
    const def = prefs.provider && prefs.model ? { provider: prefs.provider, model: prefs.model, thinking: prefs.thinking ?? 'medium', usable: usable.has(prefs.provider) } : null
    return { providers, default: def, protocols: PROTOCOLS }
  }

  /** Saves a built-in provider: its key (blank keeps the stored one) and its base URL (blank: the provider's own). */
  async saveProvider(id, body = {}) {
    const rt = await this.runtime()
    const p = rt.getProvider(id)
    if (!p || HIDDEN.has(id)) throw httpError(404, 'not-found', `no provider ${id}`)
    const config = this.config()
    if (config.providers[id]?.api) throw bad(`${id} is a custom provider; save it as one`)
    await this.unhide(id)
    if (body.baseUrl !== undefined) {
      const base = body.baseUrl === null ? '' : text(body.baseUrl, 'the base URL')
      const entry = { ...(config.providers[id] ?? {}) }
      if (base) entry.baseUrl = url(base, 'the base URL')
      else delete entry.baseUrl
      if (Object.keys(entry).length) config.providers[id] = entry
      else delete config.providers[id]
      writeJson(this.modelsPath, config)
      this.reload()
    }
    const key = body.key === undefined ? '' : apiKey(body.key)
    if (key) await this.storeKey(id, key)
    // a provider saved with nothing stored stays listed (it waits for its key)
    if (!key && body.baseUrl === undefined && !config.providers[id]) {
      config.providers[id] = {}
      writeJson(this.modelsPath, config)
      this.reload()
    }
    return this.view()
  }

  /** Adds or replaces a custom provider: an OpenAI-, Anthropic- or Google-compatible endpoint. */
  async saveCustom(body = {}) {
    const rt = await this.runtime()
    const id = text(body.id, 'the provider ID', 64)
    if (!ID.test(id)) throw bad('the provider ID starts with a lowercase letter, then lowercase letters, digits and dashes')
    const config = this.config()
    const existing = config.providers[id]
    if (rt.getProvider(id) && !existing?.api) throw httpError(409, 'Exists', `a provider already uses the ID ${id}`)
    if (!PROTOCOLS.includes(body.api)) throw bad(`the protocol is one of ${PROTOCOLS.join(', ')}`)
    const models = Array.isArray(body.models) ? body.models.map((m) => text(m, 'a model ID', 256)).filter(Boolean) : []
    if (!models.length) throw bad('a custom provider needs at least one model')
    if (new Set(models).size !== models.length) throw bad('each model ID may appear once')
    const name = body.name ? text(body.name, 'the display name', 128) : ''
    config.providers[id] = { ...(name ? { name } : {}), baseUrl: url(body.baseUrl, 'the base URL'), api: body.api, models: models.map((m) => ({ id: m })) }
    writeJson(this.modelsPath, config)
    this.reload()
    const key = body.key === undefined ? '' : apiKey(body.key)
    if (key) await this.storeKey(id, key)
    return this.view()
  }

  /** A hidden provider added again: its environment keys come back. */
  async unhide(id) {
    const prefs = this.prefs()
    if (!prefs.hidden?.includes(id)) return
    const { findEnvKeys } = await import('@earendil-works/pi-ai/compat')
    for (const name of findEnvKeys(id, EVERY) ?? [])
      if (name in this.held) {
        this.env[name] = this.held[name]
        delete this.held[name]
      }
    const hidden = prefs.hidden.filter((h) => h !== id)
    const { hidden: _, ...rest } = prefs
    writeJson(this.prefsPath, { ...rest, ...(hidden.length ? { hidden } : {}) })
    this.reload()
  }

  /** Removes what Connect keeps for a provider: its stored key or sign-in, and its models.json entry. */
  async removeProvider(id) {
    const rt = await this.runtime()
    const config = this.config()
    if (!rt.getProvider(id) && !config.providers[id]) throw httpError(404, 'not-found', `no provider ${id}`)
    if ((await rt.listCredentials()).some((c) => c.providerId === id)) await rt.logout(id)
    if (config.providers[id]) {
      delete config.providers[id]
      writeJson(this.modelsPath, config)
    }
    const prefs = this.prefs()
    // a key from the environment: Connect stops using it until the provider is added again
    const { findEnvKeys } = await import('@earendil-works/pi-ai/compat')
    const fromEnv = (findEnvKeys(id, this.env) ?? []).length > 0
    const hidden = new Set(prefs.hidden ?? [])
    if (fromEnv) hidden.add(id)
    const { provider, model, thinking } = prefs.provider === id ? {} : prefs
    writeJson(this.prefsPath, { ...(provider ? { provider, model, thinking } : {}), ...(hidden.size ? { hidden: [...hidden] } : {}) })
    this.reload()
    return this.view()
  }

  /** The model new live sessions use, and its thinking level. */
  async setDefault(body = {}) {
    const rt = await this.runtime()
    const provider = text(body.provider, 'the provider', 64)
    const model = text(body.model, 'the model', 256)
    const found = rt.getModel(provider, model)
    if (!found) throw bad(`no model ${provider}/${model}`)
    const thinking = body.thinking === undefined ? 'medium' : text(body.thinking, 'the thinking level', 16)
    if (!THINKING.includes(thinking)) throw bad(`the thinking level is one of ${THINKING.join(', ')}`)
    const { hidden } = this.prefs()
    writeJson(this.prefsPath, { provider, model, thinking, ...(hidden?.length ? { hidden } : {}) })
    return this.view()
  }

  /**
   * What a live session runs on: { model, modelRuntime, thinkingLevel } for
   * the model `choice` names, else the default. Refused when neither names
   * one, or its provider has no key or sign-in.
   */
  async agentModel(choice = {}) {
    const rt = await this.runtime()
    const prefs = this.prefs()
    const provider = choice.provider ?? prefs.provider
    const id = choice.model ?? prefs.model
    if (!provider || !id) throw Object.assign(new Error('no model chosen: pick a default model in Models'), { code: 'NoModel', status: 409 })
    const model = rt.getModel(provider, id)
    if (!model) throw bad(`no model ${provider}/${id}`)
    if (!rt.getProviderAuthStatus(provider).configured) throw Object.assign(new Error(`${provider} has no key or sign-in: add one in Models`), { code: 'NoModel', status: 409 })
    const thinking = choice.thinking ?? (provider === prefs.provider && id === prefs.model ? prefs.thinking : null) ?? 'medium'
    if (!THINKING.includes(thinking)) throw bad(`the thinking level is one of ${THINKING.join(', ')}`)
    return { model, modelRuntime: rt, thinkingLevel: thinking }
  }

  // ---------- sign-in ----------

  /** Starts a provider's subscription sign-in; a running one for the provider is cancelled first. */
  async startLogin(id) {
    const rt = await this.runtime()
    const p = rt.getProvider(id)
    if (!p || HIDDEN.has(id)) throw httpError(404, 'not-found', `no provider ${id}`)
    if (!p.auth?.oauth) throw bad(`${id} has no sign-in; it takes an API key`)
    for (const l of this.logins.values()) if (l.provider === id && l.active) l.cancel()
    const login = new Login(id, p.auth.oauth.name ?? id)
    this.logins.set(login.id, login)
    login.run(
      rt.login(id, 'oauth', login.interaction(), { agentName: 'LayerFS Connect', getDeviceId: () => this.deviceId() }),
      () => this.reload(),
      () => setTimeout(() => this.logins.delete(login.id), KEEP_LOGIN_MS).unref(),
    )
    return login.view()
  }

  login(loginId) {
    const login = this.logins.get(loginId)
    if (!login) throw httpError(404, 'not-found', `no sign-in ${loginId}`)
    return login
  }

  loginView(loginId) {
    return this.login(loginId).view()
  }

  /** Answers the sign-in's open question: a method's ID, or a pasted code or redirect URL. */
  respondLogin(loginId, body = {}) {
    const login = this.login(loginId)
    login.answer(text(body.value, 'the answer', 8192))
    return login.view()
  }

  cancelLogin(loginId) {
    const login = this.login(loginId)
    login.cancel()
    return login.view()
  }

  /** Opens the sign-in's page (its URL, or the device-code page) in the system browser. */
  openLogin(loginId) {
    const login = this.login(loginId)
    const url = login.step?.url ?? login.step?.verificationUri
    if (!url) throw httpError(409, 'Conflict', 'the sign-in has no page to open yet')
    if (!OPENABLE.test(url)) throw bad(`not a sign-in page Connect opens: ${url}`)
    this.openUrl(url)
    return login.view()
  }

  /** This install's stable ID, made on first use. */
  deviceId() {
    const file = join(this.dir, 'device-id')
    if (existsSync(file)) return readFileSync(file, 'utf8').trim()
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const id = randomUUID()
    writeFileSync(file, `${id}\n`, { mode: 0o600 })
    return id
  }

  async storeKey(id, key) {
    const rt = await this.runtime()
    await rt.login(id, 'api_key', {
      prompt: async (p) => {
        if (p.type !== 'secret' && p.type !== 'text') throw bad(`${id} asks for more than a key`)
        return key
      },
      notify: () => {},
    })
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
    if (!this.active || !this.pending) throw httpError(409, 'Conflict', 'the sign-in is not asking anything now')
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
    promise.then(
      () => {
        if (this.active) this.finish('done', null)
        stored()
      },
      (error) => {
        if (this.active) this.finish('failed', error?.message ?? String(error))
      },
    ).finally(() => {
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

/** The thinking levels a model supports (pi-ai), or none when pi cannot say. */
async function thinkingLevels() {
  try {
    const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai')
    return (m) => (m.reasoning ? getSupportedThinkingLevels(m) : ['off'])
  } catch {
    return (m) => (m.reasoning ? THINKING.slice(0, 6) : ['off'])
  }
}

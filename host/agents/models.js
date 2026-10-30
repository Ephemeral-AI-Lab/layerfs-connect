// Provider/model selection follows ConeCode's provider-scoped model settings;
// Pi owns credentials, model metadata and the actual provider protocol.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { discoverModels } from './model-discovery.js'
import { ModelLogins, signInOf } from './model-login.js'
import { nativeHeaders, requestHeaders, savedHeaders } from './headers.js'

const read = (file, initial) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : initial
const writeContents = (file, contents) => {
  writeFileSync(`${file}.tmp`, contents, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}
const write = (file, value) => writeContents(file, `${JSON.stringify(value, null, 2)}\n`)
const defined = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
const modelMetadata = (model = {}) => defined(Object.fromEntries([
  'name', 'reasoning', 'thinkingLevelMap', 'input', 'inputLimits', 'cost', 'promptCache',
  'contextWindow', 'maxTokens', 'samplingParams', 'samplingParamsByThinkingLevel', 'compat',
].map((field) => [field, model[field]])))
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
/** A provider's model list as the settings page edits it: id, name, limits, input types, reasoning. */
const listedModel = (model = {}) => defined({
  id: model.id,
  name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : undefined,
  contextWindow: positive(model.contextWindow),
  maxTokens: positive(model.maxTokens),
  reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
  input: Array.isArray(model.input) ? model.input.filter((type) => type === 'text' || type === 'image') : undefined,
})

/** Checks a model list sent by the settings page; every id must be present and unique. */
function modelList(models) {
  if (models === undefined) return undefined
  if (!Array.isArray(models)) throw new Error('Invalid model list.')
  const seen = new Set()
  return models.map((model) => {
    const id = typeof model?.id === 'string' ? model.id.trim() : ''
    if (!id) throw new Error('Model ID is required.')
    if (seen.has(id)) throw new Error('Model ID must be unique.')
    seen.add(id)
    return listedModel({ ...model, id })
  })
}

export class AgentModels {
  static async create(agentDir) {
    mkdirSync(agentDir, { recursive: true, mode: 0o700 })
    const models = new AgentModels(agentDir)
    models.runtime = await ModelRuntime.create({ authPath: models.authPath, modelsPath: models.modelsPath, allowModelNetwork: false })
    const error = models.runtime.getError()
    if (error) throw new Error(error)
    return models
  }

  constructor(agentDir) {
    this.agentDir = agentDir
    this.authPath = join(agentDir, 'auth.json')
    this.modelsPath = join(agentDir, 'models.json')
    this.selectionPath = join(agentDir, 'connect-models.json')
    this.config = read(this.modelsPath, { providers: {} })
    this.selected = read(this.selectionPath, null)
    this.syncVersions = new Map()
    this.pendingWrites = Promise.resolve()
    /** Subscription sign-ins (model-login.js), served under /api/agent/logins. */
    this.logins = new ModelLogins(this)
  }

  snapshot() {
    return {
      providers: this.runtime.getProviders().map((provider) => {
        const config = this.config.providers[provider.id]
        return {
          id: provider.id,
          name: provider.name,
          baseUrl: config?.baseUrl ?? provider.baseUrl,
          api: config?.api ?? this.runtime.getModels(provider.id)[0]?.api,
          headers: savedHeaders(config?.headers),
          hasKey: this.runtime.hasConfiguredAuth(provider.id),
          custom: Boolean(config),
          // Pi ships it (a catalog provider), rather than models.json declaring it
          builtIn: this.runtime.builtins?.has?.(provider.id) ?? !config,
          // the models models.json lists for it: all of a declared provider's, extras for a built-in one
          savedModels: (config?.models ?? []).map((model) => listedModel(model)),
          // a subscription sign-in it offers, and whether its credential is one
          signIn: signInOf(provider),
          signedIn: this.runtime.isUsingOAuth?.(provider.id) ?? false,
        }
      }).sort((a, b) => Number(b.hasKey) - Number(a.hasKey) || a.name.localeCompare(b.name)),
      models: this.runtime.getModels().map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        thinkingLevels: getSupportedThinkingLevels(model),
      })),
      selected: this.selected,
    }
  }

  async reload(provider) {
    await this.runtime.refresh({ allowNetwork: false, ...(provider ? { providers: [provider] } : {}) })
    const error = this.runtime.getError()
    if (error) throw new Error(error)
  }

  enqueueWrite(operation) {
    const pending = this.pendingWrites.then(operation)
    this.pendingWrites = pending.catch(() => {})
    return pending
  }

  saveProvider(input) {
    return this.enqueueWrite(() => this.persistProvider(input))
  }

  configureProvider(input = {}) {
    if (!input || typeof input.provider !== 'string' || !input.provider.trim()) throw new Error('Provider ID is required.')
    if (['name', 'baseUrl', 'api', 'apiKey'].some((field) => input[field] !== undefined && typeof input[field] !== 'string')) {
      throw new Error('Invalid provider settings.')
    }
    const id = input.provider.trim()
    const baseUrl = input.baseUrl?.trim()
    if (!baseUrl && !this.runtime.getProvider(id)) throw new Error('Enter an API URL for this provider.')
    if (baseUrl) {
      let url
      try { url = new URL(baseUrl) } catch { throw new Error('Enter a valid API URL.') }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Use an HTTP or HTTPS API URL without credentials, query parameters, or fragments.')
      }
    }
    const models = modelList(input.models)
    if (models && !models.length && !this.runtime.builtins?.has?.(id)) throw new Error('A custom provider needs at least one model.')
    return this.saveProvider({
      id,
      models,
      name: input.name?.trim() || undefined,
      baseUrl: baseUrl || undefined,
      api: input.api?.trim() || this.config.providers[id]?.api || (this.runtime.getProvider(id) ? undefined : 'openai-completions'),
      apiKey: input.apiKey?.trim() || undefined,
      headers: input.headers,
    })
  }

  async persistProvider({ id, name, baseUrl, api, apiKey, models, modelOverrides, headers }) {
    if (!id?.trim()) throw new Error('Provider ID is required.')
    const config = {
      ...this.config.providers[id],
      ...defined({ name, baseUrl, api, models, modelOverrides, headers: nativeHeaders(headers) }),
    }
    // an emptied model list goes away rather than staying as []
    if (Array.isArray(config.models) && !config.models.length) delete config.models
    const previous = this.config
    const next = { ...this.config, providers: { ...this.config.providers } }
    // Built-in providers can save credentials without an empty Pi override.
    if (Object.keys(config).length) next.providers[id] = config
    else delete next.providers[id]
    const files = [this.modelsPath, ...(apiKey?.trim() ? [this.authPath] : [])]
      .map((path) => ({ path, contents: existsSync(path) ? readFileSync(path) : undefined }))
    try {
      write(this.modelsPath, next)
      if (apiKey?.trim()) write(this.authPath, { ...read(this.authPath, {}), [id]: { type: 'api_key', key: apiKey.trim() } })
      this.config = next
      await this.reload(id)
    } catch (error) {
      // Pi checks the whole provider on reload: a rejected save leaves the files as they were
      this.config = previous
      for (const { path, contents } of files) {
        if (contents === undefined) rmSync(path, { force: true })
        else writeContents(path, contents)
      }
      await this.reload(id).catch(() => {})
      throw error
    }
    // a model the list dropped is no longer the one new chats use
    if (this.selected?.provider === id && !this.runtime.getModel(id, this.selected.modelId)) {
      this.selected = null
      write(this.selectionPath, null)
    }
    return this.snapshot()
  }

  /** Opens models.json, where providers and their models are kept, in the system's text editor. */
  openConfig() {
    if (!existsSync(this.modelsPath)) write(this.modelsPath, this.config)
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-t', this.modelsPath]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', this.modelsPath]] : ['xdg-open', [this.modelsPath]]
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
    return { path: this.modelsPath }
  }

  configure({ provider, modelId, apiKey, baseUrl, api, thinkingLevel, contextWindow, maxTokens, reasoning, headers }) {
    return this.enqueueWrite(async () => {
      if (!provider?.trim() || !modelId?.trim()) throw new Error('Choose a provider and model.')
      headers = requestHeaders(headers)
      const known = this.runtime.getModel(provider, modelId)
      const config = { ...this.config.providers[provider] }
      const overrides = defined({ contextWindow, maxTokens, reasoning })
      if (known) {
        if (Object.keys(overrides).length) {
          config.modelOverrides = { ...config.modelOverrides, [modelId]: { ...config.modelOverrides?.[modelId], ...overrides } }
        }
      } else {
        config.models = [...(config.models ?? []), { id: modelId, ...overrides }]
      }
      await this.persistProvider({ id: provider, apiKey, baseUrl: baseUrl || undefined, api: api || undefined, headers, models: config.models, modelOverrides: config.modelOverrides })
      return this.select({ provider, modelId, thinkingLevel: thinkingLevel ?? this.selected?.thinkingLevel ?? 'off' })
    })
  }

  select({ provider, modelId, thinkingLevel = 'off' }) {
    const model = this.resolve({ provider, modelId })
    this.selected = { provider, modelId, thinkingLevel: clampThinkingLevel(model, thinkingLevel) }
    write(this.selectionPath, this.selected)
    return this.snapshot()
  }

  resolve(selection = this.selected) {
    if (!selection) throw new Error('Configure a model in Models before starting a chat.')
    const model = this.runtime.getModel(selection.provider, selection.modelId ?? selection.model)
    if (!model) throw new Error(`Unknown model: ${selection.provider}/${selection.modelId ?? selection.model}`)
    return model
  }

  removeProvider(id) {
    // A model list already being fetched must not recreate a removed provider.
    this.syncVersions.set(id, (this.syncVersions.get(id) ?? 0) + 1)
    return this.enqueueWrite(async () => {
      delete this.config.providers[id]
      write(this.modelsPath, this.config)
      const auth = read(this.authPath, {})
      delete auth[id]
      write(this.authPath, auth)
      if (this.selected?.provider === id) {
        this.selected = null
        write(this.selectionPath, null)
      }
      await this.reload()
      return this.snapshot()
    })
  }

  async test(config) {
    if (config?.provider && config?.modelId) await this.configure(config)
    const model = this.resolve()
    const result = await this.runtime.completeSimple(model, {
      messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }],
    }, { maxTokens: 64, thinkingLevel: 'off', maxRetries: 0, signal: AbortSignal.timeout(30_000) })
    if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error(result.errorMessage ?? 'The model test did not finish.')
    return { text: result.content.filter((part) => part.type === 'text').map((part) => part.text).join('') }
  }

  discover(config) {
    return discoverModels(this.runtime, this.config, config)
  }

  async sync(input) {
    const provider = input?.provider
    const version = (this.syncVersions.get(provider) ?? 0) + 1
    this.syncVersions.set(provider, version)
    const result = await this.discover(input)
    // Discovery may overlap; serialize writes so providers cannot overwrite one
    // another, and a slower request cannot restore superseded connection values.
    return this.enqueueWrite(() => {
      if (this.syncVersions.get(provider) !== version) throw new Error('This model sync was replaced by a newer request.')
      return this.saveDiscovered(input, result)
    })
  }

  async saveDiscovered(input, result) {
    // Native/OAuth catalogs are already registered by Pi. Replacing them with
    // custom model definitions would discard their protocol and auth behavior.
    if (result.source === 'catalog') {
      if (!this.runtime.hasConfiguredAuth(input.provider) && !this.config.providers[input.provider]) {
        throw new Error('Configure or sign in to this provider before syncing its built-in models.')
      }
      if (input.headers !== undefined) await this.persistProvider({ id: input.provider, headers: input.headers })
      return result
    }
    if (!result.models.length) return result

    const { provider } = input
    const saved = this.config.providers[provider]
    const known = this.runtime.getProvider(provider)
    const first = this.runtime.getModels(provider)[0]
    const models = new Map((saved?.models ?? []).map((model) => [model.id, model]))
    for (const model of result.models) {
      // Preserve manually configured definitions and modelOverrides, including
      // IDs the endpoint no longer lists. Keep Pi's richer built-in metadata.
      models.set(model.id, {
        ...modelMetadata(this.runtime.getModel(provider, model.id)),
        ...model,
        ...models.get(model.id),
      })
    }
    const config = {
      ...this.config,
      providers: {
        ...this.config.providers,
        [provider]: {
          ...saved,
          api: input.api?.trim() || saved?.api || first?.api,
          baseUrl: input.baseUrl?.trim() || saved?.baseUrl || known?.baseUrl || first?.baseUrl,
          ...defined({ headers: nativeHeaders(input.headers) }),
          models: [...models.values()],
        },
      },
    }
    const apiKey = input.apiKey?.trim()
    const files = [this.modelsPath, ...(apiKey ? [this.authPath] : [])]
      .map((path) => ({ path, contents: existsSync(path) ? readFileSync(path) : undefined }))
    try {
      write(this.modelsPath, config)
      if (apiKey) write(this.authPath, { ...read(this.authPath, {}), [provider]: { type: 'api_key', key: apiKey } })
      await this.reload(provider)
      this.config = config
    } catch (error) {
      // Pi validates the complete provider on reload. A rejected sync must not
      // strand the next process with broken configuration or replaced credentials.
      for (const { path, contents } of files) {
        if (contents === undefined) rmSync(path, { force: true })
        else writeContents(path, contents)
      }
      await this.reload(provider)
      throw error
    }
    return result
  }
}

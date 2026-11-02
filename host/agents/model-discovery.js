import { requestHeaders, savedHeaders } from './headers.js'

const supportedApis = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
const positiveInteger = (...values) => values.find((value) => Number.isSafeInteger(value) && value > 0)
const nonempty = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim()

/** Only the endpoint can declare image support; missing or empty metadata is unknown. */
function modelInput(model) {
  const modalities = [model.architecture?.input_modalities, model.input_modalities, model.input]
    .find((value) => Array.isArray(value) && value.length && value.every((type) => typeof type === 'string'))
  if (modalities) {
    const input = modalities.filter((type) => type === 'text' || type === 'image')
    if (input.length) return [...new Set(input)]
  }
  const images = [model.capabilities?.image_input?.supported, model.capabilities?.vision?.supported, model.capabilities?.vision]
    .find((value) => typeof value === 'boolean')
  if (images !== undefined) return images ? ['text', 'image'] : ['text']
}

function parseBaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Enter a valid API URL to fetch models.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS API URL without credentials, query parameters, or fragments.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function modelDetails(model, api) {
  const google = api === 'google-generative-ai'
  if (google && Array.isArray(model.supportedGenerationMethods) && !model.supportedGenerationMethods.includes('generateContent')) return
  const rawId = nonempty(google ? model.name : model.id)
  if (!rawId) return
  const id = google ? rawId.replace(/^models\//, '') : rawId
  if (!id) return
  const reasoning = model.capabilities?.thinking?.supported ?? model.reasoning ?? model.thinking
  const input = modelInput(model)
  return {
    id,
    name: nonempty(model.display_name, model.displayName, !google && model.name) ?? id,
    ...(typeof reasoning === 'boolean' ? { reasoning } : {}),
    ...(input ? { input } : {}),
    ...Object.fromEntries(Object.entries({
      contextWindow: positiveInteger(model.max_input_tokens, model.inputTokenLimit, model.context_window, model.context_length),
      maxTokens: positiveInteger(model.max_tokens, model.outputTokenLimit, model.max_output_tokens, model.top_provider?.max_completion_tokens),
    }).filter(([, value]) => value !== undefined)),
  }
}

/** Read-only discovery: temporary form values never enter Pi's persisted configuration. */
export async function discoverModels(runtime, config, input = {}) {
  const { provider, baseUrl, api, apiKey } = input
  if (typeof provider !== 'string' || !provider.trim()) throw new Error('Choose a provider to fetch models.')
  if ([baseUrl, api, apiKey].some((value) => value !== undefined && typeof value !== 'string')) throw new Error('Invalid model discovery settings.')
  const customHeaders = requestHeaders(input.headers)
  const known = runtime.getProvider(provider)
  const catalog = runtime.getModels(provider)
  const saved = config.providers[provider]
  const protocol = api?.trim() || saved?.api || catalog[0]?.api
  const key = apiKey?.trim()
  // Pi refreshes its own catalogs; it does not list arbitrary temporary API endpoints.
  // Subscription OAuth and native protocols without a listing API keep that catalog explicit.
  if (!supportedApis.has(protocol) || (!key && runtime.isUsingOAuth(provider))) {
    if (!known) throw new Error('This API does not support automatic model discovery.')
    return {
      source: 'catalog',
      models: catalog.map(({ id, name, reasoning, contextWindow, maxTokens }) => ({ id, name, reasoning, contextWindow, maxTokens })),
    }
  }

  const savedBase = saved?.baseUrl || known?.baseUrl || catalog[0]?.baseUrl
  const url = parseBaseUrl(baseUrl?.trim() || savedBase)
  const sameEndpoint = savedBase && url.href === parseBaseUrl(savedBase).href
  if (!key && !sameEndpoint && customHeaders === undefined && runtime.hasConfiguredAuth(provider)) {
    throw new Error('Enter an API key for the changed API URL. Saved credentials are only used with their saved URL.')
  }
  const signal = AbortSignal.timeout(15_000)
  let auth
  if (!key && sameEndpoint && known) {
    try { auth = (await runtime.getAuth(provider, { signal }))?.auth }
    catch { throw new Error('Could not read credentials for this provider. Enter an API key and try again.') }
  }
  let headers
  try { headers = new Headers(key ? {} : auth?.headers) }
  catch { throw new Error('The provider credentials contain invalid HTTP headers.') }
  // A temporary replacement, including {}, must not inherit old custom auth headers.
  for (const name of Object.keys(saved?.headers ?? {})) headers.delete(name)
  headers.set('accept', 'application/json')
  const resolvedKey = key || auth?.apiKey
  if (resolvedKey && /[\x00-\x1f\x7f-\uffff]/.test(resolvedKey)) throw new Error('The API key contains invalid characters.')
  if (protocol === 'anthropic-messages') {
    headers.set('anthropic-version', '2023-06-01')
    if (resolvedKey) headers.set('x-api-key', resolvedKey)
    if (!url.pathname.endsWith('/v1')) url.pathname = `${url.pathname.replace(/\/$/, '')}/v1`
  } else if (protocol === 'google-generative-ai') {
    if (resolvedKey) headers.set('x-goog-api-key', resolvedKey)
    if (url.pathname === '/') url.pathname = '/v1beta'
  } else if (resolvedKey) headers.set('authorization', `Bearer ${resolvedKey}`)
  for (const [name, value] of Object.entries(customHeaders ?? (sameEndpoint ? savedHeaders(saved?.headers) : undefined) ?? {})) {
    headers.set(name, value)
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/models`
  if (protocol === 'anthropic-messages') url.searchParams.set('limit', '1000')
  if (protocol === 'google-generative-ai') url.searchParams.set('pageSize', '1000')

  const models = new Map()
  const cursors = new Set()
  for (let page = 0; page < 100; page++) {
    let response
    try { response = await fetch(url, { headers, redirect: 'error', signal }) }
    catch { throw new Error(signal.aborted ? 'Fetching models timed out. Try again.' : 'Could not fetch models. Check the API URL and connection; redirects are not followed.') }
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403) throw new Error(`Model discovery was denied (HTTP ${response.status}). Check the API key and its permissions.`)
      throw new Error(`Could not fetch models (HTTP ${response.status}). Check that this endpoint supports listing models.`)
    }
    let data
    try { data = await response.json() }
    catch { throw new Error(signal.aborted ? 'Fetching models timed out. Try again.' : 'The provider returned an invalid model list.') }
    const rows = protocol === 'google-generative-ai' ? data?.models : data?.data
    if (!Array.isArray(rows)) throw new Error('The provider returned an invalid model list.')
    for (const row of rows) {
      const model = row && typeof row === 'object' && modelDetails(row, protocol)
      if (model) models.set(model.id, model)
    }
    const cursor = protocol === 'google-generative-ai' ? nonempty(data.nextPageToken) : data.has_more ? nonempty(data.last_id, rows.at(-1)?.id) : undefined
    if (!cursor) {
      if (data.has_more) throw new Error('The provider returned invalid model pagination.')
      return { source: 'remote', models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)) }
    }
    if (cursors.has(cursor)) throw new Error('The provider returned invalid model pagination.')
    cursors.add(cursor)
    url.searchParams.set(protocol === 'google-generative-ai' ? 'pageToken' : protocol === 'anthropic-messages' ? 'after_id' : 'after', cursor)
  }
  throw new Error('The provider returned too many model pages. Narrow the endpoint and try again.')
}

/** Agent HTTP routes share the host's authentication and event stream. */
export async function agentRoute(manager, method, parts, body, query = new URLSearchParams()) {
  const [group, id, action, requestId] = parts
  if (group === 'providers' && !id && method === 'POST') {
    await manager.models.configureProvider(body)
    return manager.modelsSnapshot()
  }
  // subscription sign-in (model-login.js): start one, then poll, answer, open its page or cancel it
  if (group === 'providers' && id && action === 'login' && !requestId && method === 'POST') return manager.models.logins.start(id)
  if (group === 'logins' && id && !requestId) {
    if (!action && method === 'GET') return manager.models.logins.view(id)
    if (action === 'respond' && method === 'POST') return manager.models.logins.respond(id, body)
    if (action === 'cancel' && method === 'POST') return manager.models.logins.cancel(id)
    if (action === 'open' && method === 'POST') return manager.models.logins.open(id)
    return undefined
  }
  if (group === 'providers' && id && !action && method === 'DELETE') {
    await manager.models.removeProvider(id)
    return manager.modelsSnapshot()
  }
  if (group === 'models') {
    if (!id && method === 'GET') return manager.modelsSnapshot()
    if (id === 'config' && action === 'open' && method === 'POST') return manager.models.openConfig()
    if (!id && method === 'POST') {
      await manager.models.configure(body)
      return manager.modelsSnapshot()
    }
    if (id === 'test' && method === 'POST') return manager.models.test(body)
    if (id === 'discover' && method === 'POST') return manager.models.discover(body)
    if (id === 'sync' && method === 'POST') {
      const result = await manager.models.sync(body)
      return { ...result, catalog: manager.modelsSnapshot() }
    }
  }
  // the scenarios a chat plays (/scenario <id>), and which do not play in one yet
  if (group === 'scenarios' && !id && method === 'GET') {
    return (manager.scenarios?.all() ?? []).map(({ id: scenario, title, blurb, notInChat }) => ({ id: scenario, title, blurb, notInChat }))
  }
  // the Extensions panel: a chat's tools, Pi extensions and Pi slash commands
  if (group === 'capabilities' && !id && method === 'GET') return manager.capabilities(query.get('session') || undefined)
  if (group === 'capabilities' && !id && method === 'POST') return manager.setCapability(body ?? {})
  // Settings → Runs: the run limits every chat uses
  if (group === 'run-limits' && !id && method === 'GET') return manager.runSettings()
  if (group === 'run-limits' && !id && method === 'POST') return manager.setRunSettings(body ?? {})
  // Settings → SDKs: sdks.json, what Connect found of each SDK, and its switch
  if (group === 'sdks' && !id && method === 'GET') return manager.sdkView()
  if (group === 'sdks' && !id && method === 'POST') return manager.setSdk(body ?? {})
  if (group === 'sdks' && id === 'config' && action === 'open' && method === 'POST') return manager.sdks.openConfig()
  if (group !== 'sessions') return undefined
  if (!id && method === 'GET') return manager.list()
  if (!id && method === 'POST') return body?.scenario ? manager.createScenario(body) : manager.create(body)
  if (!action && method === 'GET') return manager.detail(id)
  if (!action && method === 'DELETE') return manager.remove(id)
  if (action === 'trace' && method === 'GET') return manager.trace(id, { before: query.get('before'), limit: query.get('limit') ?? undefined })
  if (action === 'live' && method === 'GET') return manager.liveView(id)
  if (action === 'output' && requestId && method === 'GET') return manager.output(id, requestId, Number(query.get('offset') ?? 0))
  if (action === 'queue' && requestId) {
    if (method === 'DELETE') return manager.updateQueued(id, requestId)
    if (method === 'POST') return manager.updateQueued(id, requestId, body.mode ?? '')
  }
  if (action === 'children' && requestId && !parts[4] && method === 'GET') return manager.childConversation(id, requestId)
  if (method !== 'POST') return undefined
  if (action === 'message') return manager.message(id, body)
  if (action === 'continue') return manager.continue(id, body)
  if (action === 'limits') return manager.updateLimits(id, body)
  if (action === 'update') return manager.update(id, body)
  if (action === 'children' && requestId && parts[4] === 'stop') return manager.stopChild(id, requestId)
  if (action === 'rollback') return manager.rollback(id, body)
  if (action === 'edit') return manager.edit(id, body)
  if (action === 'fork') return manager.fork(id, body)
  if (action === 'stop') return manager.stop(id)
  if (action === 'compact') return manager.compact(id)
  if (action === 'permissions') return manager.permissions.setMode(id, body.mode)
  if (action === 'approvals' && requestId) return manager.permissions.decide(id, requestId, body.decision)
  return undefined
}

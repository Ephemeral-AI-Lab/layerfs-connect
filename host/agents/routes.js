/** Agent HTTP routes share the host's authentication and event stream. */
export async function agentRoute(manager, method, parts, body, query = new URLSearchParams()) {
  const [group, id, action, requestId] = parts
  if (group === 'providers' && !id && method === 'POST') {
    await manager.models.configureProvider(body)
    return manager.modelsSnapshot()
  }
  if (group === 'providers' && id && !action && method === 'DELETE') {
    await manager.models.removeProvider(id)
    return manager.modelsSnapshot()
  }
  if (group === 'models') {
    if (!id && method === 'GET') return manager.modelsSnapshot()
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
  if (group !== 'sessions') return undefined
  if (!id && method === 'GET') return manager.list()
  if (!id && method === 'POST') return manager.create(body)
  if (!action && method === 'GET') return manager.detail(id)
  if (!action && method === 'DELETE') return manager.remove(id)
  if (action === 'output' && requestId && method === 'GET') return manager.output(id, requestId, Number(query.get('offset') ?? 0))
  if (action === 'queue' && requestId) {
    if (method === 'DELETE') return manager.updateQueued(id, requestId)
    if (method === 'POST') return manager.updateQueued(id, requestId, body.mode ?? '')
  }
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

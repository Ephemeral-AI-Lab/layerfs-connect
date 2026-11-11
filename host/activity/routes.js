export async function activityRoute(recorder, method, parts, query) {
  if (method !== 'GET' || parts.length > 3) return undefined
  const actionId = parts[0]
  if (actionId && !/^[\w-]{1,80}$/.test(actionId)) return undefined
  if (parts[1] === 'invocations') {
    if (parts[2]) return /^[\w-]{1,80}$/.test(parts[2]) ? recorder.invocation(actionId, parts[2]) : undefined
    return recorder.invocationPage(actionId, { after: query.get('after'), project: query.get('project') || undefined, limit: Number(query.get('limit')) || 100 })
  }
  if (parts.length > 1) return undefined
  const result = await recorder[query.get('summary') === '1' ? 'summaries' : 'read']({ actionId, origin: query.get('origin') || 'all', status: query.get('status') || 'all', search: (query.get('search') || '').slice(0, 200), before: query.get('before') || Infinity, limit: Number(query.get('limit')) || 100 })
  if (actionId) return result.items[0] ?? (result.cleared ? { cleared: true, id: actionId } : null)
  return result
}

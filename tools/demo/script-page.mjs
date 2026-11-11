/** Page a generated command plan without sending every project payload to the UI. */
export function scriptPage(script, { offset = 0, limit = 100, kind, name } = {}) {
  offset = Number(offset); limit = Number(limit)
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw Object.assign(new Error('Script pages need a nonnegative offset and a limit from 1 to 1000.'), { status: 400, code: 'InvalidInput' })
  const scoped = kind && name
  const stores = !scoped ? [] : script.configuration.stores.filter(store => kind === 'machine' ? store.machine === name : kind === 'store' ? store.name === name : store.name === name.split('/')[0])
  const projects = new Set(stores.flatMap(store => store.projects.map(project => `${store.name}/${project}`)).filter(project => kind !== 'project' || project === name))
  const sandboxes = new Set(script.commands.filter(step => step.argv[0] === 'sandbox' && step.argv[1] === 'create' && projects.has(step.argv[2])).map(step => step.argv[3]))
  const commands = scoped ? script.commands.filter(step => {
    if (step.phase === 'reset') return false
    const [family, , target] = step.argv
    if (['project', 'branch', 'commit', 'file'].includes(family)) return projects.has(target)
    if (family === 'store') return kind !== 'project' && stores.some(store => store.name === target)
    if (family === 'sandbox') return sandboxes.has(step.argv[1] === 'create' ? step.argv[3] : target)
    if (family === 'workspace') return sandboxes.has(target.split(':')[0])
    if (family === 'machine') return kind === 'machine' && target === name
    return false
  }) : script.commands
  return { ...script, files: [], commands: commands.slice(offset, offset + limit), total: commands.length, offset, next: offset + limit < commands.length ? offset + limit : null }
}

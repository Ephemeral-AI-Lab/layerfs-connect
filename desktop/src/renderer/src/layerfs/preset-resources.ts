import type { DemoPreset, PresetJob } from './demo-presets-api'
import type { CliInvocation } from './activity-api'

export interface PresetResource { kind: 'machine' | 'store' | 'project'; name: string; machine: string; store?: string }

/** Match resource identifiers in CLI argument positions, never in file content/messages. */
export function resourceMatches(argv: string[], resource: PresetResource, groups: DemoPreset['projectGroups']) {
  const [family, operation, target] = argv
  const stores = groups.filter(group => resource.kind === 'machine' ? group.machine === resource.name : group.store === resource.store)
  const projects = stores.flatMap(group => group.projects.map(project => `${group.store}/${project}`)).filter(project => resource.kind !== 'project' || project === resource.name)
  if (family === 'machine') return resource.kind === 'machine' && target === resource.name
  if (family === 'store') return resource.kind !== 'project' && stores.some(group => group.store === target)
  if (['project', 'branch', 'commit', 'file'].includes(family)) return projects.includes(target)
  if (family === 'sandbox' && operation === 'create') return projects.includes(target)
  // The preset recipe creates one sandbox for the first project in each store.
  const sandboxes = stores.filter(group => resource.kind !== 'project' || `${group.store}/${group.projects[0]}` === resource.name).map(group => `demo-${group.projects[0]}`)
  if (family === 'sandbox') return sandboxes.includes(target)
  if (family === 'workspace') return sandboxes.some(name => target === name || target?.startsWith(`${name}:`))
  return false
}

export function resourceStatus(job: PresetJob | null, calls: CliInvocation[], resource: PresetResource, groups: DemoPreset['projectGroups']) {
  if (!job || !(job.rebuild || job.command === 'setup')) return 'Planned'
  if (job.state === 'completed' && job.presetVerified) return 'Ready'
  if (job.progress?.stage === 'resetting' || job.progress?.stage === 'checking' || job.state === 'queued') return 'Waiting'
  const related = calls.filter(call => resourceMatches(call.argv, resource, groups))
  const last = related.at(-1)
  if (last && !['success', 'queued', 'running'].includes(last.status)) return 'Failed'
  if (related.some(call => call.status === 'running' || call.status === 'queued')) return 'In progress'
  const ownFamily = resource.kind
  const created = related.filter(call => call.status === 'success' && call.argv[0] === ownFamily)
  if (created.some(call => ['create', 'init', 'push'].includes(call.argv[1]))) return 'Created'
  if (resource.kind === 'machine' && created.some(call => call.argv[1] === 'start')) return 'Started'
  return job.state === 'failed' || job.state === 'interrupted' ? 'Not verified' : 'Waiting'
}

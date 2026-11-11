import { projectDefinition } from './projects.mjs'
export const CONTENT_VERSION = 3
// Real-resource fixture descriptions. Nothing here fabricates LayerFS records.
const stores = [
  { name: 'demo-studio', machine: 'native', projects: ['website', 'design'] },
  { name: 'demo-services', machine: 'docker', projects: ['gateway', 'billing'] },
  { name: 'demo-build-cache', machine: 'demo-build', projects: ['compiler', 'sdk'] },
  { name: 'demo-experiments', machine: 'demo-research', projects: ['embeddings', 'evaluation'] },
]
const vms = [
  { name: 'demo-build', platform: 'lima', cpus: 2, memory: '4G', disk: '20G' },
  { name: 'demo-research', platform: 'lima', cpus: 2, memory: '4G', disk: '20G' },
]
export const presets = {
  studio: { description: 'Four machines, four stores and eight unequal project workloads with dense real commit, branch and publication histories. No sandboxes or workspaces.', machines: ['native', 'docker', ...vms], stores, sandboxes: false },
}
// Kept addressable for existing private homes and cleanup; not offered as presets.
const legacyPresets = {
  starter: { description: 'Native + Docker, three stores and six projects; no new VMs.', machines: ['native', 'docker'], stores: [...stores.slice(0, 2), { ...stores[2], machine: 'native' }] },
  native: { description: 'One native machine, one store and two projects; useful for quick checks.', machines: ['native'], stores: stores.slice(0, 1) },
  empty: { description: 'An initialized real home with built-in machines and no fixture stores.', machines: ['native', 'docker'], stores: [] },
}
export function presetOf(name) {
  if (!Object.hasOwn(presets, name) && !Object.hasOwn(legacyPresets, name)) throw new Error(`Unknown preset ${name}. Run "node tools/demo-fixtures.mjs presets".`)
  return structuredClone(presets[name] ?? legacyPresets[name])
}
export function sourceFiles(name) {
  return structuredClone(projectDefinition(name).files)
}

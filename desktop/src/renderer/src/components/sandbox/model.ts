import type { Workspace, Activity, SandboxFile } from './types'
export type { Outcome, Actor, Workspace, Activity, SandboxFile, SandboxSnapshot } from './types'
export function workspaceState(ws: Workspace, events: Activity[], time: number) {
  const mounts = events.filter(e => e.method === 'workspace.mount' && e.workspace === ws.id && e.start <= time)
  const mount = mounts.at(-1)
  const current = events.filter(e => e.workspace === ws.id && e.start >= (mount?.start ?? -Infinity))
  const unmount = current.find(e => e.method === 'workspace.unmount' && e.start <= time)
  const active = current.filter(e => e.start <= time && time < e.end)
  const last = current.filter(e => e.end <= time).at(-1)
  const mounted = (!mount || mount.end <= time) && !(unmount && unmount.end <= time && unmount.outcome === 'ok')
  return { mounted, mounting: !!mount && mount.start <= time && time < mount.end, unmounted: !!unmount && unmount.end <= time && unmount.outcome === 'ok', active, last }
}
export const clock = (time: number) => `0:${Math.floor(time).toString().padStart(2, '0')}`
export const fileBytes = (file: SandboxFile) => new TextEncoder().encode(file.content).byteLength
export function sizeLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` }

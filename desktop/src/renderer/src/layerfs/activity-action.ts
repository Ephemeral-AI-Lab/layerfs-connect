import type { CliAction } from '../../../../../shared/cli-activity'

let gesture: { id: string; label: string } | undefined
function clicked(event: Event) {
  const source = event instanceof SubmitEvent ? event.submitter : event.target
  const target = source instanceof Element ? source.closest('button, [role="button"], input[type="submit"]') : null
  if (!target) return
  const label = target.getAttribute('aria-label') || target.textContent?.trim() || target.getAttribute('title')
  if (!label) return
  const current = { id: crypto.randomUUID(), label: label.slice(0, 200) }
  gesture = current
  // One browser event dispatch; never attach a later polling request to a past click.
  setTimeout(() => { if (gesture === current) gesture = undefined }, 0)
}
document.addEventListener('click', clicked, true)
document.addEventListener('submit', clicked, true)
if (import.meta.hot) import.meta.hot.dispose(() => { document.removeEventListener('click', clicked, true); document.removeEventListener('submit', clicked, true) })

/** Stable action names describe the API operation, independent of button wording. */
export function desktopAction(method: string, path: string): CliAction {
  const parts = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent)
  const [, group, id, sub] = parts
  const family = ({ machines: 'machine', projects: 'project', sandboxes: 'sandbox', workspaces: 'workspace', stores: 'store', branches: 'branch', buckets: 'backup', 'doctor-jobs': 'doctor', 'storage-jobs': 'transfer' } as Record<string, string>)[group] ?? group
  const verb = method === 'DELETE' ? (family === 'sandbox' ? 'close' : family === 'workspace' ? 'unmount' : 'remove') : sub ?? (id === 'check' ? 'check' : 'create')
  const user = method !== 'GET' || !!gesture
  const label = user ? `${verb.charAt(0).toUpperCase()}${verb.slice(1).replaceAll('-', ' ')} ${family}` : `Read ${group}`
  return { id: gesture?.id ?? crypto.randomUUID(), name: `${family}.${method === 'GET' ? 'read' : verb}`, label: gesture?.label ?? label, target: id, page: location.hash.split('?')[0].slice(1), origin: user ? 'user' : 'background' }
}

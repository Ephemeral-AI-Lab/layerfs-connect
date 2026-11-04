// Dev builds only: draw Machines, Storage and Projects on one simulated host
// (data/compute-sim.ts, data/home-sim.ts) instead of asking this one. The
// choice is shared by the pages and remembered (localStorage
// `connect.simulate`). While it is on, the host client answers every read
// about the sample home from it (data/project-sim.ts: a sample project opens
// with its Branches, Commits, files, Sandboxes and chats) and refuses every
// call that would change it; nothing about the sample home reaches the host.
import { FlaskConical } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { Chip } from '@/components/storage/chips'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { reloadStorageView } from '@/components/projects/store-facts'
import { isSimId, SIM_IDS, SIMULATIONS, type SimId, type Simulation } from '@/data/compute-sim'
import { simChats, simRoute } from '@/data/project-sim'
import { setSimHook } from '@/host/client'
import { t, useI18n } from '@/i18n'

const KEY = 'connect.simulate'
/** Where Machines kept the choice before the pages shared it. */
const OLD_KEY = 'connect.compute.simulate'
const LIVE = 'live'

const read = (): SimId | null => {
  if (!import.meta.env.DEV) return null
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)
    return isSimId(v) ? v : null
  } catch {
    return null
  }
}

let current = read()
const listeners = new Set<() => void>()

/** Points the host client at the simulated host, or back at the live one. */
function install() {
  const sim = current ? SIMULATIONS[current] : null
  setSimHook(
    sim && {
      route: (method, path) => simRoute(sim, method, path),
      // the sample chats join the host's, so a sample project's Chats and Live have theirs
      extend: (method, path, value) => (method === 'GET' && path === '/api/agent/sessions' && Array.isArray(value) ? [...value, ...simChats(sim)] : value),
    },
  )
}
install()

export function setSimulation(v: SimId | null) {
  current = v
  try {
    localStorage.removeItem(OLD_KEY)
    if (v) localStorage.setItem(KEY, v)
    else localStorage.removeItem(KEY)
  } catch {
    /* the choice just isn't remembered */
  }
  install()
  reloadStorageView()
  listeners.forEach((l) => l())
}

/** The simulated host the pages draw, or null for the live host. */
export function useSimulation(): SimId | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  )
}

/** A simulated page's refusal of any action: nothing is sent. */
export const SIMULATED_REFUSAL = Object.assign(new Error('This is sample data: nothing is sent to the host. Pick Live host to act.'), { code: 'Simulated' })

/** The header's picker (dev builds only). */
export function SimulationPicker() {
  useI18n()
  const value = useSimulation()
  if (!import.meta.env.DEV) return null
  return (
    <Select value={value ?? LIVE} onValueChange={(v) => setSimulation(isSimId(v) ? v : null)}>
      <SelectTrigger size="sm" aria-label={t('Simulate a host')} className="h-8 rounded-full px-3 text-xs">
        <FlaskConical aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={LIVE}>{t('Live host')}</SelectItem>
        {SIM_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            {t(SIMULATIONS[id].label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The line under a simulated page's header. */
export function SimulatedNote({ sim }: { sim: Simulation }) {
  useI18n()
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Chip tone="warning" icon={FlaskConical}>
        {t('Simulated')}
      </Chip>
      {t('{label}: sample data, not this machine.', { label: t(sim.label) })}
    </p>
  )
}

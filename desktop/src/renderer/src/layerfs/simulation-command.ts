/** A slash command starts an independent scripted run, never a model message. */
export type SimulationInput = { project: string; machine: string; mixed: boolean }
export type SimulationCommand = { ok: true; input: SimulationInput } | { ok: false; error: string }
export const SIMULATION_USAGE = '/simulation --project <preset> --machine <machine> [--mixed [true|false]]'

export function parseSimulationCommand(text: string): SimulationCommand | null {
  const words = text.trim().split(/\s+/)
  if (words.shift() !== '/simulation') return null
  const values: Record<string, string | boolean> = {}
  for (let i = 0; i < words.length; i++) {
    const [flag, ...parts] = words[i].split('=')
    if (!['--project', '--machine', '--mixed'].includes(flag)) return { ok: false, error: `Unknown argument ${words[i]}. Use ${SIMULATION_USAGE}` }
    const key = flag.slice(2)
    if (key in values) return { ok: false, error: `Name ${flag} once.` }
    let value = parts.length ? parts.join('=') : undefined
    if (key === 'mixed') {
      if (value === undefined && words[i + 1] && !words[i + 1].startsWith('--')) value = words[++i]
      if (value !== undefined && value !== 'true' && value !== 'false') return { ok: false, error: '--mixed accepts true or false.' }
      values.mixed = value !== 'false'
    } else {
      if (value === undefined && words[i + 1] && !words[i + 1].startsWith('-')) value = words[++i]
      if (!value || value.startsWith('-')) return { ok: false, error: `${flag} needs a ${key === 'project' ? 'preset project' : 'machine'} name.` }
      values[key] = value
    }
  }
  if (!values.project || !values.machine) return { ok: false, error: `Choose a preset project and machine. Use ${SIMULATION_USAGE}` }
  return { ok: true, input: { project: String(values.project), machine: String(values.machine), mixed: values.mixed === true } }
}

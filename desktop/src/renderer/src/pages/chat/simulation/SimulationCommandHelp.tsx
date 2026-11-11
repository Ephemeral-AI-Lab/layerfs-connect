import { SIMULATION_USAGE } from '@/layerfs/simulation-command'

/** Keep slash-command discovery next to the ordinary composer. */
export function SimulationCommandHelp({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const command = text.trim()
  if (!command.startsWith('/') || (!'/simulation'.startsWith(command) && !command.startsWith('/simulation '))) return null
  return <div className="mt-2 px-1 text-12 text-muted-foreground">
    {command.length <= '/simulation'.length && <button type="button" className="mb-1 block text-left underline" onClick={() => onChange('/simulation --project design --machine native')}>Simulation · run scripted project conversations</button>}
    <p className="break-words font-mono">{SIMULATION_USAGE}</p>
    <p className="mt-1">Each run creates a new tagged SQLite Store and project. Existing simulations keep running.</p>
  </div>
}

// `/scenario [<name>] [-machine <machine>]`: the scenario to play and the
// machine its Sandboxes run on (LayerFS 2.0). Left out, the project's Store's
// machine; named, the project's Store moves there first, since Sandboxes
// follow the Store. The host checks the name against machine.list.
// `--machine` and `-machine=<name>` are read the same way.

export type ScenarioCommand =
  | { ok: true; name: string | null; machine: string | null }
  /** `error` is an English message template for t(), filled from `params`. */
  | { ok: false; error: string; params?: Record<string, string> }

const FLAG = /^--?machine(?:=(.*))?$/

/** Null when `text` is not a `/scenario` command. */
export function parseScenarioCommand(text: string): ScenarioCommand | null {
  const words = text.trim().split(/\s+/)
  if (words[0] !== '/scenario') return null
  let name: string | null = null
  let machine: string | null = null
  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    const flag = FLAG.exec(word)
    if (flag) {
      if (machine !== null) return { ok: false, error: 'Name -machine once.' }
      machine = flag[1] ?? words[++i] ?? ''
      if (!machine) return { ok: false, error: '-machine needs a machine’s name.' }
    } else if (word.startsWith('-')) {
      return { ok: false, error: 'Unknown option {option}. /scenario takes -machine <name>.', params: { option: word } }
    } else if (name === null) {
      name = word
    } else {
      return { ok: false, error: '/scenario plays one scenario (or all), not {first} and {second}.', params: { first: name, second: word } }
    }
  }
  return { ok: true, name, machine }
}

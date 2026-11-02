// `/scenario [<name>] [-platform <platform>]`: the scenario to play and the
// platform its Sandboxes are made on (layerfs#529), docker unless named.
// `--platform` and `-platform=<name>` are read the same way.

export const PLATFORM_NAMES = ['docker', 'mac', 'linux', 'apple-container', 'microsandbox', 'lima', 'firecracker', 'ssh'] as const
export type ScenarioPlatform = (typeof PLATFORM_NAMES)[number]
export const DEFAULT_SCENARIO_PLATFORM: ScenarioPlatform = 'docker'

export type ScenarioCommand =
  | { ok: true; name: string | null; platform: ScenarioPlatform }
  /** `error` is an English message template for t(), filled from `params`. */
  | { ok: false; error: string; params?: Record<string, string> }

const FLAG = /^--?platform(?:=(.*))?$/

/** Null when `text` is not a `/scenario` command. */
export function parseScenarioCommand(text: string): ScenarioCommand | null {
  const words = text.trim().split(/\s+/)
  if (words[0] !== '/scenario') return null
  let name: string | null = null
  let platform: string | null = null
  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    const flag = FLAG.exec(word)
    if (flag) {
      if (platform !== null) return { ok: false, error: 'Name -platform once.' }
      platform = flag[1] ?? words[++i] ?? ''
      if (!platform) return { ok: false, error: '-platform needs a name: {names}.', params: { names: PLATFORM_NAMES.join(', ') } }
    } else if (word.startsWith('-')) {
      return { ok: false, error: 'Unknown option {option}. /scenario takes -platform <name>.', params: { option: word } }
    } else if (name === null) {
      name = word
    } else {
      return { ok: false, error: '/scenario plays one scenario (or all), not {first} and {second}.', params: { first: name, second: word } }
    }
  }
  const chosen = platform ?? DEFAULT_SCENARIO_PLATFORM
  if (!(PLATFORM_NAMES as readonly string[]).includes(chosen)) return { ok: false, error: 'No platform named {platform}. Platforms: {names}.', params: { platform: chosen, names: PLATFORM_NAMES.join(', ') } }
  return { ok: true, name, platform: chosen as ScenarioPlatform }
}

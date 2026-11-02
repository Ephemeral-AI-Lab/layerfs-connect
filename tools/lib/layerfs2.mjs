// Rewrites a scenario written for LayerFS 1.1.0's `layerfs` command into
// 2.0's (docs/layerfs-2.0-integration.md §8 step 9): every call names its
// project first ("$LAYERFS_CONNECT_PROJECT", set by the run), `fs` is `file`,
// Branch calls take their 2.0 positionals, `branch list_commits` is
// `commit list`, and `sandbox create` names its Sandbox (sb<k>, unique in
// the scenario; the run's scope makes it unique in the home) on the run's
// machine ("$LAYERFS_CONNECT_MACHINE"). Expect codes follow (fs.* -> file.*).
// A scenario that uses the 1.1.0 JS SDK or background processes is not
// rewritten: v2Blocked says why, and the scenario is marked `blocked`.
const P = '"$LAYERFS_CONNECT_PROJECT"'
const M = '"$LAYERFS_CONNECT_MACHINE"'

/** Why a scenario cannot play on 2.0 yet, or null. */
export function v2Blocked(scenario) {
  const text = JSON.stringify(scenario)
  if (/run_in_background|process\.(start|cancel|list)|job_output|job_kill/.test(text)) return 'needs background processes (§9 Q2)'
  if (/LayerFS\.open|LayerFSBackend|@layerfs\//.test(text)) return 'its scripts use the 1.1.0 JS SDK; they are not rewritten for the 2.0 package yet'
  return null
}

/** One shell string rewritten; `next` names the next Sandbox. */
export function v2Command(text, next) {
  return text
    .replace(/\blayerfs fs glob (\S+) /g, `layerfs file glob ${P} $1 / `)
    .replace(/\blayerfs fs ([a-z_]+)\b/g, (_, call) => `layerfs file ${call} ${P}`)
    .replace(/\blayerfs branch list_commits\b/g, `layerfs commit list ${P}`)
    .replace(/\blayerfs branch publish\b/g, `layerfs branch publish ${P}`)
    .replace(/\blayerfs branch merge ([^\s'"-][^\s]*) ([^\s'"-][^\s]*) ([^\s'"-][^\s]*)/g, `layerfs branch merge ${P} $3 $1 $2`)
    .replace(/\blayerfs branch fork ([^\s'"-][^\s]*)(?: ([^\s'"-][^\s|;)]*))?/g, (_, name, from) => `layerfs branch fork ${P} ${name} ${from ?? 'main'}`)
    .replace(/\blayerfs sandbox create\b(?! ")/g, () => `layerfs sandbox create ${P} ${next()} ${M}`)
    .replace(/jq -r \.sandbox\b/g, 'jq -r .name')
}

/** An expect code in 2.0's names. */
export const v2Code = (code) => code.replace(/^fs\./, 'file.').replace(/^branch\.list_commits:/, 'commit.list:').replace(/^sandbox\.create:ok$/, 'sandbox.create:running')

/** A whole scenario rewritten (or marked blocked); idempotent. */
export function toV2(scenario) {
  const blocked = v2Blocked(scenario)
  if (blocked) return { ...scenario, blocked }
  if (scenario.layerfs === 2) return scenario
  let k = 0
  const next = () => `sb${++k}`
  const walk = (v, key) => {
    if (typeof v === 'string') return key === 'expect' ? v2Code(v) : v2Command(v, next)
    if (Array.isArray(v)) return v.map((x) => walk(x, key))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k2, x]) => [k2, walk(x, k2)]))
    return v
  }
  return { ...walk(scenario), layerfs: 2 }
}

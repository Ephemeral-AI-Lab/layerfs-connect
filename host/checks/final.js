// The checks that compare a finished run's project with a replay's recorded
// final.json (ported from dsh-layerfs tools/checks/gates.mjs):
//   order        the project's history equals the recorded one: each
//                Branch's Commits in the recorded order, each fork from and
//                each merge and publish of the recorded node
//   final tree   every tracked file on main has the recorded SHA-256, and no
//                other tracked file exists. final.json's `varies` names what a
//                run cannot reproduce byte for byte: a name's clock reading
//                (`stamp`, matched as a pattern) and files whose format holds
//                the run's clock or an OS-assigned value (`content`, compared
//                by presence); variesOf() decides both from the record
//   closed       no Sandbox of the project still runs: each replay step
//                closes the Sandbox it made, and so does the tree check
import { compareHistory, historyOf } from './history.js'
import { trackedChanges, trackedHashes } from './tree.js'

/** The order check: the run's history against final.json's recorded one, as failure messages. */
export async function orderFailures(final, lf, backend) {
  const run = await historyOf(lf, backend)
  const failures = compareHistory(final.history, run)
  // a run's Commit where the record has UpToDate must change no tracked file
  const byRef = new Map([...run.ids].map(([id, ref]) => [ref, id]))
  for (const ref of failures.extras) {
    const changes = await trackedChanges(lf, run.items.get(byRef.get(ref)))
    if (changes.length) failures.push(`${ref} is a Commit where the record has UpToDate, and it changes ${changes.length} tracked path(s), first ${changes[0].path}`)
  }
  return { failures: [...failures], branches: Object.keys(run.branches).length, layers: run.layers.length }
}

/** The patterns `varies` uses: a clock reading in a name, and the formats whose bytes hold run-time values. */
const STAMP = /[0-9]{16,}/g
const CONTENT = [
  [/\.sqlite$/, 'an SQLite database (page headers count writes; rows hold times)'],
  [/\.pyc$/, "CPython bytecode (holds its source's modification time)"],
  [/\/server-[0-9]{16,}\.stdout$/, "a test server's log (holds its OS-assigned port)"],
]

/**
 * What of a recorded final main a run cannot reproduce byte for byte, from
 * the record alone (what a recording writes to final.json).
 * @returns {{ stamp: string, content: Record<string, string> }}
 */
export function variesOf(main) {
  const content = {}
  for (const path of Object.keys(main)) for (const [pattern, why] of CONTENT) if (pattern.test(path)) content[path] = why
  return { stamp: STAMP.source, content }
}

/** The final-tree comparison, pure: recorded final.json against a run's main ({ path: sha256 }). */
export function compareTree(final, files) {
  const failures = []
  const varies = final.varies ?? { stamp: null, content: {} }
  const stamp = varies.stamp ? new RegExp(varies.stamp, 'g') : null
  const name = (path) => (stamp ? path.replace(stamp, '<stamp>') : path)
  const exempt = new Set(Object.keys(varies.content ?? {}).map(name))
  // each file as (name pattern, SHA-256, or "*" when its bytes vary), counted
  const count = (all) => {
    const out = new Map()
    for (const [path, sha] of Object.entries(all)) {
      const key = `${name(path)} ${exempt.has(name(path)) ? '*' : sha}`
      out.set(key, [...(out.get(key) ?? []), path])
    }
    return out
  }
  const [want, got] = [count(final.main), count(files)]
  for (const [key, paths] of want) {
    const have = got.get(key)?.length ?? 0
    if (have >= paths.length) continue
    const pattern = key.slice(0, key.lastIndexOf(' '))
    const there = [...got].filter(([k]) => k.startsWith(`${pattern} `)).flatMap(([, p]) => p)
    const recorded = paths.map((p) => final.main[p].slice(0, 12)).join(', ')
    failures.push(
      there.length
        ? `${paths[have]} differs: ${there.map((p) => files[p].slice(0, 12)).join(', ')}, recorded ${recorded}`
        : `${paths[have]} is missing from main`,
    )
  }
  for (const [key, paths] of got) {
    const extra = paths.length - (want.get(key)?.length ?? 0)
    if (extra > 0) failures.push(`${paths[paths.length - extra]} (${files[paths[0]].slice(0, 12)}) is tracked on main but not in the record`)
  }
  return {
    failures,
    files: Object.keys(files).length,
    varies: { stamped: Object.keys(final.main).filter((p) => name(p) !== p).length, content: exempt.size },
  }
}

/** The final-tree check: main's tracked files, hashed in a Workspace, against final.json's. */
export async function finalTreeFailures(final, lf) {
  const run = await trackedHashes(lf)
  return compareTree(final, run.files)
}

/** The closed check: the project's running Sandboxes, `<n> (<workspaces> Workspace(s))` each. */
export async function openSandboxes(lf) {
  const open = []
  for (let pos = 0; ; ) {
    const page = await lf.project.list_sandboxes(1000, pos)
    for (const s of page.items) open.push(`Sandbox ${s.sandbox} (${(s.workspaces ?? []).length} Workspace(s))`)
    if (!page.hasMore) return open
    pos += page.items.length
  }
}

// The checks a finished scripted run must pass. run.mjs runs `expected` on a
// run's trace lines; the others compare a finished run's project with a
// replay's recorded final.json and need a LayerFS client. Those live in
// host/checks (the engine runs them after each run, as finalChecks) and are
// re-exported here:
//   expected     each bash step with `expect` left those LayerFS outcomes, in
//                order, on its agent's trace lines ("a|b" allows either)
//   order        host/checks/final.js orderFailures
//   final tree   host/checks/final.js finalTreeFailures (compareTree, variesOf)
//   closed       host/checks/final.js openSandboxes: the project's running
//                Sandboxes; openContainers below asks Docker instead, for
//                any container still running on the project's volume
// Ported from dsh-layerfs tools/checks/gates.mjs.
import { execFileSync } from 'node:child_process'
import { codeOf, inOrder, matches } from '../lib/expect.mjs'

export { codeOf, matches }
export { compareTree, finalTreeFailures, openSandboxes, orderFailures, variesOf } from '../../host/checks/final.js'

/**
 * Each bash step's `expect` against its agent's trace lines. The lines of one
 * bash call share a `step`; the calls are taken in the order they began (a
 * background call's first line may end after a later call's: lines arrive as
 * their calls end). Expecting steps match the calls in order. A bash step
 * without `expect` may have made LayerFS calls too, so before an expecting
 * step as many unmatched calls as such steps (and earlier failed ones) since
 * the last match may be passed over; more is a failure.
 * @param {object} scenario compiled scenario (tools/lib/scenario.mjs)
 * @param {(agent: string) => object[]} linesOf the agent's finished trace lines, in order
 * @returns {{ failures: string[], notes: string[] }}
 */
export function expectedOutcomes(scenario, linesOf) {
  const failures = []
  const notes = []
  for (const [agent, steps] of Object.entries(scenario.agents)) {
    const byStep = new Map()
    for (const line of linesOf(agent)) {
      if (line.ok === undefined || line.ok === null || line.method === 'sandbox.service') continue
      let group = byStep.get(line.step)
      if (!group) byStep.set(line.step, (group = { step: line.step, codes: [], start: line.start }))
      group.codes.push(codeOf(line))
      if (line.start < group.start) group.start = line.start
    }
    const groups = [...byStep.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    const bash = steps.filter((s) => s.kind === 'call' && s.call.name === 'bash')
    const expecting = bash.filter((s) => s.expect?.length).length
    if (expecting && !groups.length) {
      failures.push(`${agent}: no LayerFS calls on the trace`)
      continue
    }
    let next = 0
    let slack = 0
    let matched = 0
    for (const step of bash) {
      if (!step.expect?.length) {
        slack++
        continue
      }
      const end = Math.min(groups.length, next + slack + 1)
      let at = -1
      for (let i = next; i < end && at < 0; i++) if (inOrder(groups[i].codes, step.expect)) at = i
      if (at < 0) {
        const shown =
          groups
            .slice(next, Math.max(end, next + 1))
            .map((g) => `[${g.codes.join(', ')}]`)
            .join(' ') || 'nothing'
        failures.push(`${step.at} (${step.call.args.description}): expected ${step.expect.join(', ')}; ${agent}'s next call(s) show ${shown}`)
        slack++
        continue
      }
      matched++
      next = at + 1
      slack = 0
    }
    notes.push(`${agent}: ${groups.length} bash call(s) with LayerFS lines, ${expecting} checked, ${matched} matched`)
  }
  return { failures, notes }
}

/** Container states that hold the volume but run nothing: an idle-closed Sandbox, a failed start. */
const STOPPED = new Set(['created', 'exited', 'dead'])

/** The containers on the project's volume, `name state` each. */
export function volumeContainers(volume, docker = '/var/run/docker.sock', run = execFileSync) {
  const out = run('docker', ['-H', `unix://${docker}`, 'ps', '-a', '--filter', `volume=${volume}`, '--format', '{{.Names}} {{.State}}'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

/** The containers still running on the project's volume. A stopped one, such as a Sandbox that closed itself when idle, has closed. */
export function openContainers(volume, docker = '/var/run/docker.sock', run = execFileSync) {
  return volumeContainers(volume, docker, run).filter((line) => !STOPPED.has(line.split(' ').at(-1)))
}

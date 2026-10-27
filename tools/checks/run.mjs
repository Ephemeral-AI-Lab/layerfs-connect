#!/usr/bin/env node
// Checks a finished demo run again, from outside the engine:
//   node tools/checks/run.mjs <run folder> [--scenarios <dir>]
//   node tools/checks/run.mjs --url <host url> --token <token> <run id> [--scenarios <dir>]
// A run folder is <state>/runs/<run id>/: run.json (the run's record) and
// traces/<agent>.jsonl (each agent's SDK trace). With --url (or
// LAYERFS_CONNECT_URL and LAYERFS_CONNECT_TOKEN) it reads GET /api/runs/:id
// from a running host instead, whose steps carry each call's trace line.
// The scenario is loaded from --scenarios (default: Connect's scenarios/).
// Checks: the run's own state (passed, or why not) and each bash step's
// `expect` (gates.mjs expectedOutcomes). The final checks (final.json: order,
// final tree, closed) need a LayerFS client on the run's project; the engine
// runs them after the root's last step, and this command reports the
// record's results. To run them again, use tools/checks/final.mjs.
// Reads files or the HTTP API only; opens no Store.
// Exit 0 when every check holds, 1 when one fails, 2 on a wrong command line
// or a run it cannot find.
// Ported from dsh-layerfs tools/checks/run.mjs, which read dsh web's profile.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScenario } from '../lib/scenario.mjs'
import { expectedOutcomes } from './gates.mjs'

const USAGE = 'usage: node tools/checks/run.mjs (<run folder> | --url <host url> --token <token> <run id>) [--scenarios <dir>]'

/** Reads a JSON-lines file; a line that does not parse is counted, not used. */
export function readLines(file) {
  const lines = []
  let bad = 0
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim()) continue
    try {
      lines.push(JSON.parse(raw))
    } catch {
      bad++
    }
  }
  return { lines, bad }
}

/** A run folder as { record, byAgent, bad, source }. */
export function readRunFolder(folder) {
  const file = join(folder, 'run.json')
  if (!existsSync(file)) throw Object.assign(new Error(`${file} does not exist: not a run folder`), { usage: true })
  const record = JSON.parse(readFileSync(file, 'utf8'))
  const byAgent = new Map()
  let bad = 0
  const traces = join(folder, 'traces')
  if (existsSync(traces)) {
    for (const name of readdirSync(traces).filter((n) => n.endsWith('.jsonl'))) {
      const read = readLines(join(traces, name))
      byAgent.set(basename(name, '.jsonl'), read.lines)
      bad += read.bad
    }
  }
  return { record, byAgent, bad, source: traces }
}

/** A run from the host's HTTP API as { record, byAgent, bad, source }. */
export async function readRunApi(url, token, id) {
  const answer = await fetch(`${url.replace(/\/$/, '')}/api/runs/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } })
  const body = await answer.json().catch(() => null)
  if (!answer.ok) throw Object.assign(new Error(`GET /api/runs/${id}: ${answer.status} ${body?.code ?? ''} ${body?.message ?? ''}`.trim()), { usage: answer.status === 404 })
  const byAgent = new Map()
  for (const step of body.steps ?? []) {
    for (const call of step.calls ?? []) byAgent.set(call.agent ?? step.agent, [...(byAgent.get(call.agent ?? step.agent) ?? []), call])
  }
  return { record: body, byAgent, bad: 0, source: `${url} /api/runs/${id}` }
}

/**
 * Checks a run read by readRunFolder or readRunApi.
 * @returns {{ scenario: string, project: string, failures: string[], notes: string[] }}
 */
export function checkRun({ record, byAgent, bad, source }, scenariosDir) {
  const name = record.demo ?? record.scenario
  const folder = join(scenariosDir, name ?? '')
  if (!name || !existsSync(join(folder, 'scenario.json'))) {
    throw Object.assign(new Error(`the run played ${name}, and ${folder} holds no scenario.json`), { usage: true })
  }
  const scenario = loadScenario(folder)
  const failures = []
  const notes = []
  if (record.state === 'passed') notes.push(`run: passed${record.ended ? ` in ${((record.ended - record.started) / 1000).toFixed(1)} s` : ''}`)
  else failures.push(`run: ${record.state}${record.error ? ` (${record.error})` : ''}`)

  if (bad) failures.push(`lines: ${bad} line(s) of ${source} do not parse`)
  for (const [agent, lines] of byAgent) {
    if (!scenario.agents[agent]) failures.push(`lines: ${lines.length} line(s) of an agent named ${agent}, which ${name} does not have`)
  }
  const expected = expectedOutcomes(scenario, (agent) => byAgent.get(agent) ?? [])
  failures.push(...expected.failures)
  const count = [...byAgent.values()].reduce((n, lines) => n + lines.length, 0)
  notes.push(`lines: ${count} from ${source}`, ...expected.notes)

  if (existsSync(join(folder, 'final.json'))) {
    const checks = record.checks ?? []
    if (!checks.length) failures.push(`final: ${name} has a final.json, and the run's record holds no final checks`)
    for (const c of checks) (c.ok ? notes : failures).push(`${c.name}: ${c.detail}`)
  }
  return { scenario: name, project: record.project ?? '(not recorded)', failures, notes }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i < 0 ? fallback : args.splice(i, 2)[1]
  }
  const scenarios = resolve(opt('--scenarios', fileURLToPath(new URL('../../scenarios/', import.meta.url))))
  const url = opt('--url', null)
  const token = opt('--token', process.env.LAYERFS_CONNECT_TOKEN)
  const api = url ?? (args[0] && !existsSync(args[0]) ? process.env.LAYERFS_CONNECT_URL : null)
  if (args.length !== 1 || (api && !token)) {
    console.error(USAGE)
    return 2
  }
  let result
  try {
    const run = api ? await readRunApi(api, token, args[0]) : readRunFolder(resolve(args[0]))
    result = checkRun(run, scenarios)
  } catch (error) {
    console.error(`run check: ${error.message}`)
    if (error.usage) console.error(USAGE)
    return 2
  }
  console.log(`${result.scenario} (project ${result.project})`)
  for (const note of result.notes) console.log(`  ${note}`)
  for (const failure of result.failures) console.log(`  FAIL ${failure}`)
  console.log(result.failures.length ? `FAIL: ${result.failures.length} failure(s)` : 'PASS: every check holds')
  return result.failures.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => process.exit(code))

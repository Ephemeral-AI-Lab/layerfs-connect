#!/usr/bin/env node
// Runs a scenario's final checks (host/checks: order, final tree, closed)
// on a project of Connect's LayerFS home, outside a run, or records a
// project's present state as a final.json:
//   node --import ./host/resolve-layerfs.js tools/checks/final.mjs <project> <scenario> [--scenarios <dir>]
//   node --import ./host/resolve-layerfs.js tools/checks/final.mjs <project> --final <final.json>
//   node --import ./host/resolve-layerfs.js tools/checks/final.mjs <project> --record <out.json>
// --state names Connect's state folder (default ~/.layerfs-connect). It opens
// the runtime without its sweep and one client on the project; it never
// starts or stops the worker. The tree check and --record fork a
// final-tree-check-* Branch from main and use a Sandbox of their own, which
// they close. Exit 0 when every check holds, 1 when one fails, 2 on a wrong
// command line.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LayerFS } from '@layerfs/agent'
import { LayerFSBackend } from '@layerfs/backend'
import { LayerFSRuntime } from '@layerfs/runtime'
import { resolveSpec, runtimeSettings, withProjectEnv } from '../../host/config.js'
import { finalChecks } from '../../host/checks/index.js'
import { variesOf } from '../../host/checks/final.js'
import { historyOf } from '../../host/checks/history.js'
import { trackedHashes } from '../../host/checks/tree.js'

const USAGE =
  'usage: node --import ./host/resolve-layerfs.js tools/checks/final.mjs <project> (<scenario> [--scenarios <dir>] | --final <final.json> | --record <out.json>) [--state <dir>]'
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** A final.json of the project's present state: main's tracked hashes, what varies, and the history by place. */
export async function recordFinal(lf) {
  const history = await historyOf(lf, LayerFSBackend.of(lf))
  const { files } = await trackedHashes(lf)
  const branches = Object.fromEntries(
    Object.entries(history.branches).map(([name, b]) => [name, { forkedFrom: b.forkedFrom, commits: b.commits.map(({ id, ...c }) => c) }]),
  )
  return { main: files, varies: variesOf(files), history: { layers: history.layers, branches } }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i < 0 ? null : args.splice(i, 2)[1]
  }
  const state = opt('--state')
  const scenarios = resolve(opt('--scenarios') ?? join(APP, 'scenarios'))
  const finalFile = opt('--final')
  const out = opt('--record')
  const [project, scenario] = args
  if (!project || args.length !== (finalFile || out ? 1 : 2)) {
    console.error(USAGE)
    process.exit(2)
  }
  const spec = state ? resolveSpec(state) : resolveSpec()
  const runtime = await LayerFSRuntime.open({ ...runtimeSettings(spec), sweep: false })
  spec.runtime = Promise.resolve(runtime)
  let client
  let scratch
  try {
    const record = (await runtime.project.list()).find((p) => p.name === project)
    if (!record) throw new Error(`no project ${project} in ${spec.home}`)
    client = await withProjectEnv(spec, record, () => LayerFS.open(project))
    if (out) {
      const final = await recordFinal(client)
      writeFileSync(out, `${JSON.stringify(final, null, 1)}\n`)
      console.log(`${project}: recorded ${Object.keys(final.main).length} tracked files, ${Object.keys(final.history.branches).length} Branches, ${final.history.layers.length} Layers to ${out}`)
      return 0
    }
    let scenarioDir = join(scenarios, scenario ?? '')
    if (finalFile) {
      // finalChecks reads <dir>/final.json: give it a folder holding a copy
      scratch = mkdtempSync(join(tmpdir(), 'lfc-final-'))
      writeFileSync(join(scratch, 'final.json'), (await import('node:fs')).readFileSync(finalFile))
      scenarioDir = scratch
    }
    const checks = await finalChecks({ scenario: scenario ?? basename(finalFile), scenarioDir, project, client })
    if (!checks.length) console.log(`${project}: ${scenarioDir} has no final.json; no final checks`)
    for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail.replaceAll('\n', '\n       ')}`)
    return checks.every((c) => c.ok) ? 0 : 1
  } finally {
    await client?.close()
    await runtime.close()
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`final check: ${error.code ? `${error.code}: ` : ''}${error.message}`)
      process.exit(2)
    },
  )
}

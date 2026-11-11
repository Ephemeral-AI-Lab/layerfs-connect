#!/usr/bin/env node
// Receipt bookkeeping only for generated scripts; their shell executes each CLI line.
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { execute } from '../../host/cli/spawn.js'
import { parse, stringify } from '../../host/cli/json.js'
import { assertProjectStep } from '../demo/recipe.mjs'
import { resolveSimulationStep, validateSimulationPackage, claimSimulationExecution } from './compiler.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const location = (directory, key, extension = 'json') => join(directory, 'receipts', `${digest(key)}.${extension}`)
const journal = (directory, entry) => appendFile(join(directory, 'journal.jsonl'), stringify(entry) + '\n')
async function loadStep(directory, key) {
  directory = resolve(directory)
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (manifest.status !== 'prepared') throw new Error(`Simulation package is ${manifest.status}; generated scripts cannot replay managed runs.`)
  await claimSimulationExecution(directory, 'standalone')
  const planText = await readFile(join(directory, 'plan.json'), 'utf8')
  if (digest(planText) !== manifest.hashes['plan.json']) throw new Error('Simulation plan hash changed; no command was attempted.')
  const plan = JSON.parse(planText), step = plan.steps.find(item => item.key === key)
  if (!step) throw new Error(`Unknown simulation step ${key}`)
  if (step.phase === 'setup') await validateSimulationPackage(directory)
  if (digest(await readFile(join(directory, step.scriptPath))) !== manifest.hashes[step.scriptPath]) throw new Error(`Simulation script hash changed: ${step.scriptPath}`)
  return { directory, step }
}
export async function beginPackageStep(directory, key) {
  const loaded = await loadStep(directory, key)
  directory = loaded.directory
  const { step } = loaded
  await mkdir(join(directory, 'receipts'), { recursive: true, mode: 0o700 })
  const receipts = {}, dependencies = new Set(step.dependsOn)
  if (step.commitFrom) dependencies.add(step.commitFrom)
  for (const word of step.argv) { const match = word.match(/^<ws:(.+)>$/); if (match) dependencies.add(match[1]) }
  for (const dependency of dependencies) receipts[dependency] = parse(await readFile(location(directory, dependency), 'utf8'))
  const argv = resolveSimulationStep(step, receipts, directory)
  // An exclusive intent survives both failures and confirmed completion.
  await writeFile(location(directory, key, 'json.intent'), stringify({ key, argv, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 })
  await journal(directory, { key, status: 'started', argv })
  return { directory, step, argv }
}
async function saveReceipt(directory, step, result) {
  if (step.key === 'setup.machine' && (result.supports?.sqlite === false || !['ready', 'running'].includes(result.state))) {
    throw Object.assign(new Error(`Machine ${step.argv[2]} is not ready for a SQLite simulation. Start a supported machine and launch a new simulation.`), { code: 'Unavailable' })
  }
  assertProjectStep(step, result)
  await writeFile(location(directory, step.key), stringify(result), { flag: 'wx', mode: 0o600 })
  await journal(directory, { key: step.key, status: 'completed', result })
  return result
}
export async function finishPackageStep(directory, key) {
  const loaded = await loadStep(directory, key)
  directory = loaded.directory
  // Require an already reserved execution attempt; finish never initiates a command.
  await readFile(location(directory, key, 'json.intent'))
  const frames = (await readFile(location(directory, key, 'stdout'), 'utf8')).trim().split('\n').filter(Boolean).map(parse)
  const finalFrames = frames.filter(frame => Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'refusal'))
  const result = loaded.step.argv.includes('--events') ? finalFrames.length === 1 && frames.at(-1) === finalFrames[0] ? finalFrames[0].result : undefined : frames.length === 1 ? frames[0] : undefined
  if (!result || typeof result !== 'object') throw new Error(`Missing unambiguous CLI result for ${key}`)
  return saveReceipt(directory, loaded.step, result)
}
/** Adapter entry retained for non-shell setup callers; agent transcripts use explicit bash. */
export async function executePackageStep(directory, key, { spec, executeCommand = execute } = {}) {
  const prepared = await beginPackageStep(directory, key)
  if (!spec) {
    if (!process.env.LAYERFS_CONNECT_CLI || !process.env.LAYERFS_HOME) throw new Error('Set LAYERFS_CONNECT_CLI and LAYERFS_HOME to the pinned CLI and selected home.')
    spec = { cli: process.env.LAYERFS_CONNECT_CLI, daemon: process.env.LAYERFS_CONNECT_DAEMON, home: process.env.LAYERFS_HOME, state: resolve(prepared.directory, '../..') }
  }
  try {
    const result = await executeCommand(spec, prepared.argv, { input: prepared.step.input, events: prepared.argv.includes('--events') })
    return await saveReceipt(prepared.directory, prepared.step, result)
  } catch (error) {
    await journal(prepared.directory, { key, status: 'failed', code: error.code, message: error.message })
    throw error
  }
}
async function main() {
  const [directory, action, key, field] = process.argv.slice(2)
  if (action === 'begin') { await beginPackageStep(directory, key); return }
  if (action === 'finish') { await finishPackageStep(directory, key); return }
  if (action === 'receipt') {
    if (!['head', 'ws'].includes(field)) throw new Error('Invalid receipt field.')
    const receipt = parse(await readFile(location(resolve(directory), key), 'utf8')), value = receipt[field]
    if (typeof value !== 'string' || !value) throw new Error(`Missing confirmed ${field} receipt for ${key}`)
    process.stdout.write(value); return
  }
  if (action === 'failed') {
    await journal(resolve(directory), { key, status: 'failed', exitCode: Number(field), replayAllowed: false }); return
  }
  throw new Error('Usage: script-command.mjs <run-directory> begin|finish|receipt|failed <step-key> [field|exit-code]')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })

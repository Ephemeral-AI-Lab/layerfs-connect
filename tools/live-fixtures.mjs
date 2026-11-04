#!/usr/bin/env node
// Real Stores, projects and Sandboxes for the Live view, on the machines this
// Connect's home already has, through the running app's host
// (<state>/host.json). Every name starts with `live-`; nothing else is touched.
//
//   node tools/live-fixtures.mjs setup      Stores, projects, open Sandboxes (again: only what is missing)
//   node tools/live-fixtures.mjs play [<project>...]
//                                           scenario chats on the projects (shop, conflicts), for Live's lanes
//   node tools/live-fixtures.mjs matrix [<scenario>...]
//                                           shop and conflicts on lima1 and lima2, SQLite and PostgreSQL;
//                                           waits for every verdict, exits 1 on any failure
//   node tools/live-fixtures.mjs status     what of it exists
//   node tools/live-fixtures.mjs teardown   closes, removes and disconnects all of it, and the PostgreSQL container
//
// SQLite: a Store per machine (native, docker, lima1, lima2), each made on
// native, its projects created there, then pushed. PostgreSQL: one Docker
// container (`live-pg`, 127.0.0.1:55442, the local postgres:17 image) with two
// databases, each a Store, whose projects' Sandboxes run in the lima VMs (and
// docker): LayerFS rewrites the loopback host to each machine's alias
// (lima: 192.168.5.2, docker: host.docker.internal), so the server stays off
// the LAN. The password is a file under <state>/secrets (0600), passed as a
// `file:` reference. PostgreSQL Stores need the linked addon built with
// `--features postgresql`.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATE = process.env.LAYERFS_CONNECT_STATE || join(homedir(), '.layerfs-connect')
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/demo-workspace')
const PG = { container: 'live-pg', image: 'postgres:17-bookworm', port: 55442, user: 'live', password: join(STATE, 'secrets', 'live-pg.password') }

/** sandboxes: name -> its Workspaces' Branches (forked from main), on `machine` for a PostgreSQL project. */
const SQLITE = [
  { store: 'live-native', machine: 'native', projects: [{ name: 'site', source: FIXTURE, sandboxes: { 'live-site-1': ['site-nav'] } }] },
  { store: 'live-docker', machine: 'docker', projects: [{ name: 'shop', sandboxes: {} }] },
  {
    store: 'live-lima1',
    machine: 'lima1',
    projects: [
      { name: 'crawler', source: FIXTURE, sandboxes: { 'live-crawler-1': ['onboarding', 'cache-warm', 'docs-pass'], 'live-crawler-2': [] } },
      { name: 'indexer', source: FIXTURE, sandboxes: { 'live-indexer-1': ['reindex', 'schema-v2'] } },
    ],
  },
  {
    store: 'live-lima2',
    machine: 'lima2',
    projects: [
      {
        name: 'box',
        source: FIXTURE,
        sandboxes: { 'live-box-1': ['ui-pass', 'api-pass', 'perf'], 'live-box-2': ['search'], 'live-box-3': ['checkout'], 'live-box-4': [], 'live-box-5': ['docs'], 'live-box-6': ['release'] },
      },
    ],
  },
]
const POSTGRESQL = [
  {
    store: 'live-pg-app',
    database: 'live_app',
    projects: [
      { name: 'app', source: FIXTURE, sandboxes: { 'live-app-lima1': [{ machine: 'lima1' }, 'app-login', 'app-search'], 'live-app-lima2': [{ machine: 'lima2' }, 'app-billing', 'app-audit'], 'live-app-docker': [{ machine: 'docker' }, 'app-ops'] } },
    ],
  },
  { store: 'live-pg-api', database: 'live_api', projects: [{ name: 'api', source: FIXTURE, sandboxes: { 'live-api-lima1': [{ machine: 'lima1' }, 'api-v2'], 'live-api-lima2': [{ machine: 'lima2' }, 'api-auth'] } }] },
]
/** play: scenario chats (the only two that play in a chat on LayerFS 2.0), each project's Store's machine unless named. */
const PLAYS = [
  { scenario: 'conflicts', project: 'live-native/site' },
  { scenario: 'shop', project: 'live-native/site' },
  { scenario: 'conflicts', project: 'live-native/site' },
  { scenario: 'shop', project: 'live-docker/shop' },
  { scenario: 'conflicts', project: 'live-lima2/box' },
  { scenario: 'conflicts', project: 'live-pg-app/app', machine: 'lima1' },
  { scenario: 'conflicts', project: 'live-pg-app/app', machine: 'lima2' },
  { scenario: 'conflicts', project: 'live-pg-api/api', machine: 'lima2' },
]
/** matrix: each scenario that plays in a chat, on a lima machine, with a SQLite Store there and with a PostgreSQL Store. */
const MATRIX_SCENARIOS = ['shop', 'conflicts']
const MATRIX_TARGETS = [
  { project: 'live-lima1/crawler', label: 'lima1 · SQLite' },
  { project: 'live-lima2/box', label: 'lima2 · SQLite' },
  { project: 'live-pg-app/app', machine: 'lima1', label: 'lima1 · PostgreSQL' },
  { project: 'live-pg-api/api', machine: 'lima2', label: 'lima2 · PostgreSQL' },
]
const STORES = [...SQLITE, ...POSTGRESQL]

// ---------- the host ----------

function endpoint() {
  try {
    return JSON.parse(readFileSync(join(STATE, 'host.json'), 'utf8'))
  } catch {
    console.error(`no running Connect host (${join(STATE, 'host.json')}); start the app first`)
    process.exit(2)
  }
}
const host = endpoint()

async function call(method, path, body) {
  const res = await fetch(`${host.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${host.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const answer = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${answer.code ?? res.status} ${answer.message ?? ''}`.trim()), { code: answer.code })
  return answer
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const enc = encodeURIComponent
const say = (...a) => console.log(...a)
const failures = []

async function until(what, read, done, ms = 600_000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await read()
    if (done(v)) return v
    if (Date.now() > end) throw new Error(`${what}: still not done after ${ms / 1000} s`)
    await sleep(1000)
  }
}

// ---------- PostgreSQL ----------

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const containerState = () => {
  try {
    return docker('inspect', '-f', '{{.State.Status}}', PG.container)
  } catch {
    return null
  }
}

async function postgresUp() {
  if (!existsSync(PG.password)) {
    mkdirSync(dirname(PG.password), { recursive: true, mode: 0o700 })
    writeFileSync(PG.password, randomBytes(24).toString('hex'), { mode: 0o600 })
  }
  const state = containerState()
  if (state === null) {
    say(`container ${PG.container}: creating on 127.0.0.1:${PG.port}`)
    docker('run', '-d', '--name', PG.container, '--label', 'layerfs-connect=live-fixtures', '-p', `127.0.0.1:${PG.port}:5432`,
      '-e', `POSTGRES_USER=${PG.user}`, '-e', `POSTGRES_PASSWORD=${readFileSync(PG.password, 'utf8').trim()}`, '-e', 'POSTGRES_DB=postgres', PG.image)
  } else if (state !== 'running') {
    say(`container ${PG.container}: starting (${state})`)
    docker('start', PG.container)
  }
  await until(`container ${PG.container}`, async () => { try { docker('exec', PG.container, 'pg_isready', '-U', PG.user, '-d', 'postgres'); return true } catch { return false } }, Boolean, 60_000)
  const have = docker('exec', PG.container, 'psql', '-U', PG.user, '-d', 'postgres', '-Atc', 'select datname from pg_database').split('\n')
  for (const { database } of POSTGRESQL) {
    if (have.includes(database)) continue
    say(`database ${database}: creating`)
    docker('exec', PG.container, 'createdb', '-U', PG.user, database)
  }
}

// ---------- setup ----------

async function storeJob(path, body, what) {
  const job = await call('POST', path, body)
  const ended = await until(what, () => call('GET', `/api/storage-jobs/${job.id}`), (j) => j.ended)
  if (ended.error) throw new Error(`${what}: ${ended.error.code} ${ended.error.message}`)
}

async function ensureProject(store, p, known) {
  const key = `${store}/${p.name}`
  if (known.has(key)) return
  say(`project ${key}: creating${p.source ? ' from fixtures/demo-workspace' : ' (empty)'}`)
  const job = await call('POST', '/api/projects', { name: p.name, store, ...(p.source ? { source: p.source } : {}) })
  const done = await until(`project ${key}`, () => call('GET', `/api/project-inits/${job.id}`), (j) => j.step === 'done' || j.step === 'failed')
  if (done.step === 'failed') throw new Error(`project ${key}: ${done.error?.code} ${done.error?.message}`)
}

async function ensureSandboxes(key, sandboxes) {
  const open = new Map((await call('GET', `/api/projects/${enc(key)}/sandboxes`)).filter((s) => s.state !== 'gone').map((s) => [s.name ?? s.id, s]))
  for (const [name, list] of Object.entries(sandboxes)) {
    const opts = typeof list[0] === 'object' ? list[0] : {}
    const branches = list.filter((b) => typeof b === 'string')
    if (!open.has(name)) {
      say(`sandbox ${name}: opening for ${key}${opts.machine ? ` on ${opts.machine}` : ''}`)
      try {
        await call('POST', `/api/projects/${enc(key)}/sandboxes`, { name, ...opts })
      } catch (error) {
        // one machine refusing leaves the rest to set up; setup then exits 1
        failures.push(`sandbox ${name}: ${error.message}`)
        say(`  FAILED: ${error.message}`)
        continue
      }
    }
    const mounted = new Set((open.get(name)?.workspaces ?? []).map((w) => w.branch))
    for (const branch of branches) {
      if (mounted.has(branch)) continue
      say(`  workspace ${name}:${branch}`)
      try {
        await call('POST', `/api/sandboxes/${enc(name)}/workspaces`, { branch, fork: true, name: branch })
      } catch (error) {
        // the Branch is there from an earlier setup: mount it as it is
        if (!/Exists|NameTaken/.test(error.code ?? '')) throw error
        await call('POST', `/api/sandboxes/${enc(name)}/workspaces`, { branch, name: branch })
      }
    }
  }
}

async function setup() {
  await postgresUp()
  const view = await call('GET', '/api/storage')
  const stores = new Map(view.stores.map((s) => [s.name, s]))
  const known = new Set((await call('GET', '/api/projects')).map((p) => p.key))
  for (const s of SQLITE) {
    if (!stores.has(s.store)) {
      say(`store ${s.store}: creating (SQLite, on native)`)
      await call('POST', '/api/stores', { name: s.store })
    }
    // projects first, while the Store is on native; then the push (refused while a Sandbox holds it)
    for (const p of s.projects) await ensureProject(s.store, p, known)
    const at = stores.get(s.store)?.machine ?? 'native'
    if (at !== s.machine) {
      if (at !== 'native') throw new Error(`store ${s.store} is on ${at}, not ${s.machine}: move it from Storage`)
      say(`store ${s.store}: pushing to ${s.machine}`)
      await storeJob(`/api/stores/${enc(s.store)}/push`, { machine: s.machine }, `push ${s.store}`)
    }
    for (const p of s.projects) await ensureSandboxes(`${s.store}/${p.name}`, p.sandboxes)
  }
  for (const s of POSTGRESQL) {
    if (!stores.has(s.store)) {
      say(`store ${s.store}: connecting (PostgreSQL, ${s.database})`)
      await call('POST', '/api/stores/postgresql', { name: s.store, url: `postgresql://${PG.user}@127.0.0.1:${PG.port}/${s.database}`, password: `file:${PG.password}`, synchronousCommit: 'off' })
    }
    for (const p of s.projects) {
      await ensureProject(s.store, p, known)
      await ensureSandboxes(`${s.store}/${p.name}`, p.sandboxes)
    }
  }
  await status()
  if (failures.length) throw new Error(`\nsetup left out:\n  ${failures.join('\n  ')}`)
}

// ---------- play, status, teardown ----------

const ours = (key) => typeof key === 'string' && STORES.some((s) => key.startsWith(`${s.store}/`))
const chatKey = (c) => c.project ?? c.scenario?.project ?? null

async function play(only) {
  for (const p of PLAYS.filter((p) => !only.length || only.includes(p.project))) {
    const chat = await call('POST', '/api/agent/sessions', p)
    say(`chat ${chat.id}: ${p.scenario} on ${p.project}${p.machine ? ` (Sandboxes on ${p.machine})` : ''}`)
    // staggered, so the chats overlap without all ending at once
    await sleep(4000)
  }
}

const ENDED = new Set(['passed', 'failed', 'stopped'])

async function matrix(only) {
  const scenarios = only.length ? only : MATRIX_SCENARIOS
  const unknown = scenarios.filter((s) => !MATRIX_SCENARIOS.includes(s))
  if (unknown.length) throw new Error(`matrix plays ${MATRIX_SCENARIOS.join(', ')}, not ${unknown.join(', ')}`)
  const runs = []
  for (const scenario of scenarios) {
    for (const { label, ...target } of MATRIX_TARGETS) {
      const chat = await call('POST', '/api/agent/sessions', { scenario, ...target })
      runs.push({ id: chat.id, scenario, label, project: target.project })
      say(`chat ${chat.id}: ${scenario} on ${target.project} (${label})`)
      await sleep(4000)
    }
  }
  const results = await Promise.all(runs.map(async (r) => {
    const read = async () => (await call('GET', `/api/agent/sessions/${r.id}`)).scenario ?? {}
    const s = await until(`chat ${r.id}`, read, (s) => ENDED.has(s.state), 1_800_000).catch((error) => ({ state: 'timeout', error: error.message }))
    return { ...r, state: s.state, steps: `${s.done ?? '?'}/${s.of ?? '?'}`, error: s.error }
  }))
  say('')
  for (const r of results) {
    say(`${r.state === 'passed' ? 'PASS' : 'FAIL'}  ${r.scenario.padEnd(10)} ${r.label.padEnd(20)} ${r.steps.padEnd(6)} ${r.id}`)
    if (r.state !== 'passed' && r.error) say(`      ${r.error.split('\n').filter(Boolean).join(' | ')}`)
  }
  const failed = results.filter((r) => r.state !== 'passed').length
  if (failed) throw new Error(`\n${failed} of ${results.length} failed`)
  say(`\nall ${results.length} passed`)
}

async function status() {
  const view = await call('GET', '/api/storage')
  const projects = (await call('GET', '/api/projects')).filter((p) => ours(p.key))
  say(`\ncontainer ${PG.container}: ${containerState() ?? 'none'}`)
  for (const s of STORES) {
    const row = view.stores.find((x) => x.name === s.store)
    say(`store ${s.store}: ${row ? `${row.kind}${row.machine ? ` on ${row.machine}` : ''} · ${row.state}` : 'none'}`)
    for (const p of projects.filter((x) => x.store === s.store)) {
      const sandboxes = await call('GET', `/api/projects/${enc(p.key)}/sandboxes`).catch((e) => e)
      if (sandboxes instanceof Error) { say(`  ${p.key}: ${sandboxes.message}`); continue }
      say(`  ${p.key}: ${sandboxes.length} Sandboxes`)
      for (const b of sandboxes) say(`    ${b.name ?? b.id} on ${b.machine ?? '?'} · ${b.state} · ${(b.workspaces ?? []).map((w) => w.branch).join(', ') || 'no Workspace'}`)
    }
  }
  const chats = (await call('GET', '/api/agent/sessions')).filter((c) => ours(chatKey(c)))
  for (const c of chats) say(`chat ${c.id} ${c.state} ${c.scenario ? `${c.scenario.id} ${c.scenario.state} ${c.scenario.done}/${c.scenario.of}` : ''} on ${chatKey(c)}`)
}

async function teardown() {
  for (const c of (await call('GET', '/api/agent/sessions')).filter((c) => ours(chatKey(c)))) {
    say(`chat ${c.id}: deleting`)
    await call('DELETE', `/api/agent/sessions/${c.id}`)
  }
  const projects = (await call('GET', '/api/projects')).filter((p) => ours(p.key))
  for (const p of projects) {
    say(`project ${p.key}: closing its Sandboxes`)
    await call('POST', `/api/projects/${enc(p.key)}/close-sandboxes`, {}).catch(async (error) => {
      say(`  ${error.message}; forcing`)
      await call('POST', `/api/projects/${enc(p.key)}/close-sandboxes`, { force: true })
    })
    say(`project ${p.key}: removing`)
    await call('DELETE', `/api/projects/${enc(p.key)}`)
  }
  const view = await call('GET', '/api/storage')
  for (const s of STORES) {
    const row = view.stores.find((x) => x.name === s.store)
    if (!row) continue
    say(`store ${s.store}: ${row.kind === 'postgresql' ? 'disconnecting' : 'removing'}`)
    if (row.kind === 'postgresql') await call('POST', `/api/stores/${enc(s.store)}/disconnect`)
    else await call('DELETE', `/api/stores/${enc(s.store)}?confirm=${enc(s.store)}`)
  }
  if (containerState() !== null) {
    say(`container ${PG.container}: removing`)
    docker('rm', '-f', '-v', PG.container)
  }
  rmSync(PG.password, { force: true })
}

const commands = { setup, play, matrix, status, teardown }
const command = commands[process.argv[2]]
if (!command) {
  console.error('usage: live-fixtures.mjs setup | play | matrix | status | teardown')
  process.exit(2)
}
try {
  await command(process.argv.slice(3))
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

#!/usr/bin/env node
// Drives the running Connect app's host from a terminal: the same HTTP API
// the app's pages use (host/README.md), found through <state>/host.json.
//
//   node tools/connect-run.mjs start <demo>...    start a run of each demo; prints the run ids
//   node tools/connect-run.mjs status [<run>...]   each run's state (default: every run)
//   node tools/connect-run.mjs wait <run>... [--ms 100000]
//                                                  waits until each run ends or --ms passes
//
// Exit: 0 when every named run passed (start: when every run started), 1
// when one failed or was stopped, 3 when one is still running at the end of
// a wait, 2 on a bad command line or no host. Nothing is retried.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STATE = process.env.LAYERFS_CONNECT_STATE || join(homedir(), '.layerfs-connect')

function endpoint() {
  try {
    return JSON.parse(readFileSync(join(STATE, 'host.json'), 'utf8'))
  } catch {
    console.error(`no running Connect host (${join(STATE, 'host.json')}); start the app first`)
    process.exit(2)
  }
}

async function call(host, method, path) {
  const res = await fetch(`${host.url}${path}`, { method, headers: { authorization: `Bearer ${host.token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path}: ${body.code ?? res.status} ${body.message ?? ''}`.trim())
  return body
}

const line = (r) =>
  `${r.id}  ${r.demo.padEnd(12)} ${r.state.padEnd(8)} ${String(r.done).padStart(4)}/${String(r.of).padEnd(4)} ${r.project}` +
  `${r.ended ? `  ${((r.ended - r.started) / 1000).toFixed(1)} s` : ''}${r.error ? `  — ${r.error}` : ''}`

const ended = (r) => r.state !== 'starting' && r.state !== 'running'

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const at = rest.indexOf('--ms')
  const ms = at < 0 ? 100_000 : Number(rest.splice(at, 2)[1])
  const host = endpoint()
  if (command === 'start' && rest.length) {
    let failed = false
    for (const demo of rest) {
      try {
        console.log(line(await call(host, 'POST', `/api/demos/${encodeURIComponent(demo)}/runs`)))
      } catch (error) {
        console.log(`${demo}: ${error.message}`)
        failed = true
      }
    }
    return failed ? 1 : 0
  }
  if (command === 'status') {
    const runs = rest.length ? await Promise.all(rest.map((id) => call(host, 'GET', `/api/runs/${id}`))) : await call(host, 'GET', '/api/runs')
    for (const r of runs) console.log(line(r))
    return runs.every((r) => r.state === 'passed') ? 0 : runs.some((r) => !ended(r)) ? 3 : 1
  }
  if (command === 'wait' && rest.length) {
    const until = Date.now() + ms
    let runs = []
    for (;;) {
      runs = await Promise.all(rest.map((id) => call(host, 'GET', `/api/runs/${id}`)))
      if (runs.every(ended) || Date.now() >= until) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    for (const r of runs) {
      console.log(line(r))
      for (const c of r.checks ?? []) console.log(`    ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail.split('\n')[0]}`)
    }
    return runs.every((r) => r.state === 'passed') ? 0 : runs.some((r) => !ended(r)) ? 3 : 1
  }
  console.error('usage: connect-run.mjs start <demo>... | status [<run>...] | wait <run>... [--ms N]')
  return 2
}

process.exit(await main())

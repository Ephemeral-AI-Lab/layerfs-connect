import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarizeInvocations, recordedHistory, benchmarkSample } from '../tools/demo/benchmark.mjs'

test('benchmark measures child lifetimes and permits exact adjacent starts without invented overlap', () => {
  const result = summarizeInvocations([
    { family: 'file.write', started: 10, ended: 30 },
    { family: 'file.write', started: 20, ended: 40 },
    { family: 'branch.publish', started: 40, ended: 50 },
    { family: 'branch.fork', started: 50, ended: 50 },
    { family: 'branch.merge', started: 60 },
  ])
  assert.equal(result.count, 4)
  assert.equal(result.peak, 2)
  assert.equal(result.wallMs, 40)
  assert.equal(result.processMs, 50)
  assert.deepEqual(result.concurrencyMs, { 0: 0, 1: 30, 2: 10 })
  assert.equal(result.families['file.write'].count, 2)
})

test('benchmark joins rotated activity segments by invocation identity, excluding reads and other actions', async () => {
  const state = mkdtempSync(join(tmpdir(), 'demo-benchmark-test-')), logs = join(state, 'logs', 'cli')
  mkdirSync(logs, { recursive: true })
  const event = (type, invocationId, data, action = 'setup') => ({ type, invocationId, data, action: { id: action } })
  const save = (file, events) => writeFileSync(join(logs, file), events.map(JSON.stringify).join('\n') + '\n')
  save('activity-10.ndjson', [event('cli.finished', 'write', { ended: 50 }), event('cli.finished', 'read', { ended: 70 })])
  save('activity-2.ndjson', [event('cli.queued', 'write', { argv: ['file', 'write', 'demo-studio/design'] }), event('cli.started', 'write', { started: 10 }), event('cli.queued', 'read', { argv: ['file', 'read', 'demo-studio/design'] }), event('cli.started', 'read', { started: 20 }), event('cli.queued', 'other', { argv: ['branch', 'fork', 'demo-studio/design'] }, 'cleanup')])
  try {
    const result = await recordedHistory(state, 'setup')
    assert.equal(result.count, 1)
    assert.equal(result.queued, 1)
    assert.equal(result.incomplete, 0)
    assert.equal(result.wallMs, 40)
    assert.equal(result.peak, 1)
  } finally { rmSync(state, { recursive: true, force: true }) }
})

test('benchmark refuses an existing arm receipt before any fixture operation', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'demo-benchmark-receipt-test-')), evidence = join(folder, 'arm.json')
  writeFileSync(evidence, '{"preserve":true}\n')
  try {
    await assert.rejects(benchmarkSample({ cli: process.execPath, evidence }), /evidence already exists/)
    assert.equal(readFileSync(evidence, 'utf8'), '{"preserve":true}\n')
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

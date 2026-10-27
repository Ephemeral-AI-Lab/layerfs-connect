// The checks' pure parts: the expected outcomes gate and the run checker
// (run.mjs) on a made-up run folder. No Docker, no project.
//   node --test tools/checks/tests/checks.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { codeOf, expectedOutcomes, matches, openContainers } from '../gates.mjs'
import { checkRun, readRunFolder } from '../run.mjs'

// bash calls in the order they began, though a background call's first line
// may end after a later call's lines; codes are the SDK's method names
const bash = (at, expect) => ({ kind: 'call', call: { name: 'bash', args: { description: at } }, expect, at })
const line = (step, start, method, kind) => ({ step, start: `2026-10-20T09:09:${start}Z`, method, ok: true, kind })
const lines = [
  line('z', '06.000', 'sandbox.create'),
  line('b', '07.245', 'fs.write', 'Committed'),
  line('a', '07.225', 'backend.daemon.process.start', 'running'),
  { ...line('b', '07.349', 'workspace.unmount'), ok: false, code: 'Busy' },
  line('a', '18.408', 'workspace.exec', 'exit:0'),
  line('c', '19.000', 'workspace.commit', 'Committed'),
  line('c', '19.100', 'sandbox.close', 'Closed'),
]

test('expected outcomes: in order of the calls that began', () => {
  const scenario = {
    agents: {
      root: [
        bash('root[0]', ['sandbox.create:ok']),
        bash('root[1]', ['running', 'workspace.exec:exit:0']),
        bash('root[3]', ['fs.write:Committed', 'workspace.unmount:Busy']),
        bash('root[5]', ['workspace.commit:Committed', 'sandbox.close:Closed']),
      ],
    },
  }
  assert.deepEqual(expectedOutcomes(scenario, () => lines).failures, [])
  assert.equal(codeOf(lines[0]), 'sandbox.create:ok')
  assert.equal(codeOf(lines[3]), 'workspace.unmount:Busy')
  // a code of the older SDK matches no line of today's
  assert.equal(expectedOutcomes({ agents: { root: [bash('root[0]', ['sandbox.exec:exit:0'])] } }, () => [lines[4]]).failures.length, 1)
  assert.equal(expectedOutcomes({ agents: { root: [bash('root[1]', ['workspace.exec:exit:1'])] } }, () => [lines[4]]).failures.length, 1)
  // a call still running (ok null on the host's API) is not checked
  assert.deepEqual(expectedOutcomes({ agents: { root: [bash('root[0]', ['sandbox.create:ok'])] } }, () => [{ ...lines[1], ok: null }, lines[0]]).failures, [])
})

test('| alternatives share what precedes the last ":" before the first "|"', () => {
  assert.ok(matches('workspace.exec:exit:0', 'workspace.exec:exit:1|0'))
  assert.ok(matches('workspace.exec:exit:1', 'workspace.exec:exit:1|0'))
  assert.ok(!matches('workspace.exec:exit:2', 'workspace.exec:exit:1|0'))
  assert.ok(matches('workspace.commit:UpToDate', 'workspace.commit:Committed|UpToDate'))
  assert.ok(!matches('fs.write:UpToDate', 'workspace.commit:Committed|UpToDate'))
  assert.ok(matches('workspace.mount:Mounted', 'Mounted') && matches('workspace.exec:exit:0', 'exit:0') && !matches('workspace.exec:exit:10', 'exit:0'))
  const either = (kind) =>
    expectedOutcomes({ agents: { root: [bash('root[0]', ['workspace.exec:exit:1|0', 'workspace.commit:Committed|UpToDate'])] } }, () => [
      line('a', '01.000', 'workspace.exec', 'exit:1'),
      line('a', '02.000', 'workspace.commit', kind),
    ]).failures
  assert.deepEqual(either('UpToDate'), [])
  assert.equal(either('Committed').length, 0)
  assert.equal(either('Merged').length, 1)
})

test('a step without expect may pass over one call; a failed step does not take the next', () => {
  const free = { kind: 'call', call: { name: 'bash', args: { description: 'free' } }, expect: null, at: 'root[1]' }
  const two = [line('p', '01.000', 'fs.write', 'Committed'), line('q', '02.000', 'branch.fork', 'Forked')]
  assert.deepEqual(expectedOutcomes({ agents: { root: [free, bash('root[2]', ['branch.fork:Forked'])] } }, () => two).failures, [])
  assert.match(expectedOutcomes({ agents: { root: [bash('root[2]', ['branch.fork:Forked'])] } }, () => two).failures[0], /root\[2\].*\[fs\.write:Committed\]/)
  const failedFirst = expectedOutcomes({ agents: { root: [bash('root[0]', ['fs.write:UpToDate']), bash('root[1]', ['branch.fork:Forked'])] } }, () => two).failures
  assert.equal(failedFirst.length, 1)
  assert.match(failedFirst[0], /^root\[0\]/)
})

test('run.mjs: a run folder, its agents traces and the scenario it played', () => {
  const home = mkdtempSync(join(tmpdir(), 'lfc-checks-run-'))
  try {
    const scenarios = join(home, 'scenarios')
    const run = join(home, 'runs', 'r1')
    mkdirSync(join(scenarios, 'small'), { recursive: true })
    mkdirSync(join(run, 'traces'), { recursive: true })
    writeFileSync(
      join(scenarios, 'small', 'scenario.json'),
      JSON.stringify({
        type: 'layerfs-scenario',
        version: 3,
        title: 'Small',
        tags: ['cli', 'merge'],
        agents: {
          root: [
            { bash: { description: 'fork', command: 'layerfs branch fork cart' }, expect: ['branch.fork:Forked'] },
            { subagent: { description: 'helper', prompt: 'Help.' } },
            { reply: 'Waiting.', until: ['helper'] },
            { bash: { description: 'log', command: 'layerfs branch list_commits cart' } },
          ],
          helper: [{ bash: { description: 'apply', command: 'layerfs fs apply cart --from "{{scenario}}/changes/000.json"' }, expect: ['fs.apply:Committed|UpToDate'] }],
        },
      }),
    )
    const record = (state, error = null, checks = []) =>
      writeFileSync(join(run, 'run.json'), JSON.stringify({ id: 'r1', demo: 'small', project: 'small-1', state, error, started: 0, ended: 4200, checks }))
    const trace = (agent, rows) => writeFileSync(join(run, 'traces', `${agent}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    record('passed')
    trace('root', [line('root:0', '01.000', 'project.list_branches'), line('root:0', '01.100', 'branch.fork', 'Forked')])
    trace('helper', [line('helper:0', '02.000', 'fs.apply', 'UpToDate')])
    let result = checkRun(readRunFolder(run), scenarios)
    assert.deepEqual([result.scenario, result.project, result.failures], ['small', 'small-1', []])

    // a failed run, a line of an agent the scenario lacks, and a missing outcome fail
    record('failed', 'root: agents.root[0] failed')
    trace('root', [])
    trace('agent-0a1b', [line('s3', '03.000', 'fs.write', 'Committed')])
    result = checkRun(readRunFolder(run), scenarios)
    assert.equal(result.failures.length, 3, result.failures.join('\n'))
    assert.match(result.failures.join('\n'), /run: failed \(root: agents\.root\[0\] failed\)[^]*agent named agent-0a1b[^]*root: no LayerFS calls/)

    // a recorded final.json: the record's final checks are reported, and their absence fails
    rmSync(join(run, 'traces', 'agent-0a1b.jsonl'))
    trace('root', [line('root:0', '01.100', 'branch.fork', 'Forked')])
    writeFileSync(join(scenarios, 'small', 'final.json'), '{}')
    record('passed')
    assert.match(checkRun(readRunFolder(run), scenarios).failures.join('\n'), /holds no final checks/)
    record('passed', null, [{ name: 'final.tree', ok: false, detail: '/a differs' }])
    assert.deepEqual(checkRun(readRunFolder(run), scenarios).failures, ['final.tree: /a differs'])
    assert.throws(() => readRunFolder(join(home, 'nothing')), /not a run folder/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("closed: a stopped Sandbox's container has closed; a running one has not", () => {
  const ps = (out) => (file, args) => {
    assert.deepEqual(args.slice(2, 6), ['ps', '-a', '--filter', 'volume=v'])
    return out
  }
  assert.deepEqual(openContainers('v', '/d.sock', ps('lfc-p-1 exited\nlfc-p-2 created\nold dead\n')), [])
  assert.deepEqual(openContainers('v', '/d.sock', ps('lfc-p-1 exited\nlfc-p-2 running\nlfc-p-3 restarting\n')), ['lfc-p-2 running', 'lfc-p-3 restarting'])
})

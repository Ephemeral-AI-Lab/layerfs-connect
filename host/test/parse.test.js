// The call parser over every step of every scenario, plus hand-checked
// classifications and the shell and JavaScript forms the scenarios use.
// Run: node --test host/test/parse.test.js
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { segments, stepView } from '../parse/index.js'

const SCENARIOS = fileURLToPath(new URL('../../scenarios/', import.meta.url))
const scenarios = readdirSync(SCENARIOS)
  .filter((d) => existsSync(join(SCENARIOS, d, 'scenario.json')))
  .map((d) => [d, JSON.parse(readFileSync(join(SCENARIOS, d, 'scenario.json'), 'utf8'))])

const lineCount = (text) => {
  const lines = text.split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines.length
}

test('all ten scenarios are there', () => {
  assert.equal(scenarios.length, 10)
})

test('every step: lines covered once, in order, text matching', () => {
  let steps = 0
  for (const [name, s] of scenarios) {
    for (const [agent, list] of Object.entries(s.agents)) {
      list.forEach((step, index) => {
        const view = stepView(step, index, agent)
        const where = `${name} ${agent}[${index}]`
        steps++
        assert.ok(view.segments.length > 0, where)
        if (view.tool !== 'bash') return
        const lines = view.text.split('\n')
        let next = 1
        for (const seg of view.segments) {
          assert.equal(seg.lines[0], next, `${where}: segment starts at ${seg.lines[0]}, expected ${next}`)
          assert.ok(seg.lines[1] >= seg.lines[0], where)
          assert.equal(seg.text, lines.slice(seg.lines[0] - 1, seg.lines[1]).join('\n'), where)
          next = seg.lines[1] + 1
        }
        assert.equal(next - 1, lineCount(view.text), `${where}: segments end at ${next - 1}`)
        // neighbours differ
        for (let k = 1; k < view.segments.length; k++) {
          const [a, b] = [view.segments[k - 1], view.segments[k]]
          assert.ok(a.kind !== b.kind || a.form !== b.form || a.call !== b.call, `${where}: segments ${k - 1} and ${k} should be one`)
        }
      })
    }
  }
  assert.ok(steps > 1300, `only ${steps} steps`)
})

test('no bash step that calls LayerFS comes out all local', () => {
  for (const [name, s] of scenarios) {
    for (const [agent, list] of Object.entries(s.agents)) {
      list.forEach((step, index) => {
        if (!step.bash) return
        const { command } = step.bash
        if (!/\blayerfs |\blf\./.test(command)) return
        const view = stepView(step, index, agent)
        assert.ok(view.segments.some((seg) => seg.kind !== 'local'), `${name} ${agent}[${index}] is all local`)
        assert.notEqual(view.kind, 'local', `${name} ${agent}[${index}]`)
      })
    }
  }
})

test('every `layerfs` command and lf./be. call of every step is found', () => {
  // counted independently with a regex over the scripts' lines, against the segments' lines
  for (const [name, s] of scenarios) {
    for (const [agent, list] of Object.entries(s.agents)) {
      list.forEach((step, index) => {
        if (!step.bash) return
        const view = stepView(step, index, agent)
        const lines = view.text.split('\n')
        lines.forEach((line, k) => {
          const m = /^\s*(?:[a-z]+=\$\()?layerfs ([a-z_]+) ([a-z_]+)/.exec(line) ?? /\b(?:lf|be)\.([a-z_]+)\.([a-z_]+)\(/.exec(line)
          if (!m) return
          const seg = view.segments.find((sg) => sg.lines[0] <= k + 1 && k + 1 <= sg.lines[1])
          assert.ok(seg.call, `${name} ${agent}[${index}] line ${k + 1} (${line.trim().slice(0, 60)}) is in a segment with no call`)
        })
      })
    }
  }
})

const step = (name, agent, index) => scenarios.find(([n]) => n === name)[1].agents[agent][index]
const signature = (name, agent, index) => {
  const view = stepView(step(name, agent, index), index, agent)
  return { kind: view.kind, segments: view.segments.map((s) => `${s.lines.join('-')} ${s.form} ${s.call ?? s.kind}${s.detail ? ` «${s.detail}»` : ''}`) }
}

// hand-checked against each script
const EXPECTED = [
  ['tour', 'root', 0, 'branch', ['1-11 sdk branch.fork']],
  ['tour', 'root', 4, 'sandbox', ['1-6 sdk sandbox.create', '7-8 sdk workspace.mount', '9-12 sdk workspace.exec «sh install.sh\nsh build.sh»', '13-14 sdk workspace.commit', '15-15 sdk workspace.unmount', '16-20 sdk sandbox.close']],
  ['tour', 'root', 6, 'sandbox', ['1-8 sdk sandbox.create', '9-9 sdk workspace.mount', '10-11 sdk backend.daemon.process.start «sh serve.sh»', '12-17 sdk workspace.unmount', '18-18 sdk backend.daemon.process.cancel', '19-19 sdk workspace.commit', '20-20 sdk workspace.unmount', '21-25 sdk sandbox.close']],
  ['merge', 'root', 3, 'workspace', ['1-9 sdk workspace.exec «cat app/page.tsx»', '10-19 sdk workspace.commit']],
  ['merge', 'root', 7, 'branch', ['1-11 sdk branch.merge']],
  ['sandbox', 'root', 1, 'sandbox', ['1-8 sdk sandbox.list_workspaces', '9-12 sdk backend.daemon.process.start «timeout 60 sh -c \'exec 9<README.md; touch .build-ready; while [ ! -f .build-release ]; do sleep 0.05; done; sh build.sh --slow\'»', '13-20 sdk backend.daemon.process.list', '21-26 sdk workspace.exec «cat .next/BUILD_ID && ls .next/server/app»']],
  ['sandbox', 'root', 3, 'job', ['1-1 tool job_output «build»']],
  ['sandbox', 'root', 5, 'job', ['1-1 tool job_list']],
  ['agents', 'root', 4, 'subagent', ['1-1 tool subagent «ava»']],
  ['agents', 'root', 90, 'branch', ['1-23 sdk branch.merge']],
  ['agents', 'ava', 1, 'sandbox', ['1-6 sdk sandbox.create', '7-7 sdk workspace.mount', '8-12 sdk workspace.exec «sh install.sh»', '13-15 sdk workspace.commit', '16-16 sdk workspace.unmount', '17-22 sdk sandbox.close']],
  ['agents', 'dee', 21, 'backend', ['1-8 sdk backend.daemon.process.list', '9-9 sdk backend.daemon.process.cancel', '10-10 sdk sandbox.list_workspaces', '11-13 sdk workspace.unmount', '14-18 sdk sandbox.close']],
  ['checkpoints', 'a01', 0, 'branch', ['1-1 cli branch.fork', '2-2 cli fs.mkdir', '3-10 cli fs.write']],
  ['checkpoints', 'root', 3, 'branch', ['1-1 cli branch.merge', '2-2 cli branch.publish']],
  ['parallel', 'root', 2, 'subagent', ['1-1 tool reply «header, footer»']],
  ['parallel', 'root', 4, 'subagent', ['1-1 tool send_message «footer»']],
  ['parallel', 'header', 0, 'branch', ['1-1 cli branch.fork', '2-4 cli fs.write', '5-5 cli sandbox.create', '6-6 cli workspace.mount', '7-7 cli workspace.exec «sh test.sh && ls app»', '8-8 cli workspace.unmount', '9-9 cli sandbox.close', '10-10 cli branch.list_commits']],
  ['parallel', 'header', 1, 'subagent', ['1-1 tool reply «header»']],
  ['conflicts', 'root', 1, 'sandbox', ['1-1 cli sandbox.create', '2-2 cli workspace.mount', '3-3 cli workspace.exec «sed -i \'s/Hello world/Hello from the Workspace/\' app/page.tsx»']],
  ['conflicts', 'root', 3, 'workspace', ['1-1 cli workspace.commit']],
  ['shop', 'root', 0, 'branch', ['1-2 cli branch.fork', '3-3 cli fs.apply']],
  ['depot', 'root', 1, 'sandbox', ['1-8 sdk sandbox.create', '9-9 sdk workspace.mount', '10-10 sdk workspace.exec «CARGO_HOME=$PWD/.cargo-home timeout 110 cargo fetch --locked»', '11-13 sdk workspace.commit', '14-14 sdk workspace.unmount', '15-18 sdk sandbox.close']],
  ['crew', 'people', 0, 'fs', ['1-2 cli fs.apply']],
]

test('hand-checked classifications', () => {
  for (const [name, agent, index, kind, segs] of EXPECTED) {
    const got = signature(name, agent, index)
    assert.deepEqual(got, { kind, segments: segs }, `${name} ${agent}[${index}]`)
  }
})

test('crew: a heredoc read into $cmd becomes the exec detail; the read itself is local', () => {
  const view = stepView(step('crew', 'work-b', 1), 1, 'work-b')
  const sig = view.segments.map((s) => `${s.lines.join('-')} ${s.call ?? s.kind}`)
  assert.deepEqual(sig, ['1-2 sandbox.create', '3-3 workspace.mount', '4-15 local', '16-16 workspace.exec', '17-17 workspace.commit', '18-18 workspace.unmount', '19-19 sandbox.close'])
  assert.match(view.segments[3].detail, /^timeout 110 bash -c 'node --input-type=module/)
})

test('a background bash step is marked and keeps its LayerFS kind', () => {
  const view = stepView(step('sandbox', 'root', 1), 1)
  assert.equal(view.background, true)
  assert.equal(view.job, 'build')
  assert.equal(view.kind, 'sandbox')
})

test('shell forms: continuations, pipes, $( ), blocks, comments, heredocs', () => {
  const cmd = [
    '# make a Branch', // 1
    'layerfs branch \\', // 2
    '  fork a', // 3
    '', // 4
    'for f in x y; do', // 5
    '  layerfs fs write a "/$f" -m "w $f" <<EOF', // 6
    'body $f', // 7
    'EOF', // 8
    'done', // 9
    'echo "$(layerfs fs read a /x)" | wc -c', // 10
    'if ! layerfs branch merge a b c; then', // 11
    '  echo conflict', // 12
    'fi', // 13
    'jq -n 1 # a local line', // 14
    "printf '%s\\n' 'layerfs fs write is quoted here'", // 15
  ].join('\n')
  const sig = segments(cmd).map((s) => `${s.lines.join('-')} ${s.form} ${s.call ?? s.kind}`)
  assert.deepEqual(sig, ['1-4 cli branch.fork', '5-9 cli fs.write', '10-10 cli fs.read', '11-13 cli branch.merge', '14-15 shell local'])
})

test('SDK forms: other client names, family aliases, backend and init', () => {
  const cmd = [
    "node --input-type=module <<'JS'", // 1
    'const { LayerFS } = await import("@layerfs/agent")', // 2
    'const { LayerFSBackend } = await import("@layerfs/backend")', // 3
    'const shop = await LayerFS.open(process.env.LAYERFS_PROJECT)', // 4
    'const { fs, workspace: w } = shop', // 5
    'const backend = LayerFSBackend.of(shop)', // 6
    'try {', // 7
    '  // write it', // 8
    '  await fs.write("main", "/a", "x", "m")', // 9
    '  const text = `${(await shop.fs.read("main", "/a")).content}`', // 10
    '  console.log(text)', // 11
    '', // 12
    '  const cmd = "make"', // 13
    '  await w.exec({ sandbox: "1", path: "/w/1" }, cmd)', // 14
    '  console.log((await backend.store.project.get_history()).items.length)', // 15
    '  await LayerFS.init("p", "/tmp/x")', // 16
    '} finally {', // 17
    '  await shop.close()', // 18
    '}', // 19
    'JS', // 20
  ].join('\n')
  const sig = segments(cmd).map((s) => `${s.lines.join('-')} ${s.form} ${s.call ?? s.kind}${s.detail ? ` «${s.detail}»` : ''}`)
  assert.deepEqual(sig, ['1-9 sdk fs.write', '10-12 sdk fs.read', '13-14 sdk workspace.exec «make»', '15-15 sdk backend.store.project.get_history', '16-20 sdk project.init'])
})

test('a node script with no LayerFS call is one local segment; plain shell is local', () => {
  assert.deepEqual(segments("node --input-type=module <<'JS'\nconsole.log(1)\nJS").map((s) => `${s.lines} ${s.form} ${s.kind}`), ['1,3 sdk local'])
  assert.deepEqual(segments('ls\n\necho hi').map((s) => `${s.lines} ${s.form} ${s.kind}`), ['1,3 shell local'])
  assert.deepEqual(segments('').map((s) => s.lines), [[1, 1]])
})

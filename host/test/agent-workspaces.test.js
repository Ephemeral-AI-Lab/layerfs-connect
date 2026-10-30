import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentWorkspaces } from '../agents/workspaces.js'

// A substitute SDK: no Docker, user project, local working directory or credential is touched.
function fixture(specs = [{}]) {
  const calls = []
  const branches = new Set(['main'])
  const branchHeads = new Map()
  const baseLayer = `32${'a'.repeat(62)}`
  const mounts = new Map()
  const runs = []
  const controls = { cancel: 'stopped', commit: 'Committed', commitError: null, startError: null, unmountError: null, closeError: null, status: null, instructions: '' }
  let sandbox = 0, mountId = 0, commits = 0
  const layerfs = {
    project: { list_branches: async () => ({ items: [...branches].map((name) => ({ name })), hasMore: false }) },
    branch: { fork: async (name, from) => {
      calls.push(['fork', name, from]); branches.add(name)
      const head = from === 'main' || from.startsWith('32') ? null : from
      branchHeads.set(name, head)
      return { kind: 'Forked', branch: name, base: baseLayer, head }
    } },
    sandbox: {
      create: async () => { calls.push(['create']); return { sandbox: String(++sandbox) } },
      list_workspaces: async (id) => ({ items: [...mounts.values()].filter((item) => item.sandbox === id) }),
      close: async (id) => { calls.push(['closeSandbox', id]); if (controls.closeError) throw controls.closeError },
    },
    workspace: {
      mount: async (id, branch) => {
        const item = { sandbox: id, path: `/workspaces/${++mountId}`, workspace: `unique-${mountId}`, branch, base: branchHeads.get(branch) ?? null }
        mounts.set(item.path, item)
        calls.push(['mount', id, branch])
        return item
      },
      exec: async (ws, command) => {
        calls.push(['control', ws.path, command])
        if (command.startsWith('for file in ')) return { exitCode: 0, stdout: controls.instructions, stderr: '' }
        if (command.startsWith('set -o pipefail; dd ')) {
          const run = runs.find((item) => command.includes(item.directory))
          assert.ok(run)
          const offset = Number(command.match(/skip=(\d+)/)[1])
          const output = run.output.subarray(offset, offset + 65536)
          return { exitCode: 0, stdout: `${output.toString('base64')}\n${run.waiting ? '' : `${run.exitCode}\n`}`, stderr: '' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      commit: async (ws, message) => {
        calls.push(['commit', ws.path, message])
        if (controls.commitError) throw controls.commitError
        return { kind: controls.commit, head: controls.commit === 'Committed' ? `commit-${++commits}` : 'unchanged' }
      },
      unmount: async (ws) => {
        calls.push(['unmount', ws.path])
        if (controls.unmountError) throw controls.unmountError
        mounts.delete(ws.path)
        return { kind: 'Unmounted' }
      },
    },
    close: async () => { calls.push(['closeClient']) },
  }
  const backend = { daemon: { workspace: {
    status: async (ws) => {
      calls.push(['status', ws.path])
      return controls.status ?? { kind: 'ok', base: ws.head, baseLayer, branch: ws.branch, branchHead: ws.head, activity: 'Idle' }
    },
  }, process: {
    start: async (ws, command) => {
      const spec = specs[runs.length] ?? {}
      const run = {
        id: `proc_${ws.sandbox}_${runs.length + 1}`, path: ws.path, command,
        directory: command.match(/\/tmp\/connect-command-[a-f0-9-]+/)[0],
        output: Buffer.from(spec.output ?? 'hello\n'), exitCode: spec.exitCode ?? 0, waiting: spec.waiting ?? false,
      }
      runs.push(run)
      calls.push(['start', run.id, command])
      if (controls.startError) throw controls.startError
      return { process: run.id }
    },
    list: async () => ({ items: runs }),
    cancel: async (id) => { calls.push(['cancel', id]); return { kind: 'Stopped', status: controls.cancel } },
  } } }
  const projects = { open: async (name) => { calls.push(['open', name]); return { layerfs, backend } } }
  const adapter = new AgentWorkspaces({ projects })
  const record = { id: 'conversation-a', project: 'real-project', cwd: '/original/local/folder', workspace: adapter.initial('conversation-a') }
  const changes = []
  const onChange = () => changes.push(structuredClone(record.workspace))
  return { adapter, record, calls, controls, mounts, branches, runs, projects, changes, onChange, backend, baseLayer }
}

test('creates one session branch and mount; restored handles require the same unique workspace', async () => {
  const f = fixture()
  await Promise.all([f.adapter.prepare(f.record, f.onChange), f.adapter.prepare(f.record, f.onChange)])
  assert.deepEqual(f.calls.filter(([op]) => op === 'fork'), [['fork', 'chat-conversation-a', 'main']])
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 1)
  assert.equal(f.record.workspace.state, 'ready')
  assert.equal(f.record.workspace.workspaceId, 'unique-1')
  f.mounts.get(f.record.workspace.path).base = 'saved-before-restart'
  const restored = new AgentWorkspaces({ projects: f.projects })
  await restored.prepare(f.record)
  assert.equal(f.record.workspace.head, 'saved-before-restart')
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 1)
  f.mounts.get(f.record.workspace.path).workspace = 'another-incarnation'
  await assert.rejects(restored.prepare(f.record), /no longer available/)
  assert.equal(f.record.workspace.state, 'error')
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 1)
})

test('context reads only the actual mount root and does not commit or run through the command process', async () => {
  const f = fixture()
  f.controls.instructions = `AGENTS.md\n${Buffer.from('follow workspace instructions 你好').toString('base64')}`
  const instructions = await f.adapter.context(f.record)
  assert.deepEqual(instructions, [{ path: '/workspaces/1/AGENTS.md', content: 'follow workspace instructions 你好' }])
  const command = f.calls.find(([operation]) => operation === 'control')
  assert.equal(command[1], '/workspaces/1')
  assert.doesNotMatch(command[2], /original\/local\/folder/)
  assert.equal(f.calls.some(([operation]) => operation === 'commit' || operation === 'start'), false)
  f.controls.instructions = ''
  assert.deepEqual(await f.adapter.context(f.record), [])
})

test('bash output stays byte-exact across pages, awaits consumers, and nonzero exits still save', async () => {
  const output = Buffer.from('雪'.repeat(50000))
  const f = fixture([{ output, exitCode: 7 }])
  const chunks = []
  let consumed = false
  const result = await f.adapter.exec(f.record, { command: "printf '%s' \"a'b\"; exit 7", agent: 'worker', toolCallId: 'call-1' }, {
    onChange: f.onChange,
    onData: async (bytes) => { assert.ok(Buffer.isBuffer(bytes)); await Promise.resolve(); chunks.push(bytes); consumed = true },
  })
  assert.deepEqual(result, { exitCode: 7 })
  assert.equal(consumed, true)
  assert.deepEqual(Buffer.concat(chunks), output)
  const ops = f.calls.map(([op]) => op)
  assert.ok(ops.indexOf('cancel') < ops.indexOf('commit'))
  assert.equal(f.record.workspace.process, null)
  assert.equal(f.record.workspace.commitCount, 1)
  assert.equal(f.record.workspace.head, 'commit-1')
  assert.equal(typeof f.record.workspace.lastSaved, 'number')
  assert.ok(f.calls.filter(([op]) => op === 'control').every(([, path]) => path === '/workspaces/1'))
  assert.ok(!f.runs[0].command.includes(f.record.cwd))
  assert.match(f.runs[0].command, /while \[ ! -f .*\/go/)
  assert.match(f.runs[0].command, /while :; do sleep 3600; done/)
})

test('unchanged commands do not invent commits or update the last saved time', async () => {
  const f = fixture()
  f.controls.commit = 'UpToDate'
  await f.adapter.exec(f.record, { command: 'ls' })
  assert.equal(f.record.workspace.commitCount, 0)
  assert.equal(f.record.workspace.lastSaved, null)
  assert.equal(f.record.workspace.head, 'unchanged')
})

test('root and child bash calls serialize execution and save boundaries in one session', async () => {
  const f = fixture()
  await Promise.all([
    f.adapter.exec(f.record, { command: 'root', agent: 'root' }),
    f.adapter.exec(f.record, { command: 'child', agent: 'child' }),
  ])
  const ops = f.calls.filter(([op]) => ['start', 'cancel', 'commit'].includes(op)).map(([op]) => op)
  assert.deepEqual(ops, ['start', 'cancel', 'commit', 'start', 'cancel', 'commit'])
  assert.equal(f.record.workspace.commitCount, 2)
})

test('abort cancels the actual process before committing interrupted changes', async () => {
  const f = fixture([{ waiting: true }])
  const controller = new AbortController()
  await assert.rejects(f.adapter.exec(f.record, { command: 'sleep 60' }, {
    signal: controller.signal,
    onData: () => controller.abort(),
  }), { name: 'AbortError' })
  const ops = f.calls.map(([op]) => op)
  assert.ok(ops.indexOf('cancel') < ops.indexOf('commit'))
  assert.equal(f.record.workspace.process, null)
  assert.equal(f.record.workspace.state, 'ready')
})

test('timeout is explicit and also stops the process before saving', async () => {
  const f = fixture([{ waiting: true, output: '' }])
  await assert.rejects(f.adapter.exec(f.record, { command: 'sleep 60', timeout: 0.01 }), /timed out/)
  assert.equal(f.calls.filter(([op]) => op === 'cancel').length, 1)
  assert.equal(f.calls.filter(([op]) => op === 'commit').length, 1)
})

test('unconfirmed stop retains ownership and overlay; a subsequent release can retry the stop', async () => {
  const f = fixture()
  f.controls.cancel = 'stopping'
  await assert.rejects(f.adapter.exec(f.record, { command: 'work' }), /not stopped/)
  assert.ok(f.record.workspace.process.id)
  assert.equal(f.calls.filter(([op]) => op === 'commit').length, 0)
  assert.equal(f.calls.filter(([op]) => op === 'unmount').length, 0)
  f.controls.cancel = 'stopped'
  await f.adapter.release(f.record)
  assert.equal(f.record.workspace.state, 'closed')
  assert.equal(f.record.workspace.path, null)
  assert.equal(f.record.workspace.sandbox, null)
  assert.ok(f.branches.has('chat-conversation-a'))
})

test('commit failure retains the mount and never force-unmounts or falls back locally', async () => {
  const f = fixture()
  f.controls.commitError = Object.assign(new Error('conflicting changes'), { code: 'Conflict' })
  await assert.rejects(f.adapter.exec(f.record, { command: 'edit file' }), /conflicting changes/)
  assert.equal(f.record.workspace.state, 'error')
  assert.equal(f.record.workspace.process, null)
  assert.equal(f.record.workspace.path, '/workspaces/1')
  assert.equal(f.calls.filter(([op]) => op === 'unmount').length, 0)
})

test('an uncertain start keeps its locator; recovery finds and stops that exact registered command', async () => {
  const f = fixture()
  f.controls.startError = new Error('reply lost')
  await assert.rejects(f.adapter.exec(f.record, { command: 'work' }), /reply lost/)
  assert.equal(f.record.workspace.process.id, null)
  assert.ok(f.record.workspace.process.directory)
  f.controls.startError = null
  const restored = new AgentWorkspaces({ projects: f.projects })
  await restored.prepare(f.record)
  assert.equal(f.record.workspace.process, null)
  assert.equal(f.calls.filter(([op]) => op === 'start').length, 1)
  assert.equal(f.calls.filter(([op]) => op === 'cancel').length, 1)
})

test('releasing a pending workspace creates nothing; a closed workspace can resume its branch', async () => {
  const f = fixture()
  await f.adapter.release(f.record)
  assert.equal(f.calls.length, 0)
  assert.equal(f.record.workspace.state, 'closed')
  await f.adapter.prepare(f.record)
  await f.adapter.release(f.record)
  assert.deepEqual(f.calls.slice(-3).map(([op]) => op), ['unmount', 'closeSandbox', 'closeClient'])
  await f.adapter.prepare(f.record)
  assert.equal(f.calls.filter(([op]) => op === 'fork').length, 1)
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 2)
})

test('release retries an unmount refusal without clearing custody or closing its sandbox', async () => {
  const f = fixture()
  await f.adapter.prepare(f.record)
  f.controls.unmountError = Object.assign(new Error('mount still in use'), { code: 'Busy' })
  await assert.rejects(f.adapter.release(f.record), /mount still in use/)
  assert.equal(f.record.workspace.path, '/workspaces/1')
  assert.equal(f.record.workspace.workspaceId, 'unique-1')
  assert.equal(f.calls.filter(([op]) => op === 'closeSandbox').length, 0)
  f.controls.unmountError = null
  await f.adapter.release(f.record)
  assert.equal(f.record.workspace.state, 'closed')
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 1)
})

test('a failed sandbox close never remounts an already released workspace on retry', async () => {
  const f = fixture()
  await f.adapter.prepare(f.record)
  f.controls.closeError = new Error('Docker unavailable')
  await assert.rejects(f.adapter.release(f.record), /Docker unavailable/)
  assert.equal(f.record.workspace.path, null)
  assert.equal(f.record.workspace.workspaceId, null)
  assert.equal(f.record.workspace.sandbox, '1')
  f.controls.closeError = null
  await new AgentWorkspaces({ projects: f.projects }).release(f.record)
  assert.equal(f.record.workspace.state, 'closed')
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 1)
  assert.equal(f.calls.filter(([op]) => op === 'unmount').length, 1)
})

test('release accepts an idle sandbox that disappeared after its workspace was unmounted', async () => {
  const f = fixture()
  await f.adapter.prepare(f.record)
  f.controls.closeError = new Error('Docker unavailable')
  await assert.rejects(f.adapter.release(f.record), /Docker unavailable/)
  f.controls.closeError = Object.assign(new Error('idle sandbox is gone'), { code: 'NoSuchSandbox' })
  await new AgentWorkspaces({ projects: f.projects }).release(f.record)
  assert.equal(f.record.workspace.state, 'closed')
  assert.equal(f.record.workspace.sandbox, null)
  assert.equal(f.calls.filter(([op]) => op === 'mount').length, 1)
})

test('a disconnected output consumer during final draining does not skip saving stopped changes', async () => {
  const f = fixture([{ output: 'x'.repeat(100000) }])
  let pages = 0
  await assert.rejects(f.adapter.exec(f.record, { command: 'print and edit' }, {
    onData: async () => { if (++pages === 2) throw new Error('client disconnected') },
  }), /client disconnected/)
  assert.equal(f.record.workspace.process, null)
  assert.equal(f.record.workspace.head, 'commit-1')
  assert.equal(f.record.workspace.commitCount, 1)
})

test('uncertain start recovery reads subsequent SDK process pages', async () => {
  const f = fixture()
  f.controls.startError = new Error('reply lost')
  await assert.rejects(f.adapter.exec(f.record, { command: 'work' }), /reply lost/)
  const pages = []
  f.backend.daemon.process.list = async (size, page) => {
    pages.push(page)
    return page === 0
      ? { items: Array.from({ length: 1000 }, (_, index) => ({ id: `old-${index}`, path: '/workspaces/other', command: 'old' })), hasMore: true, nextPagePos: 1000 }
      : { items: f.runs, hasMore: false, nextPagePos: null }
  }
  f.controls.startError = null
  await new AgentWorkspaces({ projects: f.projects }).prepare(f.record)
  assert.deepEqual(pages, [0, 1000])
  assert.equal(f.record.workspace.process, null)
})

test('a checkpoint uses the mounted Commit, not a newer Branch head', async () => {
  const f = fixture()
  const commit = `12${'b'.repeat(62)}`
  f.controls.status = { kind: 'ok', base: commit, baseLayer: f.baseLayer, branchHead: 'different-later-commit' }
  const checkpoint = await f.adapter.checkpoint(f.record, f.onChange)
  assert.deepEqual(checkpoint, { project: 'real-project', branch: 'chat-conversation-a', ref: commit, head: commit, baseLayer: f.baseLayer })
  assert.equal(f.record.workspace.head, commit)
  assert.equal(f.record.workspace.baseLayer, f.baseLayer)
  const ops = f.calls.map(([op]) => op)
  assert.ok(ops.indexOf('commit') < ops.indexOf('status'))
})

test('the initial checkpoint pins the immutable Layer even when no Commit exists', async () => {
  const f = fixture()
  f.controls.commit = 'UpToDate'
  f.controls.status = { kind: 'ok', base: null, baseLayer: f.baseLayer, branchHead: null }
  const checkpoint = await f.adapter.checkpoint(f.record)
  assert.equal(checkpoint.head, null)
  assert.equal(checkpoint.ref, f.baseLayer)
  assert.notEqual(checkpoint.ref, 'main')
  const target = { id: 'copied-chat', project: f.record.project, workspace: f.adapter.initial('copied-chat') }
  const copied = await f.adapter.fork(target, checkpoint)
  assert.equal(copied.branch, 'chat-copied-chat')
  assert.equal(copied.head, null)
  assert.equal(copied.state, 'ready')
  assert.notEqual(copied.sandbox, f.record.workspace.sandbox)
  assert.notEqual(copied.workspaceId, f.record.workspace.workspaceId)
  assert.deepEqual(f.calls.filter(([op]) => op === 'fork').at(-1), ['fork', 'chat-copied-chat', f.baseLayer])
  assert.equal(f.record.workspace.state, 'ready')
})

test('restore closes the prior mount and forks a revision without erasing either timeline', async () => {
  const f = fixture()
  const checkpoint = await f.adapter.checkpoint(f.record)
  const oldBranch = f.record.workspace.branch
  const oldPath = f.record.workspace.path
  const restored = await f.adapter.restore(f.record, checkpoint, f.onChange)
  assert.match(restored.branch, /^chat-conversation-a-r-[a-f0-9]{8}$/)
  assert.equal(restored.fromRef, checkpoint.ref)
  assert.equal(restored.head, checkpoint.head)
  assert.equal(restored.commitCount, 0)
  assert.equal(restored.state, 'ready')
  assert.ok(f.branches.has(oldBranch))
  assert.ok(f.branches.has(restored.branch))
  assert.equal(f.mounts.has(oldPath), false)
  assert.equal(f.mounts.has(restored.path), true)
  const lastFork = f.calls.findIndex(([op, name]) => op === 'fork' && name === restored.branch)
  assert.ok(f.calls.findIndex(([op]) => op === 'closeSandbox') < lastFork)
  assert.deepEqual(f.calls[lastFork], ['fork', restored.branch, checkpoint.ref])
})

test('a failed old unmount prevents restore from switching branches', async () => {
  const f = fixture()
  const checkpoint = await f.adapter.checkpoint(f.record)
  const old = f.record.workspace
  f.controls.unmountError = Object.assign(new Error('workspace is busy'), { code: 'Busy' })
  await assert.rejects(f.adapter.restore(f.record, checkpoint), /workspace is busy/)
  assert.equal(f.record.workspace, old)
  assert.equal(f.record.workspace.path, '/workspaces/1')
  assert.equal(f.calls.filter(([op]) => op === 'fork').length, 1)
})

test('a copy forks from the exact saved Commit and cannot replace an existing workspace', async () => {
  const f = fixture()
  const checkpoint = await f.adapter.checkpoint(f.record)
  const target = { id: 'new-copy', project: f.record.project, workspace: f.adapter.initial('new-copy') }
  await f.adapter.fork(target, checkpoint)
  assert.deepEqual(f.calls.filter(([op]) => op === 'fork').at(-1), ['fork', 'chat-new-copy', checkpoint.head])
  await assert.rejects(f.adapter.fork(target, checkpoint), /new conversation/)
  assert.equal(f.calls.filter(([op]) => op === 'fork').length, 2)
})

test('invalid or cross-project checkpoints refuse before releasing the current workspace', async () => {
  const f = fixture()
  const checkpoint = await f.adapter.checkpoint(f.record)
  const old = f.record.workspace
  assert.throws(() => f.adapter.restore(f.record, { ...checkpoint, project: 'other-project' }), /different LayerFS project/)
  assert.throws(() => f.adapter.restore(f.record, { ...checkpoint, ref: 'main', head: 'main' }), /immutable/)
  assert.equal(f.record.workspace, old)
  assert.equal(f.calls.filter(([op]) => op === 'unmount').length, 0)
})

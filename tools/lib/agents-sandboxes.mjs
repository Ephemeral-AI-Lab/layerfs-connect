// Connect's one change to the ported "5 agents" scenario: two Sandboxes for
// the whole session instead of one per command. dsh-layerfs's script has each
// subagent command create a Sandbox, mount, run, commit, unmount and close it,
// so a Sandbox lives about a second and Live shows none most of the time.
// Here the lead opens Sandbox 1 (checkout: Ava, Ben, Cy) and Sandbox 2
// (search: Dee, Eli) after forking, every command mounts a Workspace of its
// own in its Branch's Sandbox and unmounts it, the lead's release build uses
// Sandbox 1, and the lead closes both at the end.
//
// A fresh project's Sandboxes take the lowest free numbers, and every session
// starts from a fresh project, so the lead's two creates are 1 and 2; its
// step checks that. In a shared Sandbox an agent finds a Workspace it keeps
// mounted by its own path ({{ws}}), not as the Sandbox's only Workspace.
//
// Each rewrite must match the dsh text exactly; one that no longer matches
// stops the port, so a changed upstream script is looked at, not half-moved.

/** The Sandbox each Branch's team works in. */
export const SANDBOX_OF = { checkout: '1', search: '2' }

const CREATE = '  const { sandbox } = await lf.sandbox.create();\n'
const CLOSE = '    await lf.sandbox.close(sandbox);\n'
const OWN = 'in a Sandbox and Workspace of my own, then commit, unmount and close'
const LIST = '  const [{ sandbox, path }] = (await lf.sandbox.list_workspaces("{{sandbox}}")).items;\n'
const KEPT = '  // the Workspace I kept open, as I printed it when I mounted it\n  const [sandbox, path] = "{{ws}}".split(/:(.*)/);\n'

const script = (comment, body) =>
  `# ${comment}\nnode --input-type=module <<'JS'\nconst { LayerFS } = await import("@layerfs/agent");\nconst lf = await LayerFS.open(process.env.LAYERFS_PROJECT);\ntry {\n${body}} finally {\n  await lf.close();\n}\nJS`

const OPEN_STEP = {
  bash: {
    description: 'open Sandbox 1 (checkout) and Sandbox 2 (search)',
    command: script(
      'Open the two Sandboxes the team keeps all session: 1 for checkout, 2 for search',
      [
        '  for (const [want, branch] of [["1", "checkout"], ["2", "search"]]) {\n',
        '    const { sandbox } = await lf.sandbox.create();\n',
        '    // a fresh project numbers its Sandboxes from 1; the subagents\' prompts name these two\n',
        '    if (String(sandbox) !== want) throw new Error(`expected Sandbox ${want} for ${branch}, got ${sandbox}`);\n',
        '    console.log(`Sandbox ${sandbox} for ${branch}`);\n',
        '  }\n',
      ].join(''),
    ),
  },
  expect: ['sandbox.create:ok', 'sandbox.create:ok'],
}

const CLOSE_STEP = {
  bash: {
    description: 'close Sandbox 1 and Sandbox 2',
    command: script(
      'Close the two Sandboxes now the work is done',
      '  for (const sandbox of ["1", "2"]) console.log(`Sandbox ${sandbox}`, (await lf.sandbox.close(sandbox)).kind);\n',
    ),
  },
  expect: ['sandbox.close:Closed', 'sandbox.close:Closed'],
}

/** `text` with `from` replaced by `to` exactly `times` times (default once); throws otherwise. */
function swap(text, from, to, where, times = 1) {
  const n = text.split(from).length - 1
  if (n !== times) throw new Error(`agents ${where}: expected ${times} of ${JSON.stringify(from.slice(0, 60))}, found ${n}`)
  return text.replaceAll(from, to)
}

const dropCodes = (expect) => expect?.filter((c) => c !== 'sandbox.create:ok' && c !== 'sandbox.close:Closed')

/**
 * The ported "5 agents" scenario (parsed) with two session-long Sandboxes.
 * Counts each change in `counts`, as the port's rewrite rules do.
 */
export function shareSandboxes(scenario, counts = {}) {
  const bump = (rule) => (counts[rule] = (counts[rule] ?? 0) + 1)
  const out = structuredClone(scenario)
  out.blurb = swap(
    out.blurb,
    'Every command runs in a Sandbox and Workspace of its own and commits:',
    'Every command runs in a Workspace of its own, in the Sandbox the lead keeps open for its Branch, and commits:',
    'blurb',
  )
  bump('agents: blurb names the two Sandboxes')

  // which Branch (so which Sandbox) each subagent works on, from its prompt
  const branchOf = {}
  for (const step of out.agents.root) {
    if (!step.subagent) continue
    const m = step.subagent.prompt.match(/^(You are \w+, on the (checkout|search) Branch)\./)
    if (!m) throw new Error(`agents root: subagent ${step.subagent.description} names no Branch`)
    branchOf[step.subagent.description] = m[2]
    step.subagent.prompt = step.subagent.prompt.replace(m[0], `${m[1]}, in Sandbox ${SANDBOX_OF[m[2]]}, which the lead keeps open for ${m[2]}.`)
    bump('agents: a subagent prompt names its Sandbox')
  }

  // the lead: open both after forking, build release in Sandbox 1, close both before its last reply
  const root = out.agents.root
  const after = root.findIndex((s) => s.bash?.command.startsWith('# Write /.lww on search'))
  if (after < 0) throw new Error('agents root: no "Write /.lww on search" step to open the Sandboxes after')
  root.splice(after + 1, 0, OPEN_STEP)
  bump('agents: lead opens Sandbox 1 and 2')
  const build = root.find((s) => s.bash?.command.startsWith('# Build and test release'))
  if (!build) throw new Error('agents root: no release build step')
  let c = build.bash.command
  c = swap(c, '# Build and test release in a Sandbox and Workspace of my own, then commit, unmount and close', '# Build and test release in a Workspace of my own in Sandbox 1, then commit and unmount', 'release build')
  c = swap(c, `${CREATE}  const ws = await lf.workspace.mount(sandbox, "release");\n`, '  const ws = await lf.workspace.mount("1", "release");\n', 'release build')
  c = swap(c, CLOSE, '', 'release build')
  build.bash.command = c
  build.expect = dropCodes(build.expect)
  bump('agents: lead builds release in Sandbox 1')
  if (!root.at(-1).reply) throw new Error('agents root: does not end in a reply')
  root.splice(root.length - 1, 0, CLOSE_STEP)
  bump('agents: lead closes Sandbox 1 and 2')

  // the subagents: mount in their Branch's Sandbox, never create or close one
  for (const [name, steps] of Object.entries(out.agents)) {
    if (name === 'root') continue
    const sandbox = SANDBOX_OF[branchOf[name]]
    for (const [i, step] of steps.entries()) {
      if (!step.bash) continue
      const where = `${name}[${i}]`
      let cmd = step.bash.command
      if (cmd.includes(OWN)) {
        cmd = swap(cmd, OWN, `in a Workspace of my own in Sandbox ${sandbox}, then commit and unmount`, where)
        cmd = swap(cmd, CREATE, `  const sandbox = "${sandbox}"; // the Sandbox the lead keeps open for ${branchOf[name]}\n`, where)
        cmd = swap(cmd, CLOSE, '', where)
        bump('agents: a command mounts in its Branch\'s Sandbox')
      } else if (cmd.startsWith('# Cy: edit the build line')) {
        cmd = swap(cmd, '# Cy: edit the build line in a Workspace I keep open, in a Sandbox of its own', `# Cy: edit the build line in a Workspace I keep open in Sandbox ${sandbox}`, where)
        cmd = swap(cmd, CREATE, `  const sandbox = "${sandbox}"; // the Sandbox the lead keeps open for ${branchOf[name]}\n`, where)
        cmd = swap(cmd, 'console.log(JSON.stringify({ sandbox: ws.sandbox, path: ws.path }));', 'console.log(JSON.stringify({ ws: `${ws.sandbox}:${ws.path}` }));', where)
        bump('agents: Cy keeps a Workspace open in Sandbox 1')
      } else if (cmd.startsWith('# Cy: ') && cmd.includes(LIST)) {
        cmd = swap(cmd, LIST, KEPT, where)
        if (cmd.startsWith('# Cy: keep --profile')) {
          cmd = swap(cmd, '# Cy: keep --profile, commit, unmount, and close the Sandbox I kept for it', '# Cy: keep --profile, commit and unmount the Workspace I kept open', where)
          cmd = swap(cmd, '  console.log((await lf.sandbox.close(sandbox)).kind);\n', '', where)
        }
        bump('agents: Cy finds its kept Workspace by its path')
      } else if (cmd.startsWith('# Dee: start the server')) {
        cmd = swap(cmd, '# Dee: start the server in the background, in a Workspace and Sandbox that stay up until I stop it', `# Dee: start the server in the background, in a Workspace of Sandbox ${sandbox} that stays mounted until I stop it`, where)
        cmd = swap(cmd, CREATE, `  const sandbox = "${sandbox}"; // the Sandbox the lead keeps open for ${branchOf[name]}\n`, where)
        cmd = swap(cmd, '{ sandbox: ws.sandbox, path: ws.path, process: p.process, kind: p.kind }', '{ sandbox: ws.sandbox, ws: `${ws.sandbox}:${ws.path}`, process: p.process, kind: p.kind }', where)
        bump('agents: Dee serves from Sandbox 2')
      } else if (cmd.startsWith('# Dee: stop the server')) {
        cmd = swap(cmd, '# Dee: stop the server, unmount its Workspace (dropping its dev cache) and close its Sandbox', "# Dee: stop the server and unmount its Workspace (dropping its dev cache); Eli's Workspaces in the Sandbox stay", where)
        cmd = swap(
          cmd,
          '  for (const w of (await lf.sandbox.list_workspaces("{{sandbox}}")).items) {\n    await lf.workspace.unmount({ sandbox: w.sandbox, path: w.path }, true);\n    console.log(`unmounted ${w.path}; its uncommitted dev cache discarded`);\n  }\n  console.log((await lf.sandbox.close("{{sandbox}}")).kind);\n',
          '  const [sandbox, path] = "{{ws}}".split(/:(.*)/);\n  await lf.workspace.unmount({ sandbox, path }, true);\n  console.log(`unmounted ${path}; its uncommitted dev cache discarded`);\n',
          where,
        )
        bump('agents: Dee unmounts only the server\'s Workspace')
      }
      if (/lf\.sandbox\.(create|close)\(/.test(cmd)) throw new Error(`agents ${where}: still creates or closes a Sandbox`)
      step.bash.command = cmd
      step.expect = dropCodes(step.expect)
    }
  }
  return out
}

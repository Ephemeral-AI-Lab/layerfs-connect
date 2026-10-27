// The tools a step calls, with dsh's observable behaviour:
//   bash               `bash -c` in the agent's folder (the run's work/ by
//                      default; `workdir` resolves against it), timeoutMs
//                      default 120 s, cap 600 s; on expiry the process group is
//                      killed and the step fails (dsh moves it to the
//                      background, where the scripted model's check fails it
//                      too). Checks: not killed, `expect` against the step's
//                      trace lines, exit == `exit`, `commits` printed.
//   bash (background)  a job; `as` names it; its `expect` is checked when it ends
//   subagent           starts the child the description names
//   send_message       wakes a child with a message
//   interrupt_agent    a working child stops, which ends the run (dsh's
//                      scripted run fails on an aborted request); an idle one
//                      has nothing to stop
//   list_agents, job_output, job_kill, job_list, working_directory
// Each step is one attempt. Placeholders are filled from what the agent has seen.
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { callCodes, inOrder } from '../../tools/lib/expect.mjs'
import { DEFAULT_TIMEOUT_MS, Lines, MAX_TIMEOUT_MS, startBash, Tail } from './bash.js'
import { WAIT_CAP_MS, WAIT_DEFAULT_MS } from './jobs.js'
import { Capture } from './seen.js'

const label = (agent, index) => `${agent.name}:${index}`

export class Tools {
  constructor(run) {
    this.run = run
  }

  /** Runs one call step; true when it held, false when it failed the run. */
  async call(agent, step, index) {
    const name = step.call.name
    const result = this.run.stepStarted(agent, index)
    const fail = (reason, fields = {}) => {
      this.run.stepFailed(agent, index, step, reason, result, fields)
      return false
    }
    const args = { ...step.call.args }
    // @name arguments: the agent's child or job
    for (const [key, ref] of Object.entries(step.call.refs ?? {})) {
      if (ref.agent && !agent.children.has(ref.agent)) return fail(`no id for @${ref.agent} in the results so far`)
      if (ref.job && !agent.jobs.has(ref.job)) return fail(`no id for @${ref.job} in the results so far`)
      args[key] = ref.agent ?? agent.jobs.get(ref.job).id
    }
    for (const key of name === 'bash' ? ['command'] : name === 'send_message' ? ['message'] : []) {
      const { text, missing } = agent.seen.fill(String(args[key]))
      if (missing.length) return fail(`${agent.name} has seen no value for ${missing.join(', ')}`)
      args[key] = text
    }
    if (name === 'bash') return args.run_in_background === true ? this.background(agent, step, index, args, result, fail) : this.bash(agent, step, index, args, result, fail)
    const answer = await this[name](agent, step, args, fail)
    if (answer === false) return false
    agent.seen.look(answer)
    this.run.stepEnded(result, { state: 'ok', output: answer })
    return true
  }

  folder(agent, dir) {
    return dir ? (isAbsolute(dir) ? dir : resolve(agent.cwd, dir)) : agent.cwd
  }

  async bash(agent, step, index, args, result, fail) {
    const out = new Tail()
    const err = new Tail()
    const capture = { stdout: new Capture(), stderr: new Capture() }
    const lines = { stdout: new Lines((l) => capture.stdout.line(l)), stderr: new Lines((l) => capture.stderr.line(l)) }
    const timeoutMs = Math.min(Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const proc = startBash({
      command: args.command,
      cwd: this.folder(agent, args.workdir),
      env: this.run.env(agent, label(agent, index)),
      onStdout: (b) => { out.push(b); lines.stdout.push(b) },
      onStderr: (b) => { err.push(b); lines.stderr.push(b) },
    })
    const untrack = this.run.track(proc)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)
    const done = await proc.done
    clearTimeout(timer)
    untrack()
    lines.stdout.end()
    lines.stderr.end()
    // the step's calls are all written once its process ended
    this.run.traces.read(agent.name)
    for (const c of [capture.stdout, capture.stderr]) {
      if (c.sandbox) agent.seen.sandbox = c.sandbox
      if (c.ws) agent.seen.ws = c.ws
    }
    if (agent.seen.sandbox) this.run.remember(`${agent.name}.sandbox`, agent.seen.sandbox)
    if (agent.seen.ws) this.run.remember(`${agent.name}.ws`, agent.seen.ws)
    const fields = { exitCode: done.exitCode, stdout: out.text(), stderr: err.text(), truncated: out.truncated || err.truncated }
    if (this.run.over) return false
    const checks = []
    let reason = null
    const check = (name, ok, detail) => {
      checks.push({ name, ok, detail })
      if (!ok && !reason) reason = detail
    }
    if (done.error) check('exit', false, `bash did not start: ${done.error.message}`)
    else if (timedOut) check('timeout', false, `timed out after ${timeoutMs}ms; its process group was killed`)
    else if (done.signal) check('exit', false, `killed by signal ${done.signal}`)
    if (step.expect) {
      const codes = callCodes(this.run.traces.lines(label(agent, index)))
      check('expect', inOrder(codes, step.expect), `expected ${step.expect.join(', ')}; its LayerFS calls show ${codes.length ? codes.join(', ') : 'nothing'}`)
    }
    if (!done.error && !timedOut && !done.signal) check('exit', done.exitCode === step.exit, `exit ${done.exitCode}, the step expects ${step.exit}`)
    if (step.commits) {
      const printed = [...capture.stdout.commits, ...capture.stderr.commits]
      const ok = printed.length === step.commits.length
      check('commits', ok, `names ${step.commits.length} Commit(s) (${step.commits.join(', ')}) and its call printed ${printed.length}${printed.length ? ` (${printed.join(', ')})` : ''}`)
      if (ok) {
        step.commits.forEach((ref, i) => {
          agent.seen.commits.set(ref, printed[i])
          this.run.remember(`commit:${ref}`, printed[i])
        })
      }
    }
    if (reason) return fail(reason, { ...fields, checks })
    this.run.stepEnded(result, { state: 'ok', ...fields, checks })
    return true
  }

  background(agent, step, index, args, result, fail) {
    const job = this.run.startJob(agent, step, index, {
      label: args.description,
      command: args.command,
      cwd: this.folder(agent, args.workdir),
      env: this.run.env(agent, label(agent, index)),
    })
    if (step.call.job) agent.jobs.set(step.call.job, job)
    const output = `started background job ${job.id}`
    this.run.stepEnded(result, { state: 'ok', output })
    return true
  }

  async subagent(agent, step, args, fail) {
    const child = this.run.agents.get(step.call.child)
    if (!child) return fail(`${step.call.child} has no steps`)
    if (child.state !== 'waiting') return fail(`${child.name} is already started`)
    agent.children.set(child.name, child)
    agent.touch(child.name)
    child.cwd = this.folder(agent, args.cwd)
    this.run.message(agent.name, child.name, args.prompt)
    child.receive(agent.name, args.prompt)
    child.turn()
    return `started subagent ${child.name}`
  }

  async send_message(agent, step, args) {
    const child = agent.children.get(args.agent_id)
    agent.touch(child.name)
    this.run.message(agent.name, child.name, args.message)
    child.receive(agent.name, args.message)
    return `message delivered to ${child.name}`
  }

  async interrupt_agent(agent, step, args, fail) {
    const child = agent.children.get(args.agent_id)
    agent.touch(child.name)
    if (child.state !== 'running') return `${child.name} is not working`
    // dsh: an aborted request of the scripted run fails the run
    this.run.fail(`stopped while ${child.name} worked`, child)
    return false
  }

  async list_agents(agent) {
    const rows = [...agent.children.values()].map((c) => `${c.name} ${c.name} ${c.state === 'running' ? 'running' : 'inactive'}`)
    return rows.length ? rows.join('\n') : 'no subagents'
  }

  async job_output(agent, step, args) {
    const job = this.run.job(args.job_id)
    if (args.wait === true && job.state === 'running') {
      const ms = Math.min(Number.isFinite(args.timeout_ms) && args.timeout_ms > 0 ? args.timeout_ms : WAIT_DEFAULT_MS, WAIT_CAP_MS)
      await job.wait(ms)
      await this.run.jobSettled(job)
    }
    return job.read()
  }

  async job_kill(agent, step, args) {
    const job = this.run.job(args.job_id)
    if (!job.kill(args.reason ? `killed: ${args.reason}` : 'killed')) return `job ${job.id} had already finished ${job.status()}`
    await job.done
    return `job ${job.id} killed`
  }

  async job_list(agent) {
    const mine = this.run.jobsOf(agent)
    return mine.length ? mine.map((j) => j.line()).join('\n') : 'no background jobs'
  }

  async working_directory(agent, step, args, fail) {
    if (args.cd !== undefined) {
      const dir = this.folder(agent, String(args.cd))
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return fail(`${dir} is not a directory`)
      agent.cwd = dir
    }
    return agent.cwd
  }
}

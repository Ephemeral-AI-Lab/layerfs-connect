// One agent of a run: its steps, how far it got, and when it goes on. The
// rules are dsh-layerfs's scripted model's (packages/mock/src/plan.js),
// played forward instead of read back from a conversation:
//   - a turn runs the agent's steps in order until a reply, which ends it
//   - root's first turn starts with the run; a child's when its parent's
//     `subagent` step starts it (the prompt is its first message)
//   - after a reply that waits (`until`), the agent goes on once each named
//     child has replied (settled) since the agent last contacted it (started
//     it, or sent it a message); a waiting reply whose children have all
//     replied already is not said, and the turn goes on
//   - after another reply, the agent goes on when a message arrives (a
//     parent's send_message); a message that came while it worked does not
//     wake it, as in dsh
//   - each reply of a child reaches its parent as the child's settled notice,
//     carrying the reply's text
//   - an agent whose steps are done answers a message with "Done." (dsh)
// The first failure fails the run; nothing is retried.
import { setTimeout as pause } from 'node:timers/promises'
import { Seen } from './seen.js'

export class Agent {
  constructor(run, name, steps, parent = null) {
    this.run = run
    this.name = name
    this.steps = steps
    this.parent = parent
    this.index = 0
    this.state = 'waiting'
    this.seen = new Seen(run.scenario.templates)
    /** child name -> Agent, as this agent started them */
    this.children = new Map()
    /** child name -> sequence number of the last contact */
    this.contact = new Map()
    /** { child, seq } per settled notice received */
    this.settles = []
    /** sequence numbers of the messages received (not settled notices) */
    this.received = []
    this.lastReply = -1
    /** job name (`as`) -> Job */
    this.jobs = new Map()
    this.cwd = run.work
    this.turning = false
    /** When its state last changed, and when its current pause before a step began (null between). */
    this.since = Date.now()
    this.thinking = null
  }

  view() {
    return {
      name: this.name,
      parent: this.parent?.name ?? null,
      state: this.state,
      done: this.index,
      of: this.steps.length,
      since: this.since,
      thinking: this.thinking,
    }
  }

  setState(state) {
    if (this.state === state) return
    this.state = state
    this.since = Date.now()
    this.run.agentChanged(this)
  }

  /** The children of `until` that have not replied since this agent last contacted them. */
  unsettled(until) {
    return until.filter((child) => {
      const since = this.contact.get(child) ?? Infinity
      return !this.settles.some((s) => s.child === child && s.seq > since)
    })
  }

  touch(child) {
    this.contact.set(child, this.run.next())
  }

  /** A message from another agent (or the prompt that starts a child). */
  receive(from, text) {
    this.received.push(this.run.next())
    this.seen.receive(text)
    if (this.state === 'done' && !this.turning) {
      // dsh's scripted model answers an agent with no steps left "Done."
      this.run.message(this.name, this.parent?.name ?? null, 'Done.')
      this.parent?.settled(this.name, 'Done.')
      return
    }
    this.wake()
  }

  /** A child's reply. */
  settled(child, text) {
    this.settles.push({ child, seq: this.run.next() })
    this.seen.receive(text)
    this.wake()
  }

  /** Starts a turn when the agent is idle and what it waits for has come. */
  wake() {
    if (this.state !== 'idle' || this.turning || this.run.over) return
    const previous = this.steps[this.index - 1]
    const ready = previous?.kind === 'reply' && previous.until.length ? !this.unsettled(previous.until).length : this.received.some((seq) => seq > this.lastReply)
    if (ready) this.turn()
  }

  /** Runs steps until a reply ends the turn. */
  async turn() {
    if (this.turning) return
    this.turning = true
    this.setState('running')
    try {
      while (!this.run.over) {
        const step = this.steps[this.index]
        if (!step) return this.finish()
        const index = this.index
        if (step.kind === 'reply' && step.until.length && !this.unsettled(step.until).length) {
          // a wait whose children all replied already is not said
          this.run.stepSkipped(this, index, step)
          this.index++
          this.run.progress(this)
          continue
        }
        await this.think()
        if (this.run.over) return
        if (step.kind === 'reply') return this.reply(step, index)
        const ok = await this.run.tools.call(this, step, index)
        if (!ok || this.run.over) return
        this.index++
        this.run.progress(this)
      }
    } catch (error) {
      this.run.fail(`${this.name}[${this.index}]: ${error.message}`, this)
    } finally {
      this.turning = false
      // a message may have come while the turn ended (in the same call stack)
      this.wake()
    }
  }

  /**
   * A model's pause before its next step, as a live agent has: one bounded
   * wait (Run.thinkMs). It adds time between calls only; each LayerFS call
   * keeps its own timing.
   */
  async think() {
    const ms = this.run.thinkMs()
    if (ms <= 0) return
    this.thinking = Date.now()
    this.run.agentChanged(this)
    await pause(ms)
    this.thinking = null
    this.run.agentChanged(this)
  }

  reply(step, index) {
    const { text, missing } = this.seen.fill(step.text)
    if (missing.length) return this.run.stepFailed(this, index, step, `${this.name} has seen no value for ${missing.join(', ')}`)
    this.run.stepReplied(this, index, step, text)
    this.index++
    this.lastReply = this.run.next()
    this.run.progress(this)
    this.run.message(this.name, this.parent?.name ?? null, text)
    if (this.index >= this.steps.length) this.finish()
    else this.setState('idle')
    this.parent?.settled(this.name, text)
  }

  finish() {
    this.setState('done')
    if (!this.parent) this.run.rootDone()
  }
}

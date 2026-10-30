import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { reviewCommand } from './permission-review.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
export function permissionMode(mode = 'full') {
  if (!['ask', 'auto', 'full'].includes(mode)) throw fail(400, 'Choose ask, auto, or full access.')
  return mode
}

/** Child processes can request execution here; only the desktop API can decide. */
export class ApprovalService {
  constructor(manager, review = reviewCommand) {
    this.manager = manager
    this.review = review
    this.tokens = new Map()
    this.pending = new Map()
    this.executions = new Set()
    this.stopped = new Set()
    this.server = createServer((req, res) => void this.handle(req, res))
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    this.url = `http://127.0.0.1:${this.server.address().port}`
    return this
  }

  connection(id, runDir) {
    let token = this.tokens.get(id)
    if (!token) {
      token = randomBytes(32).toString('hex')
      this.tokens.set(id, token)
    }
    const file = join(runDir, 'approval-connection.json')
    writeFileSync(file, JSON.stringify({ url: this.url, token, sessionId: id }), { mode: 0o600 })
    return file
  }

  async handle(req, res) {
    const send = (status, value) => {
      if (res.destroyed) return
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    const execute = req.url === '/execute'
    const context = req.url === '/context'
    if (req.method !== 'POST' || (!execute && !context && req.url !== '/request')) return send(404, { approved: false, reason: 'Unknown approval route.' })
    // Authenticate before accepting a body. This token never grants decisions.
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    const id = [...this.tokens].find(([, value]) => value === token)?.[0]
    if (!id) return send(401, { approved: false, reason: 'Invalid approval connection.' })
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    const active = { sessionId: id, controller }
    if (execute) this.executions.add(active)
    const event = async (value) => {
      controller.signal.throwIfAborted()
      if (!res.write(JSON.stringify(value) + '\n')) await once(res, 'drain', { signal: controller.signal })
    }
    try {
      let body = ''
      for await (const part of req) {
        body += part
        if (body.length > 256 * 1024) throw fail(413, 'The command is too large to review.')
      }
      let request
      try { request = JSON.parse(body) } catch { throw fail(400, 'Invalid approval request.') }
      if (request.sessionId !== id) throw fail(403, 'This connection belongs to another session.')
      if (context) {
        controller.signal.throwIfAborted()
        if (this.stopped.has(id)) throw fail(409, 'The session was stopped.')
        return send(200, await this.manager.context(id))
      }
      if (!['agent', 'toolCallId', 'command', 'cwd'].every((key) => typeof request[key] === 'string' && request[key].length > 0)) {
        throw fail(400, 'An agent, tool call, command, and working directory are required.')
      }
      if (request.timeout !== undefined && (typeof request.timeout !== 'number' || !Number.isFinite(request.timeout) || request.timeout <= 0)) {
        throw fail(400, 'The command timeout must be a positive number of seconds.')
      }
      if (!execute) return send(200, await this.request(id, request, controller.signal))
      controller.signal.throwIfAborted()
      if (this.stopped.has(id)) throw fail(403, 'The session was stopped.')
      const input = {
        agent: request.agent, toolCallId: request.toolCallId, command: request.command,
        cwd: await this.manager.workspaceDirectory(id),
        ...(request.timeout === undefined ? {} : { timeout: request.timeout }),
      }
      const decision = await this.request(id, input, controller.signal)
      if (!decision.approved) return send(403, decision)
      controller.signal.throwIfAborted()
      if (this.stopped.has(id)) throw fail(409, 'The session was stopped.')
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
      res.flushHeaders()
      const result = await this.manager.executeWorkspace(id, input, {
        signal: controller.signal,
        onData: (data) => event({ type: 'data', data: Buffer.from(data).toString('base64') }),
      })
      await event({ type: 'exit', exitCode: result.exitCode })
      res.end()
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.end(JSON.stringify({ type: 'error', message: error.message }) + '\n')
      } else send(error.status ?? 500, { approved: false, reason: error.message })
    } finally {
      this.executions.delete(active)
    }
  }

  request(id, input, signal) {
    const record = this.manager.record(id)
    if (signal?.aborted || this.stopped.has(id)) return Promise.resolve({ approved: false, reason: 'The session was stopped.' })
    if (record.permissionMode === 'full') return Promise.resolve({ approved: true })
    const request = {
      id: randomUUID(), agent: input.agent, toolCallId: input.toolCallId,
      command: input.command, cwd: input.cwd, created: Date.now(), status: 'pending',
    }
    record.approvals.push(request)
    return new Promise((resolve) => {
      const cancel = () => this.finish(request.id, 'cancelled', undefined, 'Command cancelled before execution.')
      const entry = { sessionId: id, request, resolve, review: null, cleanup: () => signal?.removeEventListener('abort', cancel) }
      this.pending.set(request.id, entry)
      signal?.addEventListener('abort', cancel, { once: true })
      this.applyMode(entry)
    })
  }

  applyMode(entry) {
    const { sessionId, request } = entry
    entry.review?.abort()
    entry.review = null
    const record = this.manager.record(sessionId)
    if (record.permissionMode === 'full') {
      this.finish(request.id, 'approved', 'user', 'Fully accessible mode enabled for this session.')
      return
    }
    request.status = record.permissionMode === 'auto' ? 'reviewing' : 'pending'
    delete request.reason
    this.manager.changed(sessionId, true)
    if (record.permissionMode !== 'auto') return
    const controller = new AbortController()
    entry.review = controller
    void this.review({ models: this.manager.models, record, request, signal: controller.signal }).then((result) => {
      if (entry.review !== controller || !this.pending.has(request.id)) return
      if (result.decision === 'approve') this.finish(request.id, 'approved', 'model', result.reason)
      else {
        request.status = 'pending'
        request.reason = result.reason
        this.manager.changed(sessionId, true)
      }
    }).catch((error) => {
      if (entry.review !== controller || !this.pending.has(request.id)) return
      request.status = 'pending'
      request.reason = `Automatic review could not approve this command: ${error.message}`
      this.manager.changed(sessionId, true)
    })
  }

  finish(id, status, source, reason) {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    entry.review?.abort()
    entry.cleanup()
    Object.assign(entry.request, { status, decidedAt: Date.now(), ...(source ? { source } : {}), ...(reason ? { reason } : {}) })
    this.manager.changed(entry.sessionId, true)
    entry.resolve({ approved: status === 'approved', reason: entry.request.reason })
  }

  decide(sessionId, id, decision) {
    this.manager.record(sessionId)
    if (!['approve', 'reject'].includes(decision)) throw fail(400, 'Choose approve or reject.')
    const entry = this.pending.get(id)
    if (!entry || entry.sessionId !== sessionId) throw fail(409, 'This approval is no longer pending in this session.')
    this.finish(id, decision === 'approve' ? 'approved' : 'rejected', 'user', decision === 'approve' ? 'Approved once by you.' : 'Rejected by you.')
    return this.manager.detail(sessionId)
  }

  setMode(id, mode) {
    const record = this.manager.record(id)
    record.permissionMode = permissionMode(mode)
    this.manager.changed(id, true)
    for (const entry of this.pending.values()) if (entry.sessionId === id) this.applyMode(entry)
    return this.manager.detail(id)
  }

  resume(id) { this.stopped.delete(id) }

  cancelSession(id) {
    this.stopped.add(id)
    for (const entry of this.executions) if (entry.sessionId === id) entry.controller.abort()
    for (const entry of this.pending.values()) {
      if (entry.sessionId === id) this.finish(entry.request.id, 'cancelled', undefined, 'Session stopped before execution.')
    }
  }

  forget(id) {
    this.cancelSession(id)
    this.tokens.delete(id)
  }

  async close() {
    for (const id of this.tokens.keys()) this.cancelSession(id)
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()))
  }
}

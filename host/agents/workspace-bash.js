import { readFile } from 'node:fs/promises'

/** Read on every call so restored and detached children use the current host. */
export async function readBashConnection(file, signal) {
  if (!file) throw new Error('The bash approval connection is not configured.')
  const connection = JSON.parse(await readFile(file, { encoding: 'utf8', signal }))
  if (![connection.url, connection.token, connection.sessionId].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('The bash approval connection is not configured.')
  }
  return connection
}

/** Pi retains its bash schema, output limits and renderer; the host owns execution. */
export function createWorkspaceBashOperations({ approvalFile, agent, toolCallId }) {
  return {
    async exec(command, cwd, { signal, timeout, onData }) {
      signal?.throwIfAborted()
      const connection = await readBashConnection(approvalFile, signal)
      const response = await fetch(`${connection.url}/execute`, {
        method: 'POST',
        headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: connection.sessionId, agent, toolCallId, command, cwd, ...(timeout === undefined ? {} : { timeout }) }),
        signal,
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.reason || error.message || `Workspace execution failed (HTTP ${response.status}).`)
      }
      const decoder = new TextDecoder()
      let pending = ''
      let result
      const consume = (line) => {
        if (!line.trim()) return
        if (result) throw new Error('Workspace execution sent data after its exit result.')
        const event = JSON.parse(line)
        if (event.type === 'data' && typeof event.data === 'string') onData(Buffer.from(event.data, 'base64'))
        else if (event.type === 'exit' && (Number.isInteger(event.exitCode) || event.exitCode === null)) result = { exitCode: event.exitCode }
        else if (event.type === 'error') throw new Error(event.message || 'Workspace execution failed.')
        else throw new Error('Invalid workspace execution event.')
      }
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true })
        let end
        while ((end = pending.indexOf('\n')) >= 0) {
          consume(pending.slice(0, end))
          pending = pending.slice(end + 1)
        }
      }
      pending += decoder.decode()
      if (pending) consume(pending)
      if (!result) throw new Error('The workspace connection closed before command completion was confirmed.')
      return result
    },
  }
}

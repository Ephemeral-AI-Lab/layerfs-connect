import { subagentChildren } from './extensions.js'

const text = (content) => typeof content === 'string' ? content : (content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')

/** The same projection serves streaming updates and restored Pi transcripts. */
export function transcript(messages, updates = new Map(), running = false, streaming = null, entries = []) {
  const results = new Map(messages.filter((m) => m.role === 'toolResult').map((m) => [m.toolCallId, m]))
  const rows = []
  for (const [index, message] of messages.entries()) {
    if (message.role === 'toolResult') continue
    if (message.role === 'custom' && message.display === false) continue
    const entryId = entries[index]?.id
    const identity = { id: entryId ? `e:${entryId}` : `m:${index}`, ...(entryId ? { entryId } : {}) }
    if (message.role === 'compactionSummary' || message.role === 'branchSummary') {
      const title = message.role === 'compactionSummary' ? 'Compacted context' : 'Branch context'
      rows.push({ ...identity, role: 'assistant', text: `### ${title}\n\n${message.summary}`, status: 'done', details: { kind: message.role, tokensBefore: message.tokensBefore } })
      continue
    }
    if (message.role === 'user' || message.role === 'custom') {
      rows.push({ ...identity, role: message.role === 'user' ? 'user' : 'assistant', text: text(message.content), details: message.details })
      continue
    }
    if (message.role !== 'assistant') continue
    const thinking = message.content.filter((part) => part.type === 'thinking').map((part) => part.thinking).join('\n')
    const failed = message.stopReason === 'error' || message.stopReason === 'aborted'
    rows.push({
      ...identity, role: 'assistant', text: text(message.content) || message.errorMessage || '', thinking,
      status: failed ? 'error' : message === streaming ? 'running' : 'done',
      usage: message.usage ? { input: message.usage.input, output: message.usage.output, cost: message.usage.cost?.total ?? 0 } : undefined,
    })
    for (const call of message.content.filter((part) => part.type === 'toolCall')) {
      const result = results.get(call.id) ?? updates.get(call.id)
      rows.push({
        id: call.id, role: 'tool', toolName: call.name, args: call.arguments,
        text: text(result?.content), details: result?.details,
        status: result?.isError ? 'error' : results.has(call.id) || result?.finished ? 'done' : running ? 'running' : 'error',
      })
    }
  }
  return rows
}

/** Pi's projection preserves each context message's append-only source entry, including compaction. */
export function sessionTranscript(manager, { messages, updates, running, streaming } = {}) {
  const projection = manager.buildSessionProjection()
  const sources = projection.entries.flatMap((entry) => entry.messages.map(() => entry.sourceEntry))
  messages ??= projection.messages
  const entries = messages.map((message, index) => {
    const projected = projection.messages[index]
    return projected === message || (projected && JSON.stringify(projected) === JSON.stringify(message)) ? sources[index] : undefined
  })
  return transcript(messages, updates, running, streaming, entries)
}

export function childrenFrom(messages) {
  const children = new Map()
  for (const message of messages) {
    for (const child of subagentChildren(message, { final: message.status !== 'running', fallbackId: message.id })) children.set(child.id, child)
    for (const [index, child] of (message.details?.runs ?? []).entries()) {
      const id = `${child.runId ?? message.details.runId ?? message.id}:${child.index ?? index}`
      children.set(id, {
        id, agent: child.agent ?? child.name ?? 'worker', task: child.task,
        state: child.status ?? child.state ?? (child.exitCode === undefined ? message.status : child.exitCode === 0 ? 'completed' : 'failed'),
        text: child.finalOutput ?? child.output ?? child.resultPreview ?? child.text ?? text(child.messages?.at(-1)?.content),
        sessionFile: child.sessionFile,
      })
    }
  }
  return [...children.values()]
}

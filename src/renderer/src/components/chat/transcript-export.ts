import { t, localeTag } from '@/i18n'
import type { AgentSessionDetail } from '@shared/agent-api'

export function conversationMarkdown(session: AgentSessionDetail) {
  const parts = [`# ${session.title}`, t("Project: {project}\n\nUpdated: {updated}", { project: session.project ?? t("Local folder"), updated: new Date(session.updated).toISOString() })]
  for (const message of session.messages) {
    const role = message.role === 'tool' ? t("Tool: {tool}", { tool: message.toolName ?? 'tool' }) : message.role === 'user' ? t("User") : t("Assistant")
    parts.push(`## ${role}`)
    if (message.args) parts.push(t("Input:\n\n{input}", { input: JSON.stringify(message.args, null, 2) }))
    if (message.text) parts.push(message.text)
    if (message.attachments?.length) parts.push(message.attachments.map((attachment) => t("Attachment: {name} ({type})", { name: attachment.name, type: attachment.mimeType })).join('\n'))
    if (message.outputArtifact) parts.push(t("Full tool output is saved separately ({bytes} bytes).", { bytes: message.outputArtifact.bytes.toLocaleString(localeTag()) }))
  }
  return parts.join('\n\n') + '\n'
}

export function exportConversation(session: AgentSessionDetail, format: 'md' | 'json') {
  // Export only conversation data. Never include the provider catalog or keys.
  const value = format === 'md' ? conversationMarkdown(session) : JSON.stringify({
    version: 1, id: session.id, title: session.title, project: session.project,
    created: session.created, updated: session.updated, messages: session.messages,
  }, null, 2)
  const blob = new Blob([value], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${session.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'conversation'}.${format}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

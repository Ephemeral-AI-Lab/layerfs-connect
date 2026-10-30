import { t, useI18n } from '@/i18n'
import { FileText, X } from 'lucide-react'
import type { AgentAttachment, ChatMessage } from '@shared/agent-api'

const attachmentData = new Map<string, string>()
export function retainAttachmentData(items: AgentAttachment[] = [], previous: AgentAttachment[] = []) {
  const old = new Map(previous.map((item) => [item.id, item.data]))
  return items.map((item) => {
    const data = item.data ?? old.get(item.id) ?? attachmentData.get(item.id)
    if (data) attachmentData.set(item.id, data)
    return data === item.data ? item : { ...item, data }
  })
}
export function hydrateMessageAttachments(messages: ChatMessage[], previous: ChatMessage[] = []) {
  const old = new Map(previous.map((message) => [message.id, message.attachments]))
  return messages.map((message) => message.attachments?.length ? { ...message, attachments: retainAttachmentData(message.attachments, old.get(message.id)) } : message)
}
export function attachmentPayload(items: AgentAttachment[]) {
  return retainAttachmentData(items).map((item) => {
    if (item.data === undefined) throw new Error(t("Reopen the conversation to load the attachment {name} before sending.", { name: item.name }))
    return { ...item, data: item.data }
  })
}
export function rememberAttachments(items: AgentAttachment[]) { retainAttachmentData(items); return items }

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const textTypes = new Set(['application/json', 'application/javascript', 'application/typescript', 'application/xml', 'application/yaml', 'application/x-yaml'])
const textExtension = /\.(txt|md|mdx|csv|tsv|json|jsonl|js|jsx|ts|tsx|mjs|cjs|xml|ya?ml|toml|ini|log|py|sh|bash|css|html|sql|rs|go|java|c|h|cpp|rb|vue|svelte)$/i
export async function readAttachments(files: File[], existing: AgentAttachment[], supportsImages: boolean) {
  if (existing.length + files.length > 10) throw new Error(t("Attach up to 10 files at a time."))
  let total = existing.reduce((sum, item) => sum + (item.size ?? Math.floor((item.data?.length ?? 0) * 3 / 4)), 0)
  const additions: AgentAttachment[] = []
  for (const file of files) {
    const mimeType = textExtension.test(file.name) && !file.type.startsWith('text/') && !textTypes.has(file.type) ? 'text/plain' : file.type
    const image = imageTypes.has(mimeType)
    if (!image && !mimeType.startsWith('text/') && !textTypes.has(mimeType)) throw new Error(t("{name}: choose a text file or a PNG, JPEG, WebP or GIF image.", { name: file.name }))
    if (image && !supportsImages) throw new Error(t("Choose a model that supports images before attaching an image."))
    if (file.size > (image ? 10 : 1) * 1024 * 1024) throw new Error(t("{name}: {limit}.", { name: file.name, limit: image ? t("images must be at most 10 MiB") : t("text files must be at most 1 MiB") }))
    total += file.size
    if (total > 20 * 1024 * 1024) throw new Error(t("Attachments must total at most 20 MiB."))
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(new Error(t("Could not read {name}.", { name: file.name })))
      reader.readAsDataURL(file)
    })
    additions.push({ id: crypto.randomUUID(), name: file.name, mimeType, data, size: file.size })
  }
  return rememberAttachments([...existing, ...additions])
}

export function AttachmentList({ attachments, onRemove, disabled }: { attachments: AgentAttachment[]; onRemove?: (id: string) => void; disabled?: boolean }) {
  const { t } = useI18n()
  if (!attachments.length) return null
  return <ul aria-label={t("Attachments")} className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
    {attachments.map((attachment) => <li key={attachment.id} className="flex max-w-60 min-w-0 items-center gap-2 rounded-xl border border-foreground/[0.08] bg-background/50 px-2 py-1.5">
      {imageTypes.has(attachment.mimeType) && attachment.data ? <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} className="size-10 shrink-0 rounded-lg object-cover" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate text-[11px]" title={attachment.name}>{attachment.name}</span>
      {onRemove && <button type="button" aria-label={t("Remove attachment {name}", { name: attachment.name })} title={t("Remove attachment")} disabled={disabled} onClick={() => onRemove(attachment.id)} className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><X className="size-3.5" /></button>}
    </li>)}
  </ul>
}

import { randomUUID } from 'node:crypto'

const MiB = 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const TEXT_TYPES = new Set(['application/json', 'application/javascript', 'application/typescript', 'application/xml', 'application/yaml', 'application/x-yaml'])
const bad = (message) => Object.assign(new Error(message), { status: 400 })

/** Prepare model-native images and explicitly delimited UTF-8 file contents once. */
export function normalizePrompt(input, model) {
  const text = input.text ?? ''
  if (typeof text !== 'string') throw bad('Message text must be a string.')
  const incoming = input.attachments ?? []
  if (!Array.isArray(incoming) || incoming.length > 10) throw bad('Attach at most 10 files per message.')
  const attachments = [], images = [], files = []
  let total = 0
  for (const file of incoming) {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || typeof file.mimeType !== 'string' || typeof file.data !== 'string') throw bad('Each attachment needs a name, MIME type and base64 data.')
    const mimeType = file.mimeType.toLowerCase().split(';')[0].trim()
    const image = IMAGE_TYPES.has(mimeType)
    if (!image && !mimeType.startsWith('text/') && !TEXT_TYPES.has(mimeType)) throw bad(`Unsupported attachment type: ${file.mimeType}. Use an image or UTF-8 text file.`)
    const limit = image ? 10 * MiB : MiB
    if (file.data.length > Math.ceil(limit / 3) * 4) throw bad(`${file.name} exceeds the ${image ? '10' : '1'} MiB file limit.`)
    const bytes = Buffer.from(file.data, 'base64')
    if (bytes.length > limit) throw bad(`${file.name} exceeds the ${image ? '10' : '1'} MiB file limit.`)
    if (bytes.toString('base64') !== file.data) throw bad(`${file.name} has invalid base64 data.`)
    total += bytes.length
    if (total > 20 * MiB) throw bad('Attachments exceed the 20 MiB message limit.')
    const attachment = { id: typeof file.id === 'string' && file.id ? file.id : randomUUID(), name: file.name, mimeType, data: file.data, size: bytes.length }
    attachments.push(attachment)
    if (image) {
      if (!model?.input?.includes('image')) throw bad('The selected model does not support image input. Choose a vision model or remove the image.')
      images.push({ type: 'image', mimeType, data: file.data })
    } else {
      let content
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw bad(`${file.name} must contain UTF-8 text.`) }
      if (content.includes('\0')) throw bad(`${file.name} contains binary data. Attach a UTF-8 text file.`)
      files.push(`Attached file ${JSON.stringify(file.name)} (${mimeType}, ${bytes.length} bytes):\n<attachment-content>\n${content}\n</attachment-content>`)
    }
  }
  if (!text.trim() && !attachments.length) throw bad('A message or attachment is required.')
  return { text: [text, ...files].filter(Boolean).join('\n\n'), images, attachments }
}

/** Keep display/edit metadata separate from the expanded model prompt. */
export function promptDetails(input, normalized) {
  return { connectText: input.text ?? '', connectAttachments: normalized.attachments }
}

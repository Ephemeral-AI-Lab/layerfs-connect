import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

const PAGE = 64 * 1024
const bad = (message, status = 400) => Object.assign(new Error(message), { status })

/** Capture raw output before Pi truncates its model-facing tool result. */
export function captureToolOutput(runDir, agent, toolCallId, operations) {
  const id = createHash('sha256').update(`${agent}\0${toolCallId}`).digest('hex')
  const directory = join(runDir, 'tool-output')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const fd = openSync(join(directory, `${id}.log`), 'w', 0o600)
  let bytes = 0
  return {
    operations: {
      exec: (command, cwd, options) => operations.exec(command, cwd, {
        ...options,
        onData: (data) => {
          const chunk = Buffer.from(data)
          let offset = 0
          while (offset < chunk.length) offset += writeSync(fd, chunk, offset, chunk.length - offset)
          bytes += chunk.length
          return options.onData(chunk)
        },
      }),
    },
    finish() { closeSync(fd); return { id, bytes } },
  }
}

/** Pages are confined to this conversation's owned artifact directory. */
export async function readToolOutput(runDir, id, offset = 0) {
  if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(offset) || offset < 0) throw bad('Invalid tool output reference or offset.')
  let file
  try { file = await open(join(runDir, 'tool-output', `${id}.log`), 'r') }
  catch (error) { if (error.code === 'ENOENT') throw bad('Tool output is no longer available.', 404); throw error }
  try {
    const { size: bytes } = await file.stat()
    if (offset > bytes) throw bad('Tool output offset is beyond the end of the file.')
    const buffer = Buffer.alloc(Math.min(PAGE, bytes - offset))
    const result = await file.read(buffer, 0, buffer.length, offset)
    let end = result.bytesRead
    if (offset + end < bytes && end) {
      // Keep valid multibyte characters intact across page boundaries.
      let lead = end - 1
      while (lead > 0 && end - lead <= 3 && (buffer[lead] & 0xc0) === 0x80) lead--
      const first = buffer[lead]
      const length = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1
      if (end - lead < length) end = lead
    }
    return { text: buffer.subarray(0, end).toString('utf8'), offset, nextOffset: offset + end, bytes, done: offset + end >= bytes }
  } finally { await file.close() }
}

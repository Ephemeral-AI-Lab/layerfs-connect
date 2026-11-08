import { StringDecoder } from 'node:string_decoder'
import { parse } from './json.js'
// Byte chunks may split a UTF-8 character or a JSON line.
export function lines(onLine) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  function consume(text) {
    pending += text
    let end
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end)
      pending = pending.slice(end + 1)
      if (line.trim()) onLine(line)
    }
  }
  return { write: (chunk) => consume(decoder.write(chunk)), end: () => { consume(decoder.end()); if (pending.trim()) onLine(pending); pending = '' } }
}
export function progress(onProgress) {
  return lines((line) => { const frame = parse(line); if (!frame || !('progress' in frame)) throw new Error('Unexpected CLI stderr'); onProgress?.(frame.progress) })
}

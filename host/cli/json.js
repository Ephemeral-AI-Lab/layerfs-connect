// CLI integers remain exact; HTTP/persistence use a versioned tagged decimal.
export function parse(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source || !/^-?\d+$/.test(context.source)) throw new Error('CLI integers require Node 24 JSON source support')
      return BigInt(context.source)
    }
    return value
  })
}
export const stringify = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $layerfs: 'i64-v1', decimal: String(item) } : item)
export const bytes = (value) => typeof value === 'string' ? Buffer.from(value) : value && typeof value.base64 === 'string' ? Buffer.from(value.base64, 'base64') : Buffer.alloc(0)

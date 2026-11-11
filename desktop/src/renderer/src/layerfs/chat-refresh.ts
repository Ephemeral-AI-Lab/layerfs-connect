/** One request at a time. Bursts coalesce into one trailing refresh. */
export function chatRefresh(load: () => Promise<void>, interval: number) {
  let disposed = false, loading = false, queued = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let next = 0
  const request = (immediate = false) => {
    if (disposed) return
    if (loading) { queued = true; return }
    if (timer !== undefined) return
    timer = setTimeout(async () => {
      timer = undefined
      if (disposed) return
      loading = true; queued = false
      try { await load() }
      finally { loading = false; next = Date.now() + interval; if (queued && !disposed) request() }
    }, immediate ? 0 : Math.max(0, next - Date.now()))
  }
  return { request, dispose: () => { disposed = true; if (timer !== undefined) clearTimeout(timer) } }
}

/** FIFO per-sandbox reader/writer admission. Lifecycle mutations exclude fresh
 * workspace clients until detach and record cleanup have both returned. */
export class WorkspaceLifecycleGate {
  constructor() { this.lanes = new Map() }
  acquire(key, exclusive, signal) {
    signal?.throwIfAborted()
    let lane = this.lanes.get(key)
    if (!lane) this.lanes.set(key, lane = { readers: 0, writer: false, queue: [] })
    return new Promise((resolve, reject) => {
      const entry = { exclusive, signal, resolve, reject }
      entry.abort = () => {
        lane.queue = lane.queue.filter(waiter => waiter !== entry)
        signal.removeEventListener('abort', entry.abort)
        reject(signal.reason ?? new Error('Workspace admission stopped.'))
        this.drain(key, lane)
      }
      signal?.addEventListener('abort', entry.abort, { once: true })
      lane.queue.push(entry)
      this.drain(key, lane)
    })
  }
  drain(key, lane) {
    while (!lane.writer && lane.queue.length) {
      const entry = lane.queue[0]
      if (entry.exclusive && lane.readers) break
      lane.queue.shift(); entry.signal?.removeEventListener('abort', entry.abort)
      if (entry.exclusive) lane.writer = true
      else lane.readers++
      let released = false
      entry.resolve(() => {
        if (released) return
        released = true
        if (entry.exclusive) lane.writer = false
        else lane.readers--
        this.drain(key, lane)
      })
      if (entry.exclusive) break
    }
    if (!lane.writer && !lane.readers && !lane.queue.length && this.lanes.get(key) === lane) this.lanes.delete(key)
  }
  async run(key, exclusive, signal, execute) {
    const release = await this.acquire(key, exclusive, signal)
    try { signal?.throwIfAborted(); return await execute() } finally { release() }
  }
}

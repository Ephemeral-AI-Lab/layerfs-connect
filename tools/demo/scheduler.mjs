/** One operation owns every task; failure drains siblings before releasing its lock. */
export async function runBounded(items, concurrency, run) {
  let next = 0, failure
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && next < items.length) {
      const item = items[next++]
      try { await run(item, { shouldStop: () => !!failure }) } catch (error) { failure ??= error }
    }
  })
  await Promise.all(workers)
  if (failure) throw failure
}

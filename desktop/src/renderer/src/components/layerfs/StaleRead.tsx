/** Keep the last successful view visible when a refresh fails. */
export function StaleRead({ error, observedAt }: { error?: Error; observedAt?: number }) {
  if (!error) return null
  return <p role="status" className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Last read {observedAt ? new Date(observedAt).toLocaleTimeString() : 'earlier'} · refresh failed: {error.message}</p>
}

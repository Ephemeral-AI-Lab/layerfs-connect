/** Presentation only. A live metrics source can supply the same snapshot later. */
export interface SandboxUsage {
  cpuPercent: number
  memoryUsed: number
  memoryLimit: number
  diskUsed: number
  diskTotal: number
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const capacity = (used: number, total: number) => {
  const unit = total >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2
  return `${(used / unit).toFixed(1)} / ${Number((total / unit).toFixed(1))} ${unit === 1024 ** 3 ? 'GiB' : 'MiB'}`
}

export function SandboxResources({ usage, sample = false }: { usage: SandboxUsage | null; sample?: boolean }) {
  if (!usage) return null
  return <div className="machine-card-resources" data-metrics={sample ? 'sample' : 'reported'}>
    <dl className="machine-card-usage" aria-label={sample ? 'Sample sandbox resource usage, not live' : 'Sandbox resource usage'}>
      <div>
        <dt>CPU</dt><dd>{`${Math.round(usage.cpuPercent)}%`}</dd>
      </div>
      <div>
        <dt>Memory</dt><dd>{capacity(usage.memoryUsed, usage.memoryLimit)}</dd>
      </div>
      <div>
        <dt>Disk</dt><dd>{capacity(usage.diskUsed, usage.diskTotal)}</dd>
        <div className="sandbox-metric-disk-wrap"><div className="sandbox-metric-disk" role="meter" aria-label="Disk space used" aria-valuemin={0} aria-valuemax={usage.diskTotal} aria-valuenow={usage.diskUsed} aria-valuetext={capacity(usage.diskUsed, usage.diskTotal)}>
          <span style={{ width: `${clamp(usage.diskUsed / usage.diskTotal * 100)}%` }} />
        </div></div>
      </div>
    </dl>
    <p>{sample ? 'Sample readings · design preview, not live' : 'Sandbox resource usage'}</p>
  </div>
}

import type { SandboxUsage } from '@/pages/machines/SandboxResources'

/** Static design fixtures only. Never inferred from machine allocations or sent to a host. */
export function sampleSandboxUsage(name: string): SandboxUsage {
  const shift = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 12
  const gib = 1024 ** 3
  return {
    cpuPercent: 38 + shift,
    memoryUsed: 4 * gib * (43 + shift) / 100, memoryLimit: 4 * gib,
    diskUsed: (4.8 + shift / 5) * gib, diskTotal: 20 * gib,
  }
}

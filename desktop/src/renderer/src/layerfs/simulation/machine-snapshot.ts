import type { MachineInfo, SandboxInfo } from '@/layerfs/host-api'
import { sandboxSnapshot } from '@/layerfs/sandbox-snapshot'

/** Simulated records use the same data adapter as host-backed project details. */
export function machineSandboxSnapshot(machine: MachineInfo, sandbox: SandboxInfo) {
  const snapshot = sandboxSnapshot(sandbox, sandbox.project ?? undefined, machine)
  return { ...snapshot, machine: { ...snapshot.machine, description: 'Simulated machine record' } }
}

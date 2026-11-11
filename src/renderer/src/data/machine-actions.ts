import type { NewMachine } from '@shared/host-api'

export type MachineAction =
  | { kind: 'create'; input: NewMachine }
  | { kind: 'remove'; name: string }
  | { kind: 'start'; name: string }
  | { kind: 'stop'; name: string }
  | { kind: 'update'; name: string; changes: { image?: string; docker?: string; wsl?: string } }
  | { kind: 'close'; sandbox: string; force: boolean }
  | { kind: 'unmount'; ws: string }

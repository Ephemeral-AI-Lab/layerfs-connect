import { createContext, useContext } from 'react'
import type { useSandboxDetailModel } from './use-sandbox-detail'

export const SandboxDetailContext = createContext<ReturnType<typeof useSandboxDetailModel> | null>(null)
export function useSandboxDetail() {
  const value = useContext(SandboxDetailContext)
  if (!value) throw new Error('Sandbox detail panels need a SandboxDetail provider.')
  return value
}

import { createContext } from 'react'

/** The viewed agent's conversation address, shared by Trace row links. */
export const TraceChatPath = createContext<string | null>(null)

/** Durable commit identity is the destination; checkpoint numbers are display labels. */
export function historyLink(base: string, commit: string | null | undefined, branch: string | null | undefined, call?: string) {
  return `${base}/history?${new URLSearchParams({ ...(commit ? { commit } : {}), ...(branch ? { branch } : {}), ...(call ? { call } : {}) })}`
}

import { createContext, useContext, useEffect, useRef } from 'react'
import type { AgentModels } from '@shared/agent-api'

/** The pages of the Settings dialog, in nav order. */
export type SettingsSection = 'general' | 'models' | 'runs' | 'agents' | 'extensions' | 'sdks' | 'tools' | 'hooks' | 'commands'

/** Opens the Settings dialog (the sidebar's Settings button, or "Manage models…" in a chat). */
export const SettingsContext = createContext<{ open: (section?: SettingsSection) => void }>({ open: () => {} })
export const useSettings = () => useContext(SettingsContext)

const MODELS_CHANGED = 'connect:models-changed'

/** Tells every open chat that Settings saved the model catalog. */
export function publishModels(catalog: AgentModels) {
  window.dispatchEvent(new CustomEvent<AgentModels>(MODELS_CHANGED, { detail: catalog }))
}

/** Runs `listener` with each catalog Settings saves. */
export function useModelsChanged(listener: (catalog: AgentModels) => void) {
  const latest = useRef(listener)
  latest.current = listener
  useEffect(() => {
    const handle = (event: Event) => latest.current((event as CustomEvent<AgentModels>).detail)
    window.addEventListener(MODELS_CHANGED, handle)
    return () => window.removeEventListener(MODELS_CHANGED, handle)
  }, [])
}

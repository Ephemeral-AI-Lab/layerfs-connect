/// <reference types="vite/client" />

interface Window {
  desktop?: {
    platform: string
    layerfs: {
      request: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>
      subscribe: () => Promise<boolean>
      mode: 'sim' | 'real'
      chooseDirectory: (start?: string) => Promise<string | null>
      makeScratch: () => Promise<string>
      onStream: (listener: (message: unknown) => void) => () => void
    }
  }
}

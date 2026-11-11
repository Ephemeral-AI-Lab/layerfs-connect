/// <reference types="vite/client" />

interface Window {
  desktop?: {
    platform: string
    layerfs: {
      request: (method: string, path: string, body?: unknown, action?: import('../../../../shared/cli-activity').CliAction) => Promise<{ status: number; body: unknown }>
      subscribe: () => Promise<boolean>
      chooseDirectory: (start?: string) => Promise<string | null>
      makeScratch: () => Promise<string>
      onStream: (listener: (message: unknown) => void) => () => void
    }
  }
}

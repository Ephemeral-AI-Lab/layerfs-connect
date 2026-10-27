// What the preload exposes to the renderer. `host` is the Connect host's
// address and token (host/README.md); absent when the host did not start.
interface Window {
  connect: {
    platform: string
    arch: string
    host?: { url: string; token: string } | { error: string }
  }
}

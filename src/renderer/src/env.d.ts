// What the preload exposes to the renderer.
interface Window {
  connect: { platform: string; arch: string }
}

// Many small things of one shape drawn in one batch. Each thing is a plain
// Object3D stand-in (a "proxy") that lives in the scene like a mesh would:
// it is moved, scaled, parented and animated as usual, and each frame `sync`
// copies where it ended up into one instanced mesh. So a plot's blocks,
// posts and flag cost nothing extra to draw, however many plots there are.
import * as THREE from 'three'

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

export class ProxyPool {
  mesh: THREE.InstancedMesh
  private items: THREE.Object3D[] = []
  private colors: THREE.Color[] = []
  private root: THREE.Object3D

  /** `root`: the scene part the proxies live in; a proxy cut off from it is not drawn. */
  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    root: THREE.Object3D,
    private shadow = true,
  ) {
    this.root = root
    this.mesh = this.make(256)
    root.add(this.mesh)
  }

  private make(capacity: number) {
    const m = new THREE.InstancedMesh(this.geometry, this.material, capacity)
    m.count = 0
    m.castShadow = this.shadow
    m.receiveShadow = true
    m.frustumCulled = false
    return m
  }

  /** A new proxy (or `proxy`), drawn in `color`. */
  add(color: THREE.Color, proxy = new THREE.Object3D()): THREE.Object3D {
    if (this.items.length >= this.mesh.instanceMatrix.count) {
      // grow: a bigger batch in place of the old one
      const bigger = this.make(this.mesh.instanceMatrix.count * 2)
      this.root.add(bigger)
      this.mesh.removeFromParent()
      this.mesh.dispose()
      this.mesh = bigger
      this.colors.forEach((c, i) => this.mesh.setColorAt(i, c))
    }
    proxy.userData.pool = this
    proxy.userData.pi = this.items.length
    this.items.push(proxy)
    this.colors.push(color)
    this.mesh.setColorAt(this.items.length - 1, color)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    return proxy
  }

  /** Stops drawing `proxy` (the last one takes its place). */
  remove(proxy: THREE.Object3D) {
    const i = proxy.userData.pi as number | undefined
    if (i === undefined || this.items[i] !== proxy) return
    const last = this.items.length - 1
    if (i !== last) {
      const moved = this.items[last]
      this.items[i] = moved
      this.colors[i] = this.colors[last]
      moved.userData.pi = i
      this.mesh.setColorAt(i, this.colors[i])
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    }
    this.items.pop()
    this.colors.pop()
    proxy.userData.pi = undefined
  }

  /** Copies every proxy's place into the batch. Call after the scene's matrices are up to date. */
  sync() {
    const n = this.items.length
    for (let i = 0; i < n; i++) {
      const p = this.items[i]
      this.mesh.setMatrixAt(i, attached(p, this.root) ? p.matrixWorld : HIDDEN)
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear() {
    for (const p of this.items) p.userData.pi = undefined
    this.items = []
    this.colors = []
    this.mesh.count = 0
  }

  dispose() {
    this.mesh.removeFromParent()
    this.mesh.dispose()
  }
}

/** Whether `o` is still in the scene under `root`, and visible all the way up. */
function attached(o: THREE.Object3D, root: THREE.Object3D) {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (!n.visible) return false
    if (n === root) return true
  }
  return false
}

/** Removes every proxy under `o` from its pool. */
export function releaseProxies(o: THREE.Object3D) {
  o.traverse((n) => (n.userData.pool as ProxyPool | undefined)?.remove(n))
}

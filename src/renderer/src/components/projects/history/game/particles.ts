// Voxel particles: hammer sparks, dust, confetti and fireworks. One instanced
// mesh holds them all (a fixed pool), so a big celebration costs one draw call.
import * as THREE from 'three'

import { GOLD } from './palette'

const POOL = 1400

interface P {
  alive: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  spin: THREE.Vector3
  rot: THREE.Euler
  size: number
  life: number
  age: number
  gravity: number
  drag: number
  /** Grows then shrinks (dust) instead of only shrinking. */
  puff: boolean
  /** A firework shell: bursts into confetti when it dies. */
  shell?: THREE.Color[]
}

export type Burst = 'sparks' | 'dust' | 'confetti' | 'firework' | 'poof' | 'ring'

export class Particles {
  readonly mesh: THREE.InstancedMesh
  private ps: P[] = []
  private next = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3()
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.12 })
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    for (let i = 0; i < POOL; i++) {
      this.mesh.setMatrixAt(i, this.hidden)
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1))
      this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), size: 0, life: 1, age: 0, gravity: 0, drag: 0, puff: false })
    }
  }

  private spawn(at: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, size: number, life: number, gravity: number, drag = 0.6, puff = false) {
    const i = this.next
    this.next = (this.next + 1) % POOL
    const p = this.ps[i]
    this.live = true
    p.alive = true
    p.pos.copy(at)
    p.vel.copy(vel)
    p.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4)
    p.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3)
    p.size = size
    p.life = life
    p.age = 0
    p.gravity = gravity
    p.drag = drag
    p.puff = puff
    p.shell = undefined
    this.mesh.setColorAt(i, color)
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    return p
  }

  /** A burst of `kind` at `at`, in `colors` (picked at random per particle). */
  burst(kind: Burst, at: THREE.Vector3, colors: THREE.Color[] = [new THREE.Color(GOLD)], scale = 1) {
    const pick = () => colors[Math.floor(Math.random() * colors.length)]
    const v = new THREE.Vector3()
    const rnd = (k: number) => (Math.random() * 2 - 1) * k
    if (kind === 'sparks') {
      for (let i = 0; i < 9; i++) this.spawn(at, v.set(rnd(1.6), 1.2 + Math.random() * 1.8, rnd(1.6)).multiplyScalar(scale), pick(), 0.05 * scale, 0.35 + Math.random() * 0.25, 9, 1.2)
    } else if (kind === 'dust') {
      const dust = [new THREE.Color(0xe9dcc6), new THREE.Color(0xd6c5a8), new THREE.Color(0xf4ece0)]
      for (let i = 0; i < 10; i++) this.spawn(v.copy(at).add(new THREE.Vector3(rnd(0.5), Math.random() * 0.2, rnd(0.5)).multiplyScalar(scale)), new THREE.Vector3(rnd(0.9), 0.3 + Math.random() * 0.6, rnd(0.9)).multiplyScalar(scale), dust[i % 3], (0.14 + Math.random() * 0.12) * scale, 0.9 + Math.random() * 0.5, -0.2, 2.2, true)
    } else if (kind === 'poof') {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        this.spawn(at, new THREE.Vector3(Math.cos(a) * 1.4, 0.6 + Math.random() * 0.6, Math.sin(a) * 1.4).multiplyScalar(scale), i % 3 === 0 ? new THREE.Color(0xffffff) : pick(), (0.1 + Math.random() * 0.06) * scale, 0.5 + Math.random() * 0.2, -0.5, 3.2, true)
      }
    } else if (kind === 'ring') {
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2
        this.spawn(at, new THREE.Vector3(Math.cos(a) * 2.6, 0.25, Math.sin(a) * 2.6).multiplyScalar(scale), pick(), 0.07 * scale, 0.55, 0, 2.6)
      }
    } else if (kind === 'confetti') {
      for (let i = 0; i < 46; i++) this.spawn(at, new THREE.Vector3(rnd(2.4), 2.4 + Math.random() * 3.2, rnd(2.4)).multiplyScalar(scale), pick(), (0.06 + Math.random() * 0.05) * scale, 1.6 + Math.random() * 0.9, 4.2, 1.4)
    } else if (kind === 'firework') {
      const shell = this.spawn(at, new THREE.Vector3(rnd(0.6), 7 + Math.random() * 2, rnd(0.6)).multiplyScalar(scale), new THREE.Color(0xfff3c4), 0.09 * scale, 0.75 + Math.random() * 0.2, 6, 0.4)
      shell.shell = colors
    }
  }

  /** Whether anything was still flying at the last update. */
  live = false

  update(dt: number) {
    if (dt <= 0) return
    let any = false
    for (let i = 0; i < POOL; i++) {
      const p = this.ps[i]
      if (!p.alive) continue
      any = true
      p.age += dt
      if (p.age >= p.life) {
        p.alive = false
        this.mesh.setMatrixAt(i, this.hidden)
        if (p.shell) this.explode(p.pos.clone(), p.shell)
        continue
      }
      p.vel.y -= p.gravity * dt
      p.vel.multiplyScalar(Math.exp(-p.drag * dt))
      p.pos.addScaledVector(p.vel, dt)
      if (p.pos.y < 0.02 && p.gravity > 0) {
        p.pos.y = 0.02
        p.vel.set(p.vel.x * 0.4, Math.abs(p.vel.y) * 0.25, p.vel.z * 0.4)
      }
      p.rot.x += p.spin.x * dt
      p.rot.y += p.spin.y * dt
      p.rot.z += p.spin.z * dt
      const t = p.age / p.life
      const k = p.puff ? Math.sin(Math.min(1, t * 1.15) * Math.PI) * 1.4 : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3
      this.q.setFromEuler(p.rot)
      this.s.setScalar(Math.max(0.0001, p.size * k))
      this.m.compose(p.pos, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m)
    }
    if (any || this.live) this.mesh.instanceMatrix.needsUpdate = true
    this.live = any
  }

  /** A firework's bloom: a sphere of confetti in its colours. */
  private explode(at: THREE.Vector3, colors: THREE.Color[]) {
    const v = new THREE.Vector3()
    for (let i = 0; i < 40; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(2.4 + Math.random() * 1.2)
      this.spawn(at, v, colors[i % colors.length], 0.08, 1.1 + Math.random() * 0.6, 1.6, 1.8)
    }
  }

  clear() {
    for (let i = 0; i < POOL; i++) {
      this.ps[i].alive = false
      this.mesh.setMatrixAt(i, this.hidden)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.live = false
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

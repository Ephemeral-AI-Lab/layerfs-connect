// The game's colours: the same storybook palette as the 3D map (citadel.tsx),
// so a Branch is the same colour in every view.
import * as THREE from 'three'

export const PASTELS = [0xff6fa8, 0x9b6bff, 0x4fb3ff, 0x3fd6a0, 0xff9f4a, 0xffd23f, 0xff5e7a, 0x2ec4c9, 0xc86bfa, 0x6c8cff, 0xff8c69, 0x8bd63f]
export const CREAM = 0xfff0dc
export const BLUSH = 0xffd9e6
export const STONE = 0xe8dccb
export const STONE_DARK = 0xb9a993
export const TIMBER = 0x9a6a44
export const THATCH = 0xe0b864
export const ROYAL = 0x3d55e8
export const ROSE = 0xff4f9a
export const GOLD = 0xf5c542
export const GLOW = 0xffc94d
export const GRASS = 0x7ed67a
export const GRASS_DARK = 0x5fae7a
export const WATER = 0x5cc2ff
export const SAND = 0xe9d7b8
export const DIRT = 0xc79a6b

/** A Branch's colour, from its name: the same every time, and the same as the 3D map's. */
export function colorOf(name: string): THREE.Color {
  if (name === 'main') return new THREE.Color(CREAM)
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return new THREE.Color(PASTELS[(h >>> 0) % PASTELS.length])
}

export const lighter = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color(0xffffff), k)
export const darker = (c: THREE.Color, k: number) => c.clone().lerp(new THREE.Color(0x000000), k)
export const hex = (c: THREE.Color) => `#${c.getHexString()}`

/** A stable small hash of a string, for picking heroes, angles and so on. */
export function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

// The castle game's shared contracts. Each module (heroes, castle tiers,
// simulator, world) is written against these, so they fit together.
//
// Units: one scene unit is about one metre. A hero is about 0.9 tall. The
// castle stands at the origin on an island; +Y is up. Branch plots ring it.
import type * as THREE from 'three'

// ---- what happened, in order ----------------------------------------------------

export type GameEventKind = 'commit' | 'fork' | 'merge' | 'publish'

/** One thing that happened in the project's history, as the game animates it. */
export interface GameEvent {
  /** Stable across rebuilds of the same history: `${kind}:${id}`. */
  key: string
  kind: GameEventKind
  /** Epoch ms. */
  at: number
  /**
   * The Branch that acted. commit, merge: the Branch that got the Commit.
   * fork: the new Branch. publish: the publisher ('main' when unknown).
   */
  branch: string
  /** commit, merge: the Commit id. fork: the Branch name. publish: the Layer id. */
  id: string
  /** fork: the parent Branch. merge: the Branch merged in. */
  from?: string
  /** fork: the Layer or Commit it forked at. merge: the merged-in Commit. */
  fromId?: string
  message: string
  /** publish: the Layer's number on main (Init is 0, so the first publish is 1). */
  layer?: number
  /** merge: the merged-in Branch has nothing after this, so its plot closes. */
  closes?: boolean
  /** The agent that did it, when known. */
  by?: string
}

// ---- heroes: the website's pixel-art agents, as voxel characters ------------------

export type HeroPose = 'idle' | 'walk' | 'hammer' | 'carry' | 'cheer'

export interface Hero {
  readonly name: string
  /** Feet centre at the origin, facing +Z, about 0.9 tall at scale 1. Move and turn this. */
  readonly root: THREE.Group
  /** What the body is doing; the rig animates it in `update`. */
  pose: HeroPose
  /** Each frame, with the scene clock in seconds. */
  update(time: number): void
  /** A prop held above the head (carry), or null to let go. */
  hold(prop: THREE.Object3D | null): void
  dispose(): void
}

// ---- the castle: a building that grows, and renews into a bigger one ---------------

export interface CastleTier {
  /** 0 = camp; the last tier grows without end. */
  level: number
  /** "Camp", "Cottage", "House", "Manor", "Keep", "Castle", "Citadel". */
  name: string
  /** Published Layers (Init not counted) at which main renews into this tier. */
  minLayers: number
  /** Footprint radius: plots and the moat sit outside it. */
  radius: number
  /** One line for the HUD and the rules list. */
  description: string
}

/** How one published Layer is painted: its publisher's colour. */
export interface LayerPaint {
  color: THREE.Color
  /** "Layer 5 · fix-login", for labels. */
  label: string
}

export interface CastlePiece {
  /** Positioned inside CastleBuild.group. */
  object: THREE.Object3D
  /**
   * base: comes with the tier (built during a renewal).
   * heritage: a foundation stone for a Layer published in an earlier tier.
   * slot: what one Layer added in this tier.
   */
  kind: 'base' | 'heritage' | 'slot'
  /** The Layer number that added it (heritage, slot); 0 for base. */
  layer: number
  /** Build order inside a renewal: lower first (foundations before roofs). */
  order: number
  /** Where builders stand to work on it, in CastleBuild.group space, on the ground (y = 0). */
  anchor: THREE.Vector3
  /** Top of the piece in group space: where the scaffold reaches and sparks fly. */
  top: number
  /** 0 = not there, 1 = finished. Called every frame while animating, so it must be cheap. */
  reveal(p: number): void
}

export interface CastleBuild {
  tier: CastleTier
  group: THREE.Group
  pieces: CastlePiece[]
  /** Height of the highest point, for the camera and fireworks. */
  top: number
  dispose(): void
}

// A Store's identity: its family's mark on a lit tile (SQLite or
// PostgreSQL). Identity only, never state: state stays on the chip, in words.
import { siPostgresql, siSqlite } from 'simple-icons'

import { Mark, Tile } from '@/pages/storage/StorageIcons'
import { cn } from '@/lib/utils'
import type { StoreFamily } from '@/layerfs/host-api'

type Size = 'sm' | 'md' | 'lg'

/** A family's mark in a Tile. */
export function FamilyTile({ family, size = 'md', className }: { family: StoreFamily; size?: Size; className?: string }) {
  return (
    <Tile size={size} className={className}>
      <Mark icon={family === 'postgresql' ? siPostgresql : siSqlite} />
    </Tile>
  )
}

/** One mark on a lit tile: the Store's family. */
export function StoreIcon({ family, size = 'sm', className }: { family: StoreFamily; size?: Size; className?: string }) {
  const label = family === 'postgresql' ? 'PostgreSQL' : 'SQLite'
  return (
    <span role="img" aria-label={label} title={label} className={cn('inline-flex shrink-0', className)}>
      <FamilyTile family={family} size={size} />
    </span>
  )
}

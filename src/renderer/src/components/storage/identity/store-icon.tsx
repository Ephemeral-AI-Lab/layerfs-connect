// A Store's identity (storage-links §3.6, owner 2026-10-30): one mark on a
// neutral tile that says where the Store syncs, no badge. Local-only SQLite
// shows the SQLite mark; SQLite linked to MinIO the MinIO mark, to R2 the
// Cloudflare mark; PostgreSQL the PostgreSQL mark. Identity only, never
// state: state stays on the pill, in words.
import { siPostgresql, siSqlite } from 'simple-icons'

import { isBrandMark, providerEntry, providerLabel } from '@/components/storage/identity/providers'
import { Mark, Tile } from '@/components/storage/icons'
import { cn } from '@/lib/utils'
import type { RemoteInfo, RemoteProvider, StoreFamily, StoreInfo } from '@shared/host-api'

type Size = 'sm' | 'md' | 'lg'

/** A provider's mark: its brand glyph, or its icon. */
export function ProviderMark({ provider, className }: { provider: string | null | undefined; className?: string }) {
  const mark = providerEntry(provider).mark
  if (isBrandMark(mark)) return <Mark icon={mark} className={className} />
  const Icon = mark
  return <Icon aria-hidden="true" className={cn('text-muted-foreground', className)} />
}

/** A provider's mark in a Tile, for location headers and picker tiles. */
export function ProviderTile({ provider, size = 'md', className }: { provider: string | null | undefined; size?: Size; className?: string }) {
  return (
    <Tile size={size} className={className}>
      <ProviderMark provider={provider} />
    </Tile>
  )
}

/** A family's mark in a Tile. */
export function FamilyTile({ family, size = 'md', className }: { family: StoreFamily; size?: Size; className?: string }) {
  return (
    <Tile size={size} className={className}>
      <Mark icon={family === 'postgresql' ? siPostgresql : siSqlite} />
    </Tile>
  )
}

/** The provider of a SQLite Store's link, as a one-item list (none when local only or PostgreSQL). */
export function storeProviders(store: Pick<StoreInfo, 'kind' | 'link'>, remotes: RemoteInfo[] = []): RemoteProvider[] {
  if (store.kind !== 'sqlite' || !store.link) return []
  const p = store.link.provider ?? remotes.find((r) => r.name === store.link?.remote)?.provider ?? null
  return p ? [p] : []
}

/** The icon's name and tooltip: "Local only", "MinIO", "Cloudflare R2", "PostgreSQL". */
export function storeIconLabel(family: StoreFamily, providers: RemoteProvider[]): string {
  if (family === 'postgresql') return 'PostgreSQL'
  return providers.length ? providerLabel(providers[0]) : 'Local only'
}

interface StoreIconProps {
  family: StoreFamily
  /** The provider of the Store's link (storeProviders); ignored for PostgreSQL. */
  providers?: RemoteProvider[]
  size?: Size
  className?: string
}

/** One mark on a neutral tile: the linked provider's for SQLite with a link, else the family's. */
export function StoreIcon({ family, providers = [], size = 'sm', className }: StoreIconProps) {
  const provider = family === 'sqlite' ? (providers[0] ?? null) : null
  const label = storeIconLabel(family, provider ? [provider] : [])
  return (
    <span role="img" aria-label={label} title={label} className={cn('inline-flex shrink-0', className)}>
      {provider ? <ProviderTile provider={provider} size={size} /> : <FamilyTile family={family} size={size} />}
    </span>
  )
}

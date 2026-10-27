import { FolderOpen } from 'lucide-react'
import { siCloudflare, siGoogledrive, siMinio, siPostgresql, siSqlite } from 'simple-icons'

import { cn } from '@/lib/utils'

/** Where a local Store's file could be copied to and from, once LayerFS has remotes. */
export type Provider = 'google-drive' | 's3' | 'r2' | 'minio' | 'folder'

export const PROVIDER_LABEL: Record<Provider, string> = {
  'google-drive': 'Google Drive',
  s3: 'Amazon S3',
  r2: 'Cloudflare R2',
  minio: 'MinIO',
  folder: 'Folder',
}

type SimpleIcon = { title: string; path: string }

/** A brand mark from simple-icons, drawn in the current text colour. */
function Mark({ icon, className }: { icon: SimpleIcon; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('fill-current', className)}>
      <path d={icon.path} />
    </svg>
  )
}

const TILE = {
  sm: 'size-7 rounded-md [&_svg]:size-3.5 text-[10px]',
  md: 'size-9 rounded-lg [&_svg]:size-[18px] text-[11px]',
  lg: 'size-11 rounded-xl [&_svg]:size-[22px] text-[13px]',
}

/** A quiet square that holds one glyph, so every source lines up. */
export function Tile({ size = 'md', className, children }: { size?: keyof typeof TILE; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-muted text-foreground/80 ring-1 ring-foreground/5 ring-inset',
        TILE[size],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function ProviderGlyph({ provider, className }: { provider: Provider; className?: string }) {
  switch (provider) {
    case 'google-drive':
      return <Mark icon={siGoogledrive} className={className} />
    case 'r2':
      return <Mark icon={siCloudflare} className={className} />
    case 'minio':
      return <Mark icon={siMinio} className={className} />
    case 'folder':
      return <FolderOpen aria-hidden="true" className={className} />
    case 's3':
      // simple-icons carries no AWS marks, so S3 gets a monogram.
      return (
        <span aria-hidden="true" className={cn('font-semibold tracking-tight', className)}>
          S3
        </span>
      )
  }
}

export function ProviderIcon({ provider, size }: { provider: Provider; size?: keyof typeof TILE }) {
  return (
    <Tile size={size}>
      <ProviderGlyph provider={provider} />
    </Tile>
  )
}

export function DatabaseIcon({ kind, size }: { kind: 'sqlite' | 'postgres'; size?: keyof typeof TILE }) {
  return (
    <Tile size={size}>
      <Mark icon={kind === 'sqlite' ? siSqlite : siPostgresql} />
    </Tile>
  )
}

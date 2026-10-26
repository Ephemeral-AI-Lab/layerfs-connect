// Storage: where projects' committed history lives.
//
// - Local storage: SQLite database files in layerfs/local_storage. A file
//   holds 0 to n projects. LayerFS only ever opens the file there; a sync
//   location (Google Drive, an S3-compatible bucket or a folder) only
//   carries whole-file copies, pulled in and pushed back.
// - Remote storage: PostgreSQL databases over HTTP, always live. Each holds
//   0 to n projects; there is nothing to push or pull.
//
// Sample data until LayerFS has remotes and a PostgreSQL backend (#446,
// A4–A9).

export type Provider = 'google-drive' | 's3' | 'r2' | 'minio' | 'folder'

export type Health = 'connected' | 'needs-sign-in' | 'unreachable' | 'not-checked'

export interface Field {
  label: string
  value: string
  /** Shown masked; kept in the system keychain, never in config files. */
  secret?: boolean
}

/** A place a local database's file is copied to and from. */
export interface SyncLocation {
  id: string
  name: string
  provider: Provider
  /** One line saying where it points. */
  where: string
  fields: Field[]
  health: Health
}

/** A local database's file against its copy at the sync location. */
export type SyncState =
  | { state: 'in-sync' }
  | { state: 'ahead'; commits: number }
  | { state: 'behind' }
  | { state: 'diverged'; commits: number }

export interface LocalDatabase {
  kind: 'sqlite'
  id: string
  /** File name in local_storage. */
  file: string
  size: string
  sync?: {
    location: string
    /** The file's path at the location. */
    remotePath: string
    status: SyncState
    pulled: string
    pushed: string
    /** The machine holding the checkout lock, if any. */
    checkedOutBy?: string
    autoPush: boolean
  }
}

export interface PostgresDatabase {
  kind: 'postgres'
  id: string
  endpoint: string
  database: string
  token: string
  health: Health
  latencyMs?: number
}

export type Database = LocalDatabase | PostgresDatabase

export const THIS_MACHINE = 'this machine'

/** Where local_storage lives; on macOS and Windows, the LayerFS box's Linux volume. */
export const LOCAL_STORAGE = 'LayerFS box · local_storage'

export const PROVIDER_LABEL: Record<Provider, string> = {
  'google-drive': 'Google Drive',
  s3: 'Amazon S3',
  r2: 'Cloudflare R2',
  minio: 'MinIO',
  folder: 'Folder',
}

export const databaseName = (db: Database) =>
  db.kind === 'sqlite' ? db.file : `${new URL(db.endpoint).host} / ${db.database}`

export const SYNC_LOCATIONS: SyncLocation[] = [
  {
    id: 'drive-personal',
    name: 'Drive · personal',
    provider: 'google-drive',
    where: 'Personal Google account',
    fields: [{ label: 'Account', value: 'Personal Google account' }],
    health: 'connected',
  },
  {
    id: 's3-eu',
    name: 'S3 · eu-west',
    provider: 's3',
    where: 's3://layerfs-eu · eu-west-1',
    fields: [
      { label: 'Bucket', value: 'layerfs-eu' },
      { label: 'Region', value: 'eu-west-1' },
      { label: 'Access key', value: 'AKIA…7Q2M', secret: true },
    ],
    health: 'connected',
  },
  {
    id: 'r2-main',
    name: 'R2 · main',
    provider: 'r2',
    where: 'r2://layerfs-main',
    fields: [
      { label: 'Bucket', value: 'layerfs-main' },
      { label: 'Endpoint', value: 'https://<account>.r2.cloudflarestorage.com' },
      { label: 'Access key', value: '9f3c…a71e', secret: true },
    ],
    health: 'connected',
  },
  {
    id: 's3-us',
    name: 'S3 · us-east',
    provider: 's3',
    where: 's3://layerfs-us · us-east-1',
    fields: [
      { label: 'Bucket', value: 'layerfs-us' },
      { label: 'Region', value: 'us-east-1' },
      { label: 'Access key', value: 'AKIA…3XKD', secret: true },
    ],
    health: 'needs-sign-in',
  },
]

export const DATABASES: Database[] = [
  { kind: 'sqlite', id: 'default', file: 'default.sqlite', size: '48.1 MB' },
  {
    kind: 'sqlite',
    id: 'team',
    file: 'team.sqlite',
    size: '12.4 MB',
    sync: {
      location: 'drive-personal',
      remotePath: '/LayerFS/team.sqlite',
      status: { state: 'ahead', commits: 2 },
      pulled: 'today 10:42',
      pushed: 'yesterday 18:05',
      checkedOutBy: THIS_MACHINE,
      autoPush: false,
    },
  },
  {
    kind: 'sqlite',
    id: 'archive',
    file: 'archive.sqlite',
    size: '210 MB',
    sync: {
      location: 'r2-main',
      remotePath: 'archive.sqlite',
      status: { state: 'behind' },
      pulled: '3 days ago',
      pushed: '3 days ago',
      checkedOutBy: 'build-box',
      autoPush: false,
    },
  },
  {
    kind: 'sqlite',
    id: 'lab',
    file: 'lab.sqlite',
    size: '3.2 MB',
    sync: {
      location: 's3-eu',
      remotePath: 'lab/lab.sqlite',
      status: { state: 'diverged', commits: 1 },
      pulled: 'today 08:10',
      pushed: 'yesterday 21:30',
      autoPush: true,
    },
  },
  { kind: 'sqlite', id: 'scratch', file: 'scratch.sqlite', size: '0.2 MB' },
  {
    kind: 'postgres',
    id: 'pg-team',
    endpoint: 'https://pg.team.example',
    database: 'layerfs',
    token: 'lfs_…4b9e',
    health: 'connected',
    latencyMs: 38,
  },
  {
    kind: 'postgres',
    id: 'pg-lab',
    endpoint: 'https://pg.lab.example',
    database: 'layerfs',
    token: 'lfs_…02c1',
    health: 'unreachable',
  },
]

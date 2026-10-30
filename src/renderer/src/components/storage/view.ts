// The storage view as the page reads it. The host answers storage-links §5
// (layerfs#509: one link per SQLite Store), but a host or LayerFS build from
// before it leaves fields out, so every answer goes through normalizeView
// first: a missing field becomes its "unknown" value, never a crash. Nothing
// here decides a link's sync state when the host gave one; without one, a
// link reads "Sync unknown".
import { providerEntry } from '@/components/storage/identity/providers'
import { isSyncState } from '@/components/storage/sync/sync-state'
import { HostError, host } from '@/host/client'
import type {
  CopyCheck,
  Health,
  PostgresqlConnection,
  ProviderInfo,
  RemoteFile,
  RemoteInfo,
  RemoteProvider,
  StorageSupports,
  StorageTotals,
  StorageView,
  StoreInfo,
  StoreLink,
  StoreSyncState,
  SyncJob,
  SyncPhase,
  SyncState,
  TransferInfo,
} from '@shared/host-api'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const arr = (x: Raw): Raw[] => (Array.isArray(x) ? x : [])
const num = (x: Raw): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: Raw): string | null => (typeof x === 'string' ? x : null)
const strs = (x: Raw): string[] => arr(x).filter((v) => typeof v === 'string')

const PHASES: SyncPhase[] = ['check', 'snapshot', 'hash', 'upload', 'download', 'verify', 'install', 'copy', 'record']
const COPY_STATES: SyncState[] = ['in_sync', 'ahead', 'behind', 'diverged', 'missing', 'checking', 'unreachable', 'unknown', 'transferring']
const copyState = (x: Raw): SyncState | null => (COPY_STATES.includes(x) ? x : null)

export const UNKNOWN_HEALTH: Health = { state: 'unknown', at: null, message: null }

function health(h: Raw): Health {
  if (!h || typeof h !== 'object') return UNKNOWN_HEALTH
  const state = ['ok', 'unreachable', 'denied', 'checking', 'unknown'].includes(h.state) ? h.state : 'unknown'
  return { state, at: num(h.at), message: str(h.message) }
}

function transfer(t: Raw): TransferInfo | null {
  if (!t || typeof t !== 'object') return null
  return { direction: t.direction === 'pull' ? 'pull' : 'push', at: num(t.at), bytes: num(t.bytes), sha256: str(t.sha256), heads: str(t.heads) }
}

function check(c: Raw): CopyCheck | null {
  if (!c || typeof c !== 'object') return null
  return {
    at: num(c.at) ?? 0,
    present: c.present === true,
    bytes: num(c.bytes),
    sha256: str(c.sha256),
    heads: str(c.heads),
    modified: num(c.modified),
    error: c.error && typeof c.error === 'object' ? { code: String(c.error.code ?? ''), message: String(c.error.message ?? '') } : null,
  }
}

/** host/bucket/prefix, from the registry's location line. */
const whereOf = (r: Raw) => providerEntry(r.provider).where({ endpoint: str(r.endpoint) ?? '', bucket: str(r.bucket) ?? '', prefix: str(r.prefix) ?? '', account: str(r.account), jurisdiction: str(r.jurisdiction) })

function link(l: Raw, store: string, remotes: Raw[]): StoreLink | null {
  if (!l || typeof l !== 'object' || !str(l.remote) || !str(l.file)) return null
  const remote = String(l.remote)
  const file = String(l.file)
  const r = remotes.find((x) => x.name === remote)
  const sync = copyState(l.sync)
  return {
    remote,
    provider: (str(l.provider) ?? str(r?.provider)) as RemoteProvider | null,
    file,
    object: str(l.object) ?? `${r ? (str(r.location) ?? whereOf(r)) : remote}/${file}/store.sqlite`,
    linked: num(l.linked),
    last: transfer(l.last),
    check: check(l.check),
    failedCheck: check(l.failedCheck),
    local: ['same', 'changed', 'unknown'].includes(l.local) ? l.local : 'unknown',
    remoteSide: ['same', 'changed', 'missing', 'unknown'].includes(l.remoteSide) ? l.remoteSide : 'unknown',
    sync: sync ?? 'unknown',
    lastKnown: copyState(l.lastKnown),
    reason: str(l.reason) ?? (sync ? null : `This LayerFS build can’t tell whether ${store} changed since its last push or pull.`),
  }
}

function store(s: Raw, remotes: Raw[]): StoreInfo {
  const name = String(s.name ?? '')
  const kind = s.kind === 'postgresql' ? 'postgresql' : 'sqlite'
  const linked = kind === 'sqlite' ? link(s.link, name, remotes) : null
  const legacyBytes = num(s.bytes)
  const size =
    s.size && typeof s.size === 'object' && num(s.size.bytes) !== null
      ? { bytes: num(s.size.bytes)!, file: num(s.size.file), wal: num(s.size.wal), at: num(s.size.at) ?? 0 }
      : legacyBytes !== null
        ? { bytes: legacyBytes, file: null, wal: null, at: 0 }
        : null
  const hostState: StoreSyncState | null = isSyncState(s.sync?.state) ? s.sync.state : null
  const state: StoreSyncState = hostState ?? (kind === 'postgresql' ? 'live' : linked ? linked.sync : 'local_only')
  return {
    name,
    kind,
    volume: str(s.volume),
    connection: str(s.connection),
    schema: str(s.schema),
    synchronousCommit: str(s.synchronousCommit) as StoreInfo['synchronousCommit'],
    link: linked,
    projects: strs(s.projects),
    created: num(s.created),
    legacy: s.legacy === true,
    size,
    bytes: size?.bytes ?? null,
    open: typeof s.open === 'boolean' ? s.open : null,
    sync: { state },
    importedFrom: s.importedFrom && typeof s.importedFrom === 'object' && str(s.importedFrom.store) ? { store: s.importedFrom.store, at: num(s.importedFrom.at), bytes: num(s.importedFrom.bytes) } : null,
    imports: strs(s.imports),
    job: str(s.job),
  }
}

function remote(r: Raw, stores: StoreInfo[]): RemoteInfo {
  const name = String(r.name ?? '')
  const mine = stores.filter((s) => s.link?.remote === name)
  const files: RemoteFile[] | null = Array.isArray(r.files)
    ? arr(r.files)
        .filter((f) => typeof f?.file === 'string')
        .map((f) => ({ file: f.file, bytes: num(f.bytes), modified: num(f.modified), linkedBy: str(f.linkedBy) }))
    : null
  const known = (files ?? mine.map((s) => ({ bytes: s.link?.check?.bytes ?? s.link?.last?.bytes ?? null }))).filter((f) => f.bytes !== null)
  return {
    name,
    provider: (str(r.provider) ?? 'minio') as RemoteProvider,
    endpoint: str(r.endpoint) ?? '',
    reachAs: str(r.reachAs) ?? str(r.endpoint) ?? '',
    account: str(r.account),
    jurisdiction: str(r.jurisdiction),
    bucket: str(r.bucket) ?? '',
    prefix: str(r.prefix) ?? '',
    hasSecret: r.hasSecret !== false,
    location: str(r.location) ?? whereOf(r),
    stores: Array.isArray(r.stores) ? strs(r.stores) : mine.map((s) => s.name),
    files,
    bytes: num(r.bytes) ?? (known.length ? known.reduce((n, f) => n + f.bytes!, 0) : null),
    health: health(r.health),
  }
}

/** host:port and database from a postgresql:// URL (the password is redacted already). */
function parseUrl(url: string): { host: string | null; database: string | null } {
  try {
    const u = new URL(url)
    return { host: u.host || null, database: u.pathname.replace(/^\//, '') || null }
  } catch {
    return { host: null, database: null }
  }
}

function connection(c: Raw, stores: StoreInfo[]): PostgresqlConnection {
  const name = String(c.name ?? '')
  const url = str(c.url) ?? ''
  const parsed = parseUrl(url)
  const mine = stores.filter((s) => s.kind === 'postgresql' && s.connection === name)
  const h = health(c.health)
  return {
    name,
    url,
    synchronousCommit: (str(c.synchronousCommit) ?? 'off') as PostgresqlConnection['synchronousCommit'],
    stores: Array.isArray(c.stores) ? strs(c.stores) : mine.map((s) => s.name),
    host: str(c.host) ?? parsed.host,
    database: str(c.database) ?? parsed.database,
    health: { ...h, serverVersion: str(c.health?.serverVersion), latencyMs: num(c.health?.latencyMs) },
    bytes: num(c.bytes),
  }
}

/** A job from any host: a string error becomes { code: '', message }, an old step word becomes running, done or failed. */
export function normalizeJob(j: Raw, remotes: Pick<RemoteInfo, 'name' | 'provider'>[] = []): SyncJob {
  const kind: SyncJob['kind'] = ['publish', 'push', 'pull', 'send', 'load', 'import'].includes(j.kind) ? j.kind : 'push'
  const ended = num(j.ended)
  const error =
    typeof j.error === 'string' ? { code: '', message: j.error } : j.error && typeof j.error === 'object' ? { code: String(j.error.code ?? ''), message: String(j.error.message ?? '') } : null
  const step: SyncJob['step'] = j.step === 'failed' || (ended !== null && error) ? 'failed' : j.step === 'done' || ended !== null ? 'done' : 'running'
  const target = String(j.target ?? '')
  return {
    id: String(j.id ?? ''),
    kind,
    store: String(j.store ?? ''),
    target,
    file: str(j.file),
    from: str(j.from),
    provider: (str(j.provider) as SyncJob['provider']) ?? (kind === 'import' ? 'postgresql' : (remotes.find((r) => r.name === target)?.provider ?? null)),
    force: j.force === true,
    step,
    phase: PHASES.includes(j.phase) ? j.phase : null,
    bytes: num(j.bytes),
    total: num(j.total),
    pieces: j.pieces && num(j.pieces.done) !== null && num(j.pieces.of) !== null ? { done: j.pieces.done, of: j.pieces.of } : null,
    rate: num(j.rate),
    eta: num(j.eta),
    cancellable: j.cancellable === true,
    error,
    result: j.result && typeof j.result === 'object' ? { bytes: num(j.result.bytes), sha256: str(j.result.sha256) } : null,
    started: num(j.started) ?? Date.now(),
    ended,
  }
}

function totals(stores: StoreInfo[], connections: PostgresqlConnection[]): StorageTotals {
  const sum = (list: StoreInfo[]) => ({ bytes: list.reduce((n, s) => n + (s.size?.bytes ?? 0), 0), unknown: list.filter((s) => !s.size).length })
  const sqlite = stores.filter((s) => s.kind === 'sqlite')
  const pg = stores.filter((s) => s.kind === 'postgresql')
  const sync: Partial<Record<StoreSyncState, number>> = {}
  for (const s of stores) sync[s.sync.state] = (sync[s.sync.state] ?? 0) + 1
  const linked = sqlite.filter((s) => s.link).map((s) => s.link!.check?.bytes ?? s.link!.last?.bytes ?? null)
  return {
    sqlite: { stores: sqlite.length, ...sum(sqlite) },
    postgresql: { stores: pg.length, connections: connections.length, ...sum(pg) },
    linked: { stores: linked.length, bytes: linked.reduce<number>((n, b) => n + (b ?? 0), 0), unknown: linked.filter((b) => b === null).length },
    sync,
  }
}

const part = (p: Raw, fallback: string) => ({
  available: p?.available === true,
  reason: str(p?.reason) ?? (p?.available === true ? null : fallback),
})

/** Any host's /api/storage answer as a whole §5 view. */
export function normalizeView(raw: Raw): StorageView {
  const v = raw && typeof raw === 'object' ? raw : {}
  const rawRemotes = arr(v.remotes?.list)
  const stores = arr(v.stores?.list).map((s) => store(s, rawRemotes))
  const remotes = rawRemotes.map((r) => remote(r, stores))
  const connections = arr(v.postgresql?.connections).map((c) => connection(c, stores))
  const t = v.totals && typeof v.totals === 'object' && v.totals.sqlite && v.totals.linked ? (v.totals as StorageTotals) : totals(stores, connections)
  const s = v.supports && typeof v.supports === 'object' ? v.supports : {}
  const supports: StorageSupports = {
    size: s.size === true || stores.some((x) => x.size !== null),
    heads: s.heads === true,
    check: s.check === true,
    progress: s.progress === true,
    postgresqlStatus: s.postgresqlStatus === true || connections.some((c) => c.health.serverVersion !== null),
    listCopies: s.listCopies === true || remotes.some((r) => r.files !== null),
  }
  return {
    stores: { ...part(v.stores, 'This LayerFS build keeps one Store per project (layerfs#506).'), list: stores },
    remotes: { ...part(v.remotes, 'Needs a LayerFS build with remotes (layerfs#506).'), list: remotes },
    postgresql: { ...part(v.postgresql, 'Needs a LayerFS build with PostgreSQL Stores (layerfs#506).'), connections },
    jobs: arr(v.jobs).map((j) => normalizeJob(j, remotes)),
    providers: arr(v.providers).filter((p) => p && typeof p.id === 'string') as ProviderInfo[],
    totals: t,
    supports,
    checkedAt: num(v.checkedAt),
    checking: num(v.checking) ?? 0,
  }
}

/** GET /api/storage, normalized; null from a host that has no such route (before layerfs#506). */
export const loadStorage = (): Promise<StorageView | null> =>
  host.storage().then(normalizeView, (e: unknown) => {
    if (e instanceof HostError && e.status === 404) return null
    throw e
  })

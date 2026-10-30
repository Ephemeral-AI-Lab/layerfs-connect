// The provider registry (storage-redesign §7.3): one entry per place a SQLite
// Store's copy can live, so adding a provider is data, not layout. The Add
// location picker, the marks, the location line and the add form all read it.
// PostgreSQL is not here: it is a database, not a copy location.
import { Cloud, FolderOpen, type LucideIcon } from 'lucide-react'
import { type SimpleIcon, siCloudflare, siGooglecloudstorage, siGoogledrive, siMinio } from 'simple-icons'

import { AWS_MARK } from '@/components/storage/icons'
import type { NewRemote, ProviderInfo, RemoteInfo, RemoteProvider, StorageView } from '@shared/host-api'

export type BrandMark = Pick<SimpleIcon, 'path' | 'hex'>

export const isBrandMark = (mark: BrandMark | LucideIcon): mark is BrandMark => typeof mark === 'object' && mark !== null && 'path' in mark

export const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const ACCOUNT = /^[0-9a-f]{32}$/

export type FieldValues = Record<string, string>

/** One input of a provider's add form. */
export interface ProviderField {
  key: string
  label: string
  kind: 'text' | 'secret' | 'select' | 'url'
  placeholder?: string
  default?: string
  options?: { value: string; label: string }[]
  /** Mono input text (names, paths, keys). */
  mono?: boolean
  /** A problem with the value as typed, or null; empty values are reported by `missing`. */
  validate?: (value: string, values: FieldValues) => string | null
  /** The word for it in "Still needed: …"; omit for an optional field. */
  needed?: string
}

/** A line of help between fields, from the values as typed. */
export interface ProviderNote {
  after: string
  text: (values: FieldValues) => string
  mono?: boolean
}

export interface ProviderEntry {
  id: RemoteProvider | string
  label: string
  family: 'copy'
  mark: BrandMark | LucideIcon
  /** Search words: every S3-speaking provider answers "s3". */
  aliases: string[]
  /** One line on what it is, for the form's header. */
  about: string
  /** How the location line reads. */
  where: (r: Pick<RemoteInfo, 'endpoint' | 'bucket' | 'prefix' | 'account' | 'jurisdiction'>) => string
  /** The add form; empty for a provider Connect can't add yet. */
  fields: ProviderField[]
  notes: ProviderNote[]
  /** The host's request from the form's values. */
  request?: (values: FieldValues) => NewRemote
}

const join = (...parts: (string | null | undefined)[]) => parts.filter((p) => p).join('/')
const nameField: ProviderField = { key: 'name', label: 'Name', kind: 'text', mono: true, validate: (v) => (NAME.test(v) ? null : 'Lower-case letters, digits and hyphens.') }
const bucketField: ProviderField = {
  key: 'bucket',
  label: 'Bucket',
  kind: 'text',
  placeholder: 'your bucket’s name',
  mono: true,
  needed: 'bucket',
  validate: (v) => (!v || BUCKET.test(v) ? null : '3–63 lower-case letters, digits, dots and hyphens.'),
}
const prefixField: ProviderField = { key: 'prefix', label: 'Prefix', kind: 'text', default: 'layerfs', mono: true }
const keys: ProviderField[] = [
  { key: 'accessKey', label: 'Access key', kind: 'text', mono: true, needed: 'access key' },
  { key: 'secretKey', label: 'Secret key', kind: 'secret', mono: true, needed: 'secret key' },
]
const objectNote = (extra: string): ProviderNote => ({
  after: 'prefix',
  text: (v) => `Each Store file is ${v.prefix ? `${v.prefix}/` : ''}<file>/store.sqlite.${extra}`,
})
const keysNote: ProviderNote = { after: 'secretKey', text: () => 'The keys stay in Connect, readable by your user only. LayerFS gets them for each push and pull.' }

const MINIO: ProviderEntry = {
  id: 'minio',
  label: 'MinIO',
  family: 'copy',
  mark: siMinio,
  aliases: ['s3', 'minio', 'self-hosted'],
  about: 'A bucket that holds your SQLite Store files.',
  where: (r) => join(r.endpoint.replace(/^https?:\/\//, ''), r.bucket, r.prefix),
  fields: [nameField, { key: 'endpoint', label: 'Endpoint', kind: 'url', default: 'http://localhost:9000', mono: true, needed: 'endpoint' }, bucketField, prefixField, ...keys],
  notes: [objectNote(' On macOS the LayerFS box reaches this machine’s localhost as host.docker.internal.'), keysNote],
  request: (v) => ({ name: v.name, provider: 'minio', endpoint: v.endpoint, bucket: v.bucket, prefix: v.prefix, accessKey: v.accessKey, secretKey: v.secretKey }),
}

const r2Host = (v: FieldValues) =>
  `https://${(v.account ?? '').trim().toLowerCase() || '<account>'}${v.jurisdiction ? `.${v.jurisdiction}` : ''}.r2.cloudflarestorage.com`

const R2: ProviderEntry = {
  id: 'r2',
  label: 'Cloudflare R2',
  family: 'copy',
  mark: siCloudflare,
  aliases: ['s3', 'cloudflare', 'r2'],
  about: 'A bucket that holds your SQLite Store files, over HTTPS.',
  where: (r) => join(r.account ? `${r.account.slice(0, 4)}…${r.account.slice(-2)}` : r.endpoint.replace(/^https?:\/\//, ''), r.bucket, r.prefix),
  fields: [
    nameField,
    {
      key: 'account',
      label: 'Account ID',
      kind: 'text',
      placeholder: 'from the R2 overview page',
      mono: true,
      needed: 'account ID',
      validate: (v) => (!v || ACCOUNT.test(v.trim().toLowerCase()) ? null : 'The 32-character account ID from the Cloudflare dashboard.'),
    },
    {
      key: 'jurisdiction',
      label: 'Jurisdiction',
      kind: 'select',
      default: '',
      options: [
        { value: '', label: 'None' },
        { value: 'eu', label: 'EU' },
        { value: 'fedramp', label: 'FedRAMP' },
      ],
    },
    bucketField,
    prefixField,
    ...keys,
  ],
  notes: [
    { after: 'jurisdiction', text: r2Host, mono: true },
    objectNote(' Use an R2 API token’s S3 access key and secret, with Object Read & Write on this bucket.'),
    keysNote,
  ],
  request: (v) => ({
    name: v.name,
    provider: 'r2',
    account: v.account.trim().toLowerCase(),
    jurisdiction: (v.jurisdiction ?? '') as '' | 'eu' | 'fedramp',
    bucket: v.bucket,
    prefix: v.prefix,
    accessKey: v.accessKey.trim(),
    secretKey: v.secretKey,
  }),
}

/** A provider LayerFS lists but Connect can't add yet: a label and a mark. */
const coming = (id: RemoteProvider, label: string, mark: BrandMark | LucideIcon, aliases: string[]): ProviderEntry => ({
  id,
  label,
  family: 'copy',
  mark,
  aliases,
  about: 'Your SQLite Store files.',
  where: (r) => join(r.endpoint, r.bucket, r.prefix),
  fields: [],
  notes: [],
})

export const PROVIDERS: ProviderEntry[] = [
  MINIO,
  R2,
  coming('s3', 'Amazon S3', AWS_MARK, ['s3', 'aws', 'amazon']),
  coming('gcs', 'Google Cloud Storage', siGooglecloudstorage, ['gcs', 'google', 'cloud storage']),
  coming('google-drive', 'Google Drive', siGoogledrive, ['drive', 'google']),
  coming('folder', 'Folder', FolderOpen, ['folder', 'disk', 'backup', 'local']),
]

/** The entry for an id; a newer LayerFS build's unknown provider gets a generic one: a cloud, its id, no form. */
export function providerEntry(id: string | null | undefined): ProviderEntry {
  return PROVIDERS.find((p) => p.id === id) ?? { ...coming('s3', id || 'Unknown provider', Cloud, []), id: id ?? 'unknown' }
}

export const providerLabel = (id: string | null | undefined) => providerEntry(id).label

/** Without E8: MinIO and R2 when remotes are on, the rest Coming (§10.4). */
export function providerInfos(view: Pick<StorageView, 'providers' | 'remotes'> | null | undefined): ProviderInfo[] {
  const known = view?.providers?.length ? view.providers : null
  return PROVIDERS.map((p) => {
    const info = known?.find((k) => k.id === p.id)
    if (info) return { ...info, available: info.available && p.fields.length > 0 }
    const live = (p.id === 'minio' || p.id === 'r2') && view?.remotes.available === true
    return { id: p.id as RemoteProvider, available: live, reason: live ? null : view?.remotes.available ? 'Not in this LayerFS build yet' : (view?.remotes.reason ?? 'Needs a LayerFS build with remotes (layerfs#506)') }
  })
}

/** Whether a provider matches a search: its label, id or aliases. */
export const providerMatches = (p: ProviderEntry, q: string) => {
  const t = q.trim().toLowerCase()
  return !t || p.label.toLowerCase().includes(t) || String(p.id).includes(t) || p.aliases.some((a) => a.includes(t))
}

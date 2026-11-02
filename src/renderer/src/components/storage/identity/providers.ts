// The bucket providers the Connect-a-bucket modal offers (restored from the
// 1.1.0 Storage page): MinIO and Cloudflare R2, each with its brand mark,
// its form's fields and its help notes. LayerFS 2.0's backups take r2 and
// MinIO only; the others show as coming with a later LayerFS.
import { FolderOpen, type LucideIcon } from 'lucide-react'
import { type SimpleIcon, siCloudflare, siGooglecloudstorage, siGoogledrive, siMinio } from 'simple-icons'

import { AWS_MARK } from '@/components/storage/icons'
import { t } from '@/i18n'

type BrandMark = SimpleIcon | typeof AWS_MARK
export const isBrandMark = (mark: BrandMark | LucideIcon): mark is BrandMark => typeof mark === 'object' && mark !== null && 'path' in mark

const ACCOUNT = /^[0-9a-f]{32}$/
export type FieldValues = Record<string, string>

export interface ProviderField {
  key: string
  label: string
  kind: 'text' | 'secret' | 'select' | 'url'
  placeholder?: string
  default?: string
  options?: { value: string; label: string }[]
  mono?: boolean
  validate?: (value: string) => string | null
  /** The word for it in "Still needed: …"; omit for an optional field. */
  needed?: string
}

export interface ProviderNote {
  after: string
  text: (values: FieldValues) => string
  mono?: boolean
}

export interface ProviderEntry {
  id: 'minio' | 'r2' | string
  label: string
  mark: BrandMark | LucideIcon
  about: string
  fields: ProviderField[]
  notes: ProviderNote[]
  /** The host's connectBucket input from the form's values; absent while LayerFS cannot back up there. */
  request?: (values: FieldValues) => { name: string; provider: 'minio' | 'r2'; endpoint?: string; account?: string; jurisdiction?: string; bucket: string; prefix?: string; accessKey: string; secretKey: string }
}

const nameField: ProviderField = { key: 'name', label: 'Name', kind: 'text', needed: 'name', placeholder: 'backups' }
const bucketField: ProviderField = { key: 'bucket', label: 'Bucket', kind: 'text', placeholder: 'your bucket’s name', needed: 'bucket' }
const prefixField: ProviderField = { key: 'prefix', label: 'Prefix', kind: 'text', default: 'layerfs', mono: true }
const keys: ProviderField[] = [
  { key: 'accessKey', label: 'Access key', kind: 'text', mono: true, needed: 'access key' },
  { key: 'secretKey', label: 'Secret key', kind: 'secret', mono: true, needed: 'secret key' },
]
const objectNote = (extra: string): ProviderNote => ({
  after: 'prefix',
  text: (v) => `${t('Each Store backup is {path}.', { path: `${v.prefix ? `${v.prefix}/` : ''}<file>/store.sqlite` })}${extra ? ` ${t(extra)}` : ''}`,
})
const keysNote: ProviderNote = { after: 'secretKey', text: () => t('Connect keeps the keys in a file only you can read and gives LayerFS its reference, never the keys.') }

const MINIO: ProviderEntry = {
  id: 'minio',
  label: 'MinIO',
  mark: siMinio,
  about: 'A bucket that holds your Store backups.',
  fields: [nameField, { key: 'endpoint', label: 'Endpoint', kind: 'url', default: 'http://localhost:9000', mono: true, needed: 'endpoint' }, bucketField, prefixField, ...keys],
  notes: [objectNote(''), keysNote],
  request: (v) => ({ name: v.name, provider: 'minio', endpoint: v.endpoint, bucket: v.bucket, prefix: v.prefix, accessKey: v.accessKey, secretKey: v.secretKey }),
}

const r2Host = (v: FieldValues) => `https://${(v.account ?? '').trim().toLowerCase() || '<account>'}${v.jurisdiction ? `.${v.jurisdiction}` : ''}.r2.cloudflarestorage.com`

const R2: ProviderEntry = {
  id: 'r2',
  label: 'Cloudflare R2',
  mark: siCloudflare,
  about: 'A bucket that holds your Store backups, over HTTPS.',
  fields: [
    nameField,
    { key: 'account', label: 'Account ID', kind: 'text', placeholder: 'from the R2 overview page', mono: true, needed: 'account ID', validate: (v) => (!v || ACCOUNT.test(v.trim().toLowerCase()) ? null : 'The 32-character account ID from the Cloudflare dashboard.') },
    { key: 'jurisdiction', label: 'Jurisdiction', kind: 'select', default: '', options: [{ value: '', label: 'None' }, { value: 'eu', label: 'EU' }, { value: 'fedramp', label: 'FedRAMP' }] },
    bucketField,
    prefixField,
    ...keys,
  ],
  notes: [{ after: 'jurisdiction', text: r2Host, mono: true }, objectNote('Use an R2 API token’s S3 access key and secret, with Object Read & Write on this bucket.'), keysNote],
  request: (v) => ({ name: v.name, provider: 'r2', account: v.account.trim().toLowerCase(), jurisdiction: v.jurisdiction || undefined, bucket: v.bucket, prefix: v.prefix, accessKey: v.accessKey.trim(), secretKey: v.secretKey }),
}

const coming = (id: string, label: string, mark: BrandMark | LucideIcon): ProviderEntry => ({ id, label, mark, about: 'Store backups.', fields: [], notes: [] })

export const PROVIDERS: ProviderEntry[] = [
  MINIO,
  R2,
  coming('s3', 'Amazon S3', AWS_MARK),
  coming('gcs', 'Google Cloud Storage', siGooglecloudstorage),
  coming('google-drive', 'Google Drive', siGoogledrive),
  coming('folder', 'Folder', FolderOpen),
]

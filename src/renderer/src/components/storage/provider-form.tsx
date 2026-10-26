import { HardDrive, KeyRound, Plus } from 'lucide-react'

import { Chip } from '@/components/storage/chips'
import { ProviderGlyph, ProviderIcon, Tile } from '@/components/storage/icons'
import { Unavailable } from '@/components/storage/unavailable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROVIDER_LABEL, type Provider, type SyncLocation } from '@/data/storage'
import { cn } from '@/lib/utils'

export const PROVIDERS: Provider[] = ['google-drive', 's3', 'r2', 'minio', 'folder']

/** The select value for "set up a new account" rather than a saved one. */
export const NEW_ACCOUNT = 'new'

export interface FieldSpec {
  key: string
  label: string
  placeholder: string
  secret?: boolean
}

/** What a new location of each provider asks for. Drive signs in through the browser instead. */
export function providerFields(provider: Provider): FieldSpec[] {
  const keys: FieldSpec[] = [
    { key: 'accessKey', label: 'Access key ID', placeholder: 'AKIAIOSFODNN7EXAMPLE' },
    { key: 'secretKey', label: 'Secret access key', placeholder: '', secret: true },
  ]
  switch (provider) {
    case 'google-drive':
      return []
    case 'folder':
      return [{ key: 'path', label: 'Folder', placeholder: '/Volumes/Backup/layerfs' }]
    case 's3':
      return [
        { key: 'bucket', label: 'Bucket', placeholder: 'layerfs-backups' },
        { key: 'region', label: 'Region', placeholder: 'eu-west-1' },
        ...keys,
      ]
    case 'r2':
      return [
        { key: 'accountId', label: 'Account ID', placeholder: '023e105f4ecef8ad9ca31a8372d0c353' },
        { key: 'bucket', label: 'Bucket', placeholder: 'layerfs-backups' },
        ...keys,
      ]
    case 'minio':
      return [
        { key: 'endpoint', label: 'Endpoint', placeholder: 'https://minio.example:9000' },
        { key: 'bucket', label: 'Bucket', placeholder: 'layerfs-backups' },
        ...keys,
      ]
  }
}

/** Shows only the ends of a secret. */
export const mask = (value: string) => (value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '••••••••')

export const isComplete = (specs: FieldSpec[], v: Record<string, string>) => specs.every((s) => v[s.key]?.trim())

export function newLocation(provider: Provider, v: Record<string, string>, taken: string[]): SyncLocation {
  const short = { 'google-drive': 'Drive', s3: 'S3', r2: 'R2', minio: 'MinIO', folder: 'Folder' }[provider]
  const detail = v.bucket ?? v.path?.split('/').filter(Boolean).pop() ?? 'account'
  const base = `${provider}-${detail}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  const where =
    provider === 'google-drive'
      ? 'Google account'
      : provider === 'folder'
        ? v.path
        : provider === 's3'
          ? `s3://${v.bucket} · ${v.region}`
          : `${provider}://${v.bucket}`
  return {
    id,
    name: `${short} · ${detail}`,
    provider,
    where,
    fields: providerFields(provider).map((s) => ({
      label: s.label,
      value: s.secret ? mask(v[s.key]) : v[s.key],
      secret: s.secret,
    })),
    // Drive signs in through the browser, which this draft does not do yet.
    health: provider === 'google-drive' ? 'needs-sign-in' : 'not-checked',
  }
}

/** Where a file path starts: the bucket or folder the account points at. */
export function pathPrefix(provider: Provider, saved: SyncLocation | undefined, v: Record<string, string>): string {
  const field = (label: string) => saved?.fields.find((f) => f.label === label)?.value
  switch (provider) {
    case 'google-drive':
      return ''
    case 'folder': {
      const folder = field('Folder') ?? v.path
      return folder ? `${folder.replace(/\/$/, '')}/` : ''
    }
    default: {
      const bucket = field('Bucket') ?? v.bucket
      return bucket ? `${provider}://${bucket}/` : ''
    }
  }
}

export const pathPlaceholder = (provider: Provider) =>
  provider === 'google-drive' ? '/LayerFS/team.sqlite' : provider === 'folder' ? 'team.sqlite' : 'layerfs/team.sqlite'

/** Fields laid out as label/input rows of the parent grid. */
export function Fields({
  specs,
  values,
  onChange,
  prefix,
}: {
  specs: FieldSpec[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  prefix: string
}) {
  return specs.map((spec) => (
    <div key={`${prefix}-${spec.key}`} className="contents">
      <Label htmlFor={`${prefix}-${spec.key}`}>{spec.label}</Label>
      <Input
        id={`${prefix}-${spec.key}`}
        type={spec.secret ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        placeholder={spec.placeholder}
        value={values[spec.key] ?? ''}
        onChange={(e) => onChange(spec.key, e.target.value)}
      />
    </div>
  ))
}

interface ProviderPickerProps {
  value: Provider | 'none'
  onChange: (value: Provider | 'none') => void
  /** Offer "Local only" first, for a new database. */
  allowNone?: boolean
  label: string
}

/** One tile per provider; picking one opens its sign-in and location fields. */
export function ProviderPicker({ value, onChange, allowNone, label }: ProviderPickerProps) {
  const options: (Provider | 'none')[] = allowNone ? ['none', ...PROVIDERS] : PROVIDERS
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-1.5', allowNone ? 'grid-cols-6' : 'grid-cols-5')}
    >
      {options.map((p) => {
        const checked = value === p
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(p)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-center text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              checked
                ? 'border-primary bg-accent/50 text-foreground ring-1 ring-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {p === 'none' ? (
              <Tile size="sm">
                <HardDrive aria-hidden="true" />
              </Tile>
            ) : (
              <ProviderIcon provider={p} size="sm" />
            )}
            <span className="leading-tight">{p === 'none' ? 'Local only' : PROVIDER_LABEL[p]}</span>
          </button>
        )
      })}
    </div>
  )
}

const ACCOUNT_LABEL: Record<Provider, { label: string; another: string }> = {
  'google-drive': { label: 'Google account', another: 'Another Google account' },
  s3: { label: 'Credentials', another: 'New access key' },
  r2: { label: 'Credentials', another: 'New API token' },
  minio: { label: 'Credentials', another: 'New access key' },
  folder: { label: 'Folder', another: 'Another folder' },
}

interface ProviderFormProps {
  provider: Provider
  /** Saved locations of this provider. */
  saved: SyncLocation[]
  account: string
  onAccountChange: (account: string) => void
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}

/**
 * The provider's sign-in or keys and its location, as rows of the parent
 * grid: a saved account to reuse, or the fields for a new one.
 */
export function ProviderForm({ provider, saved, account, onAccountChange, values, onChange }: ProviderFormProps) {
  const labels = ACCOUNT_LABEL[provider]
  const creating = account === NEW_ACCOUNT
  const needsKeys = provider !== 'google-drive' && provider !== 'folder'

  return (
    <>
      {saved.length > 0 && (
        <>
          <Label htmlFor="provider-account">{labels.label}</Label>
          <Select value={account} onValueChange={onAccountChange}>
            <SelectTrigger id="provider-account" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {saved.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  <ProviderGlyph provider={l.provider} className="size-3.5 text-[9px]" />
                  <span>{l.name}</span>
                  <span className="text-muted-foreground">{l.where}</span>
                  {l.health === 'needs-sign-in' && (
                    <Chip tone="warning" icon={KeyRound}>
                      Sign in again
                    </Chip>
                  )}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NEW_ACCOUNT}>
                <Plus /> {labels.another}
              </SelectItem>
            </SelectContent>
          </Select>
        </>
      )}

      {creating && provider === 'google-drive' && (
        <>
          <span className="text-sm font-medium">{saved.length > 0 ? '' : labels.label}</span>
          <div className="flex items-center gap-3">
            <Unavailable reason="Google sign-in isn't wired up yet">
              <Button type="button" variant="outline" disabled>
                <ProviderGlyph provider="google-drive" className="size-4" /> Sign in with Google
              </Button>
            </Unavailable>
            <span className="text-xs text-muted-foreground">Opens your browser.</span>
          </div>
        </>
      )}

      {creating && (
        <Fields specs={providerFields(provider)} values={values} prefix={`loc-${provider}`} onChange={onChange} />
      )}

      {creating && needsKeys && (
        <p className="col-start-2 -mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound aria-hidden="true" className="size-3.5" />
          Kept in the system keychain, never in a config file.
        </p>
      )}
    </>
  )
}

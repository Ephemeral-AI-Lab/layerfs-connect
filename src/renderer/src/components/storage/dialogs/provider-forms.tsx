// The add forms (storage-redesign §3.7 step 2). A bucket's fields come from
// its registry entry (identity/providers.ts), so a new provider is an entry
// and a host validator, not a new dialog. PostgreSQL's form is the
// connection: a name, its URL and synchronous_commit.
import { useId } from 'react'

import { Field } from '@/components/storage/dialogs/fields'
import { type FieldValues, NAME, type ProviderEntry } from '@/components/storage/identity/providers'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SynchronousCommit } from '@shared/host-api'

/** synchronous_commit and what each value means. */
export const SYNC: { value: SynchronousCommit; about: string }[] = [
  { value: 'off', about: 'fastest; a server crash can lose the last moments of Commits' },
  { value: 'local', about: 'flushed on the primary' },
  { value: 'remote_write', about: 'a standby has received it' },
  { value: 'on', about: 'flushed on the primary and synchronous standbys' },
  { value: 'remote_apply', about: 'a standby has applied it' },
]

/** The form's first values: each field's default, the name from the provider id. */
export function initialValues(entry: ProviderEntry, taken: Set<string>): FieldValues {
  const v: FieldValues = {}
  for (const f of entry.fields) v[f.key] = f.default ?? ''
  let name = String(entry.id)
  for (let n = 2; taken.has(name); n++) name = `${entry.id}-${n}`
  v.name = name
  return v
}

/** Each field's problem, what is still empty, and whether it can be sent. */
export function formState(entry: ProviderEntry, values: FieldValues, taken: Set<string>) {
  const problems: Record<string, string | null> = {}
  for (const f of entry.fields) {
    const p = f.validate?.(values[f.key] ?? '', values) ?? null
    problems[f.key] = p && t(p)
  }
  if (!problems.name && taken.has(values.name)) problems.name = t('A connection named {name} exists.', { name: values.name })
  const missing = entry.fields.filter((f) => f.needed && !(values[f.key] ?? '').trim()).map((f) => t(f.needed!))
  const ready = !Object.values(problems).some(Boolean) && missing.length === 0
  return { problems, missing, ready }
}

const INPUT = 'rounded-xl'

interface ProviderFormProps {
  entry: ProviderEntry
  values: FieldValues
  onChange: (values: FieldValues) => void
  problems: Record<string, string | null>
  disabled?: boolean
}

export function ProviderForm({ entry, values, onChange, problems, disabled }: ProviderFormProps) {
  useI18n()
  const base = useId()
  const set = (key: string, value: string) => onChange({ ...values, [key]: value })
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-2">
      {entry.fields.map((f) => {
        const id = `${base}-${f.key}`
        const notes = entry.notes.filter((n) => n.after === f.key)
        return [
          <Field key={f.key} id={id} label={t(f.label)} problem={problems[f.key]}>
            {f.kind === 'select' ? (
              <Select value={values[f.key] || '__none'} onValueChange={(v) => set(f.key, v === '__none' ? '' : v)} disabled={disabled}>
                <SelectTrigger id={id} className={cn(INPUT, 'w-full text-[13px]')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {f.options?.map((o) => (
                    <SelectItem key={o.value || '__none'} value={o.value || '__none'}>
                      {t(o.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                type={f.kind === 'secret' ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder && t(f.placeholder)}
                autoComplete="off"
                spellCheck={false}
                disabled={disabled}
                aria-invalid={!!problems[f.key]}
                className={cn(INPUT, 'text-[13px]', f.mono && 'font-mono', f.placeholder && 'placeholder:font-sans placeholder:italic')}
              />
            )}
          </Field>,
          ...notes.map((n, i) => (
            <p key={`${f.key}-note-${i}`} className={cn('-mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground sm:col-span-2', n.mono && 'truncate font-mono text-[11px]')}>
              {n.text(values)}
            </p>
          )),
        ]
      })}
    </div>
  )
}

export interface PostgresqlValues {
  name: string
  url: string
  synchronousCommit: SynchronousCommit
}

export function postgresqlState(v: PostgresqlValues, taken: Set<string>) {
  const name = !NAME.test(v.name) ? t('Lower-case letters, digits and hyphens.') : taken.has(v.name) ? t('A connection named {name} exists.', { name: v.name }) : null
  const url = v.url && !/^postgres(ql)?:\/\//.test(v.url) ? t('A postgresql:// URL.') : null
  const missing = [!v.name && t('name'), !v.url && 'URL'].filter((x): x is string => !!x)
  return { problems: { name: v.name ? name : null, url }, missing, ready: !name && !url && missing.length === 0 }
}

export function PostgresqlForm({ values, onChange, problems, disabled }: { values: PostgresqlValues; onChange: (v: PostgresqlValues) => void; problems: { name: string | null; url: string | null }; disabled?: boolean }) {
  useI18n()
  const ids = { name: useId(), url: useId(), sync: useId() }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
        <Field id={ids.name} label={t('Name')} problem={problems.name}>
          <Input id={ids.name} value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} disabled={disabled} className={cn(INPUT, 'text-[13px]')} aria-invalid={!!problems.name} />
        </Field>
        <Field id={ids.url} label="URL" problem={problems.url}>
          <Input
            id={ids.url}
            value={values.url}
            onChange={(e) => onChange({ ...values, url: e.target.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            className={cn(INPUT, 'font-mono text-[12.5px]')}
            aria-invalid={!!problems.url}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor={ids.sync} className="font-mono text-xs font-semibold">
          synchronous_commit
        </label>
        <Select value={values.synchronousCommit} onValueChange={(v) => onChange({ ...values, synchronousCommit: v as SynchronousCommit })} disabled={disabled}>
          <SelectTrigger id={ids.sync} className={cn(INPUT, 'w-40 font-mono text-[13px]')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNC.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <span className="font-mono">{s.value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11.5px] text-muted-foreground">{t(SYNC.find((s) => s.value === values.synchronousCommit)?.about ?? '')}</span>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{t('The URL stays in Connect, readable by your user only. On macOS the LayerFS box reaches this machine’s localhost as host.docker.internal.')}</p>
    </div>
  )
}

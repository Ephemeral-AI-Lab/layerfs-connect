import { useI18n } from '@/i18n'
import { ChevronDown, Eye, EyeOff, Plus, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface RequestHeaderRow {
  id: string
  name: string
  value: string
}

export function RequestHeaders({ rows, onChange, disabled }: {
  rows: RequestHeaderRow[]
  onChange: (rows: RequestHeaderRow[]) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [showValues, setShowValues] = useState(false)
  const count = rows.filter((row) => row.name.trim()).length

  function update(id: string, field: 'name' | 'value', value: string) {
    onChange(rows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  }

  return <section aria-label={t("Request headers")} className="overflow-hidden rounded-xl border border-foreground/[0.08] bg-foreground/[0.015]">
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
      className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.025] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex items-center gap-2">{t("Request headers")} <span className="font-normal text-faint">{count ? `· ${count}` : t("· optional")}</span></span>
      <ChevronDown className={cn('size-3.5 shrink-0 text-faint transition-transform', expanded && 'rotate-180')} />
    </button>
    {expanded && <div className="space-y-2.5 border-t border-foreground/[0.05] px-3.5 pt-3 pb-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{t("Applied to this provider’s requests.")}</p>
        <div className="flex shrink-0 items-center gap-1">
          {rows.length > 0 && <Button type="button" variant="ghost" size="icon-sm" className="size-7 rounded-lg text-muted-foreground" aria-label={showValues ? t("Hide header values") : t("Show header values")} title={showValues ? t("Hide header values") : t("Show header values")} onClick={() => setShowValues(!showValues)}>
            {showValues ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>}
          <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg px-2 text-[11px]" disabled={disabled} onClick={() => onChange([...rows, { id: crypto.randomUUID(), name: '', value: '' }])}><Plus className="size-3" />{t("Add header")}</Button>
        </div>
      </div>
      {rows.map((row, index) => <div key={row.id} className="flex min-w-0 items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
          <Input aria-label={t("Header name {index}", { index: index + 1 })} autoComplete="off" spellCheck={false} placeholder={t("Header name")} value={row.name} disabled={disabled} onChange={(event) => update(row.id, 'name', event.target.value)} className="h-9 min-w-0 font-mono text-xs" />
          <Input aria-label={t("Header value {index}", { index: index + 1 })} type={showValues ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder={t("Value")} value={row.value} disabled={disabled} onChange={(event) => update(row.id, 'value', event.target.value)} className="h-9 min-w-0 font-mono text-xs" />
        </div>
        <button type="button" aria-label={t("Remove header {index}", { index: index + 1 })} title={t("Remove header")} disabled={disabled} onClick={() => onChange(rows.filter((item) => item.id !== row.id))} className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/[0.08] hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><X className="size-3.5" /></button>
      </div>)}
      {rows.length === 0 && <p className="py-1 text-[11px] text-faint">{t("No custom headers.")}</p>}
    </div>}
  </section>
}

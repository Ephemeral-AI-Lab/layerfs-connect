// The home's one-time upgrade (#537 §8.8; #536 F2). The first call of this
// LayerFS build on a layout 2 home converts it to layout 3, and is refused
// `InUse` while anything in it is live. That refusal names each thing and
// what ends it (`detail.related[].why`), and this build refuses every call,
// `sandbox.close` included, until the conversion runs: a Sandbox the older
// build started is closed with that build (its `why` gives the command). So
// this screen lists them in LayerFS's words and checks again; the next call
// that finds nothing live converts the home, and every page works again.
import { Check, Copy, LoaderCircle, RotateCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { conversionNow, HostError, host, onConversion, setConversion } from '@/host/client'
import { t, useI18n } from '@/i18n'

/** The conversion refusal while it stands, else null. */
export function useConversion(): HostError | null {
  const [refusal, setRefusal] = useState<HostError | null>(conversionNow())
  useEffect(() => onConversion(setRefusal), [])
  return refusal
}

const command = (why: string) => /`([^`]+)`/.exec(why)?.[1] ?? null

export function UpgradeScreen({ refusal }: { refusal: HostError }) {
  useI18n()
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const related = refusal.detail?.related ?? []
  const sandboxes = related.filter((r) => r.kind === 'sandbox').map((r) => r.name)
  const check = async () => {
    setChecking(true)
    try {
      await host.status()
      setConversion(null)
      // every page read before the conversion was refused: start over on the converted home
      window.location.reload()
    } catch (e) {
      if (!(e instanceof HostError && e.conversion)) setConversion(null)
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="flex h-svh min-w-0 items-center justify-center overflow-y-auto px-6 py-10">
      <div className="glass-liquid flex w-full max-w-2xl flex-col gap-4 rounded-3xl px-7 py-6 shadow-sm">
        <header className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <TriangleAlert className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold">{sandboxes.length ? t('Upgrading this home: close Sandboxes {list}', { list: sandboxes.join(', ') }) : t('Upgrading this home')}</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('This LayerFS converts the home to its new layout once, on its first call, and only while nothing in it is live. Until then every page is refused. The conversion keeps every Store, project and machine.')}
            </p>
          </div>
        </header>
        <ul className="flex flex-col divide-y rounded-2xl bg-card/60 ring-1 ring-foreground/8">
          {related.map((r) => {
            const run = r.why ? command(r.why) : null
            return (
              <li key={`${r.kind}:${r.name}`} className="flex min-w-0 flex-col gap-1 px-4 py-2.5">
                <span className="text-[13px]">
                  <span className="text-muted-foreground">{r.kind}</span> <span className="font-mono font-semibold">{r.name}</span>
                </span>
                {r.why && <span className="text-xs break-words text-muted-foreground">{r.why}</span>}
                {run && (
                  <span className="flex items-center gap-2">
                    <code className="min-w-0 truncate rounded-md bg-foreground/[0.05] px-2 py-0.5 text-[11.5px]">{run}</code>
                    <Button size="sm" variant="ghost" className="h-6 rounded-lg px-1.5 text-[11px]" onClick={() => void navigator.clipboard.writeText(run).then(() => setCopied(run))}>
                      {copied === run ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {t(copied === run ? 'Copied' : 'Copy')}
                    </Button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-[11.5px] leading-relaxed break-words text-muted-foreground">
          <span className="font-semibold">{refusal.code}</span>: {refusal.message}
        </p>
        <div className="flex justify-end">
          <Button size="sm" className="rounded-xl" disabled={checking} onClick={() => void check()}>
            {checking ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
            {t('Check again')}
          </Button>
        </div>
      </div>
    </div>
  )
}

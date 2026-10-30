import { useI18n, localeTag } from '@/i18n'
import { Copy, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { agentHost } from '@/host/agent-client'

export function ToolOutputDialog({ sessionId, artifactId, onClose, returnFocus }: { sessionId: string; artifactId: string; onClose: () => void; returnFocus: HTMLElement | null }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [offset, setOffset] = useState(0)
  const [bytes, setBytes] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  async function load(next = offset) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const page = await agentHost.output(sessionId, artifactId, next)
      if (!mounted.current) return
      setText((current) => next === 0 ? page.text : current + page.text)
      setBytes(page.bytes); setOffset(page.nextOffset ?? page.bytes); setDone(page.done || page.nextOffset === null)
    } catch (e) { if (mounted.current) setError((e as Error).message) }
    finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  useEffect(() => { mounted.current = true; void load(0); return () => { mounted.current = false } }, [])
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col rounded-3xl [--dialog-inset:1.5rem] sm:max-w-3xl" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus() }}>
      <DialogHeader><DialogTitle>{t("Full tool output")}</DialogTitle><DialogDescription className="text-xs">{bytes === null ? t("Loading saved output…") : t("{loaded} of {total} bytes loaded", { loaded: offset.toLocaleString(localeTag()), total: bytes.toLocaleString(localeTag()) })}</DialogDescription></DialogHeader>
      <pre tabIndex={0} className="min-h-28 flex-1 overflow-auto rounded-xl border border-foreground/[0.06] bg-background/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-ring">{text || (busy ? t("Loading…") : t("No output."))}</pre>
      {error && <p role="alert" className="text-xs text-destructive">{t(error)}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" disabled={!text} onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setError("Could not copy the loaded output.")) }}><Copy className="size-3.5" />{copied ? t("Copied") : done ? t("Copy output") : t("Copy loaded output")}</Button>
        {!done && <Button size="sm" disabled={busy} onClick={() => void load()}>{busy && <LoaderCircle className="size-3.5 animate-spin" />}{busy ? t("Loading…") : error ? t("Try again") : t("Load more")}</Button>}
      </div>
    </DialogContent>
  </Dialog>
}

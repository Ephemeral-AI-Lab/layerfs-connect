// Which LayerFS this window runs on, and the switch between them
// (docs/ui/shell.md, "LayerFS mode"). The host runs real LayerFS or the
// simulator (host/sim); the main process passes the mode with the host's
// address. The chip at the foot of the sidebar opens a menu with the two
// modes; picking the other one asks first (chats that are working stop),
// then the main process restarts the host and replaces this window. In sim
// mode the menu also starts the simulated world again from a preset, and a
// striped strip runs across the top of the window so the sample world is
// never taken for the real one. The app's LayerFS menu switches too (⌥⌘1, ⌥⌘2).
import { FlaskConical, HardDrive, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { call } from '@/host/client'
import { chatLive, useChatSessions } from '@/host/use-chat-sessions'
import { t, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type Mode = 'real' | 'sim'

/** The simulated world's preset and the presets it can start from (GET /api/sim). */
interface SimInfo {
  preset: string
  presets: { name: string; label: string; description: string }[]
}

/** This window's LayerFS mode. */
export const layerfsMode = (): Mode => window.connect.mode ?? 'real'

const isMac = window.connect.platform === 'darwin'
const SHORTCUT: Record<Mode, string> = isMac ? { real: '⌥⌘1', sim: '⌥⌘2' } : { real: 'Ctrl+Alt+1', sim: 'Ctrl+Alt+2' }

/** The striped strip across the top of the window in sim mode. */
export function SimStrip() {
  useI18n()
  if (layerfsMode() !== 'sim') return null
  return <div className="sim-strip" role="presentation" title={t('Simulated LayerFS')} />
}

/** The mode chip and its menu, at the foot of the sidebar. */
export function ModeChip() {
  useI18n()
  const mode = layerfsMode()
  const [target, setTarget] = useState<Mode | null>(null)
  const [reset, setReset] = useState<string | null>(null)
  const [sim, setSim] = useState<SimInfo | null>(null)
  const canSwitch = typeof window.connect.setMode === 'function'

  useEffect(() => {
    if (mode !== 'sim') return
    let live = true
    call<SimInfo>('GET', '/api/sim').then((info) => live && setSim(info), () => {})
    return () => {
      live = false
    }
  }, [mode])

  const Icon = mode === 'sim' ? FlaskConical : HardDrive
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="layerfs-mode"
            data-mode={mode}
            aria-label={t('LayerFS mode: {mode}', { mode: t(mode === 'sim' ? 'Simulated' : 'Real') })}
            title={t(mode === 'sim' ? 'Simulated LayerFS: sample machines, Stores and projects' : 'Real LayerFS: your LayerFS home')}
            className="mode-chip app-no-drag"
          >
            <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            <span>{t(mode === 'sim' ? 'Simulated' : 'Real')}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-76">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('LayerFS')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode} onValueChange={(v) => v !== mode && (v === 'real' || v === 'sim') && setTarget(v)}>
            <ModeItem value="real" disabled={!canSwitch} title={t('Real LayerFS')} detail={t('Your LayerFS home: this Mac, Docker, your VMs and Stores.')} />
            <ModeItem value="sim" disabled={!canSwitch} title={t('Simulated LayerFS')} detail={t('Sample machines, Stores and projects. Nothing reaches your real home.')} />
          </DropdownMenuRadioGroup>
          {mode === 'sim' && sim && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('Start the simulated world again')}</DropdownMenuLabel>
              {sim.presets.map((p) => (
                <DropdownMenuItem key={p.name} onSelect={() => setReset(p.name)} className="items-start">
                  <RotateCcw className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block">
                      {t(p.label)}
                      {p.name === sim.preset && <span className="text-muted-foreground"> · {t('started from')}</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{t(p.description)}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {!canSwitch && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('Switching needs the Connect app.')}</DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SwitchDialog target={target} onClose={() => setTarget(null)} />
      <ResetDialog preset={sim?.presets.find((p) => p.name === reset) ?? null} onClose={() => setReset(null)} />
    </>
  )
}

function ModeItem({ value, title, detail, disabled }: { value: Mode; title: string; detail: string; disabled: boolean }) {
  return (
    <DropdownMenuRadioItem value={value} disabled={disabled} className="items-start py-2">
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span>{title}</span>
          <span className="text-xs text-muted-foreground">{SHORTCUT[value]}</span>
        </span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </DropdownMenuRadioItem>
  )
}

/** Asks before restarting on the other LayerFS: chats that are working stop. */
function SwitchDialog({ target, onClose }: { target: Mode | null; onClose: () => void }) {
  useI18n()
  const { sessions } = useChatSessions(target)
  const working = sessions?.filter(chatLive).length ?? 0
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const words = target === 'sim' ? t('Simulated LayerFS') : t('Real LayerFS')
  const go = async () => {
    if (!target || !window.connect.setMode) return
    setBusy(true)
    setError(null)
    try {
      // the main process replaces this window once the host runs in the new mode
      await window.connect.setMode(target)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t('Switch to {mode}?', { mode: words })}</DialogTitle>
          <DialogDescription>
            {target === 'sim'
              ? t('Connect restarts on a simulated LayerFS with sample machines, Stores and projects. Nothing you do there reaches your real LayerFS home.')
              : t('Connect restarts on your real LayerFS home. The simulated world is kept for the next time you switch.')}
          </DialogDescription>
        </DialogHeader>
        {working > 0 && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-foreground">
            {t(working === 1 ? '1 chat is working. It stops; you can continue it after switching back.' : '{n} chats are working. They stop; you can continue them after switching back.', { n: working })}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={() => void go()} disabled={busy}>
            {busy ? t('Restarting…') : t('Switch and restart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Asks before replacing the simulated world with a preset's. */
function ResetDialog({ preset, onClose }: { preset: SimInfo['presets'][number] | null; onClose: () => void }) {
  useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    if (!preset) return
    setBusy(true)
    setError(null)
    try {
      await call('POST', '/api/sim/reset', { preset: preset.name })
      // every page reads the new world
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open={preset !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Start the simulated world again?')}</DialogTitle>
          <DialogDescription>
            {t('Every machine, Store, project and Sandbox in the simulated world is replaced by the “{label}” sample. Your real LayerFS home is not touched.', { label: preset ? t(preset.label) : '' })}
          </DialogDescription>
        </DialogHeader>
        {error && <p className={cn('text-sm text-destructive')}>{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={() => void go()} disabled={busy}>
            {busy ? t('Starting again…') : t('Start again')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

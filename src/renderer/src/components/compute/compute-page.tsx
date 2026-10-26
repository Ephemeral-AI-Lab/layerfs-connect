import { Info, Play } from 'lucide-react'
import { useState } from 'react'

import { CloudCards } from '@/components/compute/cloud-cards'
import { DockerCard } from '@/components/compute/docker-card'
import { NativeCard } from '@/components/compute/native-card'
import { TargetIcon } from '@/components/compute/target-parts'
import { Notice } from '@/components/storage/notice'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type ComputeSettings,
  DOCKER,
  SANDBOXES,
  type SandboxRow,
  TARGET_LABEL,
  type TargetId,
  nativeInfo,
} from '@/data/compute'

interface ComputePageProps {
  settings: ComputeSettings
  onChange: (settings: ComputeSettings) => void
  platform: string
  arch: string
  onOpenSession: (id: string) => void
  /** Dev aid: open the turn-off question for Docker. */
  askOnOpen?: boolean
  /** Dev aid: open the unmount question. */
  unmountOnOpen?: boolean
}

const ORDER: TargetId[] = ['docker', 'native', 'modal', 'e2b', 'daytona', 'aws']

export function ComputePage({
  settings,
  onChange,
  platform,
  arch,
  onOpenSession,
  askOnOpen,
  unmountOnOpen,
}: ComputePageProps) {
  const { enabled, defaultTarget } = settings
  const [sandboxes, setSandboxes] = useState<SandboxRow[]>(SANDBOXES)
  // A target the user is turning off while it still has running Sandboxes.
  const [asking, setAsking] = useState<TargetId | null>(askOnOpen ? 'docker' : null)

  const enabledCount = ORDER.filter((id) => enabled[id]).length
  const running = sandboxes.filter((s) => s.running)
  const info = nativeInfo(platform)

  const lockOf = (id: TargetId): string | undefined => {
    if (!enabled[id] && id === 'native') return info.reason
    if (enabled[id] && defaultTarget === id) return 'Choose another default first'
    if (enabled[id] && enabledCount === 1) return 'At least one compute stays on'
    return undefined
  }

  const setEnabled = (id: TargetId, on: boolean) => onChange({ ...settings, enabled: { ...enabled, [id]: on } })

  const toggle = (id: TargetId, on: boolean) => {
    // Only Docker has Sandboxes in this sample.
    if (!on && id === 'docker' && running.length > 0) setAsking(id)
    else setEnabled(id, on)
  }

  const turnOff = (stop: boolean) => {
    if (!asking) return
    if (stop) setSandboxes((all) => all.map((s) => ({ ...s, running: false })))
    setEnabled(asking, false)
    setAsking(null)
  }

  return (
    <div className="h-svh overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 pt-7 pb-10">
        <header className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">Compute</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Where sessions run commands with their Workspace mounted. Turn on the ones you use.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Label htmlFor="default-target" className="text-muted-foreground">
              <Play className="size-3.5" /> New sessions run on
            </Label>
            <Select
              value={defaultTarget}
              onValueChange={(id) => onChange({ ...settings, defaultTarget: id as TargetId })}
            >
              <SelectTrigger id="default-target" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {ORDER.filter((id) => enabled[id]).map((id) => (
                  <SelectItem key={id} value={id}>
                    <span className="[&>span]:size-5 [&>span]:rounded [&>span]:text-[8px] [&_svg]:size-3">
                      <TargetIcon id={id} os={platform} size="sm" />
                    </span>
                    {TARGET_LABEL[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">This machine</h2>
            <p className="text-xs text-faint">
              Detected {info.os} · {arch}
            </p>
          </div>
          {!enabled.docker && running.length > 0 && (
            <Notice tone="warning" icon={Info} title="Docker is off, but Sandboxes are still running">
              {running.length} keep going until their sessions end. No new Sandbox starts in Docker.
            </Notice>
          )}
          <DockerCard
            docker={DOCKER}
            sandboxes={sandboxes}
            enabled={enabled.docker}
            isDefault={defaultTarget === 'docker'}
            locked={lockOf('docker')}
            onToggle={(on) => toggle('docker', on)}
            boxNeedsDocker={platform !== 'linux'}
            onOpenSession={onOpenSession}
            unmountOnOpen={unmountOnOpen}
          />
          <NativeCard
            platform={platform}
            arch={arch}
            enabled={enabled.native}
            locked={lockOf('native')}
            onToggle={(on) => toggle('native', on)}
          />
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-[13px] font-semibold">Cloud sandboxes</h2>
            <p className="text-xs text-faint">
              They can't open a local SQLite file, so they run projects in PostgreSQL databases.
            </p>
          </div>
          <CloudCards enabled={enabled} defaultTarget={defaultTarget} lockOf={lockOf} onToggle={toggle} />
        </section>

        <p className="flex items-center gap-2 text-xs text-faint">
          <Info aria-hidden="true" className="size-3.5" />
          Sample data. Detection, Sandboxes and cloud providers wait on the LayerFS host process.
        </p>
      </div>

      <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn off {asking ? TARGET_LABEL[asking] : ''}?</DialogTitle>
            <DialogDescription>
              {running.length} Sandbox{running.length === 1 ? ' is' : 'es are'} running (
              {[...new Set(running.map((s) => s.project))].join(', ')}). New sessions won't start here either way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => turnOff(false)}>
              Let them finish
            </Button>
            <Button variant="destructive" onClick={() => turnOff(true)}>
              Stop them
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

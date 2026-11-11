import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { host } from '@/layerfs/client'
import { useHostQuery } from '@/layerfs/use-host'
import type { MachineImages } from '@/layerfs/host-api'

export type SandboxImage = string | { archive: string; digest?: string } | undefined

/** Mount with a machine key so changing machines clears selections and observations. */
export function SandboxImageFields({ machine, disabled, onChange }: { machine: string; disabled: boolean; onChange: (image: SandboxImage, valid: boolean) => void }) {
  const inventory = useHostQuery<MachineImages>(async () => {
    if (machine === 'native' && (await host.status()).platform === 'macos') return { machine, mode: 'host', default_digest: null, images: [] }
    return host.machineImages(machine)
  }, [machine])
  const [choice, setChoice] = useState('')
  const [archive, setArchive] = useState('')
  const [digest, setDigest] = useState('')
  const choose = (next: string, path = archive, pin = digest) => {
    setChoice(next)
    onChange(next === 'archive' ? { archive: path.trim(), ...(pin.trim() ? { digest: pin.trim() } : {}) } : next || undefined,
      next !== 'archive' || (/^(?:\/|[A-Za-z]:[\\/])/.test(path.trim()) && !path.includes('\0') && (!pin.trim() || /^sha256:[a-f0-9]{64}$/.test(pin.trim()))))
  }
  if (inventory.data?.mode === 'host') return null
  if (machine === 'native' && inventory.loading) return <p role="status" className="text-xs text-muted-foreground">Loading Sandbox options…</p>
  return <div className="flex w-full min-w-0 flex-col gap-2 text-sm">
    <label className="flex min-w-0 flex-col gap-1.5">Sandbox image
      <select className="h-9 w-full min-w-0 rounded-lg border bg-background px-2" aria-label="Sandbox image" value={choice} disabled={disabled} onChange={e => choose(e.target.value)}>
        <option value="">Default image</option>
        {(inventory.data?.images ?? []).map(image => <option key={image.digest} value={image.digest}>{image.title || image.tags.join(', ') || image.digest}{image.digest === inventory.data?.default_digest ? ' (default)' : ''}</option>)}
        <option value="archive">Provide archive…</option>
      </select>
    </label>
    {inventory.loading ? <p role="status" className="text-xs text-muted-foreground">Loading images from {machine}…</p> : inventory.error ? <div className="text-xs text-muted-foreground"><p role="status">Image discovery unavailable: {inventory.error.message}</p><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={inventory.reload}>Retry loading images</Button></div> : inventory.data?.images.length === 0 ? <p role="status" className="text-xs text-muted-foreground">No images found in this machine’s archive.</p> : null}
    {choice === 'archive' && <>
      <label className="flex flex-col gap-1.5">Archive path<Input value={archive} onChange={e => { setArchive(e.target.value); choose(choice, e.target.value) }} placeholder="/absolute/path/to/sandbox-image.tar" disabled={disabled} spellCheck={false} required aria-invalid={!!archive && !/^(?:\/|[A-Za-z]:[\\/])/.test(archive.trim())} /></label>
      <p className="text-xs text-muted-foreground">A file on the computer running Connect. LayerFS prepares it on {machine}; no registry pull.</p>
      <label className="flex flex-col gap-1.5">Digest (optional)<Input value={digest} onChange={e => { setDigest(e.target.value); choose(choice, archive, e.target.value) }} placeholder="sha256:… (64 hexadecimal characters)" disabled={disabled} spellCheck={false} aria-invalid={!!digest && !/^sha256:[a-f0-9]{64}$/.test(digest.trim())} /></label>
      <p className="text-xs text-muted-foreground">For an archive with several images, enter the full digest of the image to use.</p>
    </>}
  </div>
}

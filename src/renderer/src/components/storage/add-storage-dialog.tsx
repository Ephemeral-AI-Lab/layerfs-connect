import { CloudDownload, KeyRound, type LucideIcon, Plus } from 'lucide-react'
import { useState } from 'react'
import { siPostgresql } from 'simple-icons'

import {
  type FieldSpec,
  Fields,
  NEW_ACCOUNT,
  ProviderForm,
  ProviderPicker,
  isComplete,
  mask,
  newLocation,
  pathPlaceholder,
  pathPrefix,
  providerFields,
} from '@/components/storage/provider-form'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { type Database, LOCAL_STORAGE, type Provider, type SyncLocation } from '@/data/storage'
import { cn } from '@/lib/utils'

export type AddChoice = 'new' | 'pull' | 'postgres'

export interface Added {
  database: Database
  /** A sync location made along the way. */
  location?: SyncLocation
}

function PgGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('fill-current', className)}>
      <path d={siPostgresql.path} />
    </svg>
  )
}

const CHOICES: { id: AddChoice; title: string; blurb: string; icon: LucideIcon | typeof PgGlyph }[] = [
  { id: 'new', title: 'New local database', blurb: 'An empty SQLite file', icon: Plus },
  { id: 'pull', title: 'Pull a database', blurb: 'From Drive, a bucket or a folder', icon: CloudDownload },
  { id: 'postgres', title: 'Connect PostgreSQL', blurb: 'Live over HTTP', icon: PgGlyph },
]

const POSTGRES_FIELDS: FieldSpec[] = [
  { key: 'endpoint', label: 'HTTP endpoint', placeholder: 'https://pg.team.example' },
  { key: 'database', label: 'Database', placeholder: 'layerfs' },
  { key: 'token', label: 'Access token', placeholder: '', secret: true },
]

interface AddStorageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  locations: SyncLocation[]
  takenFiles: string[]
  onAdd: (added: Added) => void
  /** Dev aid: the choice, and optionally the provider, selected on open. */
  initialChoice?: AddChoice
  initialProvider?: Provider
}

export function AddStorageDialog({
  open,
  onOpenChange,
  locations,
  takenFiles,
  onAdd,
  initialChoice,
  initialProvider,
}: AddStorageDialogProps) {
  const firstSaved = (p: Provider | 'none') => locations.find((l) => l.provider === p)?.id ?? NEW_ACCOUNT
  const startProvider = initialProvider ?? (initialChoice === 'pull' ? 'google-drive' : 'none')

  const [choice, setChoice] = useState<AddChoice>(initialChoice ?? 'new')
  const [file, setFile] = useState('')
  const [provider, setProvider] = useState<Provider | 'none'>(startProvider)
  // A saved location id, or NEW_ACCOUNT.
  const [account, setAccount] = useState(firstSaved(startProvider))
  const [loc, setLoc] = useState<Record<string, string>>({})
  const [remotePath, setRemotePath] = useState('')
  const [pg, setPg] = useState<Record<string, string>>({})

  const pickProvider = (p: Provider | 'none') => {
    setProvider(p)
    setAccount(firstSaved(p))
    setLoc({})
    setRemotePath('')
  }

  const reset = () => {
    setFile('')
    setLoc({})
    setRemotePath('')
    setPg({})
  }

  const syncing = choice !== 'postgres' && provider !== 'none'
  const saved = provider === 'none' ? [] : locations.filter((l) => l.provider === provider)
  const savedAccount = saved.find((l) => l.id === account)
  const accountReady = provider === 'none' || account !== NEW_ACCOUNT || isComplete(providerFields(provider), loc)
  const prefix = provider === 'none' ? '' : pathPrefix(provider, savedAccount, loc)

  const pulledName = remotePath.split('/').filter(Boolean).pop() ?? ''
  const fileName = choice === 'pull' ? pulledName : file.trim() && `${file.trim().replace(/\.sqlite$/, '')}.sqlite`
  const taken = fileName !== '' && takenFiles.includes(fileName)

  const complete =
    choice === 'postgres'
      ? isComplete(POSTGRES_FIELDS, pg)
      : fileName !== '' && !taken && (!syncing || (accountReady && (choice === 'new' || remotePath.trim() !== '')))

  const submit = () => {
    if (choice === 'postgres') {
      const v = Object.fromEntries(POSTGRES_FIELDS.map((s) => [s.key, pg[s.key].trim()]))
      onAdd({
        database: {
          kind: 'postgres',
          id: `pg-${Date.now().toString(36)}`,
          endpoint: v.endpoint,
          database: v.database,
          token: mask(v.token),
          health: 'not-checked',
        },
      })
    } else {
      let made: SyncLocation | undefined
      if (syncing && account === NEW_ACCOUNT) {
        const trimmed = Object.fromEntries(Object.entries(loc).map(([k, v]) => [k, v.trim()]))
        made = newLocation(provider, trimmed, locations.map((l) => l.id))
      }
      const locationId = syncing ? (made?.id ?? account) : undefined
      onAdd({
        location: made,
        database: {
          kind: 'sqlite',
          id: `db-${Date.now().toString(36)}`,
          file: fileName,
          size: choice === 'pull' ? 'not pulled yet' : '0 MB',
          sync: locationId
            ? {
                location: locationId,
                remotePath: remotePath.trim() || (provider === 'google-drive' ? `/LayerFS/${fileName}` : fileName),
                // Pull: the remote copy is newer than nothing. New: nothing pushed yet.
                status: choice === 'pull' ? { state: 'behind' } : { state: 'ahead', commits: 0 },
                pulled: 'never',
                pushed: 'never',
                autoPush: false,
              }
            : undefined,
        },
      })
    }
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-5 overflow-y-auto p-6 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add storage</DialogTitle>
          <DialogDescription>A database holds any number of projects.</DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={choice}
          onValueChange={(next) => {
            setChoice(next as AddChoice)
            pickProvider(next === 'pull' ? 'google-drive' : 'none')
            reset()
          }}
          className="grid-cols-3 gap-2"
          aria-label="What to add"
        >
          {CHOICES.map(({ id, title, blurb, icon: Icon }) => (
            <Label
              key={id}
              htmlFor={`choice-${id}`}
              className={cn(
                'relative flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 font-normal transition-colors hover:bg-muted/50',
                choice === id && 'border-primary bg-accent/50 ring-1 ring-primary hover:bg-accent/50',
              )}
            >
              <RadioGroupItem id={`choice-${id}`} value={id} className="absolute top-3 right-3" />
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/5 ring-inset">
                <Icon className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{blurb}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        <form
          id="add-storage"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (complete) submit()
          }}
        >
          {choice === 'postgres' && (
            <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
              <Fields specs={POSTGRES_FIELDS} values={pg} prefix="pg" onChange={(k, v) => setPg((p) => ({ ...p, [k]: v }))} />
              <p className="col-start-2 -mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound aria-hidden="true" className="size-3.5" />
                The token goes to the system keychain, never to a config file.
              </p>
            </div>
          )}

          {choice === 'new' && (
            <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3">
              <Label htmlFor="db-file">File name</Label>
              <div className="flex items-center rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <input
                  id="db-file"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="team"
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                  className="h-8 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground"
                />
                <span className="pr-2.5 font-mono text-xs text-faint">.sqlite</span>
              </div>
            </div>
          )}

          {choice !== 'postgres' && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{choice === 'pull' ? 'Pull from' : 'Sync with'}</span>
              <ProviderPicker
                label={choice === 'pull' ? 'Pull from' : 'Sync with'}
                value={provider}
                onChange={pickProvider}
                allowNone={choice === 'new'}
              />
            </div>
          )}

          {syncing && (
            <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-xl bg-muted/50 p-4">
              <ProviderForm
                provider={provider}
                saved={saved}
                account={account}
                onAccountChange={(a) => {
                  setAccount(a)
                  setLoc({})
                }}
                values={loc}
                onChange={(k, v) => setLoc((l) => ({ ...l, [k]: v }))}
              />
              <Label htmlFor="remote-path">{choice === 'pull' ? 'File' : 'Path there'}</Label>
              <div className="flex items-center rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                {prefix && <span className="max-w-[45%] truncate pl-2.5 font-mono text-xs text-faint">{prefix}</span>}
                <input
                  id="remote-path"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    choice === 'new' && fileName
                      ? provider === 'google-drive'
                        ? `/LayerFS/${fileName}`
                        : fileName
                      : pathPlaceholder(provider)
                  }
                  value={remotePath}
                  onChange={(e) => setRemotePath(e.target.value)}
                  className={cn(
                    'h-8 min-w-0 flex-1 bg-transparent pr-2.5 text-sm outline-none placeholder:text-muted-foreground',
                    prefix ? 'pl-0.5 font-mono text-xs' : 'pl-2.5',
                  )}
                />
              </div>
            </div>
          )}

          {choice !== 'postgres' && fileName && (
            <p className={cn('font-mono text-xs', taken ? 'text-destructive' : 'text-faint')}>
              {taken ? `${fileName} is already in local storage` : `Saved as ${LOCAL_STORAGE}/${fileName}`}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-storage" disabled={!complete}>
            {choice === 'postgres' ? 'Connect' : choice === 'pull' ? 'Add and pull' : 'Create database'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

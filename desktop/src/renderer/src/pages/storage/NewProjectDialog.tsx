import { FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { host } from '@/layerfs/client'
import { FormSheet, TextField } from '@/pages/storage/StorageDialogs'

/** Uses the existing project Init job; all errors remain in the form. */
export function NewProjectDialog({ store, onClose, onCreated }: { store: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  return <FormSheet open onClose={onClose} icon={FolderPlus} title="Add project" description={`Create an empty project in ${store}.`} action={pending ? 'Check creation' : 'Create project'} valid={!!pending || /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/.test(name.trim())} submit={async () => {
    let job = pending ? await host.projectInit(pending) : await host.createProject({ name: name.trim(), store })
    setPending(job.id)
    const deadline = Date.now() + 60_000
    while (!job.ended) {
      if (Date.now() > deadline) throw new Error('Project creation is still running. Check creation again to see its result.')
      await new Promise(resolve => setTimeout(resolve, 400))
      job = await host.projectInit(job.id)
    }
    if (job.error) { throw Object.assign(new Error(), job.error, { message: `${job.error.message}${['Failed', 'Unknown'].includes(job.error.code) ? ' · The project may have been created; check Projects before creating again.' : ''}` }) }
    onCreated()
  }}>
    {pending ? <p className="text-sm text-muted-foreground">Checking the project creation already started for {name.trim()}.</p> : <TextField label="Project name" value={name} onChange={setName} placeholder="my-project" autoFocus hint="Lowercase letters, numbers, dots, hyphens, and underscores; maximum 63 characters." />}
  </FormSheet>
}

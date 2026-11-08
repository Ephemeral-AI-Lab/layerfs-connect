import { FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { host } from '@/layerfs/client'
import { FormSheet, TextField } from '@/pages/storage/StorageDialogs'

/** Uses the existing project Init job; all errors remain in the form. */
export function NewProjectDialog({ store, onClose, onCreated }: { store: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  return <FormSheet open onClose={onClose} icon={FolderPlus} title="Add project" description={`Create an empty project in ${store}.`} action={pending ? 'Check creation' : 'Create project'} valid={!!pending || /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name.trim())} submit={async () => {
    let job = pending ? await host.projectInit(pending) : await host.createProject({ name: name.trim(), store })
    setPending(job.id)
    const deadline = Date.now() + 60_000
    while (!job.ended) {
      if (Date.now() > deadline) throw new Error('Project creation is still running. Check creation again to see its result.')
      await new Promise(resolve => setTimeout(resolve, 400))
      job = await host.projectInit(job.id)
    }
    if (job.error) { setPending(null); throw new Error(job.error.message) }
    onCreated()
  }}>
    {pending ? <p className="text-sm text-muted-foreground">Checking the project creation already started for {name.trim()}.</p> : <TextField label="Project name" value={name} onChange={setName} placeholder="my-project" autoFocus hint="Letters, numbers, dots, hyphens, and underscores." />}
  </FormSheet>
}

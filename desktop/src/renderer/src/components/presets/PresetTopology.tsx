import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Folder, Monitor, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { count, elapsed } from './preset-format'
import type { DemoPreset } from '@/layerfs/demo-presets-api'
import { activityApi, type CliInvocation } from '@/layerfs/activity-api'
import { resourceMatches, resourceStatus, type PresetResource } from '@/layerfs/preset-resources'

export function PresetTopology({ preset, active, onCommands, onActivity }: {
  preset: DemoPreset; active: boolean
  onCommands: (resource: PresetResource) => void
  onActivity: (action: string, invocation: string) => void
}) {
  const [now, setNow] = useState(Date.now)
  const [selected, setSelected] = useState<PresetResource>()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [activity, setActivity] = useState<{ id: string; calls: CliInvocation[] }>()
  const [activityError, setActivityError] = useState(false)
  const job = preset.job
  const build = !!job && (job.rebuild || job.command === 'setup')
  const actionId = build ? job.rebuildActionId ?? (job.command === 'setup' ? job.actionId : undefined) : undefined
  const busy = job?.state === 'running' || job?.state === 'queued'
  useEffect(() => { if (!busy) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [busy])
  useEffect(() => {
    if (!active || !actionId || !selected) return
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const value = await activityApi.invocations(actionId!, { limit: 100, ...(selected?.kind === 'project' ? { project: selected.name } : {}) })
        if (!cancelled) { setActivity({ id: actionId!, calls: value.items }); setActivityError(false) }
      } catch { if (!cancelled) setActivityError(true) }
      if (!cancelled && busy) timer = setTimeout(() => void poll(), 1500)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [active, actionId, busy, selected?.kind, selected?.name])
  const calls = active && activity && activity.id === actionId ? activity.calls : []
  const groups = preset.projectGroups ?? []
  function toggle(key: string) { setCollapsed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next }) }
  function row(resource: PresetResource, label: string, subtitle: string, expandable = false) {
    const key = `${resource.kind}:${resource.name}`
    const Icon = resource.kind === 'machine' ? Monitor : resource.kind === 'store' ? Database : Folder
    const recordedStatus = resourceStatus(job, calls, resource, groups)
    const definition = preset.projectDefinitions?.find(project => `${project.store}/${project.name}` === resource.name)
    const task = build && resource.kind === 'project' ? job?.progress?.tasks?.find(task => task.project === resource.name && task.targetCommits === definition?.history.commits) : undefined
    const verified = job?.state === 'completed' && job.presetVerified && preset.contentReady
    const status = verified ? 'Ready' : task ? task.state === 'running' ? 'Running' : task.state === 'completed' ? 'Created' : task.state === 'failed' ? 'Failed' : task.state === 'stopped' ? 'Stopped' : 'Waiting' : recordedStatus === 'Ready' && !preset.contentReady ? 'Planned' : recordedStatus
    return <><div className="preset-resource-row">
      {expandable ? <button className="preset-resource-toggle" aria-label={`${collapsed.has(key) ? 'Expand' : 'Collapse'} ${label}`} aria-expanded={!collapsed.has(key)} onClick={() => toggle(key)}>{collapsed.has(key) ? <ChevronRight /> : <ChevronDown />}</button> : <span className="preset-resource-toggle" />}
      <button className="preset-resource-select" aria-pressed={selected?.kind === resource.kind && selected.name === resource.name} onClick={() => setSelected(resource)}><Icon className="size-4 shrink-0" /><span className="preset-resource-name">{label}<small>{definition?.title ?? subtitle}</small>{definition && <small className="preset-density">Tier {definition.tier} · {task ? `${count(task.commits ?? 0)} / ` : ''}{count(definition.history.commits)} commits · {task ? `${count(task.layers ?? 1)} / ` : ''}{count(definition.layers ?? 0)} Layers · {count(definition.history.branches)} side branches{task?.started ? ` · ${elapsed(task.started, task.ended, now)}` : ''}</small>}</span><span title={task?.error ?? (status === 'Ready' ? 'Verified by the latest preset build. Machines shows current runtime state.' : task?.state === 'completed' ? 'Project commands completed; final library verification is pending.' : undefined)} className={`preset-resource-status${status === 'Failed' ? ' is-failed' : task?.state === 'running' ? ' is-running' : ''}`}>{status}</span></button>
      {resource.kind === 'project' && <Button variant="ghost" size="sm" className="preset-project-script" aria-label={`View script for ${label}`} onClick={() => onCommands(resource)}>View script</Button>}
    </div>{selected?.kind === resource.kind && selected.name === resource.name && resourceDetails}</>
  }
  const selectedTask = build && selected?.kind === 'project' ? job?.progress?.tasks?.find(task => task.project === selected.name) : undefined
  const definition = preset.projectDefinitions?.find(project => `${project.store}/${project.name}` === selected?.name)
  const selectedGroup = groups.find(group => group.store === selected?.store)
  const machine = preset.machineDefinitions?.find(item => item.name === selected?.machine)
  const related = selected ? calls.filter(call => resourceMatches(call.argv, selected, groups)) : []
  const resourceDetails = selected && <section className="preset-resource-details" aria-label="Selected resource"><div className="preset-resource-detail-heading"><h4>{definition?.title ?? selected.name}</h4><Button variant="ghost" size="icon-sm" aria-label="Close resource details" onClick={() => setSelected(undefined)}><X /></Button></div>
      {definition && <p className="preset-project-description">{definition.description}</p>}
      {selectedTask?.error && <p className={selectedTask.state === 'failed' ? 'preset-operation-error' : 'preset-project-description'}>{selectedTask.errorCode && <code>{selectedTask.errorCode}: </code>}{selectedTask.error}</p>}
      <dl><div><dt>Type</dt><dd>{selected.kind}</dd></div><div><dt>Machine</dt><dd>{selected.machine}</dd></div>
        {selected.kind === 'machine' && machine && <><div><dt>Platform</dt><dd>{machine.platform}</dd></div>{machine.cpus && <div><dt>Resources</dt><dd>{machine.cpus} CPUs · {machine.memory} memory · {machine.disk} disk</dd></div>}</>}
        {selected.kind === 'machine' && <div><dt>Stores</dt><dd>{groups.filter(group => group.machine === selected.name).map(group => group.store).join(', ') || 'None'}</dd></div>}
        {selected.kind === 'store' && <><div><dt>Location</dt><dd>SQLite on {selected.machine}</dd></div><div><dt>Projects</dt><dd>{selectedGroup?.projects.join(', ')}</dd></div></>}
        {selected.kind === 'project' && <><div><dt>Store</dt><dd>{selected.store}</dd></div>{definition && <><div><dt>Tier</dt><dd>{definition.tier}</dd></div><div><dt>Side branches</dt><dd>{count(definition.history.branches)}<details><summary>View names</summary>{definition.branches.join(', ')}</details></dd></div><div><dt>{preset.contentReady ? 'Verified history' : 'Planned history'}</dt><dd>{count(definition.history.commits)} commits · {count(definition.history.merges)} merges · {count(definition.layers ?? 0)} main Layers</dd></div></>}</>}
        {selectedTask && <><div><dt>CLI progress</dt><dd>{count(selectedTask.completed)} / {count(selectedTask.total)} commands</dd></div><div><dt>Elapsed</dt><dd>{elapsed(selectedTask.started, selectedTask.ended, now) || "Waiting"}</dd></div></>}
      </dl><Button variant="outline" size="sm" onClick={() => onCommands(selected)}>View related CLI commands</Button>
      {related.length > 0 && actionId && <div className="preset-resource-recorded"><p>{preset.contentReady || busy ? 'Recorded commands' : 'Previous build commands'} · select to view input and output</p>{related.slice(-4).map(call => <button key={call.id} onClick={() => onActivity(actionId, call.id)}><code>layerfs {call.argv.join(' ')}</code><span>{call.status}</span></button>)}</div>}
      {activityError && active && <p className="preset-topology-note">Command status could not be refreshed. Open CLI Activity to retry.</p>}
    </section>
  return <section className="preset-topology" aria-label="Preset environment plan">
    <div className="preset-topology-heading"><h3>Project library</h3><span>{build && job.state === 'completed' && job.presetVerified && preset.contentReady ? 'Last build verified' : busy ? build ? 'Build progress' : 'Reset in progress' : 'Machine → store → project'}</span></div>
    <p className="preset-topology-note">Planned load: {preset.projects} projects · 8 workload tiers · 2 per machine. Independent branches share the CLI pool after source imports and store placement finish.</p>
    {!preset.contentReady && preset.initialized && !busy && <p className="preset-topology-note">Saved projects are not verified against these targets. Build projects resets this environment and creates the tiered library.</p>}
    {busy && <p className="preset-topology-note">Project status and step counts follow the running scripts. Created projects await final verification.</p>}
    <ul className="preset-resource-list">{preset.machines.map(name => {
      const info = preset.machineDefinitions?.find(item => item.name === name)
      const platform = info?.platform ?? (name === 'native' ? 'native' : name === 'docker' ? 'docker' : 'machine')
      const stores = groups.filter(group => group.machine === name)
      return <li key={name}>{row({ kind: 'machine', name, machine: name }, name === 'native' ? 'Native' : name === 'docker' ? 'Docker' : name, platform === 'native' ? 'Local machine' : platform === 'docker' ? 'Container' : platform === 'lima' ? 'Lima virtual machine' : platform, stores.length > 0)}
        {!collapsed.has(`machine:${name}`) && stores.length > 0 && <ul>{stores.map(group => <li key={group.store}>{row({ kind: 'store', name: group.store, store: group.store, machine: name }, group.store, 'SQLite store', true)}
          {!collapsed.has(`store:${group.store}`) && <ul>{group.projects.map(project => <li key={project}>{row({ kind: 'project', name: `${group.store}/${project}`, store: group.store, machine: name }, project, 'Project')}</li>)}</ul>}
        </li>)}</ul>}
      </li>
    })}</ul>
    {!preset.projects && <p className="preset-empty-projects">Built-in machine records only. No stores, projects or workers are created.</p>}

  </section>
}

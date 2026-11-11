import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { presetApi, type PresetScript as Script } from '@/layerfs/demo-presets-api'
import { type PresetResource } from '@/layerfs/preset-resources'
import type { DemoPreset, PresetExecutionMode } from '@/layerfs/demo-presets-api'
import './presets.css'

function quote(value: string) {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"
}
function commandText(argv: string[]) { return ['layerfs', ...argv].map(quote).join(' ') }
function execInput(argv: string[]) { return argv[0] === 'workspace' && argv[1] === 'exec' ? argv[3] : undefined }
function displayCommand(argv: string[]) { return commandText(execInput(argv) === undefined ? argv : argv.map((value, index) => index === 3 ? '<shell command>' : value)) }
function commandPlan(script: Script, commands = script.commands) {
  const lines = ['# CLI command plan. Build preset also prepares sample files and clears CLI activity.', '# This is a dependency plan, not a standalone shell script. Use Run from terminal for the complete workflow.', '# Independent branch lanes can overlap. Each write/publish pair finishes before the next write on its branch.', '# <commit:step-key> is replaced at runtime by the immutable commit ID from that step\'s successful receipt.', `export LAYERFS_HOME=${quote(String(script.configuration.home))}`]
  if (typeof script.configuration.cli === 'string') {
    const directory = script.configuration.cli.slice(0, script.configuration.cli.lastIndexOf('/'))
    if (directory) lines.push(`export PATH=${quote(directory)}:"$PATH"`)
  }
  if (script.dynamicReset) lines.push('# Cleanup targets are discovered again at runtime; this preview may not list every deletion.')
  const limits = script.configuration.historyLimits
  if (limits) lines.push(`# History CLI pool: at most ${limits.concurrency} commands, ${limits.perStore} per store, ${limits.perProject} per project.`)
  let phase = ''
  for (const step of commands) {
    if (step.phase !== phase) { phase = step.phase; lines.push('', `# ${phase.toUpperCase()}`) }
    if (step.note) lines.push(`# ${step.note}`)
    if (step.key) lines.push(`# Step ${step.key}${step.lane ? ` · lane ${step.lane}` : ''}${step.dependsOn?.length ? ` · after ${step.dependsOn.join(', ')}` : ''}`)
    if (step.commitFrom) lines.push(`# Commit argument: immutable commit returned by ${step.commitFrom}; never the moving branch head.`)
    let command = commandText(step.argv)
    if (step.input !== undefined) {
      // printf preserves stdin exactly, including whether it ends with a newline.
      command = `printf %s ${quote(step.input)} | ${command}`
    }
    lines.push(command)
  }
  return lines.join('\n') + '\n'
}
const phaseLabels = { reset: 'Reset environment', build: 'Build preset', verify: 'Verify result' }

export function PresetScript({ preset, sandboxes, executionMode, open, onOpenChange, resource }: { preset: string; sandboxes: boolean; executionMode: PresetExecutionMode; open: boolean; onOpenChange: (open: boolean) => void; resource?: PresetResource; groups: DemoPreset['projectGroups'] }) {
  const [script, setScript] = useState<Script>(), [error, setError] = useState<string>()
  const [copied, setCopied] = useState<string>(), [filter, setFilter] = useState(true)
  const [offset, setOffset] = useState(0), [downloading, setDownloading] = useState(false)
  const snapshot = useRef<{ key: string; id?: string }>({ key: '' })
  const scoped = !!resource && filter
  const key = `${preset}:${sandboxes}:${executionMode}:${scoped ? `${resource?.kind}:${resource?.name}` : 'all'}`
  const scope = scoped ? { kind: resource!.kind, name: resource!.name } : {}
  useEffect(() => { if (open) { setFilter(true); setOffset(0); snapshot.current = { key: '' } } }, [open, resource?.kind, resource?.name])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setScript(undefined); setError(undefined); setCopied(undefined)
    if (snapshot.current.key !== key) { snapshot.current = { key }; if (offset) setOffset(0) }
    void presetApi.script(preset, sandboxes, { offset, limit: 100, snapshot: snapshot.current.id, ...scope }, executionMode).then(value => {
      if (cancelled) return
      if (!Array.isArray(value.commands) || typeof value.offset !== 'number') { setError('The host needs the paginated script API. Reconnect to the updated preview.'); return }
      snapshot.current = { key, id: value.snapshot }; setScript(value)
    }, e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [preset, sandboxes, executionMode, open, key, offset])
  const commands = script?.commands ?? []
  const projectName = resource?.kind === 'project' ? resource.name.split('/').at(-1) : undefined
  async function copy(text: string, target: string) {
    try { await navigator.clipboard.writeText(text); setCopied(target) }
    catch { setError('Copy is unavailable. Select the commands or download the plan.') }
  }
  async function download() {
    if (!script || downloading) return
    setDownloading(true); setError(undefined)
    try {
      const all: Script['commands'] = []
      let next: number | null = 0
      do {
        const page: Script = await presetApi.script(preset, sandboxes, { offset: next, limit: 1000, snapshot: script.snapshot, ...scope }, executionMode)
        all.push(...page.commands); next = page.next ?? null
      } while (next !== null)
      const url = URL.createObjectURL(new Blob([commandPlan(script, all)], { type: 'text/plain' })), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `${scoped && projectName ? projectName : preset}-cli-plan.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setDownloading(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="preset-script-dialog">
    <DialogHeader className="preset-script-header"><DialogTitle>{scoped && projectName ? `${projectName} · CLI script` : `CLI commands · ${preset.charAt(0).toUpperCase() + preset.slice(1)}`}</DialogTitle><DialogDescription>{scoped ? 'Project commands in dependency order. Independent branches can run together. Shared setup and reset are in the full plan.' : 'After preparation and placement, eight projects share the CLI pool across four machines. Independent branches can run together.'} CLI Activity records the actual execution timeline.</DialogDescription></DialogHeader>
    {error && <p role="alert" className="preset-script-error">{error}</p>}
    {!script && !error && <p role="status" className="preset-script-loading"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />Loading commands…</p>}
    {script && <>
      <div className="preset-script-toolbar"><span className="preset-command-count">{commands.length ? `${offset + 1}–${offset + commands.length}` : '0'} of {(script.total ?? commands.length).toLocaleString()} commands</span><Button variant="ghost" size="sm" onClick={() => void copy(commandPlan(script, commands), 'plan')}>{copied === 'plan' ? <Check /> : <Copy />}{copied === 'plan' ? 'Copied' : 'Copy this page'}</Button><Button variant="ghost" size="sm" disabled={downloading} onClick={() => void download()}>{downloading ? <LoaderCircle className="animate-spin" /> : <Download />}{downloading ? 'Preparing…' : 'Download full plan'}</Button></div>
      {resource && <div className="preset-command-filter"><span>{filter ? `${resource.kind}: ${resource.name}` : 'All commands'}</span><Button variant="ghost" size="sm" onClick={() => { setFilter(value => !value); setOffset(0); setCopied(undefined) }}>{filter ? 'Show all commands' : 'Show related commands'}</Button></div>}
      <div className="preset-command-list">
        <p className="preset-command-context">{executionMode === 'mixed' ? 'Mixed mode' : 'Filesystem mode'} · Environment: <code>{String(script.configuration.home)}</code></p>
        {executionMode === 'mixed' && <p className="preset-command-context">Sandboxes are reused. Each fresh workspace runs two ordered exec/commit pairs, then cleanly unmounts. The next batch mounts a fresh workspace on the saved branch head. At most 3 sandboxes per project; up to 16 mounted workspaces per sandbox.</p>}
        {script.configuration.historyLimits && <p className="preset-command-context">History CLI pool: up to {script.configuration.historyLimits.concurrency} commands · {script.configuration.historyLimits.perStore} per store · {script.configuration.historyLimits.perProject} per project.</p>}
        <p className="preset-command-context">Independent branches can overlap. Each write/publish pair finishes before the next write on its branch. <code>{'<commit:step-key>'}</code> resolves to the exact commit from a successful receipt before execution.</p>
        {!scoped && script.dynamicReset && <p className="preset-command-context">Cleanup targets are discovered when Build starts.</p>}
        {commands.map((step, index) => <div key={offset + index}>
          {(index === 0 || commands[index - 1].phase !== step.phase) && <h3 className="preset-command-phase">{phaseLabels[step.phase]}</h3>}
          <div className="preset-command-row"><span className="preset-command-number">{offset + index + 1}</span><div className="preset-command-body">{step.lane && <p className="preset-command-lane">Branch lane · {step.lane}</p>}<code>{displayCommand(step.argv)}</code>{execInput(step.argv) !== undefined && <details><summary>Shell command / exec input</summary><pre>{execInput(step.argv)}</pre></details>}{step.note && <p>{step.note}</p>}{step.commitFrom && <p>Publishes the exact commit returned by <code>{step.commitFrom}</code>.</p>}{step.key && <details><summary>Step and dependencies</summary><p>Step <code>{step.key}</code></p><p>{step.dependsOn?.length ? <>After <code>{step.dependsOn.join(', ')}</code></> : 'No history-step dependencies.'}</p></details>}{step.input !== undefined && <details><summary>File content / standard input</summary><pre>{step.input}</pre></details>}</div></div>
        </div>)}
        {!commands.length && <p className="preset-command-context">No commands for this resource in the current plan.</p>}
      </div>
      <div className="preset-script-pagination"><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</Button><span>Page {Math.floor(offset / 100) + 1}</span><Button variant="outline" size="sm" disabled={script.next == null} onClick={() => setOffset(script.next!)}>Next</Button></div>
      <details className="preset-script-configuration"><summary>Run from terminal</summary><p>Builds the entire library, including sample files, environment reset, activity reset and progress. The runner schedules dependencies and resolves commit receipts. Downloads describe that command plan; they are not standalone setup scripts.</p><div className="preset-script-command"><code>{script.command}</code><Button size="icon-sm" variant="ghost" aria-label="Copy build command" onClick={() => void copy(script.command, 'terminal')}>{copied === 'terminal' ? <Check /> : <Copy />}</Button></div></details>
    </>}
  </DialogContent></Dialog>
}

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createBashToolDefinition, createLocalBashOperations } from '@earendil-works/pi-coding-agent'
import { createWorkspaceBashOperations, readBashConnection } from './workspace-bash.js'
import { instructionPrompt, readProjectInstructions, workspaceInstructions } from './context.js'
import { captureToolOutput } from './tool-output.js'

/** How the worker and lead definitions (extensions.js) begin; a child tells which it is by its system prompt. */
export const WORKER_MARK = 'You are a focused worker in LayerFS Connect.'
export const LEAD_MARK = 'You are a team lead in LayerFS Connect.'

/** The same bash implementation is loaded by the parent and every Pi child. */
export function createConnectBashExtension({ cwd, env, traceDir, runDir = dirname(traceDir), agent = null, approvalFile, workspace = false, instructions = '', defaultBashTimeoutSeconds = 120, projectInstructions = { main: true, worker: true, lead: true }, sdk = {} }) {
  return (pi) => {
    mkdirSync(traceDir, { recursive: true })
    // which agent this is, known once its first run starts: Settings → SDKs gives each kind its own
    let kind = agent === 'root' ? 'main' : 'worker'
    pi.on('before_agent_start', async (event, ctx) => {
      try {
        // Settings → Hooks can turn project instructions off, for every agent or one
        kind = agent === 'root' ? 'main' : event.systemPrompt?.includes(LEAD_MARK) ? 'lead' : 'worker'
        const withFiles = projectInstructions[kind] !== false
        const files = !withFiles ? [] : workspace ? await workspaceInstructions(approvalFile) : await readProjectInstructions(ctx.cwd)
        const context = instructionPrompt(files, instructions)
        const location = workspace && agent !== 'root'
          ? "Connect executes every bash command in this conversation's mounted LayerFS FUSE Workspace, shared with the parent agent and subagents. Pi's local cwd is a host control directory, not the project filesystem. Each bash command starts in the Workspace root (use cd within a command for subdirectories) and is serialized and auto-committed to the session branch when it finishes; .gitignore does not exclude files from LayerFS commits, so write temporary scratch data to /tmp or remove temporary workspace files before exiting. Processes are stopped with their process group when a command ends. Do not switch execution to the host or manipulate LayerFS mounts. Pi's fullOutputPath is a host log that container bash cannot read; redirect large output to a workspace file or /tmp if you need to inspect it."
          : ''
        const note = withFiles ? 'Project root instructions above are loaded automatically; do not waste a bash call re-reading root AGENTS.md. Before changing files in subdirectories, use bash to check for additional AGENTS.override.md, AGENTS.md, or CLAUDE.md instructions in those directories.' : ''
        return { systemPrompt: [event.systemPrompt, location, context, note, sdk.prompt?.[kind]].filter(Boolean).join('\n\n') }
      } catch (error) { ctx.abort(); throw error }
    })
    const bash = createBashToolDefinition(cwd)
    pi.registerTool({
      ...bash,
      description: `Run a bash command in the workspace. Use native shell commands (rg, find, ls, sed, cat, python3, node, patch, git) to read, search, write, edit, and test files. Each command starts at the workspace root; changes in a LayerFS workspace are automatically committed after each command. Timeout is in seconds and defaults to ${defaultBashTimeoutSeconds}.`,
      promptGuidelines: [workspace
        ? 'Use bash for all file operations. Commands execute sequentially in this conversation\'s mounted LayerFS Workspace (shared with subagents) and auto-commit file changes to the session branch after each command. Batch related reads or edits into cohesive commands and use workspace-relative paths.'
        : 'Use bash for all file operations in the selected local working directory. Batch related reads or edits into cohesive commands.'],
      async execute(toolCallId, args, signal, onUpdate, ctx) {
        const name = agent ?? `child-${ctx.sessionManager.getSessionId()}`
        if (!workspace && approvalFile !== undefined) {
          signal?.throwIfAborted()
          const connection = await readBashConnection(approvalFile, signal)
          const response = await fetch(`${connection.url}/request`, {
            method: 'POST',
            headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: connection.sessionId, agent: name, toolCallId, command: args.command, cwd: ctx.cwd }),
            signal,
          })
          const decision = await response.json()
          if (!response.ok || decision.approved !== true) {
            throw new Error(decision.reason || `Bash command was not approved (HTTP ${response.status}).`)
          }
          signal?.throwIfAborted()
        }
        const output = captureToolOutput(runDir, name, toolCallId, workspace
          ? createWorkspaceBashOperations({ approvalFile, agent: name, toolCallId })
          : createLocalBashOperations())
        const tool = createBashToolDefinition(ctx.cwd, {
          operations: output.operations,
          exposeSessionEnvironment: !workspace,
          ...(!workspace ? { spawnHook: (spawn) => ({
            ...spawn,
            env: {
              ...Object.fromEntries(Object.entries(spawn.env).filter(([key]) => !key.startsWith('LAYERFS_'))),
              ...env,
              LAYERFS_TRACE: join(traceDir, `${name}.jsonl`),
              LAYERFS_TRACE_STEP: `${name}:${toolCallId}`,
              LAYERFS_TRACE_START: '1',
            },
          }) } : {}),
        })
        let result, error
        try { result = await tool.execute(toolCallId, { ...args, timeout: args.timeout ?? defaultBashTimeoutSeconds }, signal, onUpdate, ctx) }
        catch (cause) { error = cause }
        const artifact = output.finish()
        if (error && !artifact.bytes) throw error
        if (error) result = { content: [{ type: 'text', text: error.message }], isError: true }
        return { ...result, details: { ...result.details, outputArtifact: { ...artifact, truncated: !!result.details?.truncation } } }
      },
    })
  }
}

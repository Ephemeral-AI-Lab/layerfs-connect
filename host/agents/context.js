import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readBashConnection } from './workspace-bash.js'

export const INSTRUCTION_FILES = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']
export const MAX_INSTRUCTION_BYTES = 1024 * 1024

/** Match Pi's per-directory precedence, with outer scopes before the selected cwd. */
export async function readProjectInstructions(cwd) {
  const instructions = []
  for (let directory = resolve(cwd);;) {
    for (const name of INSTRUCTION_FILES) {
      const path = join(directory, name)
      let info
      try { info = await stat(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (!info.isFile()) continue
      if (info.size > MAX_INSTRUCTION_BYTES) throw new Error(`Project instructions exceed 1 MiB: ${path}`)
      instructions.unshift({ path, content: (await readFile(path, 'utf8')).replace(/^\uFEFF/, '') })
      break
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return instructions
}

export async function workspaceInstructions(approvalFile) {
  const connection = await readBashConnection(approvalFile)
  const response = await fetch(`${connection.url}/context`, {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: connection.sessionId }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.reason || result.message || 'Could not load workspace instructions.')
  return result.instructions
}

export function instructionPrompt(files, custom = '') {
  const sections = files.map(({ path, content }) => `Project instructions from ${JSON.stringify(path)}:\n<project-instructions>\n${content}\n</project-instructions>`)
  if (custom.trim()) sections.push(`Conversation instructions:\n${custom.trim()}`)
  return sections.join('\n\n')
}

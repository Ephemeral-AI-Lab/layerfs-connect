import { Box } from 'lucide-react'
import { Empty } from '@/components/layerfs/States'
import { ProjectSandboxes } from '@/components/sandbox/ProjectSandboxes'
import { chatProject, type ChatDetail } from '@/layerfs/agent-api'

export function SandboxesTab({ chat, childId }: { chat: ChatDetail; childId?: string }) {
  const project = chatProject(chat)
  if (!project) return <div className="sandbox-empty"><Empty icon={Box} title="No LayerFS project linked">Start a chat with a LayerFS project to see its agents and sandbox workspaces.</Empty></div>
  return <ProjectSandboxes key={project} project={project} chat={chat} childId={childId} />
}

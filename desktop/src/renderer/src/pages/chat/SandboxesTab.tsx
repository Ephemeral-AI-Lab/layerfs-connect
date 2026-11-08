import { Box } from 'lucide-react'
import { Empty } from '@/components/layerfs/States'
import { ProjectSandboxes } from '@/components/sandbox/ProjectSandboxes'
import { chatProject, type ChatDetail } from '@/layerfs/agent-api'
import { EXAMPLE_CHAT_ID } from '@/layerfs/chat-sim'
import { ProjectSandboxPreview } from '@/layerfs/simulation/ProjectSandboxPreview'

export function SandboxesTab({ chat, childId }: { chat: ChatDetail; childId?: string }) {
  const project = chatProject(chat)
  if (!project) return <div className="sandbox-empty"><Empty icon={Box} title="No LayerFS project linked">Start a chat with a LayerFS project to see its agents and sandbox workspaces.</Empty></div>
  return chat.id === EXAMPLE_CHAT_ID
    ? <ProjectSandboxPreview key={project} project={project} title={chat.title} chatId={chat.id} childId={childId} sampleChildId={chat.children[0]?.id} />
    : <ProjectSandboxes key={project} project={project} />
}

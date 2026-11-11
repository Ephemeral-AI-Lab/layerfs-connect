import { memo } from 'react'
import { FolderTree } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Empty } from '@/components/layerfs/States'
import { ProjectFiles } from '@/components/files/ProjectFiles'
import { chatProject, type ChatDetail } from '@/layerfs/agent-api'

export const ChatFilesTab = memo(function ChatFilesTab({ chat }: { chat: ChatDetail }) {
  const project = chatProject(chat)
  return (
    <div className="@container/files flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-5">
      {project && (
        <div className="flex shrink-0 items-center justify-between gap-3 text-12 text-muted-foreground">
          <span>LayerFS project files · read-only</span>
          <Link className="shrink-0 underline underline-offset-4 hover:text-foreground" to={`/storage/${project.split('/').map(encodeURIComponent).join('/')}/files`}>Open in Storage</Link>
        </div>
      )}
      {project ? <ProjectFiles project={project} tick={chat.state === 'running' ? Math.floor(chat.updated / 3000) : chat.updated} /> : (
        <Empty icon={FolderTree} title="No LayerFS project linked">
          Start a new chat with a LayerFS project to browse its files here.
        </Empty>
      )}
    </div>
  )
}, (a, b) => chatProject(a.chat) === chatProject(b.chat) && (a.chat.state === 'running' ? Math.floor(a.chat.updated / 3000) : a.chat.updated) === (b.chat.state === 'running' ? Math.floor(b.chat.updated / 3000) : b.chat.updated))

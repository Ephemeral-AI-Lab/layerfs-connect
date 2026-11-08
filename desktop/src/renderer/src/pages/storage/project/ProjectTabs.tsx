import { useNavigate } from 'react-router-dom'
import { Tab, TabBar } from '@/components/layerfs/motion/tabs'

export const PROJECT_TABS = ['files', 'history', 'sandboxes', 'storage'] as const
export type ProjectTab = typeof PROJECT_TABS[number]
const labels: Record<ProjectTab, string> = { files: 'Files', history: 'History', sandboxes: 'Sandboxes', storage: 'Storage' }

export function ProjectTabs({ base, current }: { base: string; current: ProjectTab }) {
  const navigate = useNavigate()
  return <TabBar aria-label="Project" variant="line">
    {PROJECT_TABS.map(tab => <Tab key={tab} active={current === tab} onClick={() => navigate(`${base}/${tab}`)}>{labels[tab]}</Tab>)}
  </TabBar>
}

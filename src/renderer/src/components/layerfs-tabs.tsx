// The LayerFS page's three parts, one tab row that each part's header
// carries: the projects, the Storage their history lives in, and the Compute
// their commands run on. The sidebar has one LayerFS item for all three.
import { Cpu } from 'lucide-react'

import { LfsProject, LfsStore } from '@/components/lfs-icons'
import { Tab, TabBar } from '@/components/motion/tabs'

export type LayerFSPart = 'projects' | 'storage' | 'compute'

const PARTS: { id: LayerFSPart; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'projects', label: 'Projects', icon: LfsProject },
  { id: 'storage', label: 'Storage', icon: LfsStore },
  { id: 'compute', label: 'Compute', icon: Cpu },
]

export function LayerFSTabs({ current, onPick }: { current: LayerFSPart; onPick?: (part: LayerFSPart) => void }) {
  return (
    <TabBar aria-label="LayerFS">
      {PARTS.map((p) => (
        <Tab key={p.id} active={p.id === current} onClick={() => p.id !== current && onPick?.(p.id)}>
          <p.icon aria-hidden="true" className="mr-1.5 size-3.5 opacity-80" />
          {p.label}
        </Tab>
      ))}
    </TabBar>
  )
}

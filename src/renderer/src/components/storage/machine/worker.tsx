// One labelled fact. (LayerFS 2.0 has no worker box: machines start on the
// first call that needs them.)
import { cn } from '@/lib/utils'

/** One labelled fact. */
export function Fact({ label, children, mono, title }: { label: string; children: React.ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold tracking-wider text-muted-foreground/80 uppercase">{label}</dt>
      <dd title={title} className={cn('mt-1 truncate', mono ? 'font-mono text-[12.5px]' : 'text-sm font-medium')}>
        {children}
      </dd>
    </div>
  )
}

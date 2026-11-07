import { ContentHeader } from '@/components/shell/ContentHeader'

/** Stand-in for pages that land in later steps (Machines and Storage from pi-desktop). */
export function PlaceholderPage({ title, body }: { title: string; body: string }) {
  return (
    <>
      <ContentHeader />
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-20 font-medium text-[var(--text-primary)]">{title}</h1>
          <p className="text-14 text-[var(--text-secondary)]">{body}</p>
        </div>
      </div>
    </>
  )
}

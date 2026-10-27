// The LayerFS icon set (assets/icons, one SVG per concept) as React
// components. Each SVG is inlined so its two tones follow the page's
// --lfs-light / --lfs-dark variables (styles.css sets them per theme). The
// files' own <style> classes are turned into inline styles here, so no class
// rule leaks into the page.
import { cn } from '@/lib/utils'

const files = import.meta.glob('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const TONES: Record<string, string> = {
  l: 'stroke:var(--lfs-light,#93B1E0)',
  d: 'stroke:var(--lfs-dark,#2F5BB5)',
  lf: 'fill:var(--lfs-light,#93B1E0)',
  df: 'fill:var(--lfs-dark,#2F5BB5)',
  af: 'fill:var(--lfs-warn,#E0A030)',
  sf: 'fill:var(--lfs-surface,#fff)',
}

/** An SVG file made ready to inline: no <style>, tone classes as styles, sized by its box. */
function prepare(svg: string): string {
  return svg
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/width="24" height="24"/, 'width="100%" height="100%"')
    .replace(/class="([^"]+)"/g, (_, names: string) => `style="${names.split(/\s+/).map((n) => TONES[n] ?? '').filter(Boolean).join(';')}"`)
}

const SVG: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, svg]) => [path.split('/').pop()!.replace(/\.svg$/, ''), prepare(svg)]),
)

export type LfsIconName =
  | 'project'
  | 'store'
  | 'layer'
  | 'commit'
  | 'branch'
  | 'fork'
  | 'merge'
  | 'publish'
  | 'workspace'
  | 'sandbox'
  | 'exec'
  | 'mount'
  | 'conflict'
  | 'diff'
  | 'agent'
  | 'worker'
  | 'init'

export interface LfsIconProps {
  className?: string
  title?: string
}

/** One icon of the set; 16 px unless `className` sizes it. Decorative unless given a `title`. */
export function LfsIcon({ name, className, title }: LfsIconProps & { name: LfsIconName }) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('inline-block size-4 shrink-0 [&>svg]:block', className)}
      dangerouslySetInnerHTML={{ __html: SVG[name] ?? '' }}
    />
  )
}

/** A named icon component, for places that take an icon component (`icon={…}`). */
const named = (name: LfsIconName) => {
  const Icon = (props: LfsIconProps) => <LfsIcon name={name} {...props} />
  Icon.displayName = `Lfs(${name})`
  return Icon
}

export const LfsProject = named('project')
export const LfsStore = named('store')
export const LfsLayer = named('layer')
export const LfsCommit = named('commit')
export const LfsBranch = named('branch')
export const LfsFork = named('fork')
export const LfsMerge = named('merge')
export const LfsPublish = named('publish')
export const LfsWorkspace = named('workspace')
export const LfsSandbox = named('sandbox')
export const LfsExec = named('exec')
export const LfsMount = named('mount')
export const LfsConflict = named('conflict')
export const LfsDiff = named('diff')
export const LfsAgent = named('agent')
export const LfsWorker = named('worker')
export const LfsInit = named('init')

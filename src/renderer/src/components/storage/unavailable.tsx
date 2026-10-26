import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const NEEDS_REMOTES = 'Needs LayerFS remotes (#446)'

/**
 * Wraps a control the backend can't serve yet. Disabled buttons fire no
 * pointer events, so the tooltip hangs off a focusable wrapper.
 */
export function Unavailable({ reason = NEEDS_REMOTES, children }: { reason?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

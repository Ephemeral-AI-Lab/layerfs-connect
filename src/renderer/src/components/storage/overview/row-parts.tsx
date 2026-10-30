// Pieces the board and the detail pages share: the glass card and the `…`
// menu button.
import { Ellipsis } from 'lucide-react'
import { type CSSProperties, forwardRef } from 'react'

import { spotlight } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Liquid glass for a band, a section or a detail card: the branch's one card surface. */
export const CARD = 'glass-liquid spotlight reveal min-w-0 rounded-2xl shadow-xs'

/** A band or section card: glass, spotlight and its place in the entrance stagger. */
export function Card({ index = 0, className, children, ...rest }: React.ComponentProps<'section'> & { index?: number }) {
  return (
    <section onPointerMove={spotlight} className={cn(CARD, className)} style={{ '--i': index } as CSSProperties} {...rest}>
      {children}
    </section>
  )
}

/** The `…` button that opens a row's menu. */
export const MoreButton = forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button> & { label: string }>(function MoreButton({ label, className, ...props }, ref) {
  return (
    <Button ref={ref} size="icon-sm" variant="ghost" aria-label={label} className={cn('rounded-xl text-muted-foreground', className)} {...props}>
      <Ellipsis />
    </Button>
  )
})

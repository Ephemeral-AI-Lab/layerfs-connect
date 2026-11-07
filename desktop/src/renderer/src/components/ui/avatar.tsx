import { cn } from '@/lib/utils'

const SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-7 w-7 text-11', user: 'h-[27px] w-[27px] text-11', row: 'h-11 w-11 text-15' }

/** Round monogram avatar; the tint is identity art, the one place brand color is allowed. */
export function Avatar({ initials, tint, size }: { initials: string; tint: string; size: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white', SIZES[size])}
      style={{ background: tint }}
    >
      {initials}
    </span>
  )
}

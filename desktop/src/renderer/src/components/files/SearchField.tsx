import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SearchFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  size?: 'sm' | 'md'
}

/** A search box: an icon, the field, and a clear button (Escape clears too). */
export function SearchField({ label, value, onChange, className, size = 'md' }: SearchFieldProps) {
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
      <Input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        className={cn('pr-7 pl-7 text-[13px] shadow-[var(--highlight)]', size === 'sm' ? 'h-7' : 'h-8')}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-faint outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}


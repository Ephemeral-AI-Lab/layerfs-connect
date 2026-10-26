import { Ellipsis, PencilLine, Trash2, Unlink } from 'lucide-react'

import { StatusChip, databaseStatus } from '@/components/storage/chips'
import { DatabaseIcon } from '@/components/storage/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type Database, databaseName } from '@/data/storage'

interface DatabaseHeaderProps {
  db: Database
  /** Short facts, joined by dots. */
  facts: string[]
  /** One monospace line: where the database is. */
  where: string
}

export function DatabaseHeader({ db, facts, where }: DatabaseHeaderProps) {
  return (
    <header className="flex items-start gap-4">
      <DatabaseIcon db={db} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="truncate text-xl font-semibold tracking-[-0.01em]">{databaseName(db)}</h2>
          <StatusChip status={databaseStatus(db)} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{facts.join(' · ')}</p>
        <p className="mt-1 truncate font-mono text-xs text-faint">{where}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled>
            <PencilLine /> Rename
          </DropdownMenuItem>
          {db.kind === 'sqlite' ? (
            <DropdownMenuItem disabled>
              <Unlink /> Remove from this machine
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              <Unlink /> Disconnect
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled variant="destructive">
            <Trash2 /> Delete database
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

// The strip across the top of the page: the window's drag handle, clear of the
// traffic lights (macOS) or the window controls (elsewhere). With the sidebar
// folded away it holds the button that shows it again.
import { PanelLeftOpen } from 'lucide-react'

import { useSidebar } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'

const isMac = window.connect.platform === 'darwin'

export function WindowBar() {
  const { t } = useI18n()
  const sidebar = useSidebar()
  return (
    <div className="window-bar shell-window-bar app-drag relative z-10 shrink-0" data-platform={isMac ? 'mac' : 'other'} data-sidebar-open={sidebar.open}>
      {!sidebar.open && (
        <button
          type="button"
          onClick={() => sidebar.setOpen(true)}
          aria-label={t('Show sidebar')}
          title={`${t('Show sidebar')} (${isMac ? '⌘B' : 'Ctrl+B'})`}
          className="shell-toolbar-button app-no-drag"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}
    </div>
  )
}

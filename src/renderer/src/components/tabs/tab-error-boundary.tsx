// A page that throws while rendering takes down only its own tab: the tab
// strip, the sidebar and the other tabs keep working, and the tab offers a reload.
import { Component, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('A tab’s page failed:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-foreground">{t('This page hit an error.')}</p>
        <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          <RotateCw className="size-3.5" />
          {t('Reload page')}
        </Button>
      </div>
    )
  }
}

from pathlib import Path
import shutil

root=Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect')
ui=root/'desktop/src/renderer/src'
staged=Path(__file__).parent
settings=ui/'pages/settings'
settings.mkdir(exist_ok=True)
for name in ['ModelsPage.tsx', 'ProviderSignIn.tsx']:
    shutil.copyfile(staged/name, settings/name)

p=ui/'layerfs/agent-api.ts'
s=p.read_text()
s=s.replace('export interface ChatModels {', '''export interface ChatProvider {
  id: string
  name?: string
  hasKey: boolean
  baseUrl?: string
  api?: string
  signIn?: { label: string; plan: string } | null
  signedIn?: boolean
}

export interface ModelSettings {
  provider: string
  modelId: string
  thinkingLevel?: string
  apiKey?: string
  baseUrl?: string
  api?: string
}

export interface ModelLogin {
  id: string
  state: 'starting' | 'waiting' | 'done' | 'failed' | 'cancelled'
  step: { type: 'auth_url'; url: string; instructions?: string } | { type: 'device_code'; userCode: string; verificationUri: string; expires?: number } | null
  prompt: { type: 'select' | 'input' | 'confirm'; message: string; placeholder?: string; options?: { id: string; label: string; description?: string }[] } | null
  progress: string | null
  error: string | null
}

export interface ChatModels {''')
s=s.replace('providers: { id: string; name?: string; hasKey: boolean }[]', 'providers: ChatProvider[]')
needle="  models: () => call<ChatModels>('GET', '/api/agent/models'),"
assert needle in s
s=s.replace(needle,needle+'''
  configureModel: (input: ModelSettings) => call<ChatModels>('POST', '/api/agent/models', input),
  testModel: () => call<{ text: string }>('POST', '/api/agent/models/test', {}),
  startLogin: (provider: string) => call<ModelLogin>('POST', `/api/agent/providers/${encodeURIComponent(provider)}/login`, {}),
  login: (id: string) => call<ModelLogin>('GET', `/api/agent/logins/${encodeURIComponent(id)}`),
  respondLogin: (id: string, value: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/respond`, { value }),
  openLogin: (id: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/open`, {}),
  cancelLogin: (id: string) => call<ModelLogin>('POST', `/api/agent/logins/${encodeURIComponent(id)}/cancel`, {}),''')
p.write_text(s)

p=ui/'router.tsx';s=p.read_text()
s=s.replace("import { PlaceholderPage } from '@/pages/PlaceholderPage'", "import { PlaceholderPage } from '@/pages/PlaceholderPage'\nimport { ModelsPage } from '@/pages/settings/ModelsPage'")
old='{ path: \'settings\', element: <PlaceholderPage title="Settings" body="Settings come later." /> }'
assert old in s
s=s.replace(old,"{ path: 'settings', element: <ModelsPage /> }")
p.write_text(s)

p=ui/'components/shell/Sidebar.tsx';s=p.read_text()
old='<NavRow to="/storage" icon={Database} label="Storage" />'
assert old in s
s=s.replace(old,old+'\n          <NavRow to="/settings" icon={Settings} label="Models" />')
p.write_text(s)

p=ui/'components/chat/Pickers.tsx';s=p.read_text()
s=s.replace("import type { ReactNode } from 'react'", "import type { ReactNode } from 'react'\nimport { useNavigate } from 'react-router-dom'")
needle='  const providers = new Map<string, ChatModel[]>()'
s=s.replace(needle,'  const navigate = useNavigate()\n'+needle)
s=s.replace('No model is set up. Add a provider key or sign in from Settings (coming later).', 'No model is set up. Connect a provider to start chatting.')
needle='''        {!models.length && (
          <p className="max-w-64 px-2 py-1.5 text-12 text-[var(--text-tertiary)]">
            No model is set up. Connect a provider to start chatting.
          </p>
        )}'''
assert needle in s
s=s.replace(needle,needle+'''\n        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>Manage models…</DropdownMenuItem>''')
p.write_text(s)

p=ui/'pages/chat/NewChatPage.tsx';s=p.read_text()
s=s.replace('setModel((current) => current ?? snapshot.selected)', '''setModel((current) => {
          const ready = snapshot.models.filter((m) => snapshot.providers.some((p) => p.id === m.provider && p.hasKey))
          const valid = (choice: ModelChoice | null) => choice && ready.some((m) => m.provider === choice.provider && m.id === choice.modelId)
          return valid(current) ? current : valid(snapshot.selected) ? snapshot.selected : ready[0] ? { provider: ready[0].provider, modelId: ready[0].id, thinkingLevel: 'off' } : null
        })''')
s=s.replace('() => setCatalogModels({ models: [], selected: null, providers: [] }),', '''(cause: Error) => { setError(`Could not load Pi models: ${cause.message}`); setCatalogModels({ models: [], selected: null, providers: [] }) },''')
needle='''        <Composer
          value={text}'''
assert needle in s
s=s.replace(needle,'''        {catalogModels && !models.length && <div className="mb-4 flex items-center justify-between gap-3 rounded-xs border border-[var(--border-default)] px-4 py-3 text-13">
          <div><p className="font-medium">Connect a model to start</p><p className="mt-1 text-12 text-[var(--text-secondary)]">Sign in to a provider or add an API key. Pi will run your chat and tools.</p></div>
          <button type="button" onClick={() => navigate('/settings')} className="shrink-0 rounded-full bg-primary px-3 py-2 text-primary-foreground">Connect model</button>
        </div>}
        <Composer
          value={text}''')
needle='<p className="mt-2.5 px-1 text-12 text-[var(--text-tertiary)]">{where}</p>'
s=s.replace(needle,needle+'''\n        {model && <p className="mt-1 px-1 text-12 text-[var(--text-tertiary)]">Pi agent · {model.provider} / {model.modelId}</p>}''')
p.write_text(s)

p=ui/'pages/chat/ChatHeader.tsx';s=p.read_text()
needle='''      {scenario && ('''
s=s.replace(needle,'''      {chat?.modelId && !scenario && <span className="ml-auto min-w-0 truncate text-12 text-[var(--text-tertiary)]" title={`${chat.provider}/${chat.modelId}`}>Pi · {chat.modelId}</span>}
      {scenario && (''')
p.write_text(s)

# Document the desktop surface beside the original app's settings spec.
p=root/'docs/ui/settings.md';s=p.read_text()
s+='''

## Desktop Models page

Source: desktop/src/renderer/src/pages/settings/ModelsPage.tsx
Opens from: Models in the sidebar, the Settings gear, or Manage models in the composer.

```text
+-[1] Models ---------------------------------------------------------------+
| Connect a model                                               [Reload]    |
| Pi powers your chats, bash tools and subagents.                            |
| [2] Pi agent runtime connected                                            |
|     Default model: <provider> / <model>, or no default model yet            |
| [3] Provider [v provider / Custom provider]                                |
|     [Provider ID________] (custom provider only)                           |
| [4] [Sign in with provider] / native OAuth steps / [Cancel sign-in]         |
| [5] Model ID [____________________________v]                              |
|     API key [****************************]                                |
| [6] > Endpoint and protocol (expanded for a custom provider)               |
|       Base URL [_________________________]                                |
|       API protocol [v____________________]                                |
| [7] [Save model] [Save & test connection] [Start a chat ->]                 |
| [8] Saved / model test reply / error                                      |
+--------------------------------------------------------------------------+
```

| Region | Behavior |
|---|---|
| [2] | Loaded through the desktop bridge from Pi's model runtime |
| [3-6] | Existing provider catalog, API keys, custom endpoints and Pi OAuth |
| [7] | Save selects the host default; test makes a real short model request |
| [8] | Failed requests remain on the form; saved API keys are never returned |

New chat shows Connect model when no authenticated model is available. The
composer's model menu always includes Manage models. New chat reloads the host
selection after setup; live chat headers identify Pi and the actual model.
'''
p.write_text(s)

p=root/'desktop/PACKAGING.md';s=p.read_text()
s=s.replace("The new desktop's Settings page is still a placeholder; packaging does not add\na model configuration interface.", "Open Models in the sidebar to sign in, save an API key or custom endpoint,\nchoose a model, and test the connection. Start a chat uses that saved selection.")
p.write_text(s)
print('Wired desktop Models page, native sign-in, model picker and setup entry points.')

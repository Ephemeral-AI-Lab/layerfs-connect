from pathlib import Path
root=Path('/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect')
ui=root/'desktop/src/renderer/src'
p=ui/'components/shell/Sidebar.tsx';s=p.read_text()
s=s.replace('import { CircleHelp,', 'import { ArrowLeft, Cpu, CircleHelp,')
s=s.replace("import { NavLink, useNavigate } from 'react-router-dom'", "import { useEffect, useRef } from 'react'\nimport { NavLink, useLocation, useNavigate } from 'react-router-dom'")
needle='''  return (
    <aside'''
assert needle in s
s=s.replace(needle,'''  const location = useLocation()
  const navigate = useNavigate()
  const settings = location.pathname === '/settings' || location.pathname.startsWith('/settings/')
  const previous = useRef('/')
  useEffect(() => {
    if (!settings) previous.current = location.pathname + location.search + location.hash
  }, [location, settings])
  function toggleSettings() {
    navigate(settings ? previous.current : '/settings/models')
  }
  return (
    <aside aria-label={settings ? 'Settings sidebar' : 'Workspace sidebar'}''',1)
start=s.index('        <div className="shrink-0 px-3 pb-2 pt-1">')
end=s.index('        <UserCard />',start)+len('        <UserCard />')
s=s[:start]+'''        {settings ? <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-3 pb-5 pt-1">
            <button type="button" onClick={toggleSettings} className={cn(ROW, 'text-[var(--text-secondary)]')}>
              <ArrowLeft size={15} strokeWidth={1.8} /><span>Back to workspace</span>
            </button>
          </div>
          <h2 className="px-6 pb-3 text-12 font-medium text-[var(--text-tertiary)]">Settings</h2>
          <nav aria-label="Settings" className="space-y-0.5 px-3">
            <NavRow to="/settings" icon={Cpu} label="Models" />
          </nav>
        </div> : <>
          <div className="shrink-0 px-3 pb-2 pt-1"><NewChatButton /></div>
          <nav aria-label="Pages" className="flex shrink-0 flex-col gap-0.5 px-3">
            <NavRow to={EXAMPLE_CHAT_PATH} icon={FlaskConical} label="Example chat" />
            <NavRow to="/machines" icon={Server} label="Machines" />
            <NavRow to="/storage" icon={Database} label="Storage" />
          </nav>
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 pb-4"><ChatList /></div>
        </>}
        <UserCard settings={settings} onToggleSettings={toggleSettings} />'''+s[end:]
s=s.replace('function UserCard() {\n  const navigate = useNavigate()', 'function UserCard({ settings, onToggleSettings }: { settings: boolean; onToggleSettings: () => void }) {')
s=s.replace('<Tip label="Settings" side="top">', '<Tip label={settings ? \'Back to workspace\' : \'Settings\'} side="top">')
s=s.replace('aria-label="Settings" className={cn(round, \'mr-1\')} onClick={() => navigate(\'/settings\')}', 'aria-label="Settings" aria-pressed={settings} className={cn(round, \'mr-1\', settings && \'bg-sidebar-item-active text-[var(--text-primary)]\')} onClick={onToggleSettings}')
p.write_text(s)
p=ui/'router.tsx';s=p.read_text().replace("{ path: 'settings', element: <ModelsPage /> },", "{ path: 'settings', element: <ModelsPage /> },\n      { path: 'settings/models', element: <ModelsPage /> },")
p.write_text(s)

p=ui/'pages/settings/ModelsPage.tsx';s=p.read_text().replace("localStorage.removeItem('lfs.chat.model')", "try { localStorage.removeItem('lfs.chat.model') } catch { /* restricted browser storage */ }")
p.write_text(s)
p=ui/'pages/settings/ProviderSignIn.tsx';s=p.read_text()
s=s.replace("        setLogin(next)\n        if (next.state === 'done') { const snapshot = await chatHost.models(); if (!stopped) onSignedIn(snapshot) }", "        if (next.state === 'done') {\n          const snapshot = await chatHost.models()\n          if (stopped) return\n          onSignedIn(snapshot)\n        }\n        setLogin(next)")
s=s.replace('<input aria-label="Sign-in response"', '<input type={prompt.type === \'secret\' ? \'password\' : \'text\'} autoComplete="off" aria-label="Sign-in response"')
p.write_text(s)
p=ui/'layerfs/agent-api.ts';s=p.read_text().replace("type: 'select' | 'input' | 'confirm'", "type: 'select' | 'manual_code' | 'text' | 'secret'")
p.write_text(s)

# Keep unsent text when the user switches to settings and back.
p=ui/'layerfs/chat-drafts.ts'
p.write_text('''/** Per-window message drafts survive a visit to Settings. */
export function readDraft(id: string) {
  try { return sessionStorage.getItem(`lfs.message.${id}`) ?? '' } catch { return '' }
}
export function saveDraft(id: string, text: string) {
  try {
    if (text) sessionStorage.setItem(`lfs.message.${id}`, text)
    else sessionStorage.removeItem(`lfs.message.${id}`)
  } catch { /* restricted browser storage */ }
}
''')
for file,id in [('pages/chat/NewChatPage.tsx',"'new'"),('pages/chat/conversation/ConversationTab.tsx','chat.id')]:
    p=ui/file;s=p.read_text()
    s="import { readDraft, saveDraft } from '@/layerfs/chat-drafts'\n"+s
    s=s.replace("const [text, setText] = useState('')", f"const [text, setText] = useState(() => readDraft({id}))\n  useEffect(() => saveDraft({id}, text), ["+('text' if id=="\'new\'" else 'chat.id, text')+"])")
    p.write_text(s)

p=root/'docs/ui/shell.md';s=p.read_text()+'''

## Desktop secondary settings sidebar

Source: desktop/src/renderer/src/components/shell/Sidebar.tsx

```text
+-Workspace sidebar----------+     +-Settings sidebar-----------+
| Window controls            |     | Window controls             |
| New chat                   |     | [<- Back to workspace]       |
| Example chat               |     | Settings                    |
| Machines                   |     | ( Models )                  |
| Storage                    |     |                             |
| Chats                      |     |                             |
| ...                        |     |                             |
|                            |     |                             |
| User             [Settings]| <-> | User             [Settings] |
+----------------------------+     +-----------------------------+
                                   Main pane: model connection
```

The bottom Settings button toggles the sidebar mode. Settings opens Models;
the same button or Back to workspace restores the previous workspace route.
Model setup is available only in the secondary navigation. Browser Back and
Forward keep the sidebar aligned with the route. Both sidebars share their
width, window controls and footer. Unsent chat text survives the switch.
'''
p.write_text(s)
p=root/'docs/ui/settings.md';s=p.read_text().replace('Opens from: Models in the sidebar, the Settings gear, or Manage models in the composer.', 'Opens from: the bottom Settings toggle, Models in the secondary sidebar, or Manage models in the composer.')
p.write_text(s)
p=root/'desktop/PACKAGING.md';s=p.read_text().replace('Open Models in the sidebar', 'Use the bottom Settings toggle, then Models in the secondary sidebar')
p.write_text(s)
print('Added secondary Settings sidebar, Models entry and preserved message drafts.')

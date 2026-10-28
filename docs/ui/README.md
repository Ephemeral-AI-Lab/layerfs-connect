# LayerFS Connect UI

How the desktop app's screens are laid out. One window: the sidebar on the
left, and on the right the screen it picks. Each screen has its own file here,
with an ASCII skeleton and the components that draw it.
Source: `src/renderer/src/App.tsx` (the shell), `src/renderer/src/components/`.

## The window

```text
+-[1] Sidebar ---------------------+-[2] Screen --------------------------------------------------+
| (o) LayerFS Connect              | Page header: title, facts                [ action ] [ ...  ] |
|     Demo replays on real LayerFS |  Tab   Tab   Tab                                    Tab N    |
|                                  |  ===                                                         |
| > LayerFS                    2   |                                                              |
| > Models   ChatGPT - gpt-6.1-sol | +----------------------------------------------------------+ |
|                                  | |                                                          | |
| [ + New session            v ]   | |  The tab's content                                       | |
|                                  | |                                                          | |
| SESSIONS                  All v  | |                                                          | |
| v playground                 28  | |                                                          | |
|     * /crew_2   REPLAY  3 h ago  | |                                                          | |
|     * /depot_2  REPLAY  3 h ago  | +----------------------------------------------------------+ |
|     Show all 28                  | [3] Composer (a session only)                                |
+----------------------------------+--------------------------------------------------------------+
```

1. **Sidebar** (`AppSidebar`, `app-sidebar.tsx`): navigation and every
   session. See [sidebar.md](sidebar.md).
2. **Screen** (`App`, `App.tsx`): the LayerFS page, a project page or a
   session page. A change of screen cross-fades.
3. **Composer** (`Composer`, `runs/composer.tsx`): under a session's
   conversation only.

## The screens (15 files)

| Group | Screen | File |
|---|---|---|
| Shell | Sidebar | [sidebar.md](sidebar.md) |
| LayerFS page | Projects | [layerfs-projects.md](layerfs-projects.md) |
| | Storage | [layerfs-storage.md](layerfs-storage.md) |
| | Compute | [layerfs-compute.md](layerfs-compute.md) |
| Project page | Live | [project-live.md](project-live.md) |
| | Timeline | [project-timeline.md](project-timeline.md) |
| | History (and Files) | [project-history.md](project-history.md) |
| | Storage | [project-storage.md](project-storage.md) |
| | Sandboxes | [project-sandboxes.md](project-sandboxes.md) |
| | Sessions (and Script) | [project-sessions.md](project-sessions.md) |
| Session page | Conversation (and Composer) | [session-conversation.md](session-conversation.md) |
| | Trace | [session-trace.md](session-trace.md) |
| Dialogs | Models | [dialog-models.md](dialog-models.md) |
| | New project | [dialog-new-project.md](dialog-new-project.md) |

## How the screens connect

```text
Sidebar
 |- LayerFS ---------> LayerFS page:  Projects | Storage | Compute
 |                        |
 |                        '- a project card -----> Project page
 |- Models ----------> Models dialog
 |- New session -----> a project's draft session, or the New project dialog
 '- a session row ---> Session page (inside its project)

Project page:  Live | Timeline | History | Storage | Sandboxes          Sessions N
                                    ^                                       |
                                    |                                       '- a row -> Session page
Session page:  Conversation | Trace |
                              '- an auto-checkpoint link --> History, on that Commit
```

## Shared pieces

- **Page frame:** `PageHeader`, `Tab` / `TabBar` with a sliding underline,
  and `Segmented` switches (`components/motion/`).
- **States:** `Loading`, `Empty` and `LoadError` (`components/projects/states.tsx`).
- **Controls:** shadcn components (`components/ui/`): button, dialog,
  dropdown-menu, select, sheet, table, tooltip.
- **Icons:** LayerFS icons (`components/lfs-icons.tsx`, SVGs in `assets/icons/`).
- **Theme:** colours, radii and motion are tokens in `src/renderer/src/styles.css`,
  with light and dark modes.

## Dev aids

Open a screen directly with `CONNECT_VIEW`:

- `projects`
- `projects/<project>[/<tab>]`
- `runs/<session id>[/<agent>]`
- `storage`
- `compute`

Save a screenshot with `CONNECT_SHOT=<file.png>`. See the main
[README](../../README.md#develop).

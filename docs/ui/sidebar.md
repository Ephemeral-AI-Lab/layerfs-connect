# Sidebar

The app's left column: the LayerFS page, the Models dialog, New session, and every session listed
under its project. Opens from: always shown, on the left of the window.
Source: `src/renderer/src/components/app-sidebar.tsx` (every region is in this file).

## Skeleton

```text
+-[1] Brand ---------------------+
| (o) LayerFS Connect            |
|     Demo replays on real       |
|     LayerFS                    |
+--------------------------------+
+-[2] LayerFS -------------------+
| LayerFS                      2 |
+--------------------------------+
+-[3] Models --------------------+
| Models   ChatGPT - gpt-6.1-... |
+--------------------------------+
+-[4] NewSession ----------------+
| [ + New session            v ] |
+--------------------------------+
+-[5] FilterMenu ----------------+
| SESSIONS                 All v |   When the host is unreachable,
+--------------------------------+   it replaces 6 and 7:
+-[6] ProjectGroup --------------+   +-[8] HostNotice ----------------+
| v heavy-check               26 |   | ! Host unreachable             |
| +-[7] SessionRow ------------+ |   | fetch failed: connect          |
| | * /crew_2   REPLAY 2 h ago | |   | ECONNREFUSED 127.0.0.1:...     |
| | * /depot_2  REPLAY 2 h ago | |   | [ Retry ]                      |
| | * /check... REPLAY 2 h ago | |   +--------------------------------+
| | * /teams... REPLAY 2 h ago | |
| | ...                        | |
| +----------------------------+ |
|   Show all 26                  |
| v playground                28 |
|   * /check... REPLAY 3 h ago   |
|   ...                          |
|   Show all 28                  |
+--------------------------------+
```

## Regions

1. **Brand** (`AppSidebar`, `app-sidebar.tsx`): the Connect mark, "LayerFS Connect" and "Demo replays on real LayerFS". It is not a link.
2. **LayerFS** (`AppSidebar` nav, `app-sidebar.tsx`): opens the LayerFS page (Projects, Storage and Compute are its tabs). The pill counts the projects in Connect's home; the active row has a lit bar on its left.
3. **Models** (`AppSidebar`, `app-sidebar.tsx`): opens the Models dialog (`ModelsDialog`, see [dialog-models.md](dialog-models.md)) instead of a page. On the right it shows the default model (provider and model, truncated). It shows a warning dot with "Set up" when there is no default yet, or "No key" when the default's provider has no key.
4. **New session** (`NewSession`, `app-sidebar.tsx`): a dropdown, "Start a session on", that lists every project, then a separator and "New project...". A project opens a draft conversation on it. "New project..." opens the New project dialog ([dialog-new-project.md](dialog-new-project.md)). The button is disabled while the demos load or the host is unreachable.
5. **Sessions header** (`FilterMenu`, `app-sidebar.tsx`): "SESSIONS" and a filter menu with "All sessions" and "Running", each with its count. The trigger reads "All" or "Running".
6. **Project folders** (`ProjectGroup`, `app-sidebar.tsx`): one per project, the one with the newest session first. The header opens the project's page and the chevron folds it. A project in a shared Store (layerfs#506) is titled `name · store`. The session count sits on the right, and a + replaces it on hover to start a session on the project. The first three projects start open, plus the selected or playing one. A folder lists 5 sessions, then "Show all N" (or "Show fewer").
7. **Session rows** (`SessionRow`, `app-sidebar.tsx`): the state dot (`RunDot`), the session's name ("/folder - session", a session name, or "Session n"), a REPLAY tag for scenario replays, and its age. A row opens that session's page.
8. **Host notice** (`HostNotice`, `app-sidebar.tsx`): "Host unreachable" (or "Demos unavailable" when the host answered with an error), the error in at most 3 lines, and Retry. It shows in place of the project list.

## States

- **Loading**: six skeleton rows in place of the list.
- **Empty**: "No projects yet. New session -> New project... makes one."; with the Running filter, "No session is playing."
- **Running filter**: only playing sessions, and only projects that have one; every folder is open.
- **Live**: a playing session's row shows up to three pulsing dots, one per running agent in its colour, in place of the state dot. In place of the age it shows "working" (a live session), "waiting" (queued) or its progress as a percentage, and a thin progress line runs along its bottom. The project header shows "live" and a dot in place of its count. A live (non-replay) session has no REPLAY tag and is named "New session" until it has a title.

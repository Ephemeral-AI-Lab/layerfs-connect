# LayerFS: Projects

Every LayerFS project in Connect's home, one card each, with totals on top. Opens from: the sidebar's
LayerFS row (the Projects tab is the default), or the Projects tab on Storage or Compute.
Source: `src/renderer/src/components/projects/projects-home.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| LayerFS                                            [ New project ]  [ Search projects      ] |
| Projects in Connect's home. A session works with an agent on one; /scenario plays a scena... |
| +-[2] LayerFSTabs -------------------------------------------------------------------------+ |
| |  Projects   Storage   Compute                                                            | |
| |  ========                                                                                | |
| +------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------+
+-[3] StatsStrip ------------------------------------------------------------------------------+
| PROJECTS                  | SESSIONS            | PLAYING NOW         | COMMITS              |
| 2                         | 54                  | 0                   | 852                  |
| In Connect's LayerFS home | On these projects   | Nothing playing     | 344 MB of Store      |
+----------------------------------------------------------------------------------------------+
+-[4] ProjectCard -----------------------+  +----------------------------------------+
| /\ heavy-check                         |  | /\ playground                          |
|    heavy-check                         |  |    playground                          |
| Imported from /private/tmp/claude-501/ |  | An empty project.                      |
| -Users-yifanxu-Ephemeral-AI-Lab-lay... |  |                                        |
| +------------------------------------+ |  | +------------------------------------+ |
| | Local SQLite - 265 MB           ~~ | |  | | Local SQLite - 78.6 MB          ~~ | |
| | main L17 - 288 Branches - 670 C... | |  | | main L9 - 134 Branches - 182 Co... | |
| +------------------------------------+ |  | +------------------------------------+ |
| o W1b 146 W...  2 h ago  crew_2.work.5 |  | o edit /...  3 h ago  merge_2.featu... |
| -------------------------------------- |  | -------------------------------------- |
| 26 sessions - last 2 h ago             |  | 28 sessions - last 3 h ago             |
|                      [ + New session ] |  |                      [ + New session ] |
+----------------------------------------+  +----------------------------------------+
```

## Regions

1. **Page header** (`PageHeader` in `ProjectsHome`, `projects/projects-home.tsx`): the title "LayerFS", a one-line description, and on the right New project and the search box. New project opens the New project dialog ([dialog-new-project.md](dialog-new-project.md)), and a project made there opens as a new session. The search filters cards by name, title, blurb and tag; Esc clears it. The header sticks to the top on scroll.
2. **Tabs** (`LayerFSTabs`, `layerfs-tabs.tsx`): Projects, Storage and Compute, the LayerFS page's three parts, with a sliding underline. The same tab row heads [layerfs-storage.md](layerfs-storage.md) and [layerfs-compute.md](layerfs-compute.md).
3. **Stats strip** (`StatsStrip`, `projects/home/stats-strip.tsx`): Projects, Sessions, Playing now and Commits, each with a note. The numbers count up as the cards report them. Commits sums what each card read, and its note gives the Store bytes.
4. **Project cards** (`ProjectCard`, `projects/home/project-card.tsx`): a grid that fills the width (three columns at 1440). Each card shows:
   - The project's title, its mono name (and the scenario's agent count) and its blurb.
   - A project in a Store shared with other projects (layerfs#506) is titled `name · store`, since the same name may be in several Stores (a clone, a PostgreSQL import). Its page and reads name that Store.
   - The Store well: Local SQLite and its size, then main's Layer, the Branches and the Commits, with a small stack of Layers on the right.
   - The last Commit: its message, its age and its Branch.
   - The session count with the last one's age, and New session.

   The title opens the project page. New session opens a draft conversation on it.

## States

- **Loading**: six skeleton cards; the strip reads "Reading" and "Reading the projects".
- **Error**: `LoadError` ("the LayerFS projects") with Retry, in place of the strip and the grid.
- **Empty**: "No projects yet" with a New project button.
- **No match**: "No projects match" and "Nothing matches ...", with Clear search. While a search is typed, the box shows "1 of 2" and an x.
- **Playing**: the header gets a "N playing" chip, and the strip's Playing now lights up with "N agents running". The card gets a lit border, a "<session> playing" chip, the phase and "done/of steps" with a progress bar, and "N sessions - one playing since ...". Its New session is disabled.
- **Card without a Store**: "not created yet" and "The first session Inits it from the fixture" (a 404); "Reading the project" while it loads.

# Project: Live (top of Sessions)

The project's working sessions as one live diagram: agents on the left, the LayerFS project in the middle, Sandboxes and their Workspaces on the right, and every LayerFS call drawn as it travels. Sessions are scenario runs; several can play on one project at once, each in a folder of its own. Opens from: the top of a project page's Sessions tab, while a run plays or ended in the last 5 minutes (Sessions is the default tab once the project has runs).
Source: `src/renderer/src/components/runs/live-tab.tsx` (main file; others named in Regions). Look: the app's liquid glass without its backdrop blur (`glass-liquid` with a solid fill inside `.live-panel`, since lanes move behind the cards every frame; `rounded-2xl` cards, `rounded-xl` controls, the `--cursor-hue` spotlight), restrained motion; every string goes through `t()` (Chinese in `i18n/live.ts`).

## Skeleton

```text
+-[1] Tab row -------------------------------------------------------------------------------------+
| History   Storage   Sandboxes   |   Sessions 13                                                     |
|                                     ========                                                     |
+--------------------------------------------------------------------------------------------------+
+-[2] Live card -----------------------------------------------------------------------------------+
| * Live   2 runs playing · 1 ended recently · 3 calls in flight                                   |
|--------------------------------------------------------------------------------------------------|
| [3] AGENTS 5 ----------------------                            SANDBOXES 4 --------------------- |
| +-[4] SessionGroup ---------------+                            +-[7] SandboxNode --------------+ |
| | v * /crew_2  3 agents - 2 work  |   +-[6] HubNode -------+   | [S] Sandbox 1  crew_2-sbx      | |
| |           [====  ] 12/40  [->]  |   |      (/\)          |   |     made by builder · /crew_2  | |
| | +-[5] AgentNode --------------+ |   |    playground      |   |                     1 mounted  | |
| | | [c] crew               2 > *| |- -|  LayerFS project   |- -|-------------------------------| |
| | |     ~ branch.fork main 0.4s | |   | [db] store-a  Local| - | W /work [crew_2.build] * build | |
| | +-----------------------------+ |   | +-----+-----+----+ |   |   ~ (exec) npm test      1.2 s | |
| |   +- AgentNode ---------------+ |---| |main |Brs  |Cmts| |   +-------------------------------+ |
| |   | [b] builder             * | |   | | L9  | 134 | 183| |   +-[8] SandboxLine --------------+ |
| |   |     ~ workspace.exec 1.2 s| |   | +-----+-----+----+ |   | Sandbox 2  /tour_1 1 Workspace| |
| |   +---------------------------+ |   | b main           0 |   +-------------------------------+ |
| +---------------------------------+   | * /crew_2          |                                     |
| +- SessionGroup (folded) ---------+   | b main           2 |                                     |
| | > * /tour_1  tour      ended    |   | b lead           4 |                                     |
| |     1 agent · 0 working  [t]    |   | +12 other open Branches                                  |
| +---------------------------------+   +--------------------+                                     |
+--------------------------------------------------------------------------------------------------+
```

## Regions

1. **Tab row** (`ProjectView`, `projects/project-view.tsx`): Sessions opens by default when the project has runs; the Live card sits above its session list. The project page reads this project's runs (`useRuns`) and hands them to Live, newest first.
2. **Live card** (`LiveTab`, `runs/live-tab.tsx`): one `glass-liquid` card. Its header has a dot (pulsing while a run plays), "Live", then "2 runs playing · 1 ended recently · 3 calls in flight".
3. **ZoneLabel** (`ZoneLabel`, `runs/live-nodes.tsx`): the "Agents" and "Sandboxes" headings, with a count once there is something to count.
4. **SessionGroup** (`SessionGroup`, `runs/live-nodes.tsx`): one group per run shown, labelled by the run's folder (`/crew_2`, its scenario on hover). Open, its header shows a chevron, the run's state dot, the folder, "3 agents · 2 working", progress (a bar and "12/40", "waiting its turn" while queued, "ended" or "stopped" once over) and an open button (↗) that opens the run. Folded, it is one card: the folder, the scenario, progress, "2 agents · 1 working" and small avatars, the busy ones lit. Past three runs a folded one is a single line.
5. **AgentNode** (`AgentNode`, `runs/live-nodes.tsx`): one card per active agent, indented by depth, with an accent bar in its colour (full while it works) and a still ring in that colour while busy. It shows avatar, name and state dot. Under them is the call in flight (spinner, method, target, time); with none, its activity, or its last call ("fs.write · 3 min ago", red with its code when it failed). A parent has a fold toggle ("2 >"); folded, it shows its subagents' avatars and "2 subagents · 1 working". A click opens the agent in its run (`onOpenRun(run, agent)`).
6. **HubNode** (`HubNode`, `runs/live-nodes.tsx`): the project. It shows the LayerFS mark (it rings in the caller's colour as calls land), the project's name and "LayerFS project". Then its Store as `StoreLine` (`projects/store-facts.tsx`: `StoreIcon`, name, where it syncs, size, `SyncPill`), from the shared Storage view. Then main's Layer ("L9"), the Branch count and the Commit count. Last come the open Branches: main first, then each run's under its folder (named inside the run: `main`, `main.1`, `lead`; a run's trunk `<folder>.main(.k)` is marked as standing for main), with Commit counts, then "+N other open Branches" for Branches of no run shown. Calls pass through these rows. A soft light in the cursor hue sits behind the card. Its border is lit while a run plays.
7. **SandboxNode** (`SandboxNode`, `runs/live-nodes.tsx`): an open Sandbox. It shows "Sandbox 1", its name, "made by builder · /crew_2" and "1 mounted". Each Workspace row has its path, its Branch (the run folder dimmed: `crew_2.`build) and the mounting agent. Under them is the running `workspace exec` (an `exec` chip, the command, its time), else "idle · last <command> <exit>" or "idle · mounted 3 min ago", plus "· N Commits". It reads "Nothing mounted. The next call mounts a new Workspace." when empty.
8. **SandboxLine** (`SandboxLine`, `runs/live-nodes.tsx`): past four Sandboxes, one not running a command is one line: "Sandbox 2", its run or state, "1 Workspace". A click opens its card.

## The diagram (`FlowEngine`, `runs/live-flow.ts`; `runs/live.css`)

One SVG over the cards, on its own layer, positioned from their `data-anchor`s: reread at most every 100 ms while anything moves, and at once after a change. A frame writes only what changed, and dots travel their lane's own path. A call sends a dot from its agent (or the folded card standing in for it), in the agent's colour, along a curved lane. The lane passes through the Branch row the call touched and on to the Workspace or Sandbox for workspace and sandbox calls. The dot comes back green, or red when the call failed. A lane carrying calls is dashed in the agent's colour and flows. A mounted Workspace keeps a thin solid lane at rest. Tree guides join subagents to their parent. Faint dotted lines join the idle placeholders to the project. Under reduced motion nothing travels; lanes still light and cards still ring.

## Data (`runs/live-data.ts`, `runs/live-model.ts`)

- **Runs shown**: those playing or queued, and those that ended in the last 5 minutes, at most 12, playing ones first. Each is read once with `host.run(id)` (not again when the list changes) and kept current from the host's events (`run`, `agent`, `step`, `call`, `live`), applied once per frame. Live keeps only the summary, the calls and `RunDetail.live`.
- **Project**: `host.project(key)`, reread every 2 s while a run plays (not while the window is hidden) and once more when a run's state changes; reads of one address go one at a time.
- **Sandboxes**: the project's open ones, joined with those the runs made and the Workspaces their playing runs hold mounted.
- **Runs and Branches**: a run's files are under `/<folder>/` and its Branches are `<folder>.<name>`.

## States

- **Idle** (no run shown): `IdleAgents` shows "No agent working", "The last run, /tour_1, ended 3 h ago" (or "No run has played on this project yet"), a dashed sketch of a tree and "A scenario run starts a session. Its agents show here as a tree, and every call they make travels to the project." `IdleSandboxes` shows "No Sandbox open" and "One opens when an agent creates it to mount a Workspace." Faint lines join both to the project; the zone counts are hidden.
- **Hub before the project is read**: a dashed box reading "Reading…".
- **Folds**: playing runs start open (the newest two), the others folded. Subagents from the third level start folded. What the user folds or opens is kept per project (`localStorage` `connect.live.folds:<project>`; runs by id, agents by scenario and name).
- **Many runs** (more than 3): a folded run is a single line.
- **Many Sandboxes** (more than 4): quiet ones become `SandboxLine`s. Past 10 lines "+N more" / "Show fewer" appear, and "Fold the Sandboxes I opened" after opening some.

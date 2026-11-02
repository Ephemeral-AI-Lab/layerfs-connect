# Project: Live

The project's working sessions as one live diagram: agents on the left, the LayerFS project in the middle, Sandboxes and their Workspaces on the right, and every LayerFS call drawn as it travels. It appears in the project's Live tab and includes running chats plus those that ended in the last 5 minutes. The first 12 sessions are shown, with an option to reveal the rest.
Source: `src/renderer/src/components/live/live-tab.tsx`. Nodes retain the shared glass edges with more opaque surfaces for legibility and efficient animation. Dark surfaces stay neutral black and gray; agent and brand colors are preserved. Only call traffic moves: no perpetual avatar rotation or breathing glow. Hovering or keyboard-focusing a node emphasizes its routes and dims unrelated routes. Every string goes through `t()` (Chinese in `i18n/live.ts`).

## Skeleton

```text
Live · 2 chats working · 3 calls in flight

Agents 5                     LayerFS                      Sandboxes 2
┌ Session ───────────┐       ┌ Project ────────────┐       ┌ Sandbox ─────────────┐
│ root               │       │ Mark · name         │       │ name · creator       │
│ ├ builder          │──────▶│ SQLite · size       │──────▶│ workspace · branch   │
│ └ reviewer         │       │ layer / branches /  │       │ command · elapsed    │
│ call · elapsed     │       │ commits             │       └──────────────────────┘
└────────────────────┘       │ main                │       ┌ Quiet sandbox ──────┐
                             │ session branches    │       └──────────────────────┘
                             └─────────────────────┘
```

## Regions

1. **Tab row** (`ProjectView`, `projects/project-view.tsx`): Live has its own tab, alongside Sessions, Files, Storage, Sandboxes and History. The project page passes its working chat runs to Live.
2. **Live card** (`LiveTab`, `live/live-tab.tsx`): one `glass-liquid` card. Its header has a steady state dot, "Live", and a short summary of working chats, recently ended chats and calls in flight.
3. **ZoneLabel** (`ZoneLabel`, `live/live-nodes.tsx`): three top-aligned headings, "Agents", "LayerFS" and "Sandboxes". Agent and Sandbox counts appear when nonzero. No decorative divider lines.
4. **SessionGroup** (`SessionGroup`, `live/live-nodes.tsx`): one group per chat or scenario, labelled by its title or folder. Its header has a fold toggle, state and open button. Progress appears only when the run has a known step total; ended, failed and stopped states remain distinct. Folded groups show a compact agent summary. Past three runs a folded group is a single line. Only actual scenario folders receive a slash prefix and monospace type.
5. **AgentNode** (`AgentNode`, `live/live-nodes.tsx`): one row per agent, indented by depth. A steady ring and short Calling label reflect actual in-flight calls; agents between calls show the most recent result instead of an inferred Working state. Known API methods use short translated action names, with exact methods and full targets on hover. A check or cross identifies success or failure without relying on color. Failed results persist until new work replaces them. The parent fold toggle shows the child count; folded summaries count agents with actual calls. Clicking an agent opens its chat.
6. **HubNode** (`HubNode`, `live/live-nodes.tsx`): a compact project card. A small LayerFS mark sits beside its name and storage type / size, followed by static main Layer, Branch and Commit counts. Open Branches show main first, then session groups with Commit counts, then a count of other open Branches. Shared Branches appear once. Calls pass through their branch row; short feedback replaces the former large glow and breathing border. The branch list scrolls independently when long.
7. **SandboxNode** (`SandboxNode`, `live/live-nodes.tsx`): an open Sandbox. It shows "Sandbox 1", its name, "made by builder · /crew_2" and "1 mounted". Each Workspace row has its path, its Branch (the run folder dimmed: `crew_2.`build) and the mounting agent. Under them is the running `workspace exec` (an `exec` chip, the command, its time), else "idle · last <command> <exit>" or "idle · mounted 3 min ago", plus "· N Commits". It reads "No mounted workspaces" when empty.
8. **SandboxLine** (`SandboxLine`, `live/live-nodes.tsx`): past four Sandboxes, one not running a command is one line: "Sandbox 2", its run or state, "1 Workspace". A click opens its card.

## The diagram (`FlowEngine`, `live/live-flow.ts`; `live/live.css`)

One SVG above the cards, positioned from `data-anchor`s. Lines stay thin and still; running calls retain a brighter route without a perpetual animation. Each new call sends a single small chevron in the agent's color. Results return along the same route with the arrow reversed, green for success and red for failure. Concurrent calls on one route share a packet; opposite directions wait rather than collide. Only the completed call's destination receives a brief border response. A small header legend explains request / success / failure.

Mounted routes remain faintly visible. Hover or keyboard focus highlights the selected node's connections and dims unrelated ones. Folding redirects routes to the visible ancestor. When nothing moves the engine stops scheduling frames. Reduced motion preserves status labels and still connections without traveling arrows or feedback flashes. All SVG layers and listeners are removed when the graph closes.

Routes use rounded elbows in the gaps between columns. They dock at the project's outside edge at the matching Branch row's height; no line runs across card text. Each gutter has one stable shared rail; new calls do not spread the wiring into a fan. Shared agent/Branch and Branch/Workspace legs are drawn once, including routes folded to the same visible ancestor. Resting links use neutral thin strokes; active or focused links retain agent colors and paint above quiet shared rails. Decorative endpoint dots are removed. Agent tree guides share a single trunk per parent. Narrow views keep at least 56px between columns and scroll horizontally instead of squeezing the wiring into cards.

## Data (`live/live-data.ts`, `live/live-model.ts`)

- **Runs shown**: those playing or queued, and those that ended in the last 5 minutes, the first 12 initially, playing ones first; more are available on demand. Each chat's live trace is read with `agentHost.live(id)` initially and every second while it works and the window is visible. Live keeps the run summary, trace calls and live mounts / sandboxes.
- **Project**: `host.project(key)`, reread every 2 s while a run plays (not while the window is hidden) and once more when a run's state changes; reads of one address go one at a time.
- **Sandboxes**: the project's open ones, joined with those the runs made and the Workspaces their playing runs hold mounted.
- **Runs and Branches**: scenario folders retain prefix-based ownership (`<folder>.<name>`). Ordinary chats associate Branches from actual mounts and in-flight or recorded calls. Shared Branches have one anchor, reused by every calling session.

## States

- **Idle** (no run shown): short Agent and Sandbox placeholders remain connected to the project. Agent status may include the last chat's end time. No fake loading skeletons or explanatory paragraphs are shown.
- **Hub before the project is read**: a dashed box reading "Reading…".
- **Folds**: playing runs start open (the newest two), the others folded. Subagents from the third level start folded. What the user folds or opens is kept per project (`localStorage` `connect.live.folds:<project>`; runs by id, agents by scenario and name).
- **Many runs** (more than 3): a folded run is a single line.
- **Many Sandboxes** (more than 4): quiet ones become `SandboxLine`s. Past 10 lines "+N more" / "Show fewer" appear, and "Fold the Sandboxes I opened" after opening some.

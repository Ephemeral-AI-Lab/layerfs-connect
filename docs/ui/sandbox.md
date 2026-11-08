# Sandbox

Source: `desktop/src/renderer/src/pages/chat/SandboxesTab.tsx`, `components/sandbox/SandboxMap.tsx`,
`components/sandbox/sandbox-map.css` and `layerfs/simulation/sandbox-scenarios.ts`. Opens from the chat's **Sandbox** tab (`/sandboxes`), including
child routes and the subagent side panel. Simulation only; no LayerFS calls.

## Project-wide flow

```text
+-[1] Header ------------------------------------------------------------------+
| Sandbox (Simulation)          [Parallel agents v] [Pause] [Replay]             |
| ui-example/search - Project-wide activity                                     |
| 2 main agents - 3 subagents - 2 sandboxes   [ ] This chat [ ] Recent resources |
+------------------------------------------------------------------------------+
| [2] Agents                 [3] LayerFS               [4] Sandboxes             |
| +----------------------+   +--------------------+   +-----------------------+ |
| | v Add project search |   | search             |   | dev - Docker          | |
| |   Main - Thinking    |-->| Project history    |   | Running - 2/16 mounts | |
| |   Reviewer - Exec    |-->| main - Published   |   | search -> search      | |
| +----------------------+   | search - 2 commits |-->| review -> search      | |
| +----------------------+   | search-tests       |   | npm test -- filter    | |
| | v Improve tests      |-->| 1 commit           |   +-----------------------+ |
| |   Main               |   +--------------------+   +-----------------------+ |
| |   Tester - Exec      |--------------------------->| checks - Docker       | |
| |   Explorer - Read    |   Request / Result / Error  | tests -> search-tests | |
| +----------------------+                            +-----------------------+ |
+-[5] Playback ----------------------------------------------------------------+
| Playing scenario              [-----------o----------------]     0:09 / 0:36 |
+-[6] Activity / selected node -------------------------------------------------+
| 0:07 workspace.exec  npm test -- coverage  Tester                          -> |
| 0:06 workspace.exec  npm test -- filter    Reviewer                        -> |
+------------------------------------------------------------------------------+
  Simulated SDK / CLI activity. No agents, commands, or resources are started.
```

| [n] | Component | Behavior |
| --- | --- | --- |
| 1 | Header / toolbar | Project scope; scenario, Play/Pause/Replay, agent and recent-resource filters |
| 2 | Agent groups | Main agents with collapsible subagents; task, activity, current call and elapsed time |
| 3 | Project hub | Published main, branch rows, commit counts; file reads route directly to branches |
| 4 | Sandbox groups | Project-bound sandbox on a machine; workspace rows bound to branches, users, command state |
| 5 | Playback | Seek pauses; finished playback stops; Replay starts over; hidden document pauses |
| 6 | Inspector | Node selection filters calls; call selection shows arguments and outcome; clear restores all |

Hover/focus isolates related paths. Selecting a workspace highlights all known users. Collapsed
subagents' paths attach to their main agent. SVG paths track element positions with ResizeObserver;
active calls send colored packets forward, results return in green, refusals in red. Quiet bindings
remain visible between calls. Activity records remain available after an animation finishes.

## States

- Parallel agents: two roots, three children, two sandboxes, three workspaces; create, mount, exec,
  commit, unmount, close. Dev has two independent workspaces on the same search branch.
- Shared workspace: main and reviewer share `dev:search`; both users appear in its inspector.
- Commit conflict: commit writes markers but publishes nothing; unmount refuses Dirty; close
  refuses MountsActive. The workspace and sandbox remain visible.
- Unmount refused: Busy leaves the mount usable; sandbox close refuses MountsActive.
- Empty project: no resources; playback disabled, scenario selection remains available.
- Unlinked chat: no-project empty state, no fabricated project or resources.

Output appears after exec completes. Exec never implicitly commits or unmounts. Commit leaves the
workspace mounted. Successful unmount removes the overlay; recent resources shows its historical
row. Closing removes the runtime, while branch history remains visible. SDK capacity is shown as
16 workspace slots per sandbox; sample counts are illustrative.

## Layout and accessibility

Three columns above 540px of available content; below that width sections stack and paths hide.
The inspector stays below the map. Controls have keyboard focus; folds use aria-expanded; sandbox
selection uses aria-pressed. Reduced motion starts paused and hides traveling packets. No live
region announces the changing timer. Main and child views share project scope; opening from the
example reviewer selects that agent. Other sample agents have no invented chat destinations.

## Verification

`PATH=<Node 24 bin>:$PATH node desktop/tools/smoke-sandbox.mjs` against the web preview.
Checks playback, selection, folding, scenario outcomes, history, child/side-panel routes,
unlinked state, reduced motion, console errors, absence of host mutations, desktop widths 1280 and 900, and component containment at 768, 414, 375 and 320.
Below the desktop shell minimum, the test constrains only the Sandbox view; it does not claim
mobile support for the surrounding desktop shell. Desktop screenshots are written to the system temp directory.

## Shared Sandbox detail

Source: `desktop/src/renderer/src/components/sandbox/` (`SandboxDetail.tsx`,
`CopyValue.tsx`, `types.ts`, `model.ts`, `detail.css`). Both entry points supply snapshots from neutral modules in
`layerfs/simulation/`. The shared component imports no conversation or host API.

Click a sandbox heading in the map to open detail. Map selection, folds, filters, scroll and
playback position remain in the parent; the detail's playback runs independently. Project activity
returns to the exact saved map position. This is embedded navigation, not a new application route.

```text
+-[7] Resource header ---------------------------------------------------------+
| < Project activity / dev                                  Simulation        |
| dev · Running                              Copy reference · Refresh          |
| Project ui-example/search ->                                                 |
+-[8] Parent machine ----------------------------------------------------------+
| docker ->  Running · platform / architecture                                |
+-[9] Detail navigation -------------------------------------------------------+
| [Overview]  Workspaces (2)                                                    |
+--------------------------------------+---------------------------------------+
| [10] Sandbox information             | [11] Workspaces                       |
| Project, backend, image, runtime ID  | Mounted count -> branches/mount detail |
| Filesystem route when reported      | Unavailable reason when read fails     |
+--------------------------------------+---------------------------------------+
| [12] Source controls, when supplied: Play/Pause · Replay · seek               |
+------------------------------------------------------------------------------+
```

| [n] | Component | Behavior |
| --- | --- | --- |
| 7 | Resource header | Contextual Back, project link, copy runtime reference, Refresh |
| 8 | Parent machine | Machine link and supplied state/platform/architecture |
| 9 | Detail tabs | Overview and Workspaces only; arrow/Home/End keyboard navigation |
| 10 | Resource facts | Reported metadata and observation marker; no invented uptime or daemon state |
| 11 | Workspace summary | Opens Workspaces; unknown read is not zero mounts |
| 12 | Source controls | Example-only playback remains supplied by the wrapper |

Scratch, Activity and Diagnostics top-level tabs have been removed. Overview has
no scratch shortcut, live-agent lanes, empty activity feed, daemon-log placeholder
or resource-utilization placeholder. Runtime route information is in Overview.
No Doctor action is shown until an actual report flow is integrated.

### Workspaces

The Workspace list and inline inspector retain Branch, handle, mount path,
reported activity, base/head and change summaries. Mount facts are combined into
**Details**. **Commands** appears only when executions are actually recorded;
example executions are labelled sample records. Missing linked users produce no
empty user panel or Used by column. Command rows expand inline.

```text
Workspace name                                             Copy handle
[Details] [Commands — only with recorded executions]
Handle · Branch · Mount path · Sandbox · Mounted · Route
Activity · Base · Head · Change summary
Linked users and lifecycle outcomes, only when recorded
```

Mutable Files and Changes patch subtabs are removed, including the sample runtime
file browser. Dirty-state summaries remain, but no mutable per-file patch or
scratch content is implied. Source adapters still own future richer CLI fields.

### Detail verification

Existing browser checks cover two-tab navigation, keyboard Home/End, Workspace
inspection, Refresh, standalone/embedded/side-panel entry points, map restoration
and unavailable resource reads. Removed scratch/diagnostics assertions are retired.
Verify desktop sizes 1280×820 and 900×600 using the web preview; no Electron launch.

## Shared detail entry points and ownership

```text
components/sandbox/
  SandboxDetail.tsx          Header, machine link, tabs and panel composition
  SandboxOverview.tsx        Reported resource metadata and Workspace summary
  SandboxWorkspaces.tsx      Workspace details and conditional command inspection
  SandboxActivityRows.tsx    Shared expandable result rows
  CopyValue.tsx
  types.ts                  View-data and navigation contracts
  model.ts                  Pure formatting and workspace-state helpers
  use-sandbox-detail.tsx     Local inspection state and derived data
  detail-context.ts          Context shared only by detail panels
  SandboxMap.tsx             Shared project-wide agent/branch/workspace map
  sandbox-map.css
  detail.css

layerfs/simulation/
  sandbox.ts                Neutral resource/file fixtures and example lookup
  sandbox-scenarios.ts      Scripted project activity
  machine-snapshot.ts       Adapter for simulated machine records
  use-sandbox-playback.ts   Simulation clock, pause, seek and replay
  SandboxDetailPreview.tsx  Supplies source controls and clock to shared detail
  ProjectSandboxPreview.tsx Supplies project-map playback and preserves return state

pages/chat/
  SandboxesTab.tsx          Resolves the conversation's project and source
  sandbox/                  Compatibility exports for the relocated shared map

pages/machines/
  SandboxDetailPage.tsx     Standalone resource route and machine breadcrumb
```

The shared detail imports neither conversation nor machine pages, and it owns no simulation
timer or data fetching. Entry wrappers supply the snapshot, time, observation, highlighted
conversation, source controls and navigation. Simulation fixtures accept explicit actor links;
they do not require a conversation object. The detail's back label is contextual.

```text
Conversation > Sandbox map                  Machines > native > Sandboxes
          |                                              |
          v                                              v
 Embedded SandboxDetail                    /machines/native/sandboxes/api-dev
 Back: Project activity                    Back: native
          |                                              |
          +---------------- shared detail ---------------+
```

Routes retain distinct machine and sandbox names: `/machines/:name` remains a machine page;
`/machines/:name/sandboxes/:sandbox` opens a sandbox. Sandbox names on machine cards are links.
The machine tab is encoded as `?view=stores|sandboxes|details`; opening detail records scroll
position, and Back restores the prior machine tab and scroll. Direct URLs fall back to their
parent machine's Sandboxes tab. Wrong-machine and missing-resource URLs show an explicit empty
state instead of choosing a different resource.

The conversation example's Open standalone link opens `/machines/docker/sandboxes/dev` (or
checks), using the same neutral example records. Machine-simulator records retain their actual
machine, project, branch and mount path. Missing scratch, command history, daemon logs, runtime
IDs and agent attribution stay unrecorded. Native filesystem routes are not relabelled as FUSE.
The new route reads only local selected fixtures or the preview's simulated host. Host-backed standalone routes use the same `HostSandboxDetail` as project navigation;
reads do not start machines or mutate resources.

Verification: `node desktop/tools/smoke-shared-sandbox.mjs` covers conversation-to-standalone
navigation, machine-card detail, shared tabs, actual recorded paths, missing data, wrong-machine
URLs, machine return context and desktop sizes. Existing map/detail/navigation scripts cover the
embedded and side-panel views after the refactor.

## Shared project map

The map lives in `components/sandbox/SandboxMap.tsx` and accepts resource view data.
`components/sandbox/ProjectSandboxes.tsx` reads real project resources for both chat and Storage.
Only Example chat uses `layerfs/simulation/ProjectSandboxPreview.tsx` for playback and sample details.
Real resource snapshots do not invent agents, command activity or successful workspace reads.

## Unified sandbox navigation

```text
Chat / Storage project -> shared SandboxMap -> SandboxDetail
                                                |
                 [Project activity] <-----------+
                 restores map selection and scroll

SandboxDetail: Overview | Workspaces
```

`components/sandbox/ProjectSandboxNavigation.tsx` owns this flow for both the chat example
and host-backed project views. The map stays mounted during inspection. Source adapters
supply data and playback; they do not implement separate navigation. Resource management
controls live inside host-backed details. Map headers retain New Sandbox and Refresh.
`HostSandboxDetail.tsx` reads the selected Sandbox and verifies its project/machine identity;
Refresh rereads that record. Unknown workspace reads and unreported files/activity stay
explicitly unavailable. Real observations do not carry simulation playback or labels.

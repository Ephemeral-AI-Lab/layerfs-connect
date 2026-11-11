# Agent–sandbox bindings — proposed design

Status: proposal for discussion; application behavior is unchanged.

## Observed gap

The child Sandboxes route passes `childId` to `SandboxesTab`, but the component
ignores it and renders `ProjectSandboxes`. Its resource adapter supplies empty
`actors`, `events`, `links` and workspace `users` arrays. The inspected saved
conversation consequently shows “0 main agents 0 subagents” despite having a
real main conversation and child history. Project resource membership alone does
not identify the actors using a Sandbox.

## Two relationships

1. **Task assignment:** the runtime assigns an actor to a reusable Sandbox for
   a task or related sequence of assignments. Several actors can share a Sandbox.
   Assignment does not reserve a mounted Workspace or claim exclusive ownership.
2. **Workspace use:** a confirmed mount creates a specific Workspace instance
   for a Branch. Track the actors actually using that instance and their calls.
   Successful unmount ends that instance's use; it does not erase task assignment
   or history. The next batch can mount another Workspace in the same Sandbox.

Default simulation execution remains automatic: children can share the parent's
project Sandbox with independent Workspaces. Creating a Sandbox identifies its
creator, not every actor assigned to it. A task can explicitly select a different
Sandbox. General SDK/CLI activity can report observed use even without a prior
runtime assignment; label this as observed use rather than an invented assignment.

An agent using direct file/Branch calls has “Direct CLI” access and no Workspace
or Sandbox use unless actual assignment or resource calls establish one.

## Live presentation

Use an Agents column and a Sandboxes column. Each Sandbox contains its current
Workspace rows; each Workspace displays its Branch. This avoids listing every
project Branch as a permanent middle column during long histories.

- Agent card: main/child name, task, status, assigned Sandbox, current Workspace
  and Branch when present, current operation and elapsed time.
- Sandbox card: name, machine, actual state, observed mounted count, assigned
  agents, and current Workspace rows with their users.
- Dashed connection: assigned, no confirmed mounted Workspace. Solid connection:
  confirmed Workspace use. Animate only a call currently in flight, with reduced
  motion respected. Label each relationship so color is not required.
- Selecting either endpoint highlights all related actors/Workspaces/Sandboxes.
  Show linked conversation, exact command, output, receipt and Trace link in a
  details panel. Several users of one Workspace remain individually visible.
- Child route: focus that child and its bindings; parent/siblings are accessible
  as conversation context. Main route: main plus its children. Project route:
  all project conversations, grouped by parent.
- Positions follow stable actor/resource identities and first appearance.
  Progress, commits and last activity never reorder nodes. Collapse completed
  Workspace sessions into history rather than accumulating thousands of nodes.
- At narrow widths, stack the agent and resource sections; selection and labels
  preserve the relationship without relying on connecting lines.

Keep resource actions distinct from graph selection. The initial binding view
reports runtime assignments and actual use; selecting a node does not change
execution or silently move an agent to another Sandbox.

## Binding data

Persist normalized relationships in Connect, scoped to the selected LayerFS home:

```text
actor: chatId + actual Pi session identity (main or child)
assignment: actor + taskId + project + Sandbox identity + assigned/released times
workspace instance: actual mount workspace id + mount receipt/call identity
use: actor + assignment, when known + workspace instance + first/last use
call: actor + toolCallId + CLI/SDK call id + state + target + receipt reference
```

Display names such as `a01-worker` are not globally unique. Preserve the parent
conversation and actual child session identity across reused assignments. Include
Store/project and home/machine context so concurrent simulations never join.
Retain the returned `ws`, `workspace`, Sandbox and Branch from the mount receipt;
the same named `ws` can later refer to another mount instance.

Suggested states:

```text
assignment: assigned → active → released
workspace: mounting → mounted → unmounting → unmounted
call: queued → running → succeeded / failed / interrupted
```

Agent execution state, resource lifecycle state and observation freshness are
separate. A finished agent can leave a mounted Workspace. An unmounted Workspace
can belong to a still-assigned agent. Failed or uncertain mutations retain an
attention/unknown state until actual inventory or receipts resolve it.

## Source of truth and updates

- Use saved chat/child metadata for actor identity and runtime task assignment.
- Join real tool/Trace/CLI activity to successful LayerFS receipts for resource
  relationships. Use the same attribution for simulations and ordinary agents.
- Reconcile actual mounted resources with `sandbox.get`. Do not present a
  planned assignment as a mounted Workspace, or missing inventory as confirmed
  unmount. Keep direct Sandbox calls attributable without inventing a Workspace.
- Existing `chatLive`/`LiveState` supplies useful trace-derived relationships,
  but needs shared-user attribution, globally ordered cross-agent events and
  live-inventory reconciliation before it is authoritative for this view.
- Persist incremental binding events and a compact indexed projection. Replay
  only new events; deduplicate by actor/call identity. Do not reread all agents'
  full trace files or broadcast full transcripts on every refresh.
- Share one project inventory refresh, pause view polling while hidden, and
  batch compact relationship/status updates. Refresh details on demand.
- Keep immutable completed session history pageable and restore it after restart.

LayerFS `origin/layerfs_v2_0_0` Workspace mount/unmount documentation confirms the
returned mount identity and handle, Branch association, short-lived mounts,
capacity rules and uncertain-outcome reconciliation. Connect owns agent
attribution; LayerFS owns actual resource state.

## Acceptance examples

1. The inspected child route shows the actual child, its parent and confirmed
   Sandbox/Workspace relationships rather than zero agents.
2. Two children share one Sandbox through separate Workspaces; selecting either
   highlights its own Workspace and Branch correctly.
3. One child unmounts and later mounts another Workspace in the same assigned
   Sandbox. Its position and assignment stay stable, while history remains visible.
4. Direct CLI work shows the agent and Branch with no invented Sandbox connection.
5. Duplicate child names across simultaneous simulations never share relationships.
6. Uncertain mount/unmount, stopped agents, stale inventory and restart retain
   truthful distinct states. Completed agents do not imply resource cleanup.
7. Hundreds of completed mounts do not produce hundreds of live graph nodes;
   view navigation and progress remain responsive at 1280×820 and 900×600.

# Sandbox

Source: `components/sandbox/ProjectSandboxes.tsx`, `ProjectSandboxNavigation.tsx`,
`HostSandboxDetail.tsx`, `SandboxMap.tsx`, `SandboxDetail.tsx`.

## Project and standalone views

```text
Chat or Storage project / Sandbox
+---------------------------------------------------------+
| Real project resources              Refresh | Diagnose  |
| Sandboxes, mounted Workspaces, recorded ownership        |
| Select a Sandbox to open its detail                     |
+---------------------------------------------------------+

< Project activity / sandbox-name           Open standalone
[Overview] [Workspaces]                       Refresh
Observed state, machine, project, recorded mount paths
```

Both project and `/machines/:machine/sandboxes/:sandbox` routes read the real
host. Standalone detail validates machine identity. Breadcrumb Back restores the
machine tab and scroll position. Opening a resource reads it; it never starts it.

Unknown ownership, metrics, activity and scratch/log data stay unavailable.
Workspace detail uses recorded paths and reported filesystem routes. There are
no example resources, scenario selectors, playback controls, simulated metrics,
or local API interception. Read failures offer Retry. Missing and wrong-parent
resources show a refusal. Only Overview and Workspaces tabs are available.

## Live agent connections

```text
+-[1] Agents ----------+   +-[2] Branch --------+   +-[3] Sandbox --------+
| Main · Working       |-->| integration        |-->| machine · running   |
|   Child · Executing  |-->| feature            |-->| Workspace · Child   |
+----------------------+   +-------------------+   +---------------------+
| [4] Selected agent / Workspace · actual calls · linked conversation     |
+------------------------------------------------------------------------+
```

1. Saved main/child identities and task state; child routes focus that child.
2. Branches referenced by these agents or current Workspaces. Existing agent
   order remains stable while calls progress.
3. Inventory plus confirmed trace mount receipts. Named handles retain their
   actual mount paths and users. Successful unmount ends active use. Motion runs
   only on in-flight edges; completion stops it. Reduced motion hides packets.
4. Selection highlights actual relationships and links the saved conversation and
   Trace. The inspector renders the latest fifty calls; full history stays in Trace.

The visible map reads the compact chat `/live` feed with one request at a time:
250 ms while running, 1500 ms while idle. Hidden views do not poll; opening the
resource detail pauses the hidden map. Project views group their saved chats.
Host trace readers tail new bytes, keep a bounded recent-call list, and merge
cross-agent events by time. They do not resend or reparse complete transcripts.
Inventory polling queues a refresh instead of discarding a slower read.
Unknown inventory remains explicitly unknown; a trace receipt is not an inferred
resource owner or a fabricated machine observation. Standalone resource details
remain resource inspection views rather than playback diagrams.

## CLI resource observations (phase 2, #147)

```text
+-[1] Sandbox ---------------------------------------------------------+
| api-dev - Recorded state on lists; current state on open / Refresh    |
| sandbox.create - record - Outcome unknown (when op.uncertain)         |
+-[2] Overview --------------------------------------------------------+
| Sandbox ID  <id>                 Created  <created>                  |
| Workspaces unavailable: <down_reason>  (no zero count)                |
| No runtime recorded (gone); lost remains Lost                        |
+-[3] Workspace Details -----------------------------------------------+
| Base commit <base>               Base Layer <base_layer>             |
| Branch head <workspace status>   Head moved since mount Yes / No / ?  |
| Changes 2 changed inodes - 3 changed entries                          |
| Pending merge Yes / No / ?       Activity Uncertain / LocalFailure   |
+---------------------------------------------------------------------+
```

1. Lists poll records only; opening detail/Refresh reads the daemon with shared Busy backoff.
2. Down reason, lost, and gone retain their distinct meanings; a missing observation is unknown.
3. Counts describe overlay changes, never per-file patches. Removed tabs stay removed.

Force close appears only after MountsActive or Busy with execs, with explicit SIGTERM,
SIGKILL after 5 seconds and loss of uncommitted changes confirmation. Chat-owned names
warn that closing ends the chat Workspace. Unknown requires a fresh Sandbox read.

## CLI phase 2: shared Doctor and Stop (2026-11-09)

```text
Resource header                         [Diagnose / Check integrity / Test connection]
+ Doctor · saved resource ---------------------------------------------------+
| Target / operation    Full by default; optional Quick or explicit write test |
| Optional time budget                                            [Run diagnosis] |
| Queued / Running · elapsed (no progress percentage, no Stop)                 |
| Findings: N                Coverage: complete / incomplete                    |
| > failed / blocked / unknown checks first                                   |
| > evidence · dependencies · advisory suggestion                             |
| Previous dated reports (potentially stale)                                  |
+----------------------------------------------------------------------------+
```

Actions open setup only. Navigation and Refresh never launch targeted audits.
Sandbox uses the header action and its existing Overview/Workspaces tabs.
Connection observations do not prove integrity. Simulated reports say so.
Mounted chat Stop disables while stopping and retains Workspace/Sandbox; output
appears after command completion. Cancellation unknown offers explicit retry.

## New Sandbox image selection

Project creation shares `SandboxImageFields` with machine creation (see
[machines.md](machines.md#sandbox-image-discovery)). Available digests come from
the selected machine, never from existing Sandbox records. Changing the
PostgreSQL machine clears the selection; SQLite uses its Store’s fixed machine.
Default uses LayerFS resolution; Provide archive accepts a caller-local absolute
path and optional full digest. macOS native omits the image controls.

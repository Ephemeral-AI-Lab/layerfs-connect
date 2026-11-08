# Machines

Source: `src/renderer/src/components/compute/` (compute-page, machine-card, machine-page,
machine-data, machine-sandboxes, add-machine, target-parts), `components/state-chip.tsx`,
`data/states.ts`, `data/compute.ts`
Opens from: sidebar Machines; any machine link (`go.machine`: focus `machine:<name>` shows the
machine page in the same tab; App passes `back` when it came from another page)
Model: [../layerfs-model.md](../layerfs-model.md) (machine, Stores, Sandboxes, Workspaces)

## Machines board (current desktop renderer)

Source: `desktop/src/renderer/src/pages/machines/` (`MachinesPage.tsx`,
`MachineCard.tsx`, `machines.css`). New machine remains in the page header;
there is no duplicate New machine tile.

```text
+-[1] Header -----------------------------------------------------------------------------+
| Machines                                              [+ New machine] [Refresh]         |
+-----------------------------------------------------------------------------------------+
 [2] 3 running - 1 stopped - 1 Sandbox - 1 Workspace

 +-[3] native -------------------------+  +-[3] lima1 --------------------------+
 | <mac> native                  [...] |  | <L> lima1                      [...] |
 |       Native - Host processes       |  |     Lima - Linux namespaces         |
 |                                     |  |                                     |
 | Uses this computer's resources      |  | CPU          Memory   Disk capacity |
 |                                     |  | 4 cores      8 GiB    50 GiB        |
 |-------------------------------------|  |-------------------------------------|
 | 1             1             1        |  | 0             0             1        |
 | Sandbox       Workspace     Local   |  | Sandboxes     Workspaces    Local   |
 |                             Store   |  |                             Store   |
 | Stores  shop                        |  | Stores  lab                         |
 |                                     |  |                                     |
 | Disk       Shared with this computer|  | Disk     35.9 GiB free of 50 GiB    |
 |                                     |  | ####.........................       |
 |-------------------------------------|  |-------------------------------------|
 | ( Running )           This computer |  | ( Running )                 [Stop]  |
 +-------------------------------------+  +-------------------------------------+
```

| [n] | Component | Source | Behavior |
|---|---|---|---|
| 1 | PageHeader | MachinesPage.tsx | New machine, Refresh, existing development simulation picker |
| 2 | Facts | MachinesPage.tsx | Running/stopped, Sandbox and Workspace totals; attention counts |
| 3 | MachineTile | MachineCard.tsx | Whole-card open; identity, allocations, inventory, Stores, disk and manual power |

Grid: 340px minimum / 400px maximum tracks, 20px gaps, left aligned, capped at
1600px. Tracks shrink to available width below 340px. Cards have a 300px minimum
height and stretch equally within each row; notices can increase row height.
Native / Docker allocation sentences reserve the same band as the VM's three
allocation columns. Those columns show configured capacity, not live usage.

Order remains: needs attention, creating/removing, running, stopped, unknown;
then native, Docker, other machines by name. Loading, unavailable host and
unsupported older LayerFS still use the existing page states. The footer note
retains manual power behavior. Reading the page starts nothing.

## Machine card

```text
+-[1] lima1 -------------------------------------------------------------------+
| <kind> lima1                                                            [...] |
|        Lima - Linux namespaces                                                |
|                                                                               |
| [2] CPU                    Memory                       Disk capacity         |
|     4 cores                8 GiB                        50 GiB                |
|-------------------------------------------------------------------------------|
| [3] 2                      3                            5                     |
|     Sandboxes              Workspaces                   Local Stores          |
| [4] Stores  lab  a  b  +2 more                                                 |
|                                                                               |
| [5] Disk                                            35.9 GiB free of 50 GiB  |
|     ######.................................................................   |
|-------------------------------------------------------------------------------|
| [6] ( Running )                                                       [Stop]  |
+-------------------------------------------------------------------------------+
```

| [n] | Region | Behavior |
|---|---|---|
| 1 | Identity | Platform mark, machine name, one platform/runtime subtitle, existing menu |
| 2 | Allocations | Known CPU, memory, disk values; native shares host resources; Docker manages unspecified allocations |
| 3 | Inventory | Recorded Sandbox count, mounted Workspaces, local SQLite Stores; zeroes stay visible |
| 4 | Store links | Up to three quiet links, then +N more; open Storage independently of the card |
| 5 | Disk status | Free/capacity and bar only with reported values; native/shared and unavailable states use text |
| 6 | Footer | SDK-derived state/operation, Start/Stop; native shows This computer without power controls |

Unknown workspace counts show a dash or `N+` when only some counts are known,
with a title explaining that some reads failed. PostgreSQL Stores are external
and are not counted as local Stores. Machine allocations never stand in for
CPU/memory utilization. Disk bars indicate used share and label free bytes;
without capacity, Docker shows only reported free disk and no invented bar.

Whole-card click, keyboard activation, Cmd/Ctrl-click and middle click retain
existing machine navigation. Menu, Store and power controls sit above the card's
stretched target and never also open the card. Focus outlines the entire card.
Windows native says Records only; its workloads run on Docker.

Attention/refusal states live inside the affected card, without duplicate board
banners:

```text
 [Danger border] Failed / missing / unresolved
 +---------------------------------------------------------------------------+
 | <short SDK reason, up to two lines; full text in title>                     |
 | Inspect: layerfs machine status <name>                 (when unresolved)   |
 | View details ->                                                           |
 +---------------------------------------------------------------------------+
 [Warning border] Stopped machine with local Stores
 | Start to use its local Store(s).                      [View details ->]    |
 [Action refused] SDK refusal text remains visible inside the card.
```

The existing settings, removal guards, refusal recovery and explicit power
calls remain. Start/Stop show their existing pending/disabled states. New
machine opens the existing Add machine dialog from the header.

## Machine page (current desktop renderer)

Source: `desktop/src/renderer/src/pages/machines/` (`MachinePage.tsx`,
`MachineSandboxes.tsx`, `MachineDetails.tsx`, `machines.css`).
Sandboxes is the default, including when the machine has Stores and no Sandboxes.

```text
+-[1] Machine console --------------------------------------------------------------------+
| [< Machines]                                                    [Settings] [Power]* [...]|
|                                                                                         |
| <kind> native                                                               ( Running ) |
|        Native - this Mac                                                                |
|                                                                                         |
| [2] Resources: Shared with this computer    Free disk <only when reported>           |
| [3] [>] Technical details                                                               |
+-----------------------------------------------------------------------------------------+

 [4] SANDBOXES / 03     3 Workspaces                                      [Stores / 02 ->]

 +-[5] --------------------------------+  +-[5] --------------------------------+
 | api-dev - shop/api            [...] |  | web-preview - shop/web        [...] |
 | Image: None - host processes        |  | Image: ubuntu:24.04                 |
 | * Running              Kernel NFS   |  | * Running              Kernel FUSE  |
 |                                     |  |                                     |
 | CPU        Memory       Disk        |  | CPU        Memory       Disk        |
 | --         --           --          |  | --         --           --          |
 | Usage not reported by LayerFS       |  | Usage not reported by LayerFS       |
 |                                     |  |                                     |
 | Workspaces                   2 / 16 |  | Workspaces                   1 / 16 |
 | Workspace          Branch           |  | Workspace          Branch           |
 | login           -> feature-login    |  | preview         -> preview          |
 | review          -> fix-validation   |  |                                     |
 |                                     |  |                                     |
 |-------------------------------------|  |-------------------------------------|
 | Open sandbox                     -> |  | Open sandbox                     -> |
 +-------------------------------------+  +-------------------------------------+
```

| [n] | Component | Source | Behavior |
|---|---|---|---|
| 1 | Machine console | MachinePage.tsx | Identity, state, manual power, settings and existing menu |
| 2 | Hardware strip | MachinePage.tsx | Allocations and reported free disk; native resources are shared |
| 3 | Technical disclosure | MachineDetails.tsx | Existing facts, versions, capabilities, connection and removal rules |
| 4 | View heading and switch | MachinePage.tsx | Sandboxes by default; Stores replaces the inventory below the header |
| 5 | Square SandboxBox | MachineSandboxes.tsx | Name/project/menu, image subtitle, status/kernel, usage availability, workspace bindings |

Card data above is illustrative. Actual cards use the current host or selected simulation.
CSS Grid uses auto-fill with a 360px minimum track, a 20px gap and a 400px card
maximum, shrinking only when the available width is below 360px. The machine
workbench is capped at 1760px. Each card keeps `aspect-ratio: 1`; rows wrap without stretching to content.
Unknown workspace counts show a dash, never zero. No chat activity
is inferred from project identity. Long names/project paths truncate with full titles.

The card's stretched native Link opens the existing
`/machines/:name/sandboxes/:sandbox` route and its existing shared Sandbox detail
component. Cmd/Ctrl-click and keyboard focus work as links. The separate menu stays
above that link; menu clicks do not navigate. A Sandbox is bound to one project,
shown as Store/project beside its name. Branches belong to individual mounted
workspaces, shown in up to three `Workspace -> Branch` rows under their own
headers; additional rows show "+N more in sandbox details". A native Sandbox's
image says "Image: None - host processes"; digests/archive names are shortened with the full
reference in the title. The image is a quiet single-line subtitle immediately
below the name/project heading, with an explicit Image label. The reported Kernel (FUSE/NFS) shares the subtitle line; status lives in
the footer beside Open sandbox. It has no panel,
border, fill, or large padding. No workspace slot graphic remains.

Workspace bindings are read with `sandbox.get` at mount, after count/state
changes, and every 15 seconds while a nonempty Sandbox is running and the window
is visible. Loading, unknown counts, unread/refused workspace data, no details
reported, and zero workspaces remain distinct. Full workspace management stays
in the existing detail component. Sandbox resource readings are omitted unless
usage data is supplied. No historical CPU/memory sparklines or empty metrics
panels remain. Configured Machine resources stay in the header.

Development builds offer Preview sample readings / Hide sample readings. Only
explicit `?metrics=sample` enables the labelled current-value fixture; simulated
mode no longer enables it automatically. The sample has CPU percentage,
memory used/limit and disk used/total with a capacity bar. Production never
shows fixtures. No Machine allocation is substituted for Sandbox usage.

Kernel uses the Sandbox's reported `route` (`fuse` / `nfs`), falling back to its
detail read, with "Not reported" when neither reports it.

Closing retains the refusal / Force close flow, and unresolved/unknown-outcome
messages remain readable in a scrollable card notice.
Returning from detail restores the machine route and saved scroll position.

Stores view:

```text
 [4] STORES / 02   Local SQLite and supported PostgreSQL Stores       [<- Sandboxes / 03]
 +-[6] shop ------------------------------------------------------------------------------+
 | SQLite - on this machine                                                               |
 | api                                                         web                       |
 +-----------------------------------------------------------------------------------------+
 +-[6] team ------------------------------------------------------------------------------+
 | PostgreSQL - external database                                                         |
 | crm                                                                                   |
 +-----------------------------------------------------------------------------------------+
```

[6] uses existing MachineData / StoreSection components. PostgreSQL availability
comes from the platform capability flag, not a verified network probe.
`?view=stores` deep-links to Stores; `?view=sandboxes` and the bare machine route
open Sandboxes. Legacy `?view=details` opens Sandboxes with Technical details expanded.
The switch preserves other URL parameters and leaves the hardware header in place.
The native disclosure retains its open state while switching views. Native
resources use one shared-resource sentence, avoiding three repeated Shared
values. The machine status sits beside its name; technical details aligns with
the resource line.

Empty inventory: "Nothing runs here. Open a project's Sandboxes tab to create one
on this machine." Windows native keeps the existing records-only explanation.
Machine errors/refusals remain visible below the header, independent of the chosen view.

## Add a machine dialog

`mac` world: every platform ready. Lima's form open. SSH hosts and Firecracker are turned off
in Connect: the host leaves them out of `machine.platforms` (host/machines.js `OFF`), so they
have no row, and lima's `nested` option (only Firecracker used it) has no field.

```text
+-[1] Add a machine ----------------------------------------------------------------------- x -+
| Create a VM on this computer.                                                                 |
| +-[2] platform rows -------------------------------------------------------------------------+ |
| | <apple> Apple Container                                                          [Create] | |
| |         A Linux VM from Apple's container tool - container CLI version 1.6.1              | |
| |-------------------------------------------------------------------------------------------| |
| | <msb>   Microsandbox                                                             [Create] | |
| |         A microVM from msb - msb 0.7.11                                                   | |
| |-------------------------------------------------------------------------------------------| |
| | <L>     Lima                                                                     |Create| | |
| |         A Linux VM from Lima - limactl version 2.2.1                                      | |
| |   +-[3] VM form ----------------------------------------------------------------------+   | |
| |   | Name            CPUs            Memory          Disk                              |   | |
| |   | lima3_______    2___________    4G__________    20G_________                      |   | |
| |   |                                                 Holds its Stores                  |   | |
| |   | Sandbox image                                                                     |   | |
| |   | [v The bundle's image        ]                                                    |   | |
| |   | [Create]*  [Cancel]   Check the fields marked above.                              |   | |
| |   +-----------------------------------------------------------------------------------+   | |
| +-------------------------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------------------------+
```

The archive image choice:

```text
| Sandbox image                         Archive path or digest                   |
| [v Choose an archive...      ]        ~~~ /path/to/sandbox-image.tar ~~~        |
```

A platform that is not ready (not in `mac`):

```text
| <L>     Lima                                                         [How to install v] |
|         /!\ limactl not found                                                           |
|         Install Lima                                                                    |
|         [brew install lima  <copy>]                                                     |
|         Then press Refresh.                                                             |
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | AddMachineDialog | add-machine.tsx:56 | Closing resets the open form |
| 2 | platform row | add-machine.tsx:85 | Addable platforms, machine.platforms order |
| 3 | VmMachineForm | add-machine.tsx:150 | Fields only for declared options |
| 4 | FormButtons | add-machine.tsx:236 | `Creating...`; Refusal below |

```text
[2] ready       <blurb> - <version | Ready>   (blurb only in a wide dialog); [Create],
                |Create| (secondary) while its form is open
    not ready   /!\ <needs joined by " - ">  [How to install v] | [How to get it v]
                bundle: Needs the LayerFS Linux bundle + 4 `python3 tools/linux_bundle.py ...`
                hardware / OS (M3, macOS 15, Apple silicon, WSL2, root, ...): no button
[3] name        prefilled <short><n>: ac1, msb1, lima3 (lowest free)
```

Field errors replace the hint under a field (shown after the first submit):

| Field | Error |
|---|---|
| Name | `A name is required` - `<name> is built in: choose another name` |
| Name | `Use lowercase letters, digits and dashes (up to 31), starting with ...` |
| Name | `A machine named <name> exists` |
| CPUs | `A whole number from 1 to 64` |
| Memory / Disk | `At least 512M, such as 4G` - `At least 2G, such as 20G` |
| Sandbox image | `A sha256: digest, or an archive's absolute path` |

## States

```text
Board loading      <spin> Reading the machines
Board error        Could not read the machines          (or: The Connect host is not reachable)
                   <message>
                   [<o> Try again]
Older LayerFS      +---------------------------------------------------------------+
(no New machine)   |                       <server>                                |
                   |            Machines come with LayerFS 2.0                     |
                   |  This Connect links LayerFS 1.x, which has no machines.       |
                   |  Projects still run where this home keeps them; this page     |
                   |  fills in once Connect links LayerFS 2.0.                     |
                   +---------------------------------------------------------------+
Simulated (dev)    (<flask> Simulated) Mac, fresh home: sample data, not this machine.
Needs attention    In-card reason / refusal and View details; no duplicate board Notice.
                   Unresolved: Inspect: layerfs machine status <name>.
                   Full status and clearing calls remain on the machine page.
No such machine    [<] Machines / <name>   then   <server> No machine named <name>
                   It was removed, or this home never had it.
Page, no Sandbox   Nothing runs here. A project's Sandboxes tab starts one on any machine.
                   native on Windows: Native on Windows keeps records only; Sandboxes run
                   on docker.
Stores, empty      SQLite: No Store files here. Push one here from Storage.
                   PG none: No PostgreSQL Store connected. Connect one from Storage.
                   PG unsupported: <ban> <LayerFS reason>
                                   (or: This machine does not run PostgreSQL Sandboxes)
                   PG unknown: This LayerFS does not say whether Sandboxes here reach PostgreSQL.
Workspaces         <spin> Reading its Workspaces...  |  <CODE>: <message>  |  No Workspace mounted
                   more than 4 rows: Show N more / Show fewer
Sandbox strip      see layerfs sandbox get <b> - clear: layerfs sandbox close <b>   (unresolved)
(red, under head)  <Code>: <message>  |  Closed by force; Workspaces of unknown state: <list>
```

Machine state chip (`StateChip entity="machine"`, data/states.ts:22):

| state | chip | tone | look | counts as |
|---|---|---|---|---|
| creating | `(* Creating)` | warning | pulses | creating or removing |
| running, ready | `( Running )` | success | | running (native is `ready`) |
| stopped | `( Stopped )` | neutral | | stopped |
| removing | `(* Removing)` | warning | pulses | creating or removing |
| failed | `( Failed )` | danger | | needs you: in-card notice, danger border |
| missing | `( Missing )` | danger | | needs you: in-card notice, danger border |
| unresolved | `( Unresolved )` | danger | | needs you: in-card inspection call |
| unknown / empty | `( Unknown )` | neutral | dashed | unknown |
| any other word | `( <word> )` | neutral | | unknown |

```text
Busy op     ( Stopped - machine.start - boot )   op words appended, mono, truncated; never pulses
            title: Operation machine.start - boot [ (outcome uncertain)]
Sandbox     Creating*, Running*, Closing*, Gone, Unresolved, Unknown (dashed)   (* pulses)
```

## Menus and dialogs

```text
Machine [...] on the board    built-in (native, docker)          others (VMs)
+------------------------+    +-----------------------------+    +------------------------------+
| -> Open                |    | -> Open                     |    | -> Open                      |
| <power> Stop | Start   |    | <power> Stop    (docker)    |    | <power> Start                |
| ...                    |    | <gear> Update settings...   |    |------------------------------|
+------------------------+    |-----------------------------|    | <trash> Remove...      (red) |
                              | <lock> Built in - can't be  |    | In use: holds 1 Store. Pull  |
                              |        removed              |    | it to native first.          |
                              +-----------------------------+    +------------------------------+
```

On the machine page the same menu has no Open. Start / Stop: non-native, running or stopped.
Remove: disabled while it holds Stores or Sandboxes, the reason under it.

```text
+-[1] Update settings ------------------------- x -+   +-[2] ---------------------------------+
| docker                                           |   | Remove lima2 and its disk?           |
| Sandbox image                                    |   |                                      |
| ~~~ sha256:... ~~~                               |   |                [Cancel]  [Remove]!   |
| Docker socket                       (docker)     |   +--------------------------------------+
| ~~~ /var/run/docker.sock ~~~                     |   busy: Removing...
| WSL distribution             (docker, Windows)   |
| ~~~ Ubuntu-24.04 ~~~                             |
|                              [Cancel]  [Save]*   |
+--------------------------------------------------+

+-[3] Sandbox [...] -----------+
| Open project                 |   only with a project
| x Close Sandbox       (red)  |   disabled while closing or Gone
+------------------------------+
 after a refused close: x Force close
 (title: Close even with Workspaces whose state LayerFS cannot learn)
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | SettingsDialog | machine-card.tsx:325 | Built-ins; bad image disables Save; `Saving...` |
| 2 | RemoveDialog | machine-card.tsx:376 | On the page a removal returns to the board |
| 3 | SandboxMenu | machine-sandboxes.tsx:183 | Open project: its Sandboxes tab |

`[Remove]!` is the destructive button.

## Notes

- `ComputePage`'s `simulate` prop is never passed (App.tsx:230); the dev-only flask picker
  (`SimulationPicker`, hidden when the host itself runs the simulator) is the only way in.
- Unused exports (grep over `src/`): `PlatformBadge`, `StatePill` (target-parts.tsx);
  `readyKinds`, `platformOfSandbox`, `OS_OF` (data/compute.ts); `needsYou` (data/states.ts).
  `AddMachine`, `PlatformMark`, `SANDBOX_CAPACITY`, `KIND_SHORT`, `VM_KINDS` are used only in
  their own file.
- Stores are only linked here: pushing, pulling and moving them is on Storage.

## Shared Sandbox detail route

```text
Machines / native                 SANDBOXES / 01     [Stores / 02 ->]
  Sandbox api-dev ->  /machines/native/sandboxes/api-dev

< native / api-dev                                (Simulation)
Parent machine: native ->
[Overview] Workspaces Scratch Activity Diagnostics
  Shared components/sandbox/SandboxDetail and its panels
```

Sandbox names on machine cards open the shared resource detail. Breadcrumb Back restores the
machine's selected `?view=` tab and scroll position. Direct detail URLs fall back to the parent
machine's Sandboxes view. The conversation embeds the same component with Project activity as
its back label. See [sandbox.md](sandbox.md) for layout, states, ownership and verification.

The new detail route is simulation-only. It preserves recorded project, machine, branch and
mount paths, while unavailable scratch/log/runtime/agent data stays explicitly unrecorded.

## Resource readings simplification

Sandbox cards omit the resource block when LayerFS reports no usage. No empty
CPU/memory/disk placeholders or historical sparklines are shown. In development,
Preview sample readings explicitly enables `?metrics=sample`; samples are never
enabled automatically by simulated mode. The sample shows current values and a
disk capacity bar, labelled design preview. Hide sample readings restores the
ordinary card. Configured Machine resources remain in the Machine header.

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


Phase 2: inventory refresh failures retain the last successful rows with a dated
Stale notice. Failed sub-reads are labelled unavailable, never empty. Starting,
stopping and creating display elapsed time with no percentage. Mutation failures
expose an explicit fresh-state inspection. Guest free space and configured
allocation are labelled separately. Sandbox Workspace counts remain unknown until
an on-demand detail read. Technical details contains the shared Doctor action.

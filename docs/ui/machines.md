# Machines

Source: `src/renderer/src/components/compute/` (compute-page, machine-card, machine-page,
machine-data, machine-sandboxes, add-machine, target-parts), `components/state-chip.tsx`,
`data/states.ts`, `data/compute.ts`
Opens from: sidebar Machines; any machine link (`go.machine`: focus `machine:<name>` shows the
machine page in the same tab; App passes `back` when it came from another page)

## Machines board

```text
+-[1] Header (sticky) ---------------------------------------------------------------------------+
| Machines                                 [<flask> v Live host]  [+ New machine]*  [<o> Refresh]|
+------------------------------------------------------------------------------------------------+
 [2] 3 running - 1 stopped - 1 Sandbox - 1 Workspace
 [3] ( a Notice per machine that needs you -- none in `mac`; see States )

 +-[4] native ------------------+ +-[4] docker ------------------+ +-[4] lima1 -------------------+
 | <mac> native           [...] | | <whale> docker         [...] | | <L> lima1              [...] |
 | Native - this Mac            | | Docker - Docker's VM - 38.2..| | Lima - 4 CPU - 8 GiB - 50 GiB|
 | <box> 1 Sandbox - 1 Workspace| | <box> No Sandboxes           | | <box> No Sandboxes           |
 | (<store> shop ->)            | | <store> No Stores            | | (<store> lab ->)             |
 |                              | |                              | | ###.......... 35.9 GiB free  |
 |------------------------------| |------------------------------| |------------------------------|
 | ( Running )                  | | ( Running )   [<power> Stop] | | ( Running )   [<power> Stop] |
 +------------------------------+ +------------------------------+ +------------------------------+
 +-[4] lima2 -------------------+ +-[5] - - - - - - - - - - - - -+
 | <L> lima2              [...] | |             [+]              |
 | Lima - 2 CPU - 4 GiB - 32 GiB| |         New machine          |
 | <box> No Sandboxes           | |  Apple Container, Microsand- |
 | <store> No Stores            | |  box, Lima, Firecracker, SSH |
 |------------------------------| |  host                        |
 | ( Stopped )  [<power> Start]*| |                              |
 +------------------------------+ +- - - - - - - - - - - - - - - +

 [6] Machine power is manual: a machine runs between Start and Stop, and nothing starts or stops
     one by itself. Reading this page starts nothing.
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | PageHeader | compute-page.tsx:154 | Dev picker :161; New machine (when available) :163 |
| 2 | facts line | compute-page.tsx:189 | Zero counts of the optional parts are left out |
| 3 | Notice | compute-page.tsx:215 | Failed / missing / unresolved machine, [Show] |
| 4 | MachineTile | compute-page.tsx:243 | Grid min 17.5rem; order RANK :65, see below |
| 5 | NewMachineTile | machine-card.tsx:253 | Dashed; the ready addable kinds; opens Add |
| 6 | footer note | compute-page.tsx:248 | Fixed text |

```text
[2] parts, in order:   N running - N stopped - N creating or removing* - N unknown* - N Sandboxes
                       - N Workspaces - (red dot) N need you* - N operations in flight*
                       (* only when > 0)
[4] order:             needs you, creating/removing, running, stopped, unknown;
                       within each: native, docker, then by name
```

## Machine card

Composite: every optional part at once (lima1 with Sandboxes, chats and many Stores).

```text
+-[0] card (whole card opens the page; Cmd/Ctrl- or middle-click: new tab) ------+
| [1]<L>  [2] lima1                                                     [4][...] |
|         [3] Lima - 4 CPU - 8 GiB - 50 GiB                                      |
| [5] the VM did not boot: vz: Virtualization.framework refused the disk image   |
| [6] <box> 2 Sandboxes - 3 Workspaces                                           |
| [7]   * 1 chat working                                                         |
| [8] (<store> lab ->) (<store> a ->) (<store> b ->) +2 more                     |
| [9] ##################............................................ 35.9 GiB free |
|--------------------------------------------------------------------------------|
| [10]( Running - machine.stop - stop )  [11] Unavailable: ...  [12][<power> Stop] |
+--------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 0 | Card ring | machine-card.tsx:176 | Amber: stopped with Stores; red: needs you (:130) |
| 1 | KindLabel | machine-card.tsx:179 | Mark only: logo, server, monitor or monogram |
| 2 | name button | machine-card.tsx:182 | Stretched link over the card |
| 3 | size line | machine-card.tsx:187 | `<Kind> - <size>`, sizes below |
| 4 | MachineMenu | machine-card.tsx:192 | See Menus and dialogs |
| 5 | down reason | machine-card.tsx:197 | Red, 2 lines; status reason or record error |
| 6 | Sandboxes line | machine-card.tsx:202 | `No Sandboxes`; `Records only` (native, Windows) |
| 7 | chats working | machine-card.tsx:213 | Live chats in its Sandboxes; pulsing dot |
| 8 | StoreChip | machine-card.tsx:272 | 3 chips then `+N more`; else `No Stores`; a size only when store.list gives one |
| 9 | disk Bar | machine-card.tsx:232 | With disk size and free disk; >75% / >90% tone |
| 10 | StateChip | machine-card.tsx:241 | See States |
| 11 | Refusal compact | machine-card.tsx:242 | `<Code>: <message>` of the last action |
| 12 | PowerButton | machine-card.tsx:56 | Non-native only; `Starting...` / `Stopping...` |

```text
[3] sizes:  native   this Mac | this PC | this host
            docker   Docker's VM [- N free]          (Linux: this host's Docker)
            ssh      host's own [- N free]
            VM       4 CPU - 8 GiB - 50 GiB [- N free]   (free left out when [9] shows)
[12]        running -> [<power> Stop] (outline)   stopped -> [<power> Start]* (primary)
```

## Machine page

`native`, its Sandbox panel open (open at first: those with Workspaces, while 12 or fewer).

```text
+-[1] Header -----------------------------------------------------------------------------------+
| [<] Machines / <mac> native  Native  ( Running )                                         [...]|
| this Mac                                                                                      |
+-----------------------------------------------------------------------------------------------+
 [2] ( attention box: only with a down reason, a refusal or unresolved -- none here )

 [3] Stores  |SQLite 1| PostgreSQL 1                                           pushed to this disk
+-----------------------------------------------------------------------------------------------+
| +-[4] Store tile -------------+                                                               |
| | <store> shop  ->            |                                                               |
| |   [5] (*api) web            |                                                               |
| +-----------------------------+                                                               |
+-----------------------------------------------------------------------------------------------+

 Sandboxes  1 Sandbox - 1 Workspace
 +-[6] Sandbox panel (expanded) ----------------------------------------+
 | <sbx> Sandbox api-dev                           (* Running )   [...] |
 |       <proj> api (<store> shop)                                      |
 |       <disc> No image - host processes                               |
 |----------------------------------------------------------------------|
 | [7] [v] 1 Workspace                                 #.......  1 of 16|
 |  [8] <ws> feature-login /workspaces/feature-login  <br> feature-login x |
 |           -- not used by a chat                                      |
 +----------------------------------------------------------------------+

 Details
+-[9] ------------------------------------------------------------------------------------------+
| Platform          Free disk         Sandboxes run as                                          |
| Native            38.2 GiB          Processes, not isolated                                   |
|-----------------------------------------------------------------------------------------------|
| [10] [Update settings...]  Built in - can't be removed                                        |
+-----------------------------------------------------------------------------------------------+
```

`lima1`: header with power and disk bar, Details with the danger zone.

```text
| [<] Machines / <L> lima1  Lima  ( Running )                             [<power> Stop] [...] |
| 4 CPU - 8 GiB - 50 GiB - limactl version 2.2.1        #####........ 35.9 GiB free of 50 GiB |

| Platform   Tool                   CPUs   Memory   Disk     Free disk   Sandboxes run as     |
| Lima       limactl version 2.2.1  4      8 GiB    50 GiB   35.9 GiB    Linux namespaces     |
|---------------------------------------------------------------------------------------------|
| [11] Danger zone  [<trash> Remove lima1...] (disabled)                                      |
|      In use: holds 1 Store. Pull it to native first.                                        |
```

Closed panel, and a Workspace a chat uses (its x asks again):

```text
 | [>] 1 Workspace                                     #.......  1 of 16 |
 |  (0 Workspaces and closed: "No Workspace mounted", no toggle)        |

 |  <ws> feature-login /workspaces/feature-login  <br> feature-login [Close anyway] |
 |       <chat> Add a login route   * working        (or: idle; <people> for a scenario chat)
 |  <Code>: <message>                                (a refused unmount)
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | header | machine-page.tsx:93 | `[<]` only with `back`; power :104, menu :105 |
| 2 | attention box | machine-page.tsx:127 | Red when it needs you; text below |
| 3 | MachineData | machine-data.tsx:42 | Starts on PG when no SQLite Store and some PG |
| 4 | StoreTile | machine-data.tsx:100 | Name opens Storage (arrow on hover); JobChip :112; a size only when store.list gives one (2.0 does not) |
| 5 | project names | machine-data.tsx:113 | Open the project; `*` dot: a Sandbox runs here |
| 6 | SandboxPanel | machine-sandboxes.tsx:92 | Grid min 19rem, by project; menu :183 |
| 7 | toggle, capacity | machine-sandboxes.tsx:139 | Bar of 16: >75% warning, full danger |
| 8 | WorkspaceRow | machine-sandboxes.tsx:245 | x (hover) unmounts; chat links :286 |
| 9 | MachineFacts | machine-card.tsx:294 | Only the facts it knows, list below |
| 10 | built-in row | machine-page.tsx:156 | native and docker |
| 11 | danger zone | machine-page.tsx:164 | Disabled while it holds anything (:290) |

```text
[1] facts line  <size> - <tool version> - default image <digest or file>   [disk bar] N free of D
[2] lines       <down reason>
                see layerfs machine status <m> - clear: layerfs machine remove <m>  (unresolved;
                                                                       disconnect for ssh)
                Its Store can't be used until it answers.        (needs you, holds Stores)
                <Code>: <message>                                (a refused action)
[3] aside       SQLite: pushed to this disk     PostgreSQL: reachable from its Sandboxes
                PostgreSQL count only when the machine says it reaches PostgreSQL
[4] JobChip     ##.. pushing... | pulling... | backing up... | restoring...
[6] head        Sandbox <name> (title adds backend - route); project link opens its Sandboxes
                tab, or "No project"; image: <digest | file> (machine default) | (custom),
                No image - host processes (native), Image not reported
[7] toggle      N Workspaces | Workspaces unknown; bar pulses while running with Workspaces
[9] facts       Platform, Tool, CPUs, Memory, Disk, Free disk, Sandbox image, OS image,
                Lima host, Nested, SSH host, Data root, Identity, Docker socket,
                WSL distribution, Sandboxes run as (Containers | Processes, not isolated |
                Linux namespaces)
[11]            ssh: [<unplug> Disconnect <name>...]; held: In use: holds N Stores. Pull them
                to native first. | In use: Sandboxes are running on it.
```

## Add a machine dialog

`mac` world: every platform ready. Lima's form open.

```text
+-[1] Add a machine ----------------------------------------------------------------------- x -+
| Create a VM on this computer, or connect a Linux host over SSH.                               |
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
| |   | Sandbox image                     [ ] Nested: Firecracker machines can run in it  |   | |
| |   | [v The bundle's image        ]                                                    |   | |
| |   | [Create]*  [Cancel]   Check the fields marked above.                              |   | |
| |   +-----------------------------------------------------------------------------------+   | |
| |-------------------------------------------------------------------------------------------| |
| | <FC>    Firecracker                                                              [Create] | |
| |         A Firecracker microVM inside a nested Lima machine - limactl version 2.2.1        | |
| |-------------------------------------------------------------------------------------------| |
| | <srv>   SSH host                                                                [Connect] | |
| |         A Linux host you reach over SSH with a key - OpenSSH_10.2p1                       | |
| +-------------------------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------------------------+
```

Firecracker form (no nested Lima machine yet), with the archive image choice:

```text
| Name          CPUs        Memory      Disk                                     |
| fc1_______    2_______    4G______    20G_____                                 |
| Sandbox image                         Archive path or digest                   |
| [v Choose an archive...      ]        ~~~ /path/to/sandbox-image.tar ~~~        |
| Lima host                             New Lima machine's name                  |
| [v Create a nested Lima machine...]   lima3___________                         |
| Firecracker runs inside a Lima machine made with --nested                      |
| [Create]*  [Cancel]                                                            |
```

SSH form:

```text
+-[4] Connect an ssh host -------------------------------------------------------------+
| Name           Host                                       Port                       |
| ssh1_______    ~~~ ubuntu@gpu-box.lan ~~~                 22____                     |
| Identity                                  Known hosts file                           |
| ~~~ ~/.ssh/id_ed25519 ~~~                 ~~~ ~/.ssh/known_hosts ~~~                 |
| Left empty, the ssh agent's keys          Left empty, ssh's own; the host key must   |
|                                           already be known                           |
| Data root                                                                            |
| /layerfs/data______                                                                  |
| Holds its Stores; it stays when disconnected                                         |
| LayerFS logs in as root by default and turns off user namespaces on that host for    |
| everyone. Use a host you keep for this.                                    (warning) |
| [5] [Connect]*  [Cancel]                                                             |
| <Code>: <message>                                                                    |
+--------------------------------------------------------------------------------------+
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
| 1 | AddMachineDialog | add-machine.tsx:61 | Closing resets the open form |
| 2 | platform row | add-machine.tsx:91 | Addable platforms, machine.platforms order |
| 3 | VmMachineForm | add-machine.tsx:159 | Fields only for declared options |
| 4 | SshMachineForm | add-machine.tsx:284 | Port, Identity, Known hosts, Data root if declared |
| 5 | FormButtons | add-machine.tsx:353 | `Creating...` / `Connecting...`; Refusal below |

```text
[2] ready       <blurb> - <version | Ready>   (blurb only in a wide dialog); [Create] | [Connect],
                |Create| (secondary) while its form is open
    not ready   /!\ <needs joined by " - ">  [How to install v] | [How to get it v]
                bundle: Needs the LayerFS Linux bundle + 4 `python3 tools/linux_bundle.py ...`
                hardware / OS (M3, macOS 15, Apple silicon, WSL2, root, ...): no button
[3] name        prefilled <short><n>: ac1, msb1, lima3, fc1, ssh1 (lowest free)
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
| Lima host | `Choose the Lima machine it runs in` |
| Lima host | `<name> is not a Lima machine made with --nested` |
| Host / Port | `user@host, or a host name` - `A port from 1 to 65535` |
| Identity | `A key file's path, such as ~/.ssh/id_ed25519` |
| Data root | `An absolute path on the host` |

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
Needs-you Notice   +-------------------------------------------------------------+
                   | /!\ lima2 is failed                                  [Show] |
                   |     the VM did not boot: vz: ...                            |
                   |     Its Store can't be used until it answers.               |
                   +-------------------------------------------------------------+
                   unresolved: title "<machine>: unresolved <op>", plus mono
                   see layerfs machine status <m> - clear: layerfs machine remove <m>
No such machine    [<] Machines / <name>   then   <server> No machine named <name>
                   It was removed or disconnected, or this home never had it.
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
| failed | `( Failed )` | danger | | needs you: Notice, red ring |
| missing | `( Missing )` | danger | | needs you: Notice, red ring |
| unresolved | `( Unresolved )` | danger | | needs you: Notice + clearing call |
| unknown / empty | `( Unknown )` | neutral | dashed | unknown |
| any other word | `( <word> )` | neutral | | unknown |

```text
Busy op     ( Stopped - machine.start - boot )   op words appended, mono, truncated; never pulses
            title: Operation machine.start - boot [ (outcome uncertain)]
Sandbox     Creating*, Running*, Closing*, Gone, Unresolved, Unknown (dashed)   (* pulses)
```

## Menus and dialogs

```text
Machine [...] on the board    built-in (native, docker)          others (VM, ssh)
+------------------------+    +-----------------------------+    +------------------------------+
| -> Open                |    | -> Open                     |    | -> Open                      |
| <power> Stop | Start   |    | <power> Stop    (docker)    |    | <power> Start                |
| ...                    |    | <gear> Update settings...   |    |------------------------------|
+------------------------+    |-----------------------------|    | <trash> Remove...      (red) |
                              | <lock> Built in - can't be  |    |  ssh: <unplug> Disconnect... |
                              |        removed              |    | In use: holds 1 Store. Pull  |
                              +-----------------------------+    | it to native first.          |
                                                                 +------------------------------+
```

On the machine page the same menu has no Open. Start / Stop: non-native, running or stopped.
Remove / Disconnect: disabled while it holds Stores or Sandboxes, the reason under it.

```text
+-[1] Update settings ------------------------- x -+   +-[2] ---------------------------------+
| docker                                           |   | Remove lima2 and its disk?           |
| Sandbox image                                    |   |                                      |
| ~~~ sha256:... ~~~                               |   |                [Cancel]  [Remove]!   |
| Docker socket                       (docker)     |   +--------------------------------------+
| ~~~ /var/run/docker.sock ~~~                     |   ssh: Disconnect <name>? Its data root
| WSL distribution             (docker, Windows)   |   stays on the host.   [Disconnect]!
| ~~~ Ubuntu-24.04 ~~~                             |   busy: Removing... / Disconnecting...
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
| 1 | SettingsDialog | machine-card.tsx:343 | Built-ins; bad image disables Save; `Saving...` |
| 2 | RemoveDialog | machine-card.tsx:394 | On the page a removal returns to the board |
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

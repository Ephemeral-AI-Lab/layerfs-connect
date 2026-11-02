# LayerFS: Compute

The machines this Connect's LayerFS home runs on (LayerFS 2.0, layerfs#533). There is one home, and
its compute is a set of machines: `native` and `docker` are built in, VMs are created
(`apple-container`, `microsandbox`, `lima`, `firecracker`) and ssh hosts are connected. A machine
holds many sqlite Stores, and a project's Sandboxes run on its Store's machine. Machines start on the
first call that needs them and stop after 10 idle minutes, so the page has no start or stop buttons.
PostgreSQL servers are Storage's; a new Sandbox is made from a project's Sandboxes tab.
Opens from: the Compute item in the sidebar.
Source: `src/renderer/src/components/compute/compute-page.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------+
| Compute                                     [Simulate v]  [+ New machine v]  [ Refresh ] |
+-----------------------------------------------------------------------------------------+
  2 ready . 1 running . 1 idle . 5 Sandboxes . * 1 needs you                          [2]
+-[3] Notice ------------------------------------------------------------------------------+
| (!) gpu-box is down                                                            [ Show ] |
|     ssh: connect to host gpu-box.lan port 22: Operation timed out                       |
|     Its Store can't be used until it answers.                                           |
+-----------------------------------------------------------------------------------------+
  Machines 5                                                                         [4]
+-----------------------------------------------------------------------------------------+
| MACHINE    KIND              STATE                 SIZE                    STORES  SBX   |
| native     (A) Native        (Ready)               this Mac                     1    2 > |
| docker     (D) Docker        (Ready)               Docker's VM . 43.7 GiB free  1    1 > |
| dev        (L) Lima          (Running)             4 CPU . 8 GiB . 40 GiB       1    2 v |
|   Stores on it                          Sandboxes                                       |
|   | agents  4 projects . 6.8 GB  [Move to...] |   Sandbox 1 . agents/crawler . 3 Workspaces |
|   Tool  limactl 2.0.1   Free disk 31.2 GiB   Sandbox image sha256:afa1...   Nested        |
|   [Remove]  In use: holds 1 Store. Move it first.                                        |
| gpu-box    [=] SSH host      (Down)                host's own                   1    0 > |
| scratch    (m) Microsandbox  (Idle . starts on use) 2 CPU . 4 GiB . 20 GiB       1    0 > |
+-----------------------------------------------------------------------------------------+
  Add a machine                                                                      [5]
+-----------------------------------------------------------------------------------------+
| (A) Apple Container  A Linux VM from Apple's container tool . container 0.6.1  [Create] |
| (m) Microsandbox     ! msb not found                                [How to install v] |
|       Install msb, or put ~/.microsandbox/bin on PATH   [curl ... | sh (copy)]           |
| (L) Lima             A Linux VM from Lima . limactl 2.0.1                      [Create] |
|   +- Name [lima1] CPUs [2] Memory [4G] Disk [20G]                                   -+  |
|   |  Sandbox image [layerfs runtime sha256:afa1...  v]   > Advanced (OS image)        |  |
|   +- [Create] [Cancel]                                                              -+  |
| (FC) Firecracker     ! Needs an M3 or later Mac for nested virtualization               |
| [=] SSH host         A Linux host you reach over SSH with a key . OpenSSH 10.0 [Connect] |
+-----------------------------------------------------------------------------------------+
  Machines start on the first call that needs them and stop after 10 idle minutes.   [6]
```

## Regions

1. **Page header** (sticky; once the page scrolls it is opaque, the page's own `--background`, with a hairline under it: `page-header-solid`): the title, **New machine** (a menu of the kinds `can_create` says are ready; choosing one opens its form in Add a machine and scrolls to it) and **Refresh** (rereads `GET /api/machines`). Dev builds put the simulation picker first. New machine is not shown when machines are unavailable.
2. **Facts line**: each state counted as it is: ready (the built-ins, answering), running (only `running`), idle (stopped: they start on use), starting (only when some are starting or being created), Sandboxes (every machine's), and in red how many need you (down or failed). Each part carries its dot, so a wrapped line starts with one.
3. **Notices**: one danger notice per machine that is down: its name, its reason (`machine.status().down_reason`, else the record's `error`), how many of its Stores wait on it, and **Show**, which opens its row and scrolls to it.
4. **Machines** (`MachinesTable`, `compute/machines-table.tsx`): native and docker first, then the rest by name. Columns: Machine; Kind (`KindLabel`: the kind's mark and name; native is this computer's: Apple, Linux or a monitor); State (`StatePill`); Size; Stores; Sandboxes. Under 46rem a row is two lines: mark, name and state, then kind, size and counts.
   - **Size**: a VM's `CPU . memory . disk`; native "this Mac" (this PC, this host); docker "Docker's VM . N GiB free" (its status's free disk; "this host's Docker" on Linux); ssh "host's own".
   - **An opened row**: its down reason; **Stores on it**, each with its project count and size and **Move to...** (`store.move`; the menu lists every other machine that is not down; disabled while this one is down); **Sandboxes** (`Sandbox n . project . n Workspaces`; on Windows native says it keeps records only); facts (Tool version, Free disk, Sandbox image digest or archive, OS image, Lima host, Nested, SSH host `user@host[:port]`, Data root, Identity, Docker socket, WSL distribution, how Sandboxes run).
   - **Actions**: a VM has **Remove**, an ssh host **Disconnect**, each confirmed inline ("Remove dev and its disk?", "Disconnect gpu-box? Its data root stays on the host."). While the machine holds Stores or Sandboxes the button is disabled with "In use: holds N Stores. Move them first." (LayerFS refuses `InUse` too; its words show under the actions). The built-ins have **Update settings** (Sandbox image; docker also its socket and, on Windows, its WSL distribution: `machine.update`) and "Built in . can't be removed".
5. **Add a machine** (`AddMachine`, `compute/add-machine.tsx`): one row per `can_create` kind, in its order: the kind, what it is and its tool's version, or what it is missing in warning colour (`needWords`, with 2.0's `machine/probe.rs` names: `tool:msb` is "msb not found", `bundle:<folder>` "Needs the LayerFS Linux bundle", `host:apple-m3` and `host:macos15` the nested-virtualization needs, `host:apple-silicon`, `host:macos`, `host:macos-or-linux`, `host:wsl2`). The button is **Create** (VM kinds) or **Connect** (ssh).
   - A missing tool's button is **How to install** (`installHelp`: msb's install line or `~/.microsandbox/bin` on PATH, Apple's container releases and `container system start`, `brew install lima`).
   - A missing Linux bundle's is **How to get it**: the sealed Linux bundle for this LayerFS version goes in `~/.cache/layerfs/bundle/<version>/`, and in a dev build the layerfs repository places it with `python3 tools/linux_bundle.py daemon|worker|helper|seal --resources <resources.json>`, each line with a copy button, then "Then press Refresh."
   - A hardware or OS need (`host:…`) keeps its reason and has no button, even when a tool is missing too.
   - Forms open inline under their row and check themselves on submit; each error sits under its field, and "Check the fields marked above." beside the buttons.
   - **Every form's Name** starts as a free name, `<short kind><n>` with the lowest unused n (`ac1`, `msb1`, `lima1`, `fc1`, `ssh1`), as 2.0's cell runner names machines (`freeMachineName`); its placeholder is the same.
   - **VM form**: Name (required; lowercase letters, digits and dashes; not `native` or `docker`; not taken), CPUs (1-64, default 2), Memory (at least 512M, default 4G), Disk (at least 2G, default 20G), Sandbox image (the default "layerfs runtime", owner decision O36: `layerfs-352-runtime:node24-https-apt-20261024`, `sha256:afa1ef9c...`; or an archive path or digest), and an Advanced fold with OS image. Firecracker adds **Lima host**: an existing Lima machine made with `--nested`, or "Create a nested Lima machine..." with its name (made first, then the Firecracker machine). `can_create` says Firecracker is ready when the Mac can nest, whether or not a nested Lima machine exists; when none does, the form opens with "Create a nested Lima machine..." chosen and a free Lima name (`lima1`) filled in.
   - **ssh form**: Name, Host (`user@host`, or a host name: user then `root`), Port (22), Identity (a key path; empty uses the ssh agent's keys), Data root (`/layerfs/data`), and the warning that LayerFS logs in as root and turns off user namespaces on that host.
   - A machine made opens its row in the table.
6. **Footnote**: "Machines start on the first call that needs them and stop after 10 idle minutes."

## States

- **Loading**: "Reading the machines" in place of the page; `LoadError` ("the machines") with Retry.
- **Unavailable**: Connect links a LayerFS with no machines (1.x): one card, "Machines come with LayerFS 2.0", naming the linked version, and nothing else. No sample data on a live host.
- **Machine states** (`machineState`): Ready and Running (success), Idle . starts on use (neutral: stopped), Starting and Creating (warning, glowing), Down and Failed (danger).
- **Can create**: ready (version and a button), missing a tool (How to install), missing the Linux bundle (How to get it), missing hardware or OS support (warning words only).
- **Refusals**: an action LayerFS refuses (`InUse`, `Exists`, `InvalidInput`, `Unsupported`) shows its words where the action was.

## Data

`GET /api/machines` answers `MachinesView` (`src/shared/host-api.ts`), built by `host/machines.js`
from LayerFS 2.0's calls (`machine/calls.rs`):

- `machines`: `machine.list().machines`, each `{ name, platform, backend, state, cpus, memory, disk
  (bytes), stores, sandboxes (names), image?, host?, nested?, docker?, wsl?, error?, ssh? }`.
- `canCreate`: `machine.list().can_create`, each `{ platform, ready, missing, version }`.
- `stores`: `store.list()` items on a machine (`{ name, machine, projects, size }`); PostgreSQL Stores
  are on no machine and left to Storage.
- `sandboxes`: `sandbox.list()` items (`{ name, machine, project, workspaces }`).
- `status`: `machine.status(name)` for every machine but native (a stopped VM answers without being
  started): `{ state, freeDisk, toolVersion, down }`.
- `{ available: false, layerfs, reason }` when the linked LayerFS has no machine family.

Actions: `POST /api/machines` (`machine.create(name, platform, { cpus, memory, disk, image, host,
nested })`, or with `platform: 'ssh'` `machine.connect(name, host, { user, port, identity, root })`),
`DELETE /api/machines/:name` (`machine.remove`, or `machine.disconnect` for an ssh host),
`POST /api/machines/:name/update` (`machine.update`) and `POST /api/machines/:name/stores { store }`
(`store.move(store, machine)`). Each is refused `Unsupported` on a LayerFS without machines. An OS
image is sent only when the linked `machine.create` takes `os_image` (layerfs#533's first table does
not; it is refused with words rather than sent).

Today Connect links LayerFS 1.1.0 (`@layerfs/runtime`), so a live host answers `available: false`.
The view and the forms are developed on the simulations below until Connect links the 2.0 package
(`layerfs`, `client({ home })`).

## Simulation

- `src/renderer/src/data/compute-sim.ts`: each case is a `MachinesView` in exactly the shape
  `host/machines.js` builds from 2.0's answers. The page's actions work on a copy in memory
  (`simulate`), refused as LayerFS refuses them (InUse while a machine holds Stores, Exists for a
  taken name, a Firecracker host that is not a nested Lima machine); Refresh puts the case back.
  - `mac-fresh`: an M1 Mac, native and docker only; every kind's create state (ready, a missing
    tool, the Linux bundle missing, Firecracker on hardware that can't nest).
  - `mac-nested`: an M3 Mac whose one Lima machine was made without `--nested`: Firecracker is
    ready and its form makes a nested Lima machine first.
  - `mac-mixed`: five machines (native, docker, a nested lima, an idle microsandbox, an ssh host
    that is down).
  - `mac-busy`: many Stores and Sandboxes on native, docker and a lima machine hosting a Firecracker
    machine; an Apple Container machine starting.
  - `windows`: native keeps records only; docker through WSL2; the Mac-only kinds need macOS, msb
    is not found.
  - `older`: a LayerFS with no machines.
- In the app (dev builds): the flask picker in the header switches between the live host and the
  simulated ones; the choice is kept in localStorage `connect.compute.simulate`, and a "Simulated"
  chip says so.
- The harness: `?page=compute&case=mac-mixed|mac-fresh|mac-nested|mac-busy|windows|older[&w=460][&dark=1]`
  (`.game-harness/pages/compute.tsx`).

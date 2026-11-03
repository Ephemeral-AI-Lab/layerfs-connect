# LayerFS: Compute

The machines this Connect's LayerFS home runs on, and every Sandbox in it (LayerFS 2.0, #537 §6). There
is one home, and its compute is a set of machines: `native` and `docker` are built in, VMs are created
(`apple-container`, `microsandbox`, `lima`, `firecracker`) and ssh hosts are connected. A machine holds
many sqlite Stores; a sqlite project's Sandboxes run on its Store's machine, a PostgreSQL project's on
any machine that supports PostgreSQL Sandboxes. **Power is manual:** a machine runs between **Start**
and **Stop**, and reading this page starts nothing. States are the SDK's, never guessed.
Opens from: the Compute item in the sidebar, or a machine link elsewhere (a Storage machine heading, a
Sandbox tile's machine, a project's Machine fact), which scrolls to that machine's row and opens it.
Source: `src/renderer/src/components/compute/compute-page.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] PageHeader --------------------------------------------------------------------------+
| Compute                                       [Simulate v]  [+ New machine v]  [ Refresh ] |
+-------------------------------------------------------------------------------------------+
  2 running . 2 stopped . 4 Sandboxes . * 1 needs you . 1 operation in flight            [2]
+-[3] Notice --------------------------------------------------------------------------------+
| (!) box: unresolved machine.create                                               [ Show ] |
|     see layerfs machine status box · clear: layerfs machine remove box                    |
+-------------------------------------------------------------------------------------------+
  Machines 5                                                                             [4]
+-------------------------------------------------------------------------------------------+
| MACHINE    PLATFORM          STATE         SIZE                       STORES  SANDBOXES    |
| native     (A) Native        (Running)     this Mac                        1    2        > |
| docker     (D) Docker        (Running)     Docker's VM . 43.7 GiB free     0    1        > |
| dev-lima   (L) Lima          (Stopped)     2 CPU . 4 GiB . 40 GiB          1    0        v |
|   Stores on it                              Sandboxes                                      |
|   | app  api . 1.2 GB    [Pull or move... v] |  No Sandboxes running.                      |
|   Tool limactl 2.2.1   Sandbox image ...   Sandboxes run as Linux namespaces              |
|   dev-lima is stopped: its Stores and Sandboxes can't be used until it starts.  [Start]   |
|   [Remove]  In use: holds 1 Store. Pull it to native first.                               |
+-------------------------------------------------------------------------------------------+
  Sandboxes 2                                                                            [5]
+-------------------------------------------------------------------------------------------+
| NAME   PROJECT    MACHINE   BACKEND . ROUTE     STATE        WORKSPACES                    |
| a1     shop/web   native    native . nfs        (Running)    2/16                        > |
| b1     pg/api     docker    docker . fuse       (Creating)   0/16                        > |
+-------------------------------------------------------------------------------------------+
  Add a machine                                                                          [6]
+-------------------------------------------------------------------------------------------+
| (L) Lima          A Linux VM from Lima . limactl 2.2.1                            [Create] |
| (FC) Firecracker  ! Needs an M3 or later Mac for nested virtualization                     |
| [=] SSH host      A Linux host you reach over SSH with a key . OpenSSH 10.0      [Connect] |
+-------------------------------------------------------------------------------------------+
  Machine power is manual: a machine runs between Start and Stop ...                     [7]
```

## Regions

1. **Page header** (sticky, opaque once scrolled): the title, **New machine** (a menu of the platforms
   `machine.platforms` says are ready; choosing one opens its form in Add a machine and scrolls to it)
   and **Refresh**. Dev builds put the simulation picker first.
2. **Facts line**: running, stopped, creating or removing (when any), unknown (when any), Sandboxes,
   in red how many need you (failed, missing or unresolved), and operations in flight on machines,
   Stores and Sandboxes.
3. **Notices**: one danger notice per machine that needs you: "<machine> is failed/missing", or
   "<machine>: unresolved <operation>" with "see `layerfs machine status <m>` · clear:
   `layerfs machine remove <m>`" (`disconnect` for ssh). It gives LayerFS's reason, how many of its
   Stores wait on it, and **Show**, which opens its row.
4. **Machines** (`MachinesTable`, `compute/machines-table.tsx`): native and docker first, then the rest
   by name. Columns: Machine; Platform (its mark and name); State (`StateChip`: the SDK's state,
   or an operation's name and phase); Size; Stores; Sandboxes. Under 46rem a row is two lines.
   - **Size**: a VM's `CPU . memory . disk`; native "this Mac" (this PC, this host); docker "Docker's
     VM . N GiB free" ("this host's Docker" on Linux); ssh "host's own".
   - **An opened row**: LayerFS's reason when it needs you; **Stores on it**, each name opening its
     Storage row and each project name opening the project, with its size. On native the button is
     **Push to…** (machines whose `supports.sqlite` is true); elsewhere **Pull or move…**: **Pull to
     native**, then "Move <store> to (pull, then push)" and the other machines. Each starts a job that
     shows on Storage. **Sandboxes on it** (name, project, Workspace count); facts (Tool, Free disk,
     Sandbox image, Lima host, Nested, SSH host, Data root, Identity, Docker socket, WSL distribution,
     how Sandboxes run).
   - **Start / Stop** (not native; only while running or stopped): `machine.start` waits until its
     worker answers; `machine.stop` is refused `InUse` while Sandboxes run, the refusal listing them.
   - **Remove / Disconnect**: a VM has **Remove**, an ssh host **Disconnect**, each confirmed inline.
     While it holds Stores or Sandboxes the button is disabled with the reason ("In use: holds 1 Store. Pull it to native first."); LayerFS refuses `InUse`
     too, with what is in the way. The built-ins have **Update settings** (Sandbox image; docker also
     its socket and, on Windows, its WSL distribution: `machine.update`) and "Built in . can't be
     removed".
   - A refused action shows LayerFS's refusal under the row (code, words, entity, phase, In the way).
5. **Sandboxes** (`SandboxesTable`, `compute/sandboxes-table.tsx`): every Sandbox in the home, by name,
   from `sandbox.list`. Columns: Name; Project (opens the project's Sandboxes tab); Machine (opens its
   row); Backend · route; State (with any operation); Workspaces `n/16`. A row opens to its Workspaces
   (`sandbox.get`): each one's name (or "unnamed"), its `<sandbox>:<path>` handle and Branch, and
   **Close** (a refused close offers **Force close**, which names the Workspaces of unknown state). An
   unresolved Sandbox shows its status and clearing calls. Empty: "No Sandboxes. A project's Sandboxes
   page starts one."
6. **Add a machine** (`AddMachine`, `compute/add-machine.tsx`): one row per platform `machine.platforms`
   lists as created or connected, in its order: the platform, a short blurb (else LayerFS's description)
   and its tool's version, or what it is missing in warning colour (`tool:msb` is "msb not found",
   `bundle:<folder>` "Needs the LayerFS Linux bundle", `host:apple-m3` and `host:macos15` the
   nested-virtualization needs, and the other `host:` needs). The button is **Create** (VMs) or
   **Connect** (ssh).
   - A missing tool's button is **How to install**, a missing Linux bundle's **How to get it**, each
     with lines to copy and "Then press Refresh." A hardware or OS need has no button.
   - Forms open inline and show only the fields the platform declares in `options`; anything else is
     not sent (the host refuses it `InvalidInput`). They check themselves on submit; each error sits
     under its field. A refused create shows the whole refusal.
   - **Name** starts as a free name, `<short platform><n>` (`ac1`, `msb1`, `lima1`, `fc1`, `ssh1`).
   - **VM form**: Name, CPUs (1-64, default 2), Memory (default 4G), Disk (default 20G; "Holds its
     Stores"), Sandbox image ("The bundle's image", the default, or "Choose an archive…": an archive
     path or digest). Lima adds **Nested** (a checkbox: Firecracker machines can run in it).
     Firecracker adds **Lima host**: an existing nested Lima machine, or "Create a nested Lima
     machine…" with its name (made first). With none, the form opens on that choice.
   - **ssh form**: Name, Host (`user@host`, or a host name), Port (22), Identity (empty: the ssh
     agent's keys), Known hosts file (empty: ssh's own), Data root (`/layerfs/data`; it stays when
     disconnected), and the warning that LayerFS logs in as root by default and turns off user
     namespaces on that host.
   - A machine made opens its row in the table.
7. **Footnote**: "Machine power is manual: a machine runs between Start and Stop, and nothing starts
   or stops one by itself. Reading this page starts nothing."

## States

- **Loading**: "Reading the machines"; `LoadError` ("the machines") with Retry.
- **Unavailable**: Connect links a LayerFS with no machines (1.x): "Machines come with LayerFS 2.0",
  naming the linked version, and nothing else.
- **Machine states** (`data/states.ts`): Running (success; native's `ready` reads Running), Stopped
  (neutral), Creating and Removing (warning, pulsing), Failed, Missing and Unresolved (danger; they
  need you), Unknown (dashed).
- **Sandbox states**: Creating, Running, Closing, Gone, Unresolved, Unknown.
- **Platform rows**: ready (version and a button), missing a tool (How to install), missing the Linux
  bundle (How to get it), missing hardware or OS support (warning words only).

## Data

`GET /api/machines` answers `MachinesView` (`src/shared/host-api.ts`), built by `host/machines.js`. None
of it starts a machine:

- `machines`: `machine.list().machines`, each `{ name, platform, backend, state, supports { sqlite,
  postgresql_sandbox, reason }, cpus, memory, disk (bytes), stores, sandboxes (names), image?, host?,
  nested?, docker?, wsl?, error?, ssh? }`.
- `platforms`: `machine.platforms()` rows, each `{ platform, how, backend, kernel, sqlite, postgresql
  { store_calls, sandbox, reason }, ready, missing, version, options [{ name, kind }], description }`.
  Also on its own at `GET /api/platforms`.
- `stores`: `store.list()` items on a machine (`{ name, machine, projects, names, size, state, op }`).
- `sandboxes`: `sandbox.list()` items (`{ name, machine, project, workspaces, state, op, backend,
  route }`).
- `status`: `machine.status(name)` only for machines that run or hold or lost an operation: `{ state,
  freeDisk, toolVersion, down, op }`.

Actions: `POST /api/machines` (`machine.create(name, platform, options)`, or with `platform: 'ssh'`
`machine.connect(name, host, options)`, the declared options only), `DELETE /api/machines/:name`
(`machine.remove`, or `machine.disconnect` for an ssh host), `POST /api/machines/:name/start|stop`,
`POST /api/machines/:name/update` (`machine.update`), `POST /api/machines/:name/stores { store }`
(a push, pull, or pull then push, as a Storage job), `GET /api/sandboxes/:name` (`sandbox.get`) and
`DELETE /api/sandboxes/:name?force=1` (`sandbox.close`).

## Simulation

- `src/renderer/src/data/compute-sim.ts`: each case is a `MachinesView` in the shape `host/machines.js`
  builds. The page's actions (create, remove, Start, Stop, push and pull) work on a copy in memory,
  refused as LayerFS refuses them; Refresh puts the case back. Cases: `mac-fresh`, `mac-mixed`,
  `mac-nested`, `mac-busy`, `windows`, `older`.
- In dev builds the flask picker in the header switches between the live host and the simulated ones
  (localStorage `connect.compute.simulate`); a "Simulated" chip says so.
- The harness: `?page=compute&case=mac-mixed|mac-fresh|mac-nested|mac-busy|windows|older[&w=460][&dark=1]`
  (`.game-harness/pages/compute.tsx`).

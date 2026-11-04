# LayerFS: Machines

The machines this Connect's LayerFS home runs on, their Sandboxes and the Workspaces in them (LayerFS
2.0, #537 §6). It is the one home of machines, Sandboxes and Workspaces; elsewhere they appear only
as links that open this page. There is one home, and its compute is a set of machines: `native` and
`docker` are built in, VMs are created (`apple-container`, `microsandbox`, `lima`, `firecracker`) and
ssh hosts are connected. A machine holds many sqlite Stores; a Sandbox belongs to one project and
runs on one machine (a sqlite project's on its Store's machine, a PostgreSQL project's on any machine
that supports PostgreSQL Sandboxes) and holds up to 16 Workspaces, each a side Branch mounted for a
chat. Stores are only linked here: their home is Storage, where they are pushed, pulled and moved.
**Power is manual:** a machine runs between **Start** and **Stop**, and reading this page starts
nothing. States are the SDK's, never guessed.
Two levels: the **board** (a grid of machine cards) and a **machine's page** (the data its
Sandboxes can use, its Sandboxes, its facts), which opens in place: its crumbs' **Machines** and the
sidebar's Machines item return to the board; opened from another page, a Back chevron before the
crumbs returns there. The page keeps the model's two relationships apart
([README.md](README.md#the-model)): **Stores** (sqlite Stores pushed to its disk,
PostgreSQL Stores it reaches) and **Sandboxes** (from any Store: a PostgreSQL Store's projects can
run on any machine that supports them).
Opens from: the Machines item in the sidebar (the board), or a machine link elsewhere (a Storage
Store's machine, a Sandbox tile's machine, a project's machine chip: `go.machine(name)`), which opens
that machine's page (the tab's `focus` is `machine:<name>`).
Source: `src/renderer/src/components/compute/compute-page.tsx` (main file, still exported as
`ComputePage`; others named in Regions).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| Machines                                          [Simulate v]  [+ New machine]  [ Refresh ] |
+-----------------------------------------------------------------------------------------------+
  3 running . 1 stopped . 4 Sandboxes . 6 Workspaces . * 1 needs you . 1 operation in flight  [2]
+-[3] Notice ------------------------------------------------------------------------------------+
| (!) gpu-box: unresolved machine.connect                                              [ Show ] |
|     see layerfs machine status gpu-box · clear: layerfs machine disconnect gpu-box            |
+-----------------------------------------------------------------------------------------------+
+-[4] card (red ring) ---------+ +-[4] card -------------------+ +-[4] card -------------------+
| [=] gpu-box            [...] | | (A) native            [...] | | (L) dev               [...] |
|     SSH · host's own         | |     Native · this Mac       | |     Lima · 4 CPU · 8 GiB    |
| [] No Sandboxes              | | [] 2 Sandboxes · 3 Wksp     | | [] 1 Sandbox · 2 Workspaces |
| [s] models 41.5 GB ->        | | * 1 chat working            | | [s] agents 6.8 GB ->        |
|                              | | [s] shop 2.4 GB ->          | | [====------] 31.2 GiB free  |
|------------------------------| |-----------------------------| |-----------------------------|
| (Unresolved) ssh: timed out  | | (Running)                   | | (Running)            [Stop] |
+------------------------------+ +-----------------------------+ +-----------------------------+
+ - - - - - - - - - - - - - - -+
|  [+] New machine         [5] |
|  Lima, Apple container, ...  |
+ - - - - - - - - - - - - - - -+
  Machine power is manual: a machine runs between Start and Stop ...                         [6]
```

A machine's page:

```text
< Machines / dev                      (Back only when opened from another page)
(L) dev   Lima   (Running)                                                    [Stop]  [...]
    4 CPU · 8 GiB · 40 GiB · limactl version 2.0.1 · default image sha256:5a3b1e0c9d7f…
    [=====-----] 31.2 GiB free of 40 GiB
DATA ITS SANDBOXES CAN USE                                                              [8]
+-[SQLite] pushed to this disk      1 -+-[PostgreSQL] reachable from its Sandboxes  1 -------+
|  [s] agents                  6.8 GB |  [s] pg                                              |
|      crawler · evals · indexer      |      * app                                           |
+-------------------------------------+------------------------------------------------------+
SANDBOXES   3 Sandboxes · 4 Workspaces                                                  [9]
+-[box] Sandbox 4  [A] crawler [s agents]                                (Running) [...] -+
|       (o) sha256:9c1f7d3e5b2a…  custom                                                  |
|-----------------------------------------------------------------------------------------|
| v 3 Workspaces                                                     [===---------] 3 of 16 |
| +- 4:/workspaces/1 [Close] + +- 4:/workspaces/2 [Close] + +- 4:/workspaces/3 [Close] +   |
| | ⑂ onboarding            | | ⑂ cache-warm            | | ⑂ docs-pass             |    |
| | [chat] Rework onb… idle | | [chat] Warm the… idle   | | [chat] Proofread * work |    |
| +-------------------------+ +-------------------------+ +-------------------------+    |
+-----------------------------------------------------------------------------------------+
+-[box] Sandbox 5  [A] indexer [s agents]   (o) sha256:5a3b… machine default  (Creating) -+
| No Workspace mounted                                               [------------] 0 of 16 |
+-----------------------------------------------------------------------------------------+
DETAILS                                                                                [10]
+-----------------------------------------------------------------------------------------+
| Platform  Lima     Tool  limactl version 2.0.1     CPUs 4    Memory 8 GiB    Disk 40 GiB |
| Free disk 31.2 GiB    Sandbox image sha256:5a3b…      Nested  Can host Firecracker ...  |
|-----------------------------------------------------------------------------------------|
| Danger zone   [Remove dev…]   In use: holds 1 Store. Pull it to native first.           |
+-----------------------------------------------------------------------------------------+
```

## Regions

1. **Page header** (sticky, opaque once scrolled): the title, **New machine** (opens Add a machine)
   and **Refresh**. Dev builds put the simulation picker first.
2. **Facts line**: running, stopped, creating or removing (when any), unknown (when any), Sandboxes,
   Workspaces (the sum of `sandbox.list`'s counts), in red how many need you (failed, missing or
   unresolved), and operations in flight on machines, Stores and Sandboxes.
3. **Notices**: one danger notice per machine that needs you: "<machine> is failed/missing", or
   "<machine>: unresolved <operation>" with "see `layerfs machine status <m>` · clear:
   `layerfs machine remove <m>`" (`disconnect` for ssh). It gives LayerFS's reason, how many of its
   Stores wait on it, and **Show**, which opens its page.
4. **Machine cards** (`MachineTile`, `compute/machine-card.tsx`): a grid of glass cards, at least
   17.5 rem wide (one column in a narrow window). Order: machines that need you, then those creating
   or removing, running, stopped and unknown; native and docker first within each, then by name. A
   machine that needs you (failed, missing, unresolved) gets a red ring; a stopped one that holds
   Stores an amber one. The whole card opens the machine's page (its name is the link, stretched
   over the card; its own controls sit above it).
   - **Head**: the platform mark, the name and the `...` menu; under the name the platform's name and
     the size: a VM's `CPU · memory · disk · N free`; native "this Mac" (this PC, this host); docker
     "Docker's VM · N GiB free" ("this host's Docker" on Linux); ssh "host's own".
   - **Body**: its Sandboxes and Workspaces ("No Sandboxes"; native on Windows "Records only"), how
     many chats work in its Sandboxes (a live dot), the sqlite Stores it holds (up to three link
     chips with their size, opening their card on Storage, then "+N more"; "No Stores"), and a disk
     bar with "N free" when its disk and free space are known (amber past 75 %, red past 90 %).
   - **Footer**: the state (`StateChip`: the SDK's state, or an operation's name and phase), LayerFS's
     reason or a refused action's words, and **Start** or **Stop** (not native; only while running
     or stopped): `machine.start` waits until its worker answers; `machine.stop` is refused `InUse`
     while Sandboxes run, the refusal listing them.
   - **The `...` menu** (shared with the page): Open (on the board), Start or Stop, the built-ins'
     **Update settings…** (a dialog: Sandbox image; docker also its socket and, on Windows, its WSL
     distribution: `machine.update`) and "Built in · can't be removed"; a VM's **Remove…** or an ssh
     host's **Disconnect…**, each confirmed in a dialog. While it holds Stores or Sandboxes the item
     is disabled with the reason under it ("In use: holds 1 Store. Pull it to native first.");
     LayerFS refuses `InUse` too, with what is in the way.
5. **New machine card**: a dashed last card, "New machine" with the kinds this host can add now; it
   opens Add a machine like the header's button.
6. **Footnote**: "Machine power is manual: a machine runs between Start and Stop, and nothing starts
   or stops one by itself. Reading this page starts nothing."
7. **Machine page header** (`MachinePage`, `compute/machine-page.tsx`): the crumbs `Machines /
   <name>` (`tabs/crumbs.tsx`; Machines returns to the board, rewinding when the board is where the
   tab came from), after a Back chevron when the page was opened from another page (it names that
   page and returns there: a project, a Store), then the platform mark, the name, the
   platform's name and the state; the size, the tool's version and its default Sandbox image
   ("default image <digest cut to 12 hex>" or an archive's file name; the whole value in its title);
   a disk bar ("N free of M") when known; **Start** or **Stop** and the menu. Under it, when it
   needs you or an action was refused: LayerFS's reason, an unresolved machine's status and clearing
   calls, how many Stores wait on it, and the refusal. A machine that is gone: "No machine named
   <name>" with the back link.
8. **Stores** (`MachineData`, `compute/machine-data.tsx`): the title, then a segmented tab control
   (**SQLite N** · **PostgreSQL N**) and, at the row's end, the chosen family's note; under it one
   glass panel with that family's Stores as a grid of small tiles (at least 12 rem wide: about four
   across, two in a narrow window). A tile is the Store's name (opens its page on Storage) and size,
   then its projects' names, each opening the project; while a job this window knows moves it off
   (or onto) the machine, a thin bar and "pulling…" (`JobChip`, `storage/job-progress.tsx`). The tabs open on SQLite unless it has none
   and PostgreSQL has some; the choice is not remembered.
   - **SQLite · pushed to this disk**: each sqlite Store whose file is on the machine. Empty: "No
     Store files here. Push one here from Storage."
   - **PostgreSQL · reachable from its Sandboxes**: when `supports.postgresql_sandbox` is true,
     every PostgreSQL Store the home has connected (they are on no machine), shown the same way
     without a size; none: "No PostgreSQL Store connected. Connect one from Storage." When false,
     LayerFS's `supports.reason` (else "This machine does not run PostgreSQL Sandboxes") and no
     count on its tab; when `supports` is missing, "This LayerFS does not say whether Sandboxes
     here reach PostgreSQL."
   - A project with a Sandbox on this machine has a green dot ("<project> runs here"). Nothing here
     pushes, pulls, moves or connects a Store.
9. **Sandboxes** (`MachineSandboxes`, `compute/machine-sandboxes.tsx`), the page's main part, with
   "N Sandboxes · M Workspaces": a grid of compact glass cards (at least 19 rem wide: three across
   at 1280 px, one in a narrow window; the cards in a row share its height), ordered by project
   key (those with no project last), then by name. Empty: "Nothing runs here. A project's Sandboxes tab
   starts one on any machine." (native on Windows: it keeps records only; Sandboxes run on docker).
   - **Head**: the Sandbox mark, "Sandbox <name>" (its backend · route in the title), the state
     chip and the `...` menu on one line; under it its project (opens the project's Sandboxes tab;
     "No project" without one) and its Store chip (opens the Store); under them its **image**:
     `sandbox.list`'s `image` cut like the header's, tagged "machine default" when it equals the
     machine's image or "custom" when it differs (no tag when the machine names none); a native
     Sandbox without one says "No image · host processes", any other "Image not reported". The
     state chip shows any operation; the menu has Open project and **Close Sandbox** (a refused
     close offers **Force close**, which names the Workspaces of unknown state, both shown under
     the head); an unresolved Sandbox's status and clearing call.
   - **Foot**: **N Workspaces** with a chevron, which shows or hides them ("No Workspace mounted"
     with none, no toggle), and a bar of how full it is with "n of 16" (amber past 12, red at 16;
     it shimmers while a running Sandbox has Workspaces). Cards with Workspaces start open while
     the machine has at most twelve such (each open card reads `sandbox.get`).
   - **Opened**, it reads `sandbox.get`: a refused read's words, or its Workspaces as rows (the
     first four, then "Show N more" / "Show fewer"). Each row is two fixed-height lines: the path
     (and name; the whole `<sandbox>:<path>` handle in its title), then the Branch in a fixed column
     so it lines up down the card, and a **Close** × shown on hover or focus (`workspace.unmount`,
     keeping what is not committed; one a chat uses asks "Close anyway" first; a refusal shows
     under the row); then **Used by**.
   - **Used by**: the chats (`useChatSessions`) whose `workspace` names this Sandbox and the
     Workspace's path (or its handle), not closed: the chat's title (a scenario chat's
     scenario title, with a people mark), "working" with a live dot while it or its child agents run
     (`chatLive`), else "idle"; clicking opens the chat (`onOpenChat`). None: "— not used by a chat"
     (an orphan Workspace).
10. **Details**: the facts (Platform, Tool, CPUs, Memory, Disk, Free disk, Sandbox image, OS image,
    Lima host, Nested, SSH host, Data root, Identity, Docker socket, WSL distribution, how Sandboxes
    run); the built-ins' **Update settings…** and "Built in · can't be removed", or the **Danger
    zone**: **Remove <name>…** or **Disconnect <name>…**, disabled with the reason while it holds
    anything. A machine removed from its page returns to the board.
11. **Add a machine** (`AddMachineDialog`, `compute/add-machine.tsx`), a dialog: one row per platform
   `machine.platforms` lists as created or connected, in its order: the platform, a short blurb (else
   LayerFS's description) and its tool's version, or what it is missing in warning colour
   (`tool:msb` is "msb not found", `bundle:<folder>` "Needs the LayerFS Linux bundle",
   `host:apple-m3` and `host:macos15` the nested-virtualization needs, and the other `host:` needs).
   The button is **Create** (VMs) or **Connect** (ssh).
   - A missing tool's button is **How to install**, a missing Linux bundle's **How to get it**, each
     with lines to copy and "Then press Refresh." A hardware or OS need has no button.
   - Forms open in their row and show only the fields the platform declares in `options`; anything
     else is not sent (the host refuses it `InvalidInput`). They check themselves on submit; each
     error sits under its field. A refused create shows the whole refusal.
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
   - A machine made closes the dialog and opens its page.

## States

- **Loading**: "Reading the machines"; `LoadError` ("the machines") with Retry.
- **Unavailable**: Connect links a LayerFS with no machines (1.x): "Machines come with LayerFS 2.0",
  naming the linked version, and nothing else.
- **Machine states** (`data/states.ts`): Running (success; native's `ready` reads Running), Stopped
  (neutral), Creating and Removing (warning, pulsing), Failed, Missing and Unresolved (danger; they
  need you), Unknown (dashed).
- **Sandbox states**: Creating, Running, Closing, Gone, Unresolved, Unknown.
- **Workspace reads**: reading, refused (the SDK's words), none mounted, or the list.
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
- `postgresql`: `store.list()` items of kind `postgresql` (`{ name, projects, names, state, op }`).
- `sandboxes`: `sandbox.list()` items (`{ name, machine, project, workspaces, state, op, backend,
  route, image }`).
- `status`: `machine.status(name)` only for machines that run or hold or lost an operation: `{ state,
  freeDisk, toolVersion, down, op }`.
- Chats: `GET /api/agent/sessions` (`useChatSessions`, kept current from `chat` events); each
  `workspace` is `{ branch, sandbox, path, state, … }`.

Actions: `POST /api/machines` (`machine.create(name, platform, options)`, or with `platform: 'ssh'`
`machine.connect(name, host, options)`, the declared options only), `DELETE /api/machines/:name`
(`machine.remove`, or `machine.disconnect` for an ssh host), `POST /api/machines/:name/start|stop`,
`POST /api/machines/:name/update` (`machine.update`), `GET /api/sandboxes/:name` (`sandbox.get`),
`DELETE /api/sandboxes/:name?force=1` (`sandbox.close`) and `DELETE /api/workspaces/:ws`
(`workspace.unmount`). The page polls the list calls every 5 s while shown.

## Simulation

- `src/renderer/src/data/compute-sim.ts`: each case is a `MachinesView` in the shape `host/machines.js`
  builds, with each Sandbox's Workspaces and sample chats on most of them (every fourth Workspace is
  an orphan; one chat is a scenario's), PostgreSQL Stores (`mac-mixed`, `mac-nested`, `mac-busy`,
  `windows`), a machine that can't reach PostgreSQL (`scratch`; native on Windows) and Sandboxes made
  from their own image (`mac-mixed` Sandbox 4, `mac-nested` Sandbox 2). The page's actions (create, remove, Start, Stop, update,
  Close Sandbox, Close Workspace) work on a copy in memory, refused as LayerFS refuses them; Refresh
  puts the case back. Cases: `mac-fresh`, `mac-mixed`, `mac-nested`, `mac-busy`, `windows`, `older`.
- In dev builds the flask picker in the header (`components/simulation.tsx`) switches between the
  live host and the simulated ones. The choice is shared with Storage and Projects, which draw the
  same home (`data/home-sim.ts`), and remembered (localStorage `connect.simulate`); a "Simulated"
  chip says so. A simulated host never calls the live one.

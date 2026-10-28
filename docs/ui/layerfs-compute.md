# LayerFS: Compute

Where runs execute commands with their Workspace mounted: Docker today, Native and cloud Sandboxes
shown as not available yet, and Connect's settings. Opens from: the Compute tab on the LayerFS page.
Source: `src/renderer/src/components/compute/compute-page.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| LayerFS                                                                          [ Refresh ] |
| Where runs execute commands with their Workspace mounted. Docker is the one LayerFS has t... |
|  Projects   Storage   Compute                                                                |
|                       =======                                                                |
+----------------------------------------------------------------------------------------------+
THIS MACHINE
macOS - arm64
+-[2] DockerCard ------------------------------------------------------------------------------+
| Docker  Default  Engine 29.5.2                                                               |
| Each run's Workspaces mount in Sandbox containers - Local SQLite                             |
| -------------------------------------------------------------------------------------------- |
| Socket                Worker                  Free for volumes     Sandbox image             |
| /var/run/docker.sock  lfc-worker  * running   111 GB               sha256:afa1ef9c2729...    |
| Worker build build-linux-36b152f9c0374becb0e9dccada126659                                    |
| -------------------------------------------------------------------------------------------- |
| Sandboxes   1 running   2 Workspaces mounted                         [==------] 2 / 32 slots |
| +-[3] SandboxList -------------------------------------------------------------------------+ |
| |    SANDBOX                    STATE       WORKSPACES      IMAGE                          | |
| | ---------------------------------------------------------------------------------------- | |
| | /\ heavy-check - 2                                                                       | |
| | v  lfc-heavy-check-s1         * Running   [==--] 2 / 16   sha256:afa1ef9c2729...         | |
| |      Sandbox s1                                                                          | |
| |      /crew_2                  ---- crew_2.work.5                                         | |
| |      /depot_2                 ---- depot_2.main                                          | |
| | >  lfc-heavy-check-s2         Exited      [----] 0 / 16   sha256:afa1ef9c2729...         | |
| | ...                                                                                      | |
| +------------------------------------------------------------------------------------------+ |
| -------------------------------------------------------------------------------------------- |
| i On this machine the LayerFS box (the worker) also runs in Docker, beside the Sandboxes.    |
+----------------------------------------------------------------------------------------------+
+-[4] NativeCard ------------------------------------------------------------------------------+
| Native - macOS   Not available yet                                                           |
| Mount on this machine and run commands without a container - Local SQLite                    |
| -------------------------------------------------------------------------------------------- |
| Detected                     Mount driver                 LayerFS                            |
| macOS - arm64                x macFUSE or FSKit           LayerFS has no macOS mount back... |
| -------------------------------------------------------------------------------------------- |
| ! Agent commands would run as you, with your files and network, and no container in between. |
+----------------------------------------------------------------------------------------------+

CLOUD SANDBOXES
They can't open a local SQLite file, so they wait on PostgreSQL storage too.
+-[5] CloudCards -----------------------------+  +---------------------------------------------+
| Modal   Not available yet                   |  | E2B   Not available yet                     |
| Sandboxes on Modal                          |  | Firecracker microVMs                        |
|                                             |  |                                             |
| PostgreSQL only                 [ Connect ] |  | PostgreSQL only                 [ Connect ] |
+---------------------------------------------+  +---------------------------------------------+
+---------------------------------------------+  +---------------------------------------------+
| Daytona   Not available yet                 |  | AWS   Not available yet                     |
| Dev environments as a service               |  | Fargate tasks in your AWS account           |
|                                             |  |                                             |
| PostgreSQL only                 [ Connect ] |  | PostgreSQL only                 [ Connect ] |
+---------------------------------------------+  +---------------------------------------------+

SETTINGS
Read only here. Edit <state>/settings.json and restart Connect.
+-[6] Settings --------------------------------------------------------------------------------+
| Settings file    <state>/settings.json                                                       |
| LayerFS home     /Users/yifanxu/.layerfs-connect/home                                        |
| Sandbox image    sha256:afa1ef9c2729...                                                      |
| LayerFS bundle   <bundle path>                                                               |
| Docker socket    /var/run/docker.sock                                                        |
| Name prefix      lfc-                                                                        |
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **Page header** (`PageHeader` in `ComputePage`, `compute/compute-page.tsx`): "LayerFS", a one-line description and the tab row (`LayerFSTabs`, see [layerfs-projects.md](layerfs-projects.md)). Refresh rereads the status and every project's Sandboxes. Under it, the "This machine" heading names the OS and architecture.
2. **Docker** (`DockerCard`, `compute/docker-card.tsx`): the default target, with the Default chip and the engine version. A dot pulses on the mark while the engine answers.
   - Socket, Worker (its container and state chip), Free for volumes and Sandbox image, then the worker's build.
   - The Sandboxes summary: running count, Workspaces mounted, and a slots bar (16 per open Sandbox).
   - A footnote, on macOS and Windows only, says the LayerFS box runs in Docker too.
3. **Sandboxes table** (`SandboxList`, `compute/sandbox-list.tsx`): the Sandboxes grouped by project, with columns Sandbox, State, Workspaces (a capacity bar, n / 16) and Image. A row with Workspaces opens to list each mounted path and its Branch; rows with Workspaces start open. A running row has a breathing edge.
4. **Native** (`NativeCard`, `compute/native-card.tsx`): a dashed "not yet" card for this machine's OS: Detected, Mount driver (a check or x for whether it is found) and why LayerFS cannot mount yet. A warning line says agent commands would run as you, with no container.
5. **Cloud sandboxes** (`CloudCards`, `compute/cloud-cards.tsx`): under their heading and note, a 2x2 grid of dashed cards for Modal, E2B, Daytona and AWS. Each card has a blurb and "PostgreSQL only". Its Connect button is disabled, and its tooltip (`Unavailable`) says it needs PostgreSQL storage and LayerFS support (#446).
6. **Settings** (`Setting` in `ComputePage`, `compute/compute-page.tsx`): read-only rows for Settings file, LayerFS home, Sandbox image, LayerFS bundle, Docker socket and Name prefix. An unset value reads "not set". A "Still missing" row lists missing settings, when there are any.

## States

- **Loading**: "Asking Docker and the worker..." (`Loading`) in place of every section; `LoadError` ("the compute status") with Retry on failure.
- **Sandboxes loading**: "Reading each project's Sandboxes..." inside the Docker card (the screenshot shows this). A failed read shows `LoadError` ("the Sandboxes") under the card, and a warning line names projects whose Sandboxes could not be read.
- **No Sandboxes**: a dashed box: "No Sandboxes. A run starts one when its first command mounts a Workspace."
- **Docker not reachable**: a "Not reachable" chip and a red line with the error, "Runs, Init and Sandboxes need Docker running."
- **Worker and disk**: on Linux there is no worker, so Worker reads "Store access: In process". A worker error shows as a red line. Free space under 20 GB reads "low"; an unset image reads "not set".
- **Sandbox states**: Running (live), Starting, Restarting, Exited, Dead, Gone. The chevron is disabled when no Workspace is mounted.

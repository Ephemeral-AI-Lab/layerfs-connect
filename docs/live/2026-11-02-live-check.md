# Live check: Connect on LayerFS 2.0 (step 11)

> **Status:** Receipt, 2026-11-02. Connect at step 10 of the port (`55c28e1`) on LayerFS
> `0b8ae8af5f` (addon, CLI and macOS daemon from `e9c0e793d3`; sealed Linux bundle 2.0.0
> linux-aarch64, image `sha256:afa1ef9c…` saved as `sha256:1d91885d…`). macOS on Apple silicon, one
> fresh 2.0 home in a throwaway Connect state folder (C1), Disposable Store profile. Calls went
> through the Connect host's HTTP API unless marked *CLI* (the native `layerfs`, as agents run it).
> The VM part is [the step-4 receipt](2026-11-02-compute.md).

## Native: Init, mount, exec, Commit

| Call | Result |
| --- | --- |
| `POST /api/stores { name: live }` | sqlite Store on native |
| `POST /api/projects { store: live, name: site, source }` | Init job `done` (host job table) |
| `POST /api/projects/live%2Fsite/sandboxes { name: live-native }` | `machine: native`, `runtime: native` (the recorded daemon) |
| *CLI* `branch fork`, `workspace mount`, `exec 'echo native > native.txt; uname -s'`, `commit` | exit 0, `Darwin`; `Committed` |
| `GET /api/projects/live%2Fsite/sandboxes` | `live-native` with 1 Workspace |
| *CLI* `unmount`; `DELETE /api/sandboxes/live-native` | `Unmounted`; `Closed` |
| `GET /api/projects/live%2Fsite/commits?branch=work` | `step: native` (a first Commit: changed paths hidden, §9 Q3) |

## Docker: a Sandbox after recording the image

| Call | Result |
| --- | --- |
| `GET /api/machines` | docker's record holds the O36 image (recorded in step 4) |
| Store `dock` with project `app`; `POST /api/stores/dock/move { machine: docker }` | job ends in phase `retire`, no error |
| `POST /api/projects/dock%2Fapp/sandboxes { name: live-docker }` | `machine: docker`, `runtime: docker` |
| *CLI* mount, `exec 'echo docker > docker.txt; uname -s -m'`, commit, unmount; close | exit 0, `Linux aarch64`; `Committed`; `Closed` |

## MinIO: back up, change, list, restore under a new name

A MinIO container made for this check, its key in an owner-only `file:` reference.

| Call | Result |
| --- | --- |
| `POST /api/buckets { name: minio, url, key: file:… }` (step 5) | connected; a URL password and a plain key were refused |
| `POST /api/stores/live/backup { bucket: minio }` | job: snapshot, upload |
| `GET /api/buckets/minio/files` | `live`: `current` |
| *CLI* `file write live/site work /changed.txt` | a new Commit |
| `GET /api/buckets/minio/files` | `live`: `store_changed` |
| `POST /api/buckets/minio/restore { store: live-restored, file: live }` | job: download, install; `live-restored` on native, idle |
| `GET /api/buckets/minio/files` | `live` for Store `live`: `store_changed`; for `live-restored`: `current` |
| *CLI* `file read live-restored/site work /native.txt` | `native` |

## One scenario run

`POST /api/demos/conflicts/runs { project }` (no background process):

- On `dock/app` (docker Sandboxes): **passed**, 14 of 14 steps. The two steps that expect a
  `Conflict` refusal exited 125. `main.landed`: "/conflicts_1 from conflicts_1.main is on main
  (fast-forward; Added)". The scope named the Branches `conflicts_1.*` and the Sandbox
  `conflicts_1.sb1`.
- On `live/site` (native macOS Sandboxes): failed at step 1. The scenario's `sed -i 's/…/…/' file`
  is GNU sed; a native macOS Sandbox runs BSD sed. This is about the scenario's content, not the
  port; tour and merge had a portable-sed fix for 1.1.0's `mac` Sandboxes, but both are blocked now.
- `expect` checks were reported as blocked: 2.0 writes no trace (§9 Q1).

## Not covered

- The app window itself: the routes the pages call were driven directly.
- PostgreSQL Stores (connect, Init, Sandboxes on native or docker).
- apple-container, firecracker and ssh machines; a scenario on a VM machine.
- Blocked scenarios (agents, sandbox, tour, depot, merge) and chat bash in a mounted Workspace.

## Clean-up

The MinIO container, the lima machine (step 4), every Sandbox and docker container this check
made, and the throwaway home were removed after this check. The containers, volumes and VMs that
were there before were not touched.

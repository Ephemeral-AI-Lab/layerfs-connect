# LayerFS Connect on LayerFS 2.0: integration spec

> **Status:** Ready, 2026-11-02. This is the work order for the Connect session that ports Connect to
> LayerFS 2.0. Its source is four read-only reviews of the LayerFS #533 branch against Connect's code,
> each checked by the parent session. Nothing here is built yet. The base is LayerFS
> `origin/layerfs_v2_0_0` at `0b8ae8af5f` (#533 complete; final product commit `e9c0e793d3`), checked
> out in the local worktree `../layerfs-issue533-v2` (branch `issue533-v2`, same commit).
>
> **In the repository from 2026-11-02.** This copy is the one the port follows and updates. Where
> it and the LayerFS source disagree, the source wins and this copy is corrected in the same commit.
>
> **LayerFS commit Connect links:** `0b8ae8af5f` (`origin/layerfs_v2_0_0`; product source as of
> `e9c0e793d3`).

## 1. Outcome

Connect runs on LayerFS 2.0 alone:

- one `layerfs` package and one LayerFS home;
- every page reads 2.0 calls;
- none of Connect's copies of LayerFS logic remain.

Features that 2.0 does not yet support are hidden behind one plain line, not faked, and each one is
filed as a LayerFS question (§9). A live check on this Mac passes, covering:

- native, docker and one VM;
- a Store move;
- a MinIO backup and restore;
- a project Init;
- a Sandbox exec and Commit;
- one scenario run.

## 2. Rules

- Work only in `~/Ephemeral-AI-Lab/layerfs-connect`. Never edit the layerfs repository; read it only.
  A 2.0 gap becomes a question in §9 for the owner, never a Connect workaround that copies LayerFS logic.
- Work on the branch `feat/connect-ui-polish` (owner, 2026-11-02), not a new branch. Its uncommitted
  polish work (the machines-based Compute page and the rest of the tree as found) is committed first
  as one baseline commit, without the stray screen recording and screenshot at the repository root.
- Only one writer: the "Connect UI polish" session must be idle; it makes no edits while this runs.
- Commit in small steps, one per item in §8. Push nothing and open no PR unless the owner asks.
- Bound every test command at 120 s; build first. No command over 2 minutes (5 in an extreme case).
- Use the Disposable Store profile only.
- Secrets never go in Connect's files as plain values (see §4).
- Do not restart dsh web on 3080 while an agent run is live.

## 3. The 2.0 model (what changed)

- **One home.** `LAYERFS_HOME` (plus the trace settings) is the only LayerFS setting. The home holds
  `layerfs.json`, `machine/`, `store/` (projects nested), `backup/`, `trace/` and `log/`.
  The old per-deployment settings (`LAYERFS_DOCKER/IMAGE/DAEMON/VOLUME/STORE_PATH/…`) are ignored.
- **Machines are compute.**
  - `native` and `docker` are built in. VM kinds (apple-container, microsandbox, lima, firecracker)
    are created; ssh hosts are connected.
  - A machine starts on the first call that needs it and stops after 10 idle minutes. There are no
    start/stop calls and no worker to manage.
- **Stores are history.**
  - A sqlite Store lives on exactly one machine and holds many projects. A PostgreSQL Store is a
    connected database and never moves.
  - Every project key is `<store>/<project>`; a bare name is refused.
- **A sqlite project's Sandboxes run on its Store's machine.** Running on another machine is
  `Unsupported`. PostgreSQL projects run on `native` or `docker`.
- **Data movement.**
  - `store.move(store, machine)`: an idle sqlite Store goes from any machine to any machine in one
    call, with the calling process relaying the bytes.
  - `backup.create`: snapshots a sqlite Store on its own machine; the bytes pass through the caller to
    an r2/minio bucket.
  - `backup.restore`: installs on `native` only.
  - `project.init`: only into an existing Store on `native`, or into a PostgreSQL Store. It never
    creates a Store.
- **Default Sandbox image (O36):** `layerfs-352-runtime:node24-https-apt-20261024`
  (`sha256:afa1ef9c…`).
  - VMs use one image per machine.
  - `docker` takes any digest per Sandbox, but the docker machine needs an image recorded
    (`machine.update("docker", {image})`) before its first Sandbox.

## 4. API facts for the port

- **Import and client.** Import with `import layerfs, { client, LayerFSError, table } from "layerfs"`
  (ESM, Node ≥ 20).
  - Construct once with `client({ home })`. There is no open/close and no per-project client
    (`LayerFS.open` is gone); every call names its project.
- **Async.** Every Node call is async and runs once on the libuv threadpool (4 threads by default).
  Long execs can starve it, so set `UV_THREADPOOL_SIZE` for the host. A call cannot be cancelled; a
  timeout only stops waiting.
- **Arguments.** Positionals follow `calls/table.rs` order, then one options object; an unknown option
  is `InvalidInput`.
- **Results are snake_case:** `exit_code`, `next_page_pos`, `has_more`, `base_layer`,
  `content_equal`, `forked_from`.
- **Paging.**
  - Input: `{page_size (1–1000, default 50), page_pos}`.
  - Output: `items` and `next_page_pos` (null at the end). `sandbox.list`, `sandbox.get` and
    `project.list` give no `has_more`.
- **Progress** is one stream (O22).
  - `on_progress(obj)` is available on `project.init`, `store.move`, `backup.create` and
    `backup.restore`.
  - The promise resolves after every event has been delivered. There is no job registry, so Connect
    keeps its own table of the calls it started.
  - `store.status` shows a move by another process (`state: moving`, `in_progress`).
- **Exec output** arrives when the command ends, never live.
  - Up to 1 MiB per stream comes back inline.
  - Above that, the output comes only through `stdout`/`stderr` functions or `stream: true`. Pass
    sinks, or the bytes are lost.
  - Node Writables are refused.
- **Errors.**
  - A refusal throws `LayerFSError{code, message, detail}`.
  - These codes survive from 1.1.0: `NoSuchProject`, `NoSuchStore`, `NoSuchBranch`, `NoSuchCommit`,
    `NoSuchSandbox`, `Binary`, `Busy`, `Unsupported`.
  - New codes: `NotFound`, `InUse`, `Unavailable`, `Denied`, `Failed`, `Unknown`. After `Unknown`,
    re-read the state.
  - `CODES` and `isRefusal` are not exported (see §9).
- **Secrets are references only (O1).**
  - Bucket keys: `env:LAYERFS_BUCKET_<NAME>` or `file:/abs/path`.
  - PostgreSQL password: `--password env:…|file:…`. A URL that contains a password is refused.
  - Connect writes owner-only `file:` references under its state folder and passes the reference,
    never the value.
- **Folder scope (O32)** is a guard, not a translator.
  - Paths must already be under the folder. Branches compose as `<ns>.<name>`, and `publish` goes to
    the project's real `main`.
  - Sandbox, commit and Store calls are refused.
- **The command line** is the native `layerfs` binary (`engine/crates/layerfs-cli`), with exit codes
  0/2/125 and `--stream`, `--progress` and `--scope*`.

## 5. Link and build setup

- **Package.** In `package.json`, replace the four `@layerfs/*` links with
  `"layerfs": "link:../layerfs-issue533-v2/api/node"`. Do not copy a `.node` file; the package finds
  the crate-side addon through the link's real path.
- **Builds in the 2.0 worktree** (ask the owner or the LayerFS session if one is missing; don't
  build LayerFS from Connect):
  - the napi addon (`engine/crates/layerfs-node/layerfs.node`, present);
  - `target/debug/layerfs` for agents' shells (present);
  - the sealed Linux bundle in `~/.cache/layerfs/bundle/2.0.0/linux-aarch64/` (present, with the
    O36 image);
  - the macOS native daemon: 2.0 takes the native machine record's `daemon` path, else
    `~/.cache/layerfs/bundle/2.0.0/macos-aarch64/layerfs-daemon` (`family/deploy.rs::daemon`). That
    bundle folder does not exist; a debug build is at `target/debug/layerfs-daemon` in the 2.0
    worktree (built 12:59 from `e9c0e793d3`). Record that path on the fresh home's native machine.
    Do not build LayerFS yourself.
    - *Corrected from source:* `machine.update` takes `cpus, memory, image, docker, wsl`, not
      `daemon` (`calls/table.rs`). The native record's `daemon` is written by `layerfs import-env`
      from `LAYERFS_DAEMON` (`home/import_env.rs`, read back by `family/deploy.rs::daemon`). Connect
      records it once on a fresh home by running the CLI's `import-env` with only `LAYERFS_HOME` and
      `LAYERFS_DAEMON` set.
  - All three outputs (addon, CLI, daemon) are from `e9c0e793d3` and match `0b8ae8af5f`'s source.
    Don't remove or move the 2.0 worktree; if it changes commit, stop and ask.
- **Finding the CLI binary.** Connect needs a dev setting for the CLI binary's path: the 1.1.0 `API`
  path is gone, and the build target may be worktree-private.

## 6. Home and migration

- **What Connect keeps:** `LAYERFS_CONNECT_STATE` (`<state>`: runs, `host.json`, agent state), and
  `<state>/home` as the LayerFS home, passed to `client({ home })` and to agents as `LAYERFS_HOME`.
- **What Connect drops:**
  - every other `settings.json` key and its `LAYERFS_CONNECT_*` mirror;
  - `deploymentEnv`, `layerfsEnv`, `withProjectEnv`;
  - `isVm`, `isHostHome`, `hostProjects`, `hostStatus`, `hostStorePath`;
  - `missing()`, `runtimeSettings`, `VOLUMES`, `STORE_PATH`;
  - bare-name and `shared` key handling;
  - the `lfc-` prefix (container names carry the home id, O33).
- **Converting an existing home.** The first 2.0 call converts a 1.1.0 home in place, keeping the old
  files under `log/1.1.0/`. Then run `layerfs import-env` once, with only these mappings:
  `image→LAYERFS_IMAGE`, `docker→LAYERFS_DOCKER`, `placement/sandbox→LAYERFS_SANDBOX`.
  Do **not** map `daemon` on macOS: Connect's `daemon` is the Linux daemon.
- **Gaps in conversion:**
  - On macOS, Stores in Docker Desktop volumes (`lfc-*`) are **not placed**. The converter reads
    volumes only at `/var/lib/docker/volumes`, which is Linux (`home/place.rs`).
  - Host-home files under `<state>/stores/` have no import path.
  - PostgreSQL Stores need `store.connect` again with a password reference.
  - **Owner decision C1 (decided 2026-11-02): fresh 2.0 home.** Start a new home at `<state>/home`
    and re-Init each project from its folder. Keep the old state folder read-only; do not convert it.
- **Old records.** Chats and run records hold bare project keys and numbered Sandboxes. Migrate the
  keys to `<store>/<project>` (a 1.1.0 project with its own Store becomes `p/p`), or mark old records
  read-only.

## 7. Call map (condensed)

| Area | Connect today (1.1.0) | 2.0 |
| --- | --- | --- |
| Runtime | `LayerFSRuntime.open`, `runtime.status()`, `worker.start`, `vm.status` | `client({home})`; `machine.list()` (`machines`, `can_create`), `machine.status(name)`; nothing to start |
| Projects | `start_init` + `get_init`, `project.list()`, `project.delete` | `store.create` (if needed), `await project.init(p, dir, {timeout, on_progress})`; `project.list([store], paging)`; `project.remove(p)` (`InUse` while any Sandbox record exists; `Unsupported` for PostgreSQL) |
| Branches | `list_branches`, `branch.fork(name, from)`, `merge(a,b,name,msg)`, `publish(b)` | `branch.list(p, paging)`; `branch.fork(p, name, from_branch, [from_commit])`; `branch.merge(p, name, a, b, {message})`; `branch.publish(p, b, [commit])` |
| Commits | `list_commits`, `diff_commits` | `commit.list(p, b, paging)`; `commit.diff(p, from, to, {paths_only, cursor})` |
| Files | `fs.list/stat/read/write/rm/apply/diff_files` | `file.list/stat/read/write/rm/apply/diff(p, branch, …, [commit])` (O13, O29) |
| Sandboxes | `sandbox.create({platform})`, `list_sandboxes`, `list_workspaces`, `close(id)`, docker stop + `clean_leftovers` | `sandbox.create(p, name, machine, {image})` (name unique in the home; machine = `project.get(p).machine` for sqlite); `sandbox.list(p)`; `sandbox.get(name).workspaces`; `sandbox.close(name, {force})` |
| Workspaces | `mount → {sandbox,path}`, `exec(ws,cmd,msg,{stdout})`, `commit(ws,msg,force)`, `unmount(ws,discard,force)`, `daemon.workspace.status` | `mount(name, branch) → {ws:"name:/path"}`; `exec(ws, cmd, {message, stream, stdout, stderr})`; `commit(ws, {message, force})`; `unmount(ws, {discard, force})`; `workspace.status(ws)` → `base_layer` |
| Storage | `store.list/create/remove`, `remote.add/remove/list/list_stores`, `store.check`, `start_publish/push/send/pull/load`, `store.unlink`, `postgresql.status`, `start_import_postgresql`, `sync.get`, `docker exec stat` | `store.list/create/remove/status/move`; `backup.connect/disconnect/list/create/restore`; `store.connect/disconnect` for PostgreSQL; `on_progress` on the call; `store.status(s).file.{bytes, wal_bytes}` |
| Dropped, no replacement (O25) | `daemon.process.start/list/cancel`, `get_history` (Layers), `get_storage`, `get_comparable`, `remote.list`, `remote.providers`, push `force`, per-Store `unlink`, the PostgreSQL import | see §9 |

## 8. Work steps (in order; one or more commits each)

1. **Baseline.** Run the existing typecheck and tests on the polish work as found, record the result,
   and commit it as one baseline commit on `feat/connect-ui-polish` (failures are noted in the
   message, not fixed here). Then copy this spec into `docs/layerfs-2.0-integration.md` and record
   the LayerFS commit Connect links (`0b8ae8af5f`) there, in one docs commit.
2. **Link and client.**
   - Link `layerfs` (§5) and make one client in `host/main.js`.
   - Delete `openRuntime`, `ensureWorker`, `startWorker`, `startVms`, `POST /api/worker/start`,
     `HostStatus.worker` and the "starting" state. The old ensureWorker exception for a 1.1.0 macOS
     home goes too.
   - Settings come down to `<state>` and the home (§6).
   - Done: the host starts against a 2.0 home, and `/api/status` answers.
3. **Host service.**
   - Port `projects.js`, `history.js`, `tree.js`, `folder.js` and `runs/run.js` to the §7 calls, with
     paging loops and snake_case.
   - Remove the `docker exec` stat reads, the container join (`sandboxTag`, `containersOf`) and the
     Docker fallback.
   - Init keeps a Connect job table fed by `on_progress`.
   - Done: the project list, branches, commits, file browser and diffs work on a 2.0 home.
4. **Compute live.** `host/machines.js` already targets 2.0. Verify it live, including create/remove
   on a VM and the "Move to…" link.
5. **Storage.** Rebuild the page on the 2.0 model:
   - **Stores by machine:** one group per machine. Each Store row shows its projects, size, status
     (idle, in use, moving, down) and backup chips. Actions: Move to…, Back up to…, Add project
     (native only), Remove.
   - **PostgreSQL Stores:** Connect… takes a URL without a password plus a password reference;
     Disconnect.
   - **Buckets and backups:**
     - Connect… takes a URL plus a key reference. Disconnect warns that it drops every Store's link to
       that bucket.
     - The file table comes from `backup.list(bucket)`, one call per bucket, with the seven states:
       current, store_changed, bucket_changed, both_changed, unknown, unlinked, missing.
     - Restore always says "installs on native".
   - **Progress:** one list of the calls this host started (move, backup create, backup restore),
     showing phase and done/total where present. A failure shows its phase. An `Unknown` failure says
     both copies were kept.
   - **Remove:** push/publish/send/pull/load as separate verbs, the push-conflict Overwrite, the
     PostgreSQL import dialog and route, `JobSampler`, the `Checks` HEAD cache, the 10-state sync
     model, `reachAs`/`reachPostgresql`, and the s3/gcs/google-drive/folder providers. Plain secrets
     in `storage.json` become `file:` references.
6. **Projects and New project.**
   - New project: pick a Store on native (or make one with `store.create`) or a PostgreSQL Store, then
     Init with progress, then an optional "Move Store to…" that warns the whole Store moves.
   - Delete: lists the project's Sandboxes, offers "Close N Sandboxes and delete", and handles `InUse`.
7. **Sandboxes and Workspaces.**
   - New Sandbox goes on the project's Sandboxes tab: a prefilled unique name and an image. The
     machine is shown fixed for sqlite; PostgreSQL gets a native/docker choice.
   - Close offers a Force choice that lists any `unknown` Workspaces.
   - Store `ws` handles, not `{sandbox, path}`.
8. **Sessions and chat agents.**
   - Agents' shells get `LAYERFS_HOME` plus trace variables only, and the project key in a
     Connect-named variable.
   - The CLI shim runs the native binary.
   - Rewrite `agents/sdks.default.json` for the one package and the 57 calls.
   - Chat Sandboxes are named on the Store's machine.
   - Checkpoints use `workspace.status().base_layer`.
   - Chat bash in the background is BLOCKED (§9): keep foreground exec, and hide Stop and live output
     behind the gap line.
9. **Runs and scenarios.**
   - Port Connect's run-scope translator (`runs/scope.js`) as a JS wrapper around the `layerfs`
     client, with the 2.0 scope as the guard underneath. A native package leaves nothing to hook, so
     `resolve-layerfs.js` and `scope-platform.js` go.
   - `-platform` becomes `-machine <name>`, checked by `machine.list`. Because Sandboxes follow the
     Store, a run's project Store is moved to that machine.
   - Regenerate `scenarios/*/scenario.json`: `file.*`, positional project-first calls, named unique
     Sandboxes, and no `process.*` (scenarios that need background processes are marked blocked).
   - Update `tools/port-scenarios.mjs`.
   - The real platform test becomes one home with one machine per kind.
   - Runs that depend on trace lines (`expect` checks, live views) wait on the trace writer (§9 Q1).
10. **Docs and tests.**
    - Rewrite `docs/ui/layerfs-storage.md`, `dialog-new-project.md`, `project-sandboxes.md`,
      `host/README.md` (Deployment, Compute, Storage) and `scenarios/README.md`.
    - Retire `storage-links.md` and `storage-redesign.md` as history.
    - Tests: replace the 1.1.0 fakes with 2.0-shaped ones. Delete tests that are hard to adapt and
      list them in the commit.
11. **Live check** on this Mac, with a fresh 2.0 home (C1):
    - Init a project on native, mount, exec and Commit;
    - make a docker Sandbox after recording the docker image;
    - create a lima machine, move the Store there, run a Sandbox, move it back;
    - connect MinIO, back up, change, check `backup.list` states, restore under a new name;
    - run one scenario that needs no background process.

    Write receipts under `docs/` with no local paths.

## 9. 2.0 gaps blocking Connect features (questions for LayerFS, not workarounds)

1. **Trace writer.** O26 says `trace/` is the feed, but nothing writes trace files in 2.0 (the writer
   was in `@layerfs/agent`, and `host/trace.rs` has no callers). This blocks run `expect` checks, live
   views and `traces.js`. **Most urgent.**
2. **Background exec.** Start, list and cancel (or live output and cancel on `workspace.exec`), and a
   per-command timeout. This blocks chat bash and the tour, sandbox and agents scenarios.
3. **History reads.** A Layer list (main's Layers, ids, sources), and a Layer→Commit or comparable
   diff for a Branch's first Commit. Does `branch.fork` accept a Layer id as `from_commit`?
4. **Store totals.** logical, canonical, stored, metadata, dedupe, compression and Init stats for the
   Storage tab.
5. **Live Sandbox state** (running, exited, dead) in `sandbox.list` and `sandbox.get`, not the
   recorded state.
6. **Error exports.** `CODES` and `isRefusal` are not exported, though S §5.1 says they are kept.
7. **Buckets.**
   - a bucket listing that contacts no bucket;
   - a partial `backup.list` with per-bucket errors;
   - per-Store unlink;
   - "exported from" in `backup.list` items;
   - `unknown` state for every Store not on native (P1-14 deferred);
   - bytes in the backup progress.
8. **Moves.** Progress visible to other processes, cancelling, a copy between machines, restoring to a
   chosen machine, and `store.status` naming the blocking Sandboxes.
9. **Init.** Init into a sqlite Store not on native, the `on_progress` shape, and cancel.
10. **Migration.** Placing macOS Docker Desktop volume Stores, and importing a loose Store file.
11. **A sqlite Sandbox on another machine** than its Store's (Connect's per-chat platform choice).
12. **The scope.** Can a folder scope allow `sandbox.create` and `commit.list` for its own project, so
    scenario agents can run scoped?
13. **Packaging.** Where does the macOS native daemon come from, how is the O36 image published, and
    what default image does `docker` get?

## 10. Owner decisions

- **C1. Existing Connect home: decided (owner, 2026-11-02): a fresh 2.0 home with re-Init.**
- **C2. Blocked features until LayerFS answers §9:** hide them behind one line ("comes with a later
  LayerFS"), or keep the 1.1.0 path for them. Recommended: hide; keeping two LayerFS versions breaks
  the one-package rule.
- **C3. Runs:** port runs and scenarios now on the 2.0 calls with `expect` checks disabled, or wait
  for the trace writer. Recommended: port now and mark trace-based checks blocked.

## 11. Done when

- Steps 1–11 are committed on `feat/connect-ui-polish`.
- Typecheck, the full test suite (each command ≤ 120 s) and the build pass.
- The live check receipts exist.
- Every §9 item that blocks a shipped feature is hidden with its line and listed in a handoff.
- Nothing is pushed.

The handoff lists:

- each commit;
- the deleted tests;
- the §9 questions still open;
- the LayerFS commit Connect links.

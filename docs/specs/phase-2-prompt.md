# Phase 2 prompt: integrate LayerFS 2.0 into Connect through the CLI (layerfs-project#137)

> **Status:** Current work order for phase 2 of
> [layerfs-project#137](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/137),
> written 2026-11-09 after phase 1 was reviewed and verified.
> Phase 1 (LayerFS #138–#144) is merged and closed; this prompt does not reopen it.

## Assignment

Move Connect's host from the linked Node package to the LayerFS CLI and refine the
existing UI to match the CLI's actual behavior. Verify every slice. Close each
sub-issue with its evidence.

| Issue | Slice |
| --- | --- |
| [#145](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/145) | 1. Host CLI adapter and management reads |
| [#146](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/146) | 2. Store/Machine mutations, persisted jobs and recovery |
| [#147](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/147) | 3. Bind Sandbox and Workspace fields already returned by `sandbox get` |
| [#148](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/148) | 4. Mounted chat execution and cancellation |
| [#149](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/149) | 5. Pinned Files/History reads |
| [#150](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/150) | 6. Wire the existing Files/History previews |
| [#151](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/151) | 7. Doctor shared report panel and contextual actions |
| [#152](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/152) | 8. Store breakdown, Project statistics and full exec output |
| [#153](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/153) | Verify Connect end to end on a pinned LayerFS CLI |

**Repository:** `~/Ephemeral-AI-Lab/layerfs-connect`. The current UI is
`desktop/src/renderer/src/`; the root `src/renderer/` is the older app.

**LayerFS authority:** `origin/layerfs_v2_0_0` at or after
`833d04cf44e8e747929d50ab1170a48260d9381c` (merge of LayerFS PR #631). Read it
with `git -C ~/Ephemeral-AI-Lab/layerfs show origin/layerfs_v2_0_0:<path>`; never
switch or edit a LayerFS checkout. Source wins over documentation.

**Design:** this folder's [cli-integration.md](cli-integration.md) (command list,
adapter contract, folder layout, slices), [cli-ui-changes.md](cli-ui-changes.md)
(UI refinements and states), [connect-cli-obs-stat.md](connect-cli-obs-stat.md)
(field coverage) and [doctor/connect-integration.md](doctor/connect-integration.md).
Where this prompt and those documents differ, this prompt is newer: phase 1 made
several workarounds unnecessary (see below).

## Before any edit

1. Read `AGENTS.md`, this prompt, the four design documents and the nine issue
   bodies.
2. **Protect the existing working tree.** `main` carries about 150 uncommitted
   changes from other work, overlapping files this phase edits (`host/*.js`,
   `desktop/src/renderer/src/layerfs/*`, Sandbox and Files components).
   - Do not commit, revert, stash or reformat them on your own.
   - Ask the owner how to establish a baseline: commit it as one baseline commit,
     or have the owner commit it. Then create the phase-2 branch from that
     baseline.
   - If no baseline is possible, stop and report.
3. **Pin a CLI build.** Connect's default binary
   (`../layerfs-v2-merge/target/debug/layerfs`, `d4304741`) predates phase 1 and
   lacks most features below. Build or obtain a CLI and daemon from
   `layerfs_v2_0_0` ≥ `833d04cf44`, with the `postgresql` feature for PostgreSQL
   Stores.
   - Use the LayerFS worktree launcher in a worktree you own; never build in
     another session's checkout.
   - Record `layerfs --version --json` (`commit`, `dirty:false`, `features`).
   - Point Connect at the build through `LAYERFS_CONNECT_CLI`; never resolve
     `layerfs` from `PATH`.
4. Reuse the running web preview on port 1025 if it belongs to this checkout; never
   kill another session's process. Do not launch Electron unless the owner asks.

## What phase 1 changed for this work

All of the following were verified on LayerFS `c6fa2dfeb6` (tree-identical to the
merge) by black-box CLI probes on a fresh native macOS home and by the PR's tests.

| Capability | Use in Connect | Notes |
| --- | --- | --- |
| `layerfs --version --json` → `{version, commit, dirty, features}` | Binary identity and the incompatible-binary state | Plain `--version` is unchanged |
| `layerfs help --json` → `{calls[66], commands[], switches[]}` | The capability gate (replaces `-h` text probes), Doctor target discovery, and the call table for `host/runs/cli-shim.mjs`, `host/parse/` and `tools/sim-table.mjs` | Lets the Node package link be removed |
| `workspace exec <ws> <cmd> --exec-id <id> --events` | Mounted chat Bash (slice 4) and full output (slice 8 merges into 4) | NDJSON: `{progress}`, then `{stream,bytes}` frames, then exactly one `{result}` or `{refusal}`. Exit 0 for any command exit; 125 refusal; 2 usage. Output over 1 MiB and binary bytes (`{base64}`) arrive as frames. **The final `result` also repeats inline stdout/stderr (≤1 MiB) already sent as frames** (above 1 MiB it carries `stdout: null`, `*_bytes`, `streamed: true`): assemble output from frames only, and take status and sizes from `result`. Delivery is after completion, not live. Require both a final frame and process exit. |
| Pre-registration cancel | ChatDock Stop | `exec-cancel` before registration still answers `ended`, but leaves a 30 s mark; the exec then ends at spawn with `kind:"cancelled"` and 128 + signal (137 observed). The bounded re-send loop in cli-integration.md is no longer needed. Rules: mint a fresh id per launch (a mark left after a finished command would cancel a reused id within 30 s); `ended` while your exec process is alive means "will end at start"; `unknown` still needs a manual retry. Running cancel answered `cancelled`/`SIGTERM`, exit 143. |
| `store stats <name>` → `{name, kind, history_logical, canonical, stored, metadata, file, free, init}` | StoreBreakdown and project ratios (slice 8) | Store-wide, O(1). `history_logical` counts Commit **and** Layer records: observed 13 → 329 after one Commit and its publish (13 + 158 + 158), so it is never a dedupe numerator. `free` is null on PostgreSQL. **`init` was null after a 2.0 Init into an existing Store**, so the "from Init" pill stays hidden. |
| `project stats <store>/<project> [<branch>] [<commit>]` | Project Storage tab statistics (slice 8) | `{project, at{id,kind,branch,root}, files, directories, symlinks, others, logical, complete, reason?}`. Hard links count per path, symlinks are not followed, root is excluded. **`project` is the bare project name (`"p"`), not `<store>/<project>`**: key results by your request. A short or unknown id is `InvalidInput`. |
| `commit diff` accepts Layer↔Layer and Commit↔Layer endpoints | History changed paths for main publications and first Commits (slice 5) | Scalable plan with stateless `--cursor` paging across processes (verified 3 pages / 53 paths). Prefer it over pinned `branch diff` for changed paths. |
| `--continuation <token>` on `file revision` and pinned `branch diff` | Deep Revisions/comparison pages (slice 6) | Opaque `lfq1:` token bound to the pin, query and page size; a tampered or mismatched token is `InvalidInput`. Repeat the same pins and options; omit `--page` on resume. Per-request `Capacity` limits remain. |

**Unchanged contract** (still binding from cli-integration.md):
- exit classes;
- i64 values above 2^53;
- reads create a missing home;
- `env:` secret references resolved in the child;
- `LAYERFS_PROGRESS_JSON=1`;
- no `has_more` on `project list` / `sandbox list` / `sandbox get`;
- move phases and authority;
- no automatic replay;
- a killed CLI does not prove remote work stopped.

**Known LayerFS gaps to keep visible, not to fix here:**
- Doctor still has no progress or cancellation.
- `--stream` remains unsuitable for the host.
- Live-CLI failure injection at every move phase was NOT_RUN upstream.
- `layerfs-store-service` test `sdk_blame_coarse::lines_between_distant_edits_keep_their_origin` fails at base `ce0e00bef2` and at `833d04cf44` (pre-existing). Treat blame `comparison_coarse` as data, and file a LayerFS issue if Connect depends on it.

## Slice order and adjustments

1. **#145 adapter.** As specified, with `help --json` / `--version --json` as the
   capability gate. Add the fake simulator CLI (`host/sim/bin/layerfs.mjs`) emitting
   the phase-1 shapes above, so the web preview exercises the real adapter.
2. **#146 jobs.** Unchanged.
3. **#147 Sandbox bindings.** Unchanged. The removed Scratch/Activity/Diagnostics
   tabs, Workspace Files/patch views and sparklines stay removed.
4. **#148 exec and cancel.**
   - Use `--events` from the start. Drop the "N bytes not retained" fallback and
     the bounded re-send loop.
   - Keep: fresh ids, persisted `{ws, exec_id}` before spawn, never launching a
     queued command whose Stop is pending, and separate Commit refusal reporting.
   - The owner must still decide whether Stop should close the mounted chat's
     Sandbox.
5. **#149 Files/History reads.** Use `commit diff` with Layer endpoints and its
   cursor for every changed-paths view. Use pinned `branch diff` only where
   attribution is needed.
6. **#150 previews.** Use `--continuation` for Revisions and comparison pages;
   PageControls stays "Page N" with no total.
7. **#151 Doctor panel.** Gate each target on `help --json` `commands`. Doctor
   targets require a build ≥ `833d04cf44`; older builds exit 2.
8. **#152 statistics.** StoreBreakdown and Project statistics on `store stats` /
   `project stats` with the caveats above. The exec part is already done in slice 4.
9. **#153 end-to-end verification.** Remove the
   `"layerfs": "link:../layerfs-v2-merge/api/node"` dependency once the shim,
   parsers and `tools/sim-table.mjs` read `help --json`.

## Rules

- Follow `AGENTS.md`: web preview first, desktop sizes 1280×820 and 900×600,
  browser console checked, `pnpm --dir desktop -s typecheck` and
  `pnpm --dir desktop -s build` after renderer changes.
- Host tests: `node --test test/*.test.mjs` and the host tests under `host/test/`.
  Bound each test command at 120 s.
- Update the matching `docs/ui/*.md` spec and the design documents with each slice.
  Keep simulated evidence and real CLI evidence distinct.
- Disposable Store profile only. Real CLI checks use fresh, owned homes, and every
  Sandbox, mount and home you create is closed and removed afterwards. Never touch
  `~/.layerfs-connect` or another home.
- Secrets stay as owner-only `file:` references or inherited `env:` variables;
  never in argv, logs, traces or UI errors.
- No automatic retry or replay of a mutation. Recovery actions are explicit and
  gated on a fresh read.
- Do not restore removed placeholders for command coverage. Do not invent CLI
  commands or fields.

## Delivery and closing

1. One or more commits per slice on the phase-2 branch, each stating the slice,
   the checks run and their results.
2. Push and PR only if the owner asks; otherwise keep local commits.
3. Close each issue when its slice is committed and verified. The closing comment
   links the commit (or PR), lists the flows exercised in the web preview, the real
   CLI checks with the binary identity, and anything NOT_RUN.
4. #153 closes last, with receipts. Then tick #137's checklist and close #137 when
   every sub-issue is closed or explicitly declined.
5. Record the outcome in `docs/specs/phase-2-record.md`: commits, binary identity,
   verification, remaining gaps and follow-up LayerFS issues.

# Scripted project simulations

`/simulation --project <preset-project> --machine <machine> [--mixed[=true|false]]`

A simulation is an independent scripted agent workload. It executes real LayerFS
CLI calls and saves real project-bound conversations, without requesting model
responses. Existing preset content and its release DAG are the source recipes.
Each invocation creates one fresh Disposable SQLite Store and one newly tagged project. It
never resets the user's environment or modifies the reference preset Store.

## Generated package

The complete reviewable package is prepared under Connect's selected state root:

```text
simulations/<run-id>/
  manifest.json
  plan.json
  setup/
    plan.json
    source/                         # immutable preset import files
    scripts/initialize-project.sh
  conversations/
    c01-<topic>/
      conversation.json
      main/
        script.json
        scripts/<task-id>.sh
      subagents/
        a01-<role>/
          script.json
          scripts/<task-id>.sh
    c02-<topic>/...
  verification/expectations.json
  journal.jsonl
  resources.json
  sessions.json
```

`manifest.json` records arguments, run identity, source recipe version and file
hashes. `plan.json` contains the CLI operation DAG, task DAG, conversation profile,
resource ceilings and exact planned CLI counts. `script.json` describes requests,
delegation, waits, tool execution and receipt-backed reporting. Each agent uses the real `bash` tool with an explicit CLI command as its visible
command argument. Generated shell scripts also contain those CLI lines directly,
including stdin content and receipt-bound handle lookups. Bookkeeping helpers
reserve an attempt and confirm its receipt; they do not execute a whole task
behind a tool call. The shell bridge validates each invocation against the
immutable plan and routes it through the pinned CLI adapter and lifecycle gate.

`resources.json` records resources owned by this run, including resources retained
after errors. `sessions.json` maps conversation and child identities to the existing
saved chat records. Their transcripts remain in Connect's normal chat persistence;
there is no second transcript store. `journal.jsonl` is append-only execution
information. Runtime state changes never alter compiled workload definitions.

The standalone shell entry requires `SIMULATION_RUN_DIR`, `LAYERFS_CONNECT_CLI`
and `LAYERFS_HOME`. Each call writes an exclusive execution intent and a confirmed
receipt. Existing intent files prevent replay, including after uncertain outcomes.
The host runner also retains confirmed receipts in its run journal. An exclusive
`execution-owner.json` permanently selects the host or standalone executor.
Generated shells reject host-owned packages and packages whose status has moved
past Prepared, so they cannot replay a completed, interrupted or failed host run.
Standalone shells are an alternate entry, not a resume mechanism for host runs.
Run standalone scripts one at a time. The host `/simulation` runtime provides
concurrent agent scheduling and per-sandbox lifecycle admission.
Before setup, every immutable package file is checked against its manifest hash.

## Preparation and project binding

1. Read the selected machine and check its state before mutations.
2. Create a unique SQLite Store on Native.
3. Import `setup/source` into `<store>/<preset-project>-<run-tag>`.
4. Move the Store with `store push` when the selected machine is not Native.
5. Create saved conversations bound to that exact new Store/project.
6. Execute the preset's foundation and concurrent release history.
7. Verify actual saved files, branch graph, publications and workspace cleanup.

Repeated invocations have distinct Store names and project names. Independent runs
may execute concurrently; their shared machine capacity is scheduled separately
from their private agent sessions and resources.

Machine power remains explicit: simulation does not start a stopped machine or
create machines. Mixed sandbox creation uses the same selected machine as its
SQLite Store. Images come from the existing LayerFS provisioning; simulation does
not pull images. Completed runs retain their Store and conversations for browsing.
There is no automatic teardown of history at completion.

## Conversation and subagent allocation

| Project | Conversations | Distinct children per conversation |
| --- | ---: | ---: |
| design | 2 | 1–2 |
| billing | 3 | 1–3 |
| sdk | 4 | 2–4 |
| evaluation | 4 | 2–4 |
| embeddings | 5 | 2–5 |
| compiler | 6 | 3–6 |
| gateway | 7 | 3–7 |
| website | 8 | 3–8 |

These are total sessions, not simultaneous operation counts. Each main agent and
each child has a hard maximum of **10 user request/response turns**. Many bash
steps, assignments, delegation calls and result collections belong inside a turn;
none of those operations automatically starts another turn. Each main agent receives a foundation request when applicable and one natural user
request per release cycle. Each child receives one request per cycle containing
all its related feature and maintenance assignments. Each request runs many bash
steps and ends with a reply; the next user prompt starts the next turn. Current
profiles use at most six main turns and five child turns per conversation. Group consecutive
release cycles into coherent conversation objectives. Give children stable IDs
within their parent and distribute successive feature/maintenance assignments
across them. A later assignment continues the existing child transcript. Children
never migrate between parents. Every project has at most eight conversations and
every conversation at most eight distinct children.

Each release has a main-agent preparation task, independent feature A, feature B
and maintenance tasks, and main-agent integration and release tasks. Forks complete
before writers start; integration waits for both features; release waits for
integration and maintenance. Later cycles preserve the preset's publication
ordering. Main-agent scripts expose delegation and confirmed results, not fabricated
model reasoning. Fixture review content never claims an application test ran.

The scheduler separately limits executing CLI calls and active agents. It must
serialize work within a reused agent session and admit ready independent tasks
fairly. A waiting main agent does not consume an execution slot. The default
planned ceilings are 12 CLI processes, three executing tasks per conversation,
three sandboxes per project and 16 mounted workspaces per sandbox. The compiler
currently uses one sandbox; its operation graph needs at most two independent
mounted branch workspaces at a time.

## Mixed mode and receipts

Mixed mode reuses the preset's current selection of direct file revisions and
workspace revisions. The default compiled workload uses two exec/commit pairs per mounted workspace:


```text
mount → exec → commit → exec → commit → unmount
```

Within a conversation, Mixed mode can also issue `exec → commit` against an
already mounted workspace or a complete `mount → exec → commit → unmount`
sequence when a task needs its own workspace. The default recipe keeps its
average of two exec/commit pairs per mount.

Sandbox lifetime, workspace lifetime and agent lifetime are independent. Every
workspace exec/commit/unmount uses the `ws` returned by its mount receipt. Every
publication uses the immutable `head` from its source commit/merge receipt,
including the foundation publications. Dependency edges wait for clean unmount
before a downstream writer or merge proceeds. No handle or commit ID is guessed.

Each conversation's journal also records every compiled CLI call of its agents as a `cli`
operation of the bash tool that ran it, with its exact receipt and typed saved-version links
(`host/simulations/trace.js`; workspace calls take their mount's confirmed facts from this run's
own receipts). Setup and verification calls belong to no conversation and are not recorded there.
The journal stays local: it is not saved to the run's project, whose branch graph is verified exactly.

Planned lifecycle calls are counted individually. CLI Activity records actual
invocations through the existing CLI adapter. Failed or uncertain mutations stop
dependent work and retain their evidence; neither host nor shell entry silently
retries them. Cancellation stops further dispatch, settles in-flight operations
and retains owned resources for inspection.

## Verification and implementation boundaries

The compiler is `tools/simulation/compiler.mjs`; it is pure until
`writeSimulationPackage` writes the new run directory. It rejects invalid arguments
and refuses to overwrite an existing run. `cycles` is an internal fixture option
for focused tests, not a public command option. Production runs use all preset
release cycles. Expectations include exact main file contents and branch/history
counts from the same preset recipe.

`test/simulation-compiler.test.mjs` verifies all eight full profiles, session reuse,
complete dependencies, task DAG acyclicity, exact Mixed lifecycle counts, receipt
resolution, fresh resource names, package determinism and no execution replay.
Native GUI behavior is outside this command's browser and host verification.

## Live proof harness

Run bounded proof commands against the actual running preview host. Each command
has a 110-second ceiling and never cleans up resources or evidence:

```sh
node tools/simulation/live-proof.mjs start --endpoint-file /state/host.json --evidence /evidence/filesystem.json --mode filesystem
node tools/simulation/live-proof.mjs status --endpoint-file /state/host.json --evidence /evidence/filesystem.json
node tools/simulation/live-proof.mjs audit --endpoint-file /state/host.json --evidence /evidence/filesystem.json
```

`start` submits all eight independent runs without waiting for completion. Default
machine placement matches Studio; `--machines` accepts a JSON project-to-machine
map. `--project` selects a single project for launch, polling or a smaller audit.
Run the Filesystem batch through completed audit before starting a separate Mixed
batch with a new evidence filename and `--mode mixed`.

The audit reads generated packages, actual operation journals, saved parent/child
Pi transcripts and CLI Activity shards. It proves fresh Store/project identities,
complete planned operation receipts, bounded conversation/child counts, at most
10 turns per main/child agent, repeated assignments and explicit bash commands
in the same child transcript, parent session linkage, retained
verification, unmounted workspaces, actual CLI overlap across selected runs and a
peak of no more than 12 executing CLI processes. Launch receipts are persisted
immediately so partial launch failures leave a reviewable list of owned run IDs.

## LayerFS question: concurrent detach and fresh workspace clients

The host admits `workspace.mount` and `workspace.unmount` exclusively per LayerFS
home and sandbox. Other ordinary workspace calls (`exec`, `commit`, `status`) share
that sandbox's admission and can execute concurrently. Different sandboxes and
direct file mutations remain independent. Admission happens before taking a global
CLI slot, so lifecycle waiters do not occupy process capacity. Waits are abortable;
execution cancellation bypasses this gate so stopping a reader cannot deadlock
behind a waiting lifecycle writer. Each CLI call is still attempted once.

This ordering addresses an observed LayerFS Native race. In Mixed SDK run
`a8d7c538-1a25-4efc-b969-37c3a9d68e7a`, `dense.008.a.session.001.unmount`
ran from `2026-11-10T09:38:40.463Z` to `09:38:40.735Z`, while the next
B workspace mount started at `09:38:40.499Z` and refused `NotMounted: saved
Workspace is no longer mounted` at `09:38:40.746Z`. B's own preceding unmount
had already succeeded; all mounted handles and names were distinct and correctly
bound to the SDK simulation project. The failed mutation was not retried.

The pinned macOS artifact `build-macos-b4035a8f06434f7e8e09c823dad9e32a`
reports commit `1edcf58caec2bf079a07891411a0151c9afa3e80` with dirty source.
Its registered build worktree has no changes in the two relevant files, whose
logic also matches `origin/layerfs_v2_0_0`:

- `control/crates/layerfs-sandbox/src/files.rs:230` refreshes all saved workspace
  records; line 253 refuses when a daemon status has no `kernel.ready`.
- `control/crates/layerfs-sandbox/src/workspace/serve.rs:264` releases the sandbox
  discovery guard before daemon detach, then removes the workspace record after
  reacquiring the guard. A fresh CLI process can refresh that retained record in
  the interval after detach and before record removal.

Evidence is retained under
`/var/folders/s4/xpkmz7wn6yq97w1ls_4f_dfc0000gn/T/layerfs-simulation-proof-kREJCH/`:
`simulations/a8d7c538-1a25-4efc-b969-37c3a9d68e7a/journal.jsonl`,
`mixed-full.json`, the CLI Activity shards, and
`home-2/machine/native/run/lfs-6b863784-sim-df464e9d065833082c40-1/daemon.log`.
That daemon log contains untimestamped client disconnect diagnostics rather than
workspace-specific events; the journal and unchanged source establish the timing.

LayerFS follow-up: should refresh recognize an in-flight peer unmount and tolerate
its retained record, allowing these calls to overlap safely? Connect currently
orders admission around the supported lifecycle boundary without changing LayerFS,
rewriting operation graphs, or replaying failures.

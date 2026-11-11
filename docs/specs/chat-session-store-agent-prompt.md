# Agent prompt: implement project-owned chat sessions and operation-level Trace

## Assignment

Implement the design in [chat-session-store.md](chat-session-store.md) in
`/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect`. Deliver persistent project-owned
conversations, per-operation saved-version bindings, and connected Chat, Trace
and History views, with recovery and portability verified.

The design has already been discussed with the user in the preceding session.
Read this handoff and the specification before editing. Continue with concrete
implementation and verification; do not stop at another generic design proposal.
If upstream facts contradict the design or a genuinely new product decision is
needed, explain the specific conflict while continuing independent work.

This prompt is a handoff for a future agent. No implementation has been done by
the session that wrote it. The specification remains a proposed implementation
design, not evidence of working behavior.

## User decisions and terminology

Preserve these explicit decisions:

1. A LayerFS project is the durable user workspace. Chats and traces must travel
   with it through Store movement and backup, rather than remain host-only.
2. A saved reference contains `store_id`, `project_id`, `branch_id`, `commit_id`
   and `version_kind: 'Commit' | 'Layer'`. Use full actual API identifiers. Public
   calls currently take Store/project names and branch names; no invented UUIDs.
3. Do not introduce `checkpoint_id` or `timeline_id`. Session/entry parentage
   describes conversation history; branches/commits describe file history.
4. One tool call may execute zero or many LayerFS operations through CLI or SDK
   and have zero or many checkpoint links. Capture the individual operations.
5. Only `fs.write_like`, `workspace.commit`, `branch.fork`, `branch.merge` and
   `branch.publish` can have checkpoint links. Normalize actual `file.*` and
   internal `fs.*` names through an explicit supported-call table.
6. Fork and merge are operations, not version kinds. Fork references an existing
   Commit/Layer; merge preserves sources and the actual result; publish links
   its source Commit to the resulting main Layer.
7. Preserve operation identity independently of saved-version identity: many
   operations can reference the same version. UI ordinals are never identities.

Storage design presented to the user: bounded immutable JSONL segments and
artifact files on a dedicated conversation branch in the same LayerFS project.
The latest clarification recommended local SQLite for rebuildable indexes and
local pending JSONL for uncommitted recovery records. Use that as the implementation
default; SQLite indexing was a recommendation, not a separately selected user
requirement. Do not place a mutable nested SQLite session database in a code
branch or confuse the local index with LayerFS's SQLite/PostgreSQL Store backend.

## Read first and preserve the checkout

- Read repository `AGENTS.md`, the main spec, `docs/layerfs-2.0-integration.md`,
  `docs/layerfs-model.md`, `docs/agent-harness.md`, `docs/ui/README.md`,
  `docs/ui/chat.md`, `docs/ui/chat-history.md`, and relevant existing storage,
  saved-query and agent/Sandbox binding specs.
- Inspect branch/status and current code before editing. This checkout already
  contains extensive modified and untracked work from other assignments. The
  spec and this prompt are untracked handoff files, not disposable clutter.
  Never revert, stash, reformat or commit unrelated changes. Do not switch to a
  historical branch named in an old integration document without checking ownership.
- Read LayerFS through `git -C /Users/yifanxu/Ephemeral-AI-Lab/layerfs show
  origin/layerfs_v2_0_0:<path>`. Never switch or edit that checkout. Study SDK
  README, CLI front end, and the relevant per-call pages/source. The study baseline
  was `58c548b3e0a45f11880e3511bf1267d11e315415`; verify the current pin/source.
- Use Connect's pinned CLI and matching daemon. Do not build or patch upstream
  LayerFS to sidestep an API gap. Report a precise upstream requirement instead.
- Check disk with LayerFS's `python3 tools/cleanup.py check` at assignment start,
  before large builds/fixtures, after batches, at least every 30 minutes, and at
  handoff. Follow the user's machine-specific cleanup rules, including the 300 GB
  net recovery target below 100 GB free, protecting active resources and evidence.

## Known gaps to verify against current code

| Location | Observed in the design study |
| --- | --- |
| `host/agents/index.js` | Host-local `chat.json` plus Pi session file; new project chats default to folder execution |
| `host/agents/workspaces.js` | Mounted branch/save/restore path exists; saves discard important receipt details |
| `host/agents/history.js` | `connect.user-checkpoint` Pi entries locate file restore boundaries |
| `host/agents/trace.js` | Joins Pi tools to per-agent diagnostic JSONL, rather than a durable operation ledger |
| `host/runs/trajectory.js` | Computes checkpoint numbers from successful writes, including unchanged saves and fork/publish |
| `host/runs/scope-client.js` | Per-invocation SDK wrapper; currently uses best-effort tracing |
| `host/runs/cli-shim.mjs` | CLI tracing boundary; needs shared operation identity and receipt normalization |
| `host/runs/trace-line.js` | Diagnostic write errors are swallowed; unsuitable as sole persistence authority |
| `host/agents/child-extension.js` | Mounted bash skips the ordinary local trace-environment hook |

Historical docs broadly promising mounted checkpoints do not establish the
current default. Preserve folder chats until explicit conversion; make new
project chats use the mounted path as specified.

## Implementation sequence

1. Establish the versioned journal schema, per-conversation session branch,
   bounded segments/artifacts, native Pi reconstruction and rebuildable local
   catalog. Persist original agent/entry identities, compactions and copied lineage.
   Provide explicit pending/local versus saved-to-project state. Never discard
   the only pending copy as a cache.
2. Add common operation intents/receipts for SDK, CLI and host-generated saves.
   Propagate invocation-local session/agent/entry/tool context. Deduplicate SDK
   and underlying CLI observations. Capture exact typed inputs and outputs;
   preserve successful operations when the enclosing tool fails.
3. Bind mounted execution and conversation restore boundaries to confirmed
   immutable refs. Retain host-generated operations without fabricating tool
   calls. Implement lost-reply reconciliation for both code and session writes.
4. Connect Chat summaries, Trace hierarchy/inspectors and exact bidirectional
   History navigation. Keep native conversation interactions and shared file/history
   components. Update the affected `docs/ui/*.md` specs with renderer changes.
5. Migrate legacy local sessions without fabricated provenance. Verify restart,
   copy, restore, index rebuilding, Store movement and backup/restore using owned
   disposable resources. Finish with a record of actual passing evidence and limits.

Use small reviewable changes, keeping source-of-truth contracts explicit. Do
not implement duplicate transcript stores or a separate demo renderer. Work
through all necessary stages; a first passing unit test is not completion.

## Correctness requirements

- `workspace.commit` captures published writes from every process in the mount,
  not just one exec. Parallel independent writers need separate branches and
  Workspaces; shared-workspace attribution describes a save boundary, not exclusive
  authorship. Preserve explicit merge input/result relationships.
- `UpToDate` creates no new commit. It can carry a link with `effect: 'unchanged'`.
  Definite refusals have no checkpoint; unknown outcomes remain unresolved.
- There is no atomic transaction spanning code and session branches. Persist
  intent, dispatch once, capture exact receipt, publish binding, and reconcile
  uncertain outcomes. Never blindly replay a command, script, merge or publication.
- Stable journal ingestion order supports pagination, not commit ancestry.
  Concurrent calls need their own contexts; never mutate global environment to
  attribute simultaneous in-process SDK invocations.
- Restore binds an explicit before/at conversation position to the primary
  workspace ref, then forks a new code branch. A multi-project tool's links do
  not constitute atomic multi-project rollback.
- Session-storage operations must not recursively trace themselves into the
  user's code operation list. Persist/report their errors separately.
- Version one has one active execution owner per conversation; a local process
  lock does not provide a cross-host lease. Do not silently combine divergent
  session histories. Preserve unrelated concurrently active conversations.
- Full Store backup preserves its own project branches, not external Stores
  referenced by a tool. Single-folder export does not silently become a complete
  session export. Renamed import bindings are explicit; never join names across homes.
- Preserve existing resource assignment semantics. Do not reorder conversation
  sidebar rows or project groups because running-session progress changes.

## Verification and delivery

Implement meaningful tests for the main spec's acceptance cases, especially
SDK calls with mixed eligible/ineligible operations, unchanged writes, fork from
Layer/Commit, merge/publish relationships, concurrent agents, failure after saved
writes, lost receipts, pending-journal recovery, copying and portable reconstruction.
Use deterministic model fixtures or configured disposable chats; do not incur
unnecessary paid model requests or change the user's model configuration.

Use the actual browser preview for renderer verification:

```sh
pnpm --dir desktop web
pnpm --dir desktop -s typecheck
pnpm --dir desktop -s build
```

Preview is fixed at `http://127.0.0.1:1025/`, with `?mac=1` before the hash for
macOS spacing. Use Node 24 and explicit pinned CLI/daemon paths. Reuse a server
only if it belongs to this checkout; never kill another session's server. Verify
interactions at 1280x820 and 900x600, inspect console errors, and exercise Chat,
Trace, History, child-agent navigation, reload and failure states. Screenshots
alone do not verify these flows. Do not launch/control/restart Electron or the
desktop application: this handoff does not request desktop verification.

Run relevant host tests and root typecheck/build for host changes; use explicit
test files or the documented `node --test test/*.test.mjs` form on Node 24.
Read package scripts before choosing broader harness suites. Keep live fixtures
in private Disposable Stores/homes and report/release only exact owned resources.

No push, PR, merge, publishing, deployment or destructive global reset is
requested. If making local commits, scope them to this work and use the required
`Assisted-by: Cindy (https://cindy.app)` trailer while preserving human authorship.

At handoff, report what works, files changed, tests and browser flows actually
exercised, remaining limitations, any upstream gaps, and the status of owned
runtime resources. Update the specification or a linked implementation record
so future agents can distinguish the proposal from completed behavior.

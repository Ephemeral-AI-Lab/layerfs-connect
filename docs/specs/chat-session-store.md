# Project-owned chat sessions, Trace and saved versions

Status: implementation specification, 2026-11-10. Implemented and verified parts,
evidence and remaining limits are in the [implementation record](chat-session-store-record.md);
where this document and the record differ, the record states what exists.

## Outcome and agreed constraints

A LayerFS project is the user's durable workspace. Its conversations, child-agent
history, traces, artifacts and saved-version bindings travel with the project
through Store movement and full Store backup/restore.

- A conversation position is identified by `session_id` and `entry_id`.
- A filesystem position is identified by Store, project, branch and immutable
  saved-version ID. Keep `version_kind` to distinguish Commit from Layer.
- Do not introduce a separate `checkpoint_id` or `timeline_id`.
- One tool call can execute zero or many LayerFS operations, including through
  an SDK, and can expose zero or many checkpoints.
- Only filesystem write-like operations, `workspace.commit`, `branch.fork`,
  `branch.merge` and `branch.publish` can produce checkpoint links.
- Fork and merge are operation kinds, not saved-version kinds.
- Chat, Trace and History are views over recorded facts. UI checkpoint numbers,
  timestamps, commit messages and mutable branch heads are not binding identities.

## Source baseline and existing behavior

LayerFS was studied read-only at `origin/layerfs_v2_0_0`, revision
`58c548b3e0a45f11880e3511bf1267d11e315415`, matching Connect's recorded CLI pin.
Implementation must recheck the actual pinned API before relying on new fields.

LayerFS sources, relative to that revision:

- `docs/architecture/api/sdk/README.md`
- `docs/architecture/api/front-ends/cli.md`
- `docs/architecture/api/sdk/workspace/{commit,status,mount}.md`
- `docs/architecture/api/sdk/branch/{fork,merge,publish,commits,get_commit}.md`
- `docs/architecture/api/sdk/file/apply.md`
- `api/crates/layerfs-api/src/workspace/commit.rs`

See [Connect integration](../layerfs-2.0-integration.md),
[LayerFS model](../layerfs-model.md), [harness](../agent-harness.md),
[saved-query contract](branch-file/contract.md), and
[agent/Sandbox bindings](agent-sandbox-bindings.md).

Current Connect behavior is incomplete relative to this proposal:

- `host/agents/index.js` persists host-local `chat.json` and points to Pi JSONL;
  newly created project chats default to `runs: 'folder'` with no mounted workspace.
- `host/agents/workspaces.js` implements mounted chat branches, saves after bash,
  immutable user-message restore points and restore through new branches.
- `host/agents/history.js` locates Pi `connect.user-checkpoint` entries.
- `host/runs/trajectory.js` computes checkpoint ordinals from successful writes,
  including operations that did not create a Commit.
- `host/runs/scope-client.js` wraps SDK operations; `host/runs/cli-shim.mjs`
  wraps CLI operations. Their diagnostic trace is best effort.
- Mounted host-generated saves do not have a complete durable operation receipt
  binding in the chat Trace. Copying Pi history does not establish complete
  copied trace provenance.

Do not treat historical harness/UI wording as proof these gaps are implemented.

## Ownership and storage

| Entity | Ownership and purpose |
| --- | --- |
| Project | Durable workspace namespace containing code and session branches |
| Conversation | Entry tree, settings references, child relationships and artifacts |
| Code branch | Independent writable file history; new path after restore/fork |
| Mounted Workspace | Runtime mount of a code branch in a project Sandbox |
| Session branch | Versioned conversation journal and artifacts in the same project |
| Local cache | Rebuildable search/list projections, Pi runtime files and pending journal |

Use one application-managed session branch per conversation, with the naming
convention `connect.session.<session_id>`. Its manifest identifies schema version,
session identity and ownership. A name prefix alone is not proof of ownership.
Discover branches through paged branch listing, verify manifests, and reconstruct
the local conversation catalog. There is no required global catalog branch whose
updates serialize all conversations.

Proposed paths on that branch:

```text
/.connect/session/manifest.json
/.connect/session/segments/<segment-id>.jsonl
/.connect/session/artifacts/<artifact-id>
```

A session branch is an ordinary LayerFS branch, initially forked from a recorded
project base. It can inherit code files; it is not an empty or privileged metadata
namespace. Connect changes only its reserved session subtree. Do not mount this
branch as the agent's code workspace or merge/publish it into code branches.
Identify it as application data in branch browsing, with an explicit way to inspect it.

Persist immutable bounded journal segments and manifest changes together using
`file.apply`. Do not rewrite the full transcript after every token. Root and child
Pi records retain native entry IDs, parent IDs, compaction records and original
session identity; the journal must reconstruct usable native session files, not
just display text. Store complete owned outputs and attachments as artifacts.

Project-committed segments are the portable authority. Local pending records are
a write-ahead journal until flushed, never a supposedly rebuildable cache while
they contain the only copy. Distinguish locally recorded, saved to project and
save-unknown states. A checkpoint is complete only when its binding is saved to
the project. Persist accepted user input before starting its model request;
streamed text can be batched until tool/turn boundaries. Preserve interrupted
local output after restart without presenting it as already portable.

Version one has one active execution owner per conversation. Detect a changed
session-branch head before publication and reconcile/refuse divergent ownership;
do not silently merge contradictory session cursors. A local lock is not a
cross-host lease. Concurrent multi-host editing of one session requires a separate
ownership protocol and is outside this specification; different conversations
can execute concurrently on separate session branches.

Credentials, approval bearer tokens and runtime connection/control files remain
outside project storage. Journal serializable settings and credential references,
not secret values. Recorded tool content follows existing content-retention policy.

## Identity and records

```ts
type SavedVersionRef = {
  store_id: string
  project_id: string
  branch_id: string
  commit_id: string
  version_kind: 'Commit' | 'Layer'
}

type VersionLink = {
  ref: SavedVersionRef
  effect: 'created' | 'referenced' | 'published' | 'unchanged'
}

type LayerFSOperation = {
  operation_id: string
  session_id: string
  agent_id: string
  entry_id: string
  tool_call_id: string | null
  cause: 'tool' | 'session_boundary' | 'lifecycle'
  method: string
  status: 'running' | 'succeeded' | 'failed' | 'unknown'
  started_at: string
  ended_at?: string
  inputs: SavedVersionRef[]
  checkpoints: VersionLink[]
  arguments_artifact?: string
  receipt_artifact?: string
  execution_context?: {
    machine: string | null
    sandbox: string | null
    workspace_instance: string | null
  }
}

type RestoreBoundary = {
  session_id: string
  entry_id: string
  position: 'before' | 'at'
  workspace_ref: SavedVersionRef
}
```

These are logical records, not a requirement for one mutable JSON file each.
Persist intent, completion and reconciliation as append-only events with unique
event IDs; projections fold them by `operation_id`. Terminal receipt import is
idempotent. Tool IDs are scoped by session/agent, and Pi entry IDs retain their
owning native session. Keep a tool call's owning entry distinct from its result entry.

The public LayerFS API currently uses Store/project names and branch names.
`*_id` here means the actual identifier accepted by that API; do not invent an
unavailable LayerFS UUID. Compose `<store_id>/<project_id>` at the adapter boundary.
`commit_id` is always complete; for a Layer it contains that Layer's full ID.
Its branch field is the context admitting that saved version, not necessarily
the branch that originally produced it. Preserve originating branch separately
when returned; do not overwrite it during a fork.

Resolve the selected LayerFS home outside this portable reference. Names are
scoped to a home and cannot identify unrelated installations globally. Importing
or restoring under different names requires an explicit origin-to-local binding
map with validation; never join identical names across homes implicitly.

Moving a Store between machines leaves these references unchanged. Machine,
Sandbox and Workspace mount identity describe execution and are not version identity.

## Cardinality and checkpoint eligibility

```text
Session entry
  Tool call                           0..N per entry
    LayerFS operation                 0..N per tool call
      Checkpoint link                 0..N per operation
```

A host-generated commit has a real operation record and cause even when there
is no agent tool call. Do not manufacture a Pi tool call for it. A tool's checkpoint
list aggregates its operations, including automatic saves explicitly caused by
that tool. Session-boundary saves appear as their own events.

| Canonical operation | Eligible result |
| --- | --- |
| `fs.write_like` | Resulting Commit, or existing version for an unchanged write |
| `workspace.commit` | Saved Commit, existing head, or initial base Layer |
| `branch.fork` | New branch plus its existing starting Commit or Layer |
| `branch.merge` | Result branch and exact resulting saved version |
| `branch.publish` | Resulting `main` Layer; source Commit remains an input |
| Any other operation | Empty checkpoint list |

Normalize SDK `file.write/edit/apply/rm/mkdir/mv/cp` and corresponding internal
`fs.*` names into the write-like class. Include supported metadata mutations when
they save a version. Use an explicit table derived from supported calls; neither
string prefix matching nor `ok: true` grants checkpoint eligibility.

Reads, `workspace.exec`, mount/unmount, Sandbox and machine operations, and
`project.init` have no checkpoint links under this policy. A shell file write
becomes a saved version only when an eligible explicit save occurs.

Rules:

1. A successful eligible operation gets links only from confirmed receipts or
   subsequent verified reconciliation. No guessed head or timestamp joins.
2. `Committed` creates a version; `UpToDate` references an existing version with
   `effect: 'unchanged'`. This is a link, not a newly created commit.
3. Fork uses `referenced`; it does not reassign authorship of the source version.
4. Merge preserves its source references and actual result kind. Do not infer
   new commit creation from the verb; retain fast-forward/reuse facts.
5. Publish uses `published`, preserving the source Commit and target Layer as
   distinct identities. Do not count the source input as another output checkpoint.
6. Definite refusal has no checkpoint. Unknown outcome has no confirmed link
   until reconciled; diagnostic candidates are not checkpoints.
7. Preserve each operation's links even if several operations reference the
   same `(store, project, branch, commit, kind)`. A UI may additionally show a
   distinct-version count, labeled separately from link or new-commit counts.

## SDK, CLI and host instrumentation

Instrument each public LayerFS invocation, not just the enclosing tool process.
An SDK script with twenty calls records twenty operations. All supported SDK
clients, explicit CLI invocations and host saves use the same receipt normalizer.
Current SDK compatibility calls continue through the pinned CLI adapter; this
design does not introduce a second transport.

- Pass immutable invocation context with session, agent, entry and tool IDs.
  For in-process concurrent tools, use invocation-local context rather than
  mutating shared process environment. Child processes inherit explicit context.
- Persist an operation intent and unique ID before dispatch. Record start and
  completion independently; never reuse one ID for an unrelated retry attempt.
- Retain lossless receipt fields needed to resolve versions, merge relationships,
  displacement, conflicts and publication source. Bounded previews link to full
  artifacts rather than clipping the authoritative receipt.
- Resolve workspace-to-project/branch context using confirmed mount-instance
  facts and operation receipts, not a later current mount with the same name.
- Persist each completed operation even if the script later exits nonzero or is
  interrupted. Earlier confirmed commits survive failure of the outer tool.
- Deduplicate observation when SDK and CLI layers see the same invocation;
  carry the operation ID through the adapter rather than reporting two writes.
- An uninstrumented SDK is an observation gap. Do not imply complete coverage
  or reconstruct per-tool ownership from later history differences.
- Session-storage writes use a separate internal domain, avoiding recursive
  trace generation and user-code checkpoint counts. Their failures still surface.

Concurrent calls retain their start/end times and causal parents. Event ingestion
sequence provides stable pagination, not filesystem causality. Commit parents,
fork inputs and merge relationships determine file ancestry. Do not infer it from
completion timestamps, and do not reorder existing conversation sidebar rows on
progress updates.

## Save protocol and crash recovery

LayerFS `workspace.commit` has `message` and `force`, not arbitrary session
metadata. There is no transaction spanning a code commit and a session-branch
commit. Use durable intent and reconciliation:

1. Record session events through the desired boundary and an operation intent.
   Before a managed restore-boundary save, commit that intent to the session branch.
2. Stop admission of new managed writers for that boundary and settle active
   commands/background-writer policy. A shell exit does not prove all writers ended.
3. Dispatch the code save once, with a short correlation token in its message
   when that API supports one. The token is recovery evidence, not version identity.
4. Record the exact receipt. For unchanged state, resolve the existing immutable
   head/base Layer. Never create a fictitious commit.
5. Commit the receipt, session boundary and binding to the session branch. Only
   then mark the boundary saved to project and available for portable restore.

Ordinary SDK operations stream intents/receipts through the journal without
promising a cross-branch transaction. Local pending events must be surfaced and
flushed at explicit boundaries. Background activity after a tool exits retains
its original invocation identity while observed, and leaves the tool unsettled
for restore purposes until its writers are resolved.

After a lost reply, inspect saved history, branch state and workspace status.
Reconcile both code writes and session-journal publication before any retry.
Never replay an SDK script, shell command, merge or publication merely because
its receipt is missing. A bare read of the latest head cannot prove which
operation produced it. Ambiguous cases remain unknown, with recovery actions.

## Agents, restore and copying

Independent parallel writers get separate code branches and Workspaces; they
can share an appropriately assigned project Sandbox. Explicit merges record the
input versions and result. A deliberately shared Workspace has shared file state:
LayerFS captures published writes from every process, not only the triggering exec.
A link identifies the observed save boundary, not exclusive tool authorship.

Each restorable entry has an explicit `before` or `at` boundary. A user-message
boundary means the file version before that message's execution; do not present
it as the state after the assistant's work. Restore requires both the selected
entry boundary and the primary workspace's saved reference.

Fork a new code branch from that reference and append a new conversation path.
Keep prior entry parents and branches. Never reset through a forced commit.
Restart processes separately; saved files do not restore process memory or sockets.

A tool may touch multiple branches, projects or Stores. Its checkpoint list is
provenance, not an atomic multi-project restore set. Version one restores only
the conversation's explicitly bound primary workspace and says so in the dialog.
Other referenced projects remain independent.

Copies retain source session/agent/entry/operation identities for inherited events,
plus explicit copy relationships. New events belong to the new session. Copy all
required artifacts or retain a durable reference guaranteed to survive source
deletion. Compaction does not erase historical tool-to-operation bindings.

## Chat, Trace and History presentation

Chat keeps the transcript primary. Tool summaries show status, operation count
and saved-version link count; details expand to actual operations. No checkpoint
number is an identity. Display short IDs while retaining full references in links.

```text
+-[1] Conversation ------------------------------------------------------+
| User: Prepare the migration                                            |
| Assistant: ...                                                         |
| [2] [v] Run migration script - Failed                                   |
|     5 LayerFS operations - 3 saved-version links                         |
|     [3] file.read       /schema.sql                  Completed           |
|         file.write      /migration.sql               Created C1 [Open]   |
|         branch.fork     review                       From C1    [Open]   |
|         workspace.commit                            Created C2 [Open]   |
|         workspace.exec  run tests                    Exit 1              |
+------------------------------------------------------------------------+
```

| Region | Behavior |
| --- | --- |
| 1 | Native conversation entries and agent hierarchy |
| 2 | Tool outcome independent of successful earlier operations |
| 3 | Operation rows; Store/project context shown when different or ambiguous |

Trace exposes the hierarchy and execution evidence. Filters include agent, tool,
operation, Store/project, branch, status and operations with checkpoint links.
The inspector shows exact arguments, timing, result/error, execution context,
inputs, outputs and coverage gaps. Large outputs load in pages.

```text
+-[1] Trace -------------------------------------------------------------+
| [Agent v] [Operation v] [Project v] [Status v]                            |
| [2] User entry > root > Run migration script                             |
|     file.read                 Completed                                 |
|     file.write                Created C1                         [Open] |
|     branch.fork               review from C1                     [Open] |
| [3] Selected operation                                                  |
|     Store / Project / Branch / full saved ID / Commit or Layer           |
|     Inputs | Result | Arguments | Output | Error | Execution             |
+------------------------------------------------------------------------+
```

| Region | Behavior |
| --- | --- |
| 1 | Paged operation filtering; no fabricated total coverage |
| 2 | Entry, agent and tool ownership; concurrent operations remain overlapping |
| 3 | Exact receipt details and typed saved-version links |

History remains a filesystem ancestry graph with Commit and Layer nodes, fork
relationships, merge parents and publication source links. Selecting a version
shows its known producing operation separately from operations referencing it.
Unknown provenance reads `No linked trace`; publication/fork never overwrites
the original producer. Main Layer publication time can be unavailable; source
Commit time must not be relabeled as publication time.

Navigation is bidirectional: Chat tool -> Trace operation -> exact History version
-> producing or referencing Trace operation. Include session, agent, operation
and full saved reference in navigation state; never depend on list position.
Use `branch.commits` with pinned `at_commit` and `branch.get_commit` for saved
history. Page events and graph metadata without eagerly loading every diff.

At 1280x820 and 900x600, keep transcript/trace scroll local and avoid horizontal
page overflow. Stack inspector content when necessary. Loading, empty, failed,
unknown and partial-coverage states remain distinct. A failed refresh preserves
already loaded evidence. Running rows do not become successful on tool completion
unless their own receipts confirm it.

## Portability, retention and migration

Store push/pull and full Store backup preserve session branches and artifacts.
Single-branch folder export is not a conversation export. A portable conversation
export must explicitly include journals, artifacts and the referenced code history
or report which referenced versions are external/unavailable. Cross-Store links
do not cause those Stores to be included in a backup automatically.

Archive retains session data and code history while releasing eligible runtime
resources. Session deletion and code-history retention are separate policies.
Do not delete referenced versions or source artifacts merely because a local
index or one conversation is removed. Missing/deleted external references remain
visible as unavailable, not rebound to a current head.

Migration imports existing Pi JSONL, chat metadata, children, trace and artifacts
into session storage with original identities. Preserve exact historical refs
where evidence exists; do not invent operation receipts from ordinal labels or
commit-message guesses. Imported historical gaps are labeled. Existing folder
chats keep their execution semantics until explicitly converted; conversion
selects/imports a real LayerFS project and creates a new bound execution branch.
New project chats use mounted code workspaces under this proposed design.

## Delivery and acceptance

Deliver in stages: journal/identity storage; common operation capture; mounted
project-chat saves and recovery; Chat/Trace/History links; migration and portability.
Update `docs/ui/chat.md` and `docs/ui/chat-history.md` alongside their eventual
renderer changes, following the existing UI-spec conventions. This proposal does
not mark those current surface specs or code as already changed.

Required implementation evidence:

1. Read-only tool: many operations, zero checkpoint links.
2. One SDK tool: writes, reads, fork, merge, publish and workspace save; exact
   operation receipts and 0..N links with correct Store/project/branch/kind.
3. Repeated unchanged saves: retained operation links, no invented new commits.
4. `file.apply` with many mutations: one invocation and its actual result, not
   one fabricated checkpoint per path.
5. Failed script after successful writes: earlier links and artifacts survive.
6. Concurrent SDK calls and children: no context leakage, double counting or
   timestamp-derived ancestry; shared-workspace authorship is labeled accurately.
7. Lost code receipt, lost session publication receipt and restart between stages:
   reconcile without replay; ambiguous outcomes stay unknown.
8. Fork from initial Layer, fork from Commit, merge reuse/new result and publish:
   typed references and source relationships survive restart and navigation.
9. Copy/compaction/restore: original producers remain resolvable; `before` and
   `at` positions restore the correct primary workspace on a new branch.
10. Store movement and backup/restore: rebuild chats, children, Trace, native Pi
    context and artifacts on a fresh local index; remapped names use explicit bindings.
11. Cross-project tool and unavailable external Store: show independent refs;
    no claim of multi-project rollback or complete backup coverage.
12. Uninstrumented SDK, journal disk failure and branch ownership conflict:
    surface incomplete persistence/coverage instead of confirmed checkpoints.
13. Real browser interactions at both desktop sizes, console inspection, desktop
    typecheck/build and relevant host tests. Native behavior is verified separately
    without launching Electron unless desktop verification is explicitly requested.

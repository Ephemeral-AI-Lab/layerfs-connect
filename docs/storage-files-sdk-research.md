# Storage Files: SDK research and proposed query additions

Research date: 2026-11-08. This is a design proposal, not an implemented API.

## Sources and verification

- Read LayerFS `origin/layerfs_v2_0_0` at `716197c499` through `git show`, without changing its checkout.
- Read the SDK overview, CLI guide, file read/stat/blame/diff pages, branch get/diff pages,
  Commit list/get/diff pages, Workspace status/commit pages, and relevant engine implementations.
- Read Connect's integration/model documents, shared Files components, project History component,
  history adapter, simulator and history tests.
- The package linked by Connect is `../layerfs-v2-merge/api/node`; that checkout's HEAD was
  `d430474135`. Runtime observations below are for its installed native addon, whose call table
  was queried directly; the checkout revision alone does not establish the addon's build revision.
- Used the existing web preview at port 1025: opened `shop/api/files`, switched to
  `feature-login`, opened History and selected a checkpoint. This preview is simulated.
- Ran a mountless native SDK experiment in a new temporary home and project. It created a
  Store, imported a two-line file, forked a branch, made three direct file writes and published.
  It did not access the user's LayerFS home, create a Sandbox or launch Electron. Closed the
  SDK and removed the experiment's own temporary directory afterward.

## Native observations

| Experiment | Result |
| --- | --- |
| Blame after two edits | Correct owners for changed and appended lines; unchanged Init line owned by a Layer ID in the field named `commit`; `origins` empty |
| File diff between Init Layer and first Commit | Text comparison succeeded |
| Tree diff between those same revisions | `InvalidInput`: `diff_commits takes two saved Commits` |
| File diff with an absent left path | `NoSuchPath`; no added-file diff |
| Commit page size 1, append a new head, request position 1 | Repeated the same Commit delivered on page one |
| Blame on published main | Succeeded and reached the source Commit |
| Commit list on main | `NoSuchBranch`: `Branch main does not exist` |

These were functional probes, not performance benchmarks. Large-history latency, PostgreSQL
behavior and remote-machine routing were not measured.

## What Connect can expose now

- Saved file tree and content at a full Commit or Layer ID.
- Single-file comparison across branches, Commits and Layers; different paths on either side.
- Paged whole-tree comparison between two named branches, or between two saved Commits.
- First-parent blame, with line continuation, clipping and coarse-comparison indicators.
- More Commit metadata: base, root, both parents, merge origin, displacement, operation,
  logical snapshot size and incremental canonical/stored/metadata bytes, plus LWW decisions.
- Deep links between Files, a checkpoint and the existing History graph.

Connect's `commitInfo` currently retains only id, branch, message, time, parent, second parent
and operation. The file adapter retains content/size but drops snapshot/root and richer stat
facts. Extending these adapters is Connect work, not a new SDK requirement.

All these reads describe saved snapshots, not uncommitted Workspace overlays. A Connect chat
checkpoint may refer to a Commit or a Layer; it is not a distinct SDK history entity.

## Findings below the public SDK

### History pagination already has a stronger engine contract

`core/crates/layerfs-history/src/contract/query.rs` defines authenticated opaque cursors bound
to catalog/incarnation, range, subject, immutable anchor and continuation position. The
persistence Commit and Layer readers resume from that position without rewalking delivered
history, and tolerate growth of the live branch.

The public SDK's `commit.list` exposes only page size and numeric offset. The service wrapper
in `engine/crates/layerfs-store-service/src/history/branch.rs` starts at the current branch
head on every request and skips `page_pos` records. Deep pages repeat prefix traversal; a
new head shifts offsets. Connect checks an expected head before paging, which helps detect
movement but is not an atomic guarantee across its separate SDK calls.

### Published Layers are queryable internally

`HistoryCatalog::layer_history` and its persistence implementation already page the main
publication chain. `LayerRecord` stores parent, root, source branch/Commit, logical bytes and
overwritten count. There is no public SDK Layer list/get family in the reviewed call table.

Layer records do not contain a publication timestamp. A source Commit's time is not the time
the Layer was published. Any future publication-time UI requires a separate persisted fact,
with explicit handling of older records where that fact is unavailable.

### An internal file-revision query exists, but needs refinement

`engine/crates/layerfs-store-service/src/operator/files.rs` implements file history behind
`backend.store.fs.list_revisions`. The SDK facade guide says no production caller of the
operator dispatcher was established. This is not a supported public SDK route for Connect.

The implementation walks a fixed path through first-parent provenance: Commit parent, else
base Layer; a Layer follows its source Commit before its previous Layer. It detects absent,
added and removed paths, and kind/content-root changes. It does not test inode identity or
mode, does not follow renames, uses offsets, and has no explicit scanned-revision work budget.
Content-root equality is also not a complete byte-equality test: the compare implementation
explicitly handles different content roots containing equal bytes.

Publication history and file provenance therefore need separate, named traversal semantics.
Following source Commits is not equivalent to listing successive main publications.

### Comparison and blame have useful but incomplete response contracts

- File diff requires both paths to exist. Addition/deletion previews need Connect handling
  today, or an optional absent-side mode in the SDK.
- File diff labels both binary and over-limit text as `Binary`; text comparison is bounded
  at 1 MiB per side. Hunks over the reply budget are omitted without a hunk continuation.
- Snapshot responses contain a shortened display label and a full tree root. A tree root
  does not uniquely identify the history event. Return full revision identity separately.
- Blame returns an empty origins table and repeats owner messages per line. Owners can be
  Layers, and may belong to ancestral branches, so a detail lookup cannot assume the current
  branch plus `commit.get` will resolve every owner.
- Blame windows limit output, but source contains no fixed history-walk depth budget.

## Proposed SDK changes, in priority order

Names below are illustrative and should be aligned with the SDK's public naming conventions.

1. **Stable cursors on Commit listing.** Expose immutable anchor and opaque continuation;
   retain offsets for compatibility. Bind future filtered cursors to filters and traversal.
   Preserve the anchor as heads grow; return the current head separately if useful.
2. **Revision get and mixed-revision tree diff.** Resolve full Commit/Layer IDs within the
   requested project without requiring an owning branch name. Return typed revision facts.
   Allow Layer-to-Commit and Layer-to-Layer comparisons with path/prefix selection and existing
   content/identity/metadata flags. Validate project ownership and folder scopes throughout.
3. **Public Layer list/get.** Reuse the existing publication-chain reader, expose source
   Commit/branch and overwritten facts, and keep publication order explicit.
4. **Public bounded file history.** Start from an immutable revision and exact path. Default
   to documented first-parent provenance; offer publication traversal separately when needed.
   Return revision kind/id, change classification, before/after path facts, metadata and
   identity flags, continuation, scanned count and exhausted-versus-budget-limited status.
   A scan may return no matches and still have a continuation. Filtering must not force an
   unbounded scan before answering.
5. **Richer blame origins and bounded work.** Populate deduplicated typed owner summaries,
   including originating branch when known and time when recorded. Add a requested line range
   and a bounded-work continuation contract with explicit unresolved lines; do not silently
   assign ownership when a traversal budget is reached.
6. **Diff presentation improvements.** Distinguish binary, too-large text and omitted hunks;
   add bounded context/hunk windows with line locations and optional absent sides. Return
   full resolved revision IDs on both sides so later pages and detail reads stay pinned.

For file history, start with exact path and explicit content/metadata/identity selection.
Add prefix, operation, time and message filters where query cost can be bounded. Rename
following should be optional and explicit about hardlinks, copies and delete/recreate cases;
an inode-based candidate is not proof of a unique rename. A general arbitrary query language
or project-wide full-text index is unnecessary for the first version.

For branch review beyond two-tip comparison, consider exposing the engine's existing
`merge_base`/`is_ancestor` queries. Label "compare tips" separately from "changes since common
ancestor"; neither alone is a prediction of merge results.

## Proposed Connect experience

- Keep the shared Files tree; add a saved revision selector alongside the branch.
- Open-file modes: Code, Compare, Blame, History.
- Compare defaults to previous revision, with main/other branch/custom saved revision options.
- History rows show actual changes to the selected path, not every Commit on the branch.
- Checkpoint inspector shows operation, time, ancestry, base/root and byte statistics;
  storage contributions must not be labeled as per-file sizes.
- Link blame owners and History changed paths to files pinned at that revision.
- Use query coverage and SDK continuation facts to distinguish no changes from incomplete search.
- Keep live Workspace status separate from saved revision reads.

The preview simulator currently refuses `file.diff` and `file.blame`. Implement their modeled
responses and edge cases before browser-verifying these modes. Native addon correctness still
needs independent SDK tests; simulation is not evidence of native behavior.

## Recommended sequence and acceptance evidence

First agree on revision identity, cursor and traversal contracts. Implement the public history
primitives upstream, then build file-history query UI on those supported calls. Compare/blame
and richer record presentation can proceed independently with current SDK limits disclosed.

Upstream checks should cover concurrent append/force-head movement during pagination, complete
main publication traversal including Init and overwrites, mixed revision diffs, scopes and
project isolation, metadata-only edits, add/delete/recreate, inherited blame owners, merges,
coarse blame, binary/large text, empty filtered pages with continuation, and equivalent semantics
on SQLite and PostgreSQL. Benchmark long sparse path histories and deep continuation separately;
no performance improvement is claimed by this research.

No application or SDK implementation was changed during this research.

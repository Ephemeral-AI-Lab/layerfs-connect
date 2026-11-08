# Branch saved history and comparison SDK specification

Status: proposed contract; not implemented. Written 2026-11-08 for the
`layerfs_v2_0_0` branch, inspected at `716197c4999fb087aa0fb17bac5ceb48b0b556ae`.
The correct branch name has no underscore between `v` and `2`.


The shared [contract and delivery gate](contract.md) governs unresolved cross-call choices;
examples below remain proposals until that gate is settled.

## Purpose and boundaries

`main` is the project's core content. Other branches represent alternate work.
A branch's saved commits are its checkpoints: add no checkpoint family and no
revision family. Expose main's saved publications through the same branch history
interface without pretending that a Layer is a Commit.

This work supplies SDK history and comparison capabilities. Consumer navigation,
graph layout, selection and grouping remain client
responsibilities. This specification does not change merge, fork, publish or write
semantics, introduce human authors, or read live Workspace overlays.

## Verified upstream baseline

The inspected upstream documentation and source establish:

- `branch.get` returns main as `{name:"main", id:null, base:<Layer>, head:null}`;
  side branches expose a Commit head or a null head and base Layer.
- `commit.list` lists side-branch Commit history newest first, with `page_size`
  and `page_pos`; main is refused. Reply budgets can shorten an existing page.
- `commit.get` currently scans that history. Prefixes of at least eight
  characters match the newest matching record; this behavior is compatibility
  behavior, not an appropriate immutable comparison identifier.
- `branch.diff` currently accepts branch names including main, but rejects
  Commit IDs; its options include `paths_only`, `page_size`, `page_pos`, `cursor`.
  Items already distinguish content, identity and metadata changes.
- `read/snapshot.rs` already resolves full Commit and Layer IDs internally.
- `operator/files.rs::revision` follows a publication's source Commit for file
  provenance, falling back to its parent Layer. Main publication order and file
  provenance order are consequently different traversals.
- Existing branch diff and commit history calls refuse folder-scoped clients.

Sources: `docs/architecture/api/sdk/{branch/{get,diff},commit/{list,get}}.md`,
`engine/crates/layerfs-store-service/src/{history/branch.rs,read/snapshot.rs,read/blame.rs,operator/files.rs}`
on the pinned upstream branch. This document proposes extensions beyond them.

## Call inventory

| Call | Status | Contract |
| --- | --- | --- |
| `branch.list(project, options)` | Extend | Add page/page_size interface; retain existing fields/options |
| `branch.get(project, branch)` | Extend | Add typed `saved_head`; preserve existing base/head fields |
| `branch.commits(project, branch, options)` | New | Saved side-branch Commit history or main Layer publication history |
| `branch.get_commit(project, branch, commit)` | New | Details of a saved version admitted through that branch context |
| `branch.diff(project, from_branch, to_branch, options)` | Extend | Pinned Commit/Layer comparisons, path filtering, attribution discovery |
| `branch.fork`, `branch.merge`, `branch.publish` | Retain | Existing signatures and effects |

## Shared identities and record shape

All successful queries return full IDs. Short IDs are presentation only.
`commit` in these call names is a user-facing saved-version term; the wire
representation always distinguishes `Commit` and `Layer`.

```ts
type SavedRef = {
  id: string;
  kind: 'Commit' | 'Layer';
  branch: string | null; // main for a main Layer; originating branch when known
  root: string;
};

type SavedRecord = {
  ref: SavedRef;
  parent: SavedRef | null;
  second_parent: SavedRef | null;
  base_layer: SavedRef | null;
  source_commit: SavedRef | null;
  operation: string; // preserve upstream recorded operation; do not invent events
  message: string | null;
  time: number;      // this record's persisted time in milliseconds
  source_time: number | null;
  statistics: {
    logical: number | bigint | null;
    new_canonical: number | bigint | null;
    new_stored: number | bigint | null;
    new_metadata: number | bigint | null;
  };
  displaced: SavedRef | null;
  lww: unknown[];
  lww_truncated: boolean;
  units?: unknown[];
};
```

These are proposed response types, not current generated declarations. Known
absence is null. Unsupported or clipped metadata must carry an explicit coverage
reason rather than fabricated zero statistics, author identities or dates.
Preserve existing exact-integer SDK transport behavior.

For a publication Layer, `parent` is its preceding Layer and `source_commit`
identifies what was published. Never substitute the source for `parent`, use the
source time as the publication time, or imply publication reassigns line owners.
An Init Layer can have neither parent nor source. For a Commit, a null Commit
parent and non-null base Layer remain separate recorded facts. Graph clients may
draw a base edge; they must not turn it into a fictitious stored Commit parent.

## `branch.commits`

```js
await layerfs.branch.commits(project, branch, {
  page: 1, page_size: 50, at_commit
});
```

- `page` is a positive one-based integer; `page_size` defaults to 50, proposed
  range 1..1000 subject to safe summary reply limits.
- Page one resolves the effective branch head once and returns `at_commit` as a
  typed `SavedRef`. Later requests pass its full ID as the `at_commit` option.
- Main lists Layers newest first through **publication parents**, including Init
  when reached. A source Commit is linked metadata, not an extra publication row.
- A side branch uses the existing history catalogue's Commit traversal, pinned
  to the requested saved start. Return complete parent/base/source links for graph
  assembly; do not silently append main publications as if they were branch commits.
- An empty side branch returns `items:[]` with its base Layer as the resolved
  start and `has_more:false`. Its saved head still supports file reads and diff.
- Membership must follow recorded branch/history relationships, not only
  `record.meta.branch == requested branch`: forks and fast-forward merges may
  legitimately point at existing Commits created elsewhere.
- Default ordering is persisted history traversal, never timestamp sorting.
  Exact merge-side inclusion/order must be documented from the upstream history
  catalogue before implementation; do not choose UI date order to fill this gap.

```ts
type HistoryPage = {
  branch: string;
  at_commit: SavedRef;
  page: number;
  page_size: number;
  items: SavedRecord[];
  has_more: boolean | null; // proposed new-call/new-page-mode value only
  scan: {
    complete: boolean;
    examined: number;
    reason: string | null;
  };
};
```

## `branch.get_commit`

```js
await layerfs.branch.get_commit(project, branch, full_saved_id);
```

Return one `SavedRecord`. Main admits a Layer on its publication lineage; a side
branch admits saved versions reachable through its recorded history/base context.
A random project Commit must not become accessible merely because its ID exists.
Validate project ownership even where content-addressed history shares objects.

Proposed new-call input is a full saved ID. Existing `commit.get` prefix behavior
remains unchanged. If prefixes are later admitted here, require unambiguous
resolution and return the full typed identity; never silently choose the newest
prefix match for a comparison. Do not add aliases named `branch.commit` or `show`.

Main's source Commit is returned as a relationship; viewing that Commit's details
uses its actual branch context. If its originating branch is unknown/unavailable,
expose that fact without inventing a traversable branch name. Authoritative
lookup behavior for deleted/renamed originating branches needs an upstream test.

## `branch.get` and `branch.list`

Add `saved_head: SavedRef` while preserving legacy `head` and `base`. Main's
`saved_head.kind` is Layer; a side branch with no Commit uses its base Layer.
The distinction fixes main's currently null Commit head without changing its
meaning for old consumers.

`branch.list` gains `page` and `page_size`, keeping byte-name ordering including
main. This listing is mutable: unlike saved history, a branch inventory is not
pinned by one Commit ID. Return explicit `consistency:"live"` unless a catalogue
generation snapshot is implemented. Do not claim new branch creation cannot shift
pages. A stable inventory token/index is a separate design decision.

## `branch.diff`

```js
await layerfs.branch.diff(project, from_branch, to_branch, {
  from_commit, to_commit,
  path_prefix,
  include_attribution: true,
  paths_only: true,
  page: 1, page_size: 50
});
```

Retain the positional branch arguments and existing branch-only comparisons.
An absent commit option resolves that branch's effective head. A supplied full
Commit or Layer ID is validated through that branch's admissible saved context.
Mixed Layer/Commit, Commit/Commit and Layer/Layer comparisons are supported within
one project. Resolve both sides once before traversal and return typed `from`
and `to`; subsequent pages and file queries reuse those exact IDs.

`path_prefix` is an absolute validated path with path-component semantics:
`/src` includes `/src/a.js`, not `/src2/a.js`. This filter does not grant folder
scope authorization. Missing sides are null for additions/removals. Type changes
remain explicit facts. A directory changed only through its children remains
omitted, preserving the existing behavior.

```ts
type ChangedPath = {
  path: string;
  kind: 'Added' | 'Removed' | 'Modified';
  type: string;
  before: unknown | null; // existing entry facts, extended compatibly
  after: unknown | null;
  content: boolean;
  metadata: boolean;
  identity: boolean;
  attribution: boolean | null;
  attribution_status: 'not_requested' | 'complete' | 'partial' | 'unavailable';
  attribution_reason: string | null;
  changed_owner_lines: number | null;
  hunks: unknown[] | null;
  hunks_omitted: boolean;
};
```

The reply contains typed endpoints, page fields, `items`, `has_more`, `scan` and
attribution coverage. Existing Added/Removed/Modified kinds are sufficient. An
attribution-only file is Modified with only `attribution:true`; Connect derives
its ownership badge from this independent flag.

`include_attribution` defaults false to preserve the existing query's cost and
meaning. When true, discover files whose text is identical but whose aligned
line owners differ. Equal content roots are **not** sufficient to prune these
paths. Reuse persisted blame/provenance rules: publication alone is not owner
change, copied text can retain ownership according to actual history semantics,
and unknown/coarse ownership never becomes a claimed exact change.

For partially evaluated paths use `attribution:null` with status/reason and
include the path as an unresolved candidate. Do not silently omit it and then
claim the attribution comparison is complete. Binary/nonregular/oversized files
can have valid content/metadata facts while attribution is unavailable.
An exact `changed_owner_lines` count is optional and null unless fully known;
line-owner ranges and alignment belong in `file.diff`, not this path summary.

## Page and bounded-work contract

The public interface is page/page_size, with no new caller-managed cursor.
**Contract gate:** deterministic candidate windows below are a proposed design
decision, not an owner-approved result-page contract. Sparse windows differ from
the common expectation that page_size counts matching results. The common-query
issue must settle that tradeoff before implementation. If result-page semantics
are selected instead, use bounded lookup/indexing or an explicit Capacity refusal
without moving the page; do not fake the requested result page.
Pinning endpoints stabilizes content, but does not by itself solve filtered
pagination or reply-budget truncation. The implementation must satisfy all of:

1. A query is defined by pinned endpoints, traversal/order, filters, inclusion
   options and page size. Changing any of these starts a new page sequence.
2. Each page has a deterministic candidate window. History candidates are saved
   records; filtered comparison candidates are paths in stable byte-path order.
   `page_size` bounds examined candidates, not guaranteed matching results.
   Attribution mode may therefore produce sparse or empty pages.
3. `has_more:true` means a further candidate exists, false means exhaustion is
   proven, null means the bound prevented deciding. It is not a total count or
   proof that a later page contains a matching change.
4. `scan.complete` means this page's candidate window was evaluated, independent
   of whole-query exhaustion. A complete empty window with more candidates must
   not be displayed as “no differences anywhere.”
5. Reply limits must not silently drop part of a window while advancing to the
   next numbered page. Use compact summaries with explicit omitted details,
   preserve every candidate's evaluation outcome, or refuse with a documented
   Capacity/bound reason. Do not return a truncated window as a complete page.
6. When the current window cannot be evaluated, return explicit incomplete state;
   the client must not skip that remainder by incrementing page. Document the
   supported refinement (smaller page, narrower path, or per-file query).
7. No totals or total_pages are promised; random deep page requests must not
   trigger an unbounded scan from the beginning.

An upstream implementation must choose indexed page access, bounded server-side
checkpoints/cache, or a documented depth bound. A pure offset rescan with unlimited
prefix traversal does not meet this contract. Durable provenance indexes require
a separate measured storage/index design; no Store-format migration is assumed.

## Authorization and compatibility

- Preserve existing folder-scope refusals for history/diff. New calls must be
  explicitly classified in `calls/scope.rs`; no default permit for a new name.
- Project-level clients still validate every endpoint against the project and
  branch context. An ID lookup alone is not an authorization check.
- Preserve `commit.list/get/diff`, their current defaults and existing options.
  Old `branch.diff` calls retain legacy paging behavior and boolean `has_more`
  when old paging options
  are used. Additive fields must not replace existing fields with another type.
- Refuse combinations of `page` and legacy `page_pos`/`cursor`; never guess which
  wins. New page mode uses the explicit coverage contract above.
- Keep JS, Python and CLI names/signatures aligned through the call table and
  generators. CLI spellings use `--page`, `--page-size`, `--from-commit`,
  `--to-commit`, `--include-attribution`.
- Preserve the SDK's existing typed refusal envelope and read retry behavior.
  Specify precise upstream error codes for out-of-context saved IDs and bound
  refusals during implementation; tests must not rely on vague empty success.

## Implementation locations

Confirmed existing files/directories on the inspected upstream branch:

```text
api/crates/layerfs-api/src/
  calls/{table,scope}.rs
  branch/{mod,get,list,diff}.rs
control/crates/layerfs-store/src/calls.rs
engine/crates/layerfs-store-service/src/
  methods/branch/{mod,list_commits,diff_branches,diff_commits}.rs
  history/{branch,lookup}.rs
  operator/files.rs
  read/{snapshot,compare,blame,walk}.rs
docs/architecture/api/sdk/branch/{README,get,list,diff}.md
```

Proposed additions: API `branch/{commits,get_commit}.rs`, corresponding Store
method adapters as needed, per-call docs `branch/{commits,get_commit}.md`.
Prefer shared saved-history and comparison helpers over duplicating engines in
the API or Connect. Regenerate SDK front ends from the existing call table and
add contract/scope/engine tests in their existing test locations.

## Acceptance scenarios

1. Init-only main returns one Layer, null parent/source and its own time. Empty
   side branch has no Commit rows and a readable Layer saved head.
2. Publish a Commit at a later time: main lists one publication event with its
   Layer parent/time and separate source Commit/time. Blame remains on source.
3. Between pages, write/publish a new head. Reusing returned pinned references
   produces unchanged ordering, IDs, paths and diff facts.
4. Fork from an earlier main Layer, independently reach identical text with
   different provenance: content-only mode can be empty; attribution mode finds
   that path with content false, attribution true. Metadata/identity flags remain
   independently correct.
5. Compare all three endpoint kind pairs; reverse sides and verify additions,
   removals and before/after metadata reverse correctly. Equal saved endpoints
   have no changes and no manufactured ownership differences.
6. Repeated lines, coarse mapping, long lines, binary files and exhausted blame
   bounds retain explicit uncertainty; none produces a false exact owner change.
7. Sparse page, budget-shortened work, deep page request and end-of-history all
   satisfy the bounded-work contract without skipped candidate windows or totals.
8. A foreign-project ID, unrelated branch ID, ambiguous prefix and folder-scoped
   query are refused. Valid shared ancestry/fast-forward history remains readable.
9. Existing `commit.*` callers, old diff paging options, branch get fields and
   write/fork/merge/publish behavior continue to pass compatibility tests.
10. Node/Python/CLI expose the same new calls/options and full identities; no
    interface needs a new family or client-generated history/provenance engine.

## Decisions required before implementing

- Confirm merge-side history ordering and admissibility against real catalogue
  traversal, including overwritten/displaced heads and branch lifecycle cases.
- Select page-addressability strategy and caps; benchmark attribution-only
  discovery over equal-content trees before promising latency or an index design.
- Confirm whether compact page records can fit the existing reply budget at
  page_size 1000, or establish a lower safe maximum for the new page mode.
- Agree exact new response field names and refusal codes in the upstream review.
  This spec deliberately does not present unimplemented shapes as current SDK.

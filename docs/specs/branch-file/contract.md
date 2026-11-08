# Branch and file SDK: shared contract and delivery gate

Status: proposed implementation specification, 2026-11-08. No SDK implementation or acceptance of unresolved options is implied.

Source baseline: LayerFS `layerfs_v2_0_0` at `716197c4999fb087aa0fb17bac5ceb48b0b556ae`, verified against the local origin ref and GitHub. Implementers must recheck the branch before changing code.

## Owner decisions retained

- `main` is project core content. Side branches represent alternate work.
- Saved branch commits are checkpoints. No extra checkpoint API or new revision family.
- New calls: `branch.commits`, `branch.get_commit`, `file.revision`.
- Retain short existing verbs/nouns and `branch.get`; use the explicitly agreed `get_commit` exception.
- Public pagination is one-based `page` plus `page_size`; no new public cursor requirement.
- Main publications remain Layers with distinct source Commit identities and publication times.
- History and comparison are separate UI pages, with a return control.

## Common version and relationship model

Proposed shared reference: `{ id, kind: "Commit" | "Layer", branch: string | null, root }`.
IDs and roots are complete, not display abbreviations. Unknown originating branch remains null.
Branch ownership must not be guessed from the currently selected branch. Details preserve
parent, base Layer, merge parents and publication source as named separate relations. Publication
order is not source Commit order; a publication must not replace a line's source Commit owner.

First list/history response resolves its starting version; subsequent page requests reuse the
full `at_commit`. A diff resolves both endpoints and returns immutable references reused for path
pages, file diff, metadata, content and attribution. Saved reads never imply live Workspace data.

## Pagination gate (must be resolved before implementation)

Do not add `page` as an offset wrapper over mutable heads or a full scan performed on every request.
Define the following as one documented shared contract across JS/Python/CLI:

1. Stable ordering/tie breaks and the exact meaning of a page under filters.
2. Valid page/page_size ranges, overflow handling, and rejection of mixed conflicting legacy options.
3. How pinned refs, filter values, query shape and page size define one stable query.
4. Bounded work/response budgets and retry semantics that cannot silently skip candidates.
5. More result pages versus incomplete observation, with no false empty-complete result.

The preferred user-facing meaning is a page of matching results. If delivering it needs an index
or bounded cached query state, specify its lifetime and limits before implementation. A proposed
alternative in the branch/file detail specs is deterministic candidate-window pages with sparse
results. That alternative changes user-visible paging semantics and requires explicit review in
the contract task; it is not an owner decision. Exhausting a budget may instead refuse with
`Capacity`, leaving the requested page unchanged. A partially emitted page must never advance
past unreturned records. No public cursor or continuation token is required from the caller.

Preserve legacy boolean `has_more` semantics. Add coverage/completeness fields or use an explicit
bounded refusal rather than silently changing existing response types to nullable booleans.
A successfully complete page can have no matches and more candidate work only if the selected
page contract explicitly supports that. Exact total counts/page counts are not required.

## Diff and provenance contract

Keep Added/Removed/Modified kinds for existing consumers. Content, metadata, identity and
attribution are independent dimensions. Attribution-only changes may have equal file bytes and
roots; comparison must not prune them on content equality. Added/removed sides are explicit nulls
when allowed by file.diff; default legacy missing-path behavior must be settled and documented.

`include_attribution` is opt-in because provenance traversal can be more expensive. Return exact,
coarse, clipped and unknown states explicitly. Only aligned unchanged text with two known
different owners is counted as attribution-only. Missing owners, binary files, truncated ranges
and coarse alignments must not turn into confident owner-change claims.

File diff retains existing left/right arguments; branch diff retains from/to branch arguments.
Existing calls/options and `commit.*` remain compatibility interfaces. Do not rewrite all families'
pagination as an incidental change; scope this contract to the listed branch/file calls.

## Scope and behavior

Define authorization for the new branch history calls and mixed refs explicitly in calls/scope.rs.
A path filter must not accidentally grant folder-scoped callers project-wide history/metadata.
Keep project isolation and existing engine snapshot validation. Read operations do not start
machines, commit, publish, acquire a write lane or mutate Store history. Preserve SDK refusal
codes and explicit unknown results through worker routing and Connect.

## Required verification

- Stable pages across moving branch heads with the same pinned query, including tied timestamps.
- Page 1/last/empty/invalid/oversized requests; filter misses, scan exhaustion and no lost records.
- Layer-to-Commit, Commit-to-Layer, Layer-to-Layer and Commit-to-Commit comparison, including Init.
- Same bytes/different owners; same owner published twice; inherited ownership; missing/coarse data.
- Added/removed files, metadata-only and inode-only changes, binary and large/clipped files.
- JS/Python/CLI parity, legacy calls/options and folder/project scope failures.
- SQLite and PostgreSQL store parity; native and worker-routed reads where applicable.
- Retained failed/unrun outcomes; no claim that UI fixtures prove native SDK behavior.

## Delivery order

1. Shared schema, pagination, compatibility and scope decisions with examples.
2. Branch saved history/details, mixed tree diff, file revision and attribution implementation slices.
3. Generated bindings, CLI/help/docs and contract verification.


Product implementation/docs belong in LayerFS. Connect integration is out of scope.
Cross-layer qualification harnesses/receipts follow layerfs-benchmark policy; focused unit/contract
tests remain beside their product code. No Store-format/index migration is approved by this spec.

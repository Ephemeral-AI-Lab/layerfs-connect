# File SDK: saved revisions and attribution comparisons

Status: proposed contract, 2026-11-08. This document does not claim these additions
are supported by the SDK or by Connect's renderer simulation.


The shared [contract and delivery gate](contract.md) governs unresolved cross-call choices;
examples below remain proposals until that gate is settled.

## Design and researched baseline

`main` is project core content; side branches represent alternate work. A branch's
saved commits are its checkpoints. Add `file.revision`, not a new revision family,
and retain the existing short file verbs and argument ordering.

Reviewed the local LayerFS `origin/layerfs_v2_0_0` at
`716197c4999fb087aa0fb17bac5ceb48b0b556ae` without changing its checkout:

- `docs/architecture/api/sdk/file/{diff,blame,read,list,stat}.md`.
- `api/crates/layerfs-api/src/file/diff.rs`.
- `engine/crates/layerfs-store-service/src/read/{snapshot,compare,blame}.rs`.
- `engine/crates/layerfs-store-service/src/operator/files.rs`.

Current `file.diff` already accepts mixed Commit/Layer selectors through
`left_commit` and `right_commit`; a missing path currently refuses the call. It
returns content equality and inode equality, but no aligned ownership, full typed
endpoint references, metadata flags or line positions. Text comparison has a 1 MiB
per-side bound and the response has a 48 KiB budget; current `Binary` can also mean
text too large for comparison. These are baseline limitations, not target semantics.

Current `file.blame` walks persisted first parents. Commit traversal falls back
to its base Layer; Layer traversal follows its source Commit before its parent
Layer. The implementation already discloses coarse comparisons and clipped lines.
It does not provide typed line owners or a bounded history-work contract. Internal
operator history is not a public `file.revision` contract and currently detects
content-root/kind differences rather than all metadata and identity changes.

## Shared references, facts and coverage

All proposed read responses add a resolved reference. Preserve existing `snapshot`
labels and legacy fields; clients must use the full reference for subsequent reads.

```ts
type SavedRef = {
  id: string;                       // full 66-hex stored identity
  kind: 'Commit' | 'Layer';
  branch: string | null;             // known recorded origin; never guessed
  root: string;                     // immutable filesystem root
};
type FileFacts = {
  type: 'file' | 'dir' | 'symlink';
  inode: number | bigint;
  size: number | bigint;
  mode: number;
};
type ChangeFlags = {
  content: boolean;
  metadata: boolean;
  identity: boolean;
  attribution: boolean | null;       // null: unrequested or unresolved
};
type Owner = {
  ref: SavedRef;
  message: string | null;
};
type Coverage = {
  status: 'complete' | 'partial' | 'unavailable' | 'not_requested';
  comparison: 'exact' | 'coarse' | null;
  reasons: string[];
};
```

An absent file side is `null`; an unresolved owner is `null` accompanied by an
explicit reason. Neither is represented by a fabricated identity. Ownership means
the persisted Commit/Layer that produced the line, not human authorship. Branch
names can be unavailable after deletion; IDs remain usable subject to retention
and authorization. Publication identity and time belong in branch details; a
published line retains its source Commit owner unless history establishes otherwise.

`content` compares actual bytes/type, `identity` compares inode identity, and
`metadata` compares supported persisted attributes. Equal bytes under different
content roots are not a content change. Unsupported attribute fields must not be
invented. Additions/removals are represented by item kind and null sides; compare
flags describe differences between two existing sides. Document this consistently
with `branch.diff` instead of assigning contradictory absent-side booleans.

## `file.revision` — new

```js
file.revision(project, branch, path, {
  at_commit,                        // full Commit/Layer; omitted resolves branch
  page: 1,
  page_size: 50,
  traversal: 'provenance'            // default; alternative 'branch'
})
```

Use the existing validated absolute-path rules. A path absent at the pinned tip
is valid: the query can find its removal and earlier existence. A path that never
existed yields an exhausted empty result. Revision v1 follows the same literal
path across history; it does not infer rename/copy relationships from matching
content or inode. No substring search or new write behavior is included.

`traversal: 'provenance'` follows the established blame chain (Commit first parent
or base Layer; Layer source Commit or parent Layer). It can show inherited changes
from another branch. `traversal: 'branch'` uses the containing branch's saved
first-parent records, or main's publication order; main compares each Layer with
its prior publication Layer. Source links stay separate from publication parents.
No merge-DAG expansion or duplicate visit is implied. Return the selected policy.

```ts
type RevisionResponse = {
  at: SavedRef;
  path: string;
  traversal: 'provenance' | 'branch';
  items: Array<{
    candidate_index: number;         // zero-based within pinned traversal
    ref: SavedRef;
    compared_to: SavedRef | null;    // actual edge used to determine this change
    kind: 'Added' | 'Removed' | 'Modified';
    before: FileFacts | null;
    after: FileFacts | null;
    changes: ChangeFlags;
    message: string | null;
    recorded_at: string;             // actual record time, not source time
  }>;
  page: number;
  page_size: number | bigint;
  has_more: boolean | null;
  end_of_query: boolean;
  scan: {
    complete: boolean;              // this candidate window evaluated
    candidates_examined: number;
    reasons: string[];
  };
};
```

**Design gate:** candidate-window pagination below is an implementable proposal,
not an owner-approved change to the meaning of a page. The shared contract issue
must choose and document candidate windows versus matching-result pages, including
bounded seeking and control-record limits, before implementation. If matching-result
pages are selected, an index or equivalent bounded query plan must replace this
candidate-window response contract; public cursor options are not an alternative.

Page 1 returns `at`; later pages must pass `at_commit: at.id` and identical
path, traversal, page size and scope. Candidate units are saved records in the
chosen traversal, newest first, not matching revisions. Page N examines candidate
indices `[(N-1)*page_size, N*page_size)`, returning only changes in that window.
Consequently a complete sparse page can have zero items and `has_more: true`.
This is deliberately documented as candidate-window pagination, not a promise of
50 matching revisions per page. Proposed default is 50, range 1..1000; the shared
contract issue must finalize caps against the control-record budget.

`has_more: false` requires proven traversal exhaustion; `null` means the server
cannot establish it within its work budget. `scan.complete` concerns only this
window; it does not assert full history exhaustion. An incomplete window cannot
advance blindly to page N+1: retry the same pinned page or use a smaller page size
and recompute the candidate window. Compact records omit optional detail rather
than silently dropping candidates. If even the mandatory window cannot fit or be
evaluated within hard limits, return a typed capacity refusal. A naive translation
of page N to an unbounded offset walk is not acceptable: deterministic seeking,
measured replay limits or an index is a delivery prerequisite. No public cursor.

V1 revision discovery detects content, metadata, identity, additions and removals.
It does not run dual blame for every candidate; `changes.attribution` is null.
Attribution comparison belongs in `file.diff` and attribution-only path discovery
in `branch.diff`, avoiding an implicit unbounded provenance scan in revision lists.

## `file.diff` — compatible extension

```js
file.diff(project, left_branch, left_path, right_branch, right_path, {
  left_commit,
  right_commit,
  include_attribution: true,
  allow_missing: true,
  page: 1,
  page_size: 100
})
```

Preserve the existing five positional arguments and each `*_commit` override's
precedence over its branch. Both references are resolved once in the same Store
read session before reading any file data. Return them even when a file is absent.
Reuse them on every subsequent diff page and on Code/Blame reads. Comparing two
different paths remains valid; this API does not assert a rename relationship.

`allow_missing` defaults false for compatibility. When true, one missing side is
an addition/removal; both missing sides still return `NoSuchPath`. Invalid or
inaccessible selectors and invalid paths never become missing-side success.
Directories retain the existing refusal. Symlink byte comparison remains supported
where currently supported; line attribution is unavailable for nonregular files.

Legacy calls without new options retain their current `kind`, `left`, `right`,
`content_equal`, `same_inode`, `hunks_omitted` and `hunks` fields. New fields are
additive. Explicit paged mode returns the proposed comparison rows below and must
document that legacy hunks remain a bounded compatibility view, not the full diff.

```ts
type DiffRow = {
  index: number;                     // stable within pinned comparison
  op: ' ' | '-' | '+';
  left_line: number | null;
  right_line: number | null;
  text: string | null;
  text_clipped: boolean;
  before_owner: Owner | null;
  after_owner: Owner | null;
  owner_changed: boolean | null;
  attribution_coverage: Coverage;
};
type DiffExtension = {
  left_ref: SavedRef;
  right_ref: SavedRef;
  before: FileFacts | null;
  after: FileFacts | null;
  change_kind: 'Equal' | 'Added' | 'Removed' | 'Modified';
  changes: ChangeFlags;
  content_coverage: Coverage;
  attribution_coverage: Coverage;
  omission_reason: null | 'binary' | 'text_limit' | 'reply_budget'
                       | 'unsupported_type' | 'history_budget';
  rows: DiffRow[];
  page: number;
  page_size: number | bigint;
  has_more: boolean | null;
};
```

Server alignment is deterministic and shared with blame's comparison policy.
All aligned rows, including equal lines, form the paged sequence. A later optional
context-folding representation must not change row indices or silently omit
attribution-only rows. Keep full-file equality checks independent of displayed
windows. Computing a bounded text alignment must not claim exact global alignment
for a larger file; return coarse coverage or explicit unavailable status.

For an unchanged aligned line with two exact known owners, `owner_changed` is the
comparison of typed full owner identities. Compare `(kind,id)`, not labels, message
or publication time. When either owner is unavailable or the mapping is coarse,
the comparison cannot assert an exact owner change: return null with coverage.
For `+` and `-` rows, `owner_changed` is false; changed content already explains the
row. Return whichever side's owner exists if requested. Matching duplicate lines
must use the same deterministic tie-breaking across pages and repeated requests.

`changes.attribution` is true when at least one exact unchanged row has changed
owner, false only after complete exact evaluation establishes none, and null if
incomplete evaluation has not established a change. Positive evidence can coexist
with partial coverage; never interpret partial coverage as a zero total. Do not
publish an exact count unless the complete comparison was evaluated.

Binary and oversized text are distinguishable. Return exact content equality when
available without text, metadata and identity facts, and explicit omitted/unavailable
line attribution. Identical binary bytes do not establish identical provenance.
Clipped text is a display limit, not proof that omitted bytes or owners match.
The same fixed-window/budget rules as revision apply to row paging: no dropped
rows when a reply budget is reached. Capacity refusal is preferable to silent gaps.

## `file.blame`, bounded reads and directory queries

Keep `file.blame(project, branch, path, commit?, options)` and existing `from_line`.
Add `line_count` (positive, capped by the existing 2000-line maximum), resolved
`at: SavedRef`, typed `owner` per line and deduplicated `origins`. Preserve line
`commit` and `message` compatibility fields. Existing `comparison_coarse`,
`line_truncated`, `clipped` and `next_line` stay meaningful; add coverage and bounded
history-work reasons. Unknown ownership is explicit null, not assigned to the tip.
Use a numeric line number continuation, not a public cursor. Source Commit ownership
is retained through main publication; Layer owners remain valid for initialization
or other Layer-originated content. Do not add an inferred human author field.

Keep `file.read`'s positional saved-version argument and `start_line`/`end_line`,
add `at: SavedRef` and explicit clipping/omission coverage. Retain current bounded
text reads and binary refusal. This proposal does not create a whole-file byte
download API. `file.stat` adds `at` without changing metadata semantics.

`file.list`, `file.glob` and `file.grep` add `page` alongside `page_size`; their
existing saved-version arguments remain. Retain old `page_pos` as compatibility;
reject supplying `page` and `page_pos` together. Define deterministic per-call units
and ordering in their call docs: directory entries by name, glob by canonical path,
grep by canonical path then line. All page modes pin `at` and filters. Candidate
windows versus matching-result pages must be explicit for glob/grep; do not claim
bounded arbitrary matching-result pages without an implementation that can seek
them. This is a shared-contract delivery decision, not hidden SDK behavior.
Existing legacy responses retain boolean `has_more` and their existing continuation
fields. A tri-state `has_more` applies only to explicitly new response contracts;
do not silently widen legacy booleans or treat incomplete work as exhausted results.

All existing `write`, `edit`, `cp`, `mv`, `mkdir`, `rm` and `apply` contracts remain.
Reads inspect saved trees, never live Workspace overlays. Side-branch writes and
publication to main continue through the existing APIs.

## Scope, failures and compatibility

- Authorize both diff paths and all snapshot references before returning facts.
  Revision traversal must not reveal out-of-scope paths, branch metadata or messages.
- Keep normal missing Store/project/branch/commit, unavailable worker, busy Store,
  path/type and binary read refusals. A read-only retry must reuse pinned IDs.
- Unknown ownership and truncated output are data coverage states, not fabricated
  successful exact answers. Transport loss remains the existing uncertain refusal.
- Preserve existing signatures and `commit.*` compatibility. Regenerate Node and
  Python declarations and verify CLI options from the same call table.
- Use existing first-parent policies; do not silently expand merges, follow renamed
  paths, inspect live workspaces or reassign provenance at publication.

## Implementation locations

```text
api/crates/layerfs-api/src/file/
  revision.rs                     new call
  {mod,diff,blame,read,stat,list,glob,grep}.rs
api/crates/layerfs-api/src/calls/{table,scope}.rs
control/crates/layerfs-store/src/calls.rs
engine/crates/layerfs-store-service/src/
  methods/file/                   new revision and extended diff/blame arguments
  read/{snapshot,compare,blame}.rs shared typed refs, alignment and coverage
  operator/files.rs               reuse traversal facts, do not copy old limitations
  history/                        bounded ancestry seeking as needed
api/scripts/gen-node-types.mjs
api/node/src/index.d.ts
api/python/tools/gen_stubs.py
api/python/src/layerfs/
api/crates/layerfs-api/tests/
docs/architecture/api/sdk/file/{revision,diff,blame,read,stat,list,glob,grep}.md
```

No Store-format migration is assumed. Measure ancestry/attribution performance
before choosing persistent indexes or cache structures. The branch-diff issue must
share the same attribution evaluator; equal tree/content roots alone cannot prune
all attribution-only paths. Connect consumes these facts rather than implementing
an independent history/blame engine.

## Acceptance criteria

1. Existing Node/Python/CLI diff signatures and legacy fields remain functional;
   `left_commit` and `right_commit` override branch selectors independently.
2. Commit/Commit, Layer/Layer and Commit/Layer comparisons return exact full refs;
   moving heads between pages cannot change pinned results.
3. Same bytes reached independently produce exact owner changes on unchanged lines;
   same source content published to main retains its source owners and produces none.
4. Added/removed sides work only with `allow_missing`; both absent still refuses.
   Content, mode-only and inode-only changes are distinguished; edits away/back
   yielding a different root but equal bytes do not report changed content.
5. Repeated lines, inserted/deleted lines, empty files and trailing newline changes
   reconstruct correctly from deterministic rows; new/deleted rows are not counted
   as attribution-only changes.
6. Binary, oversized text, long clipped lines, history work limits and coarse mapping
   report distinct coverage; unknown owners never become exact owner changes.
7. Revision detects additions, deletion/recreation, metadata-only and identity-only
   changes even when the pinned tip has no file. Literal-path behavior after rename
   is documented and tested. Publication and provenance policies are tested separately.
8. Sparse revision pages, nonfirst-page retries, changed page sizes, end-of-history
   and reply/work-budget limits cannot lose or duplicate candidate windows. Bounded
   traversal performance is measured on long histories; no unbounded offset fallback.
9. Both comparison paths, historical trees and returned messages obey folder scope;
   invalid IDs and inaccessible paths cannot be masked as an allowed missing side.
10. Generated SDK declarations, per-call docs, forwarding layers and CLI exposure
    agree. Real Store contract tests cover SQLite and relevant worker routing;
    simulated UI fixtures are not substituted for SDK evidence.

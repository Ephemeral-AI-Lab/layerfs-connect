# Branch and file SDK proposal — saved copy

Saved 2026-11-08 from the design discussion. Proposed contract only; not implemented in LayerFS.

Detailed implementation specs and the published task tree: [Branch/file specification index](specs/branch-file/README.md).
Parent: [layerfs-project#128](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/128).
The shared-contract issue must resolve the explicitly proposed pagination alternatives before implementation.
This copy supersedes the naming suggestions in `storage-files-sdk-research.md`.

The project core content is `main`. Side branches hold alternate lines of work.
A branch's saved commits are its checkpoints; no separate checkpoint API or new family is added.
For main, the branch API exposes publications as saved versions while retaining underlying Layer
identity and source Commit metadata. It must not substitute source Commit time for publication time.

## Branch

| Call | Status | Purpose |
| --- | --- | --- |
| `branch.list(project, options)` | Update pagination | List branches, including main |
| `branch.get(project, branch)` | Update | Branch details with a consistent full saved head reference |
| `branch.fork(...)` | Existing | Fork from a branch or saved version; retain existing arguments |
| `branch.merge(...)` | Existing | Merge two branches into a new branch; retain existing arguments |
| `branch.publish(project, branch, options)` | Existing | Publish saved branch content to main |
| `branch.commits(project, branch, options)` | Added | Paged saved history, including main publications |
| `branch.get_commit(project, branch, commit)` | Added | Details for one saved commit/publication |
| `branch.diff(project, from_branch, to_branch, options)` | Update | Compare branches or saved versions selected on either side |

`branch.diff` gains optional `from_commit`, `to_commit` and path/prefix selection, supports
Commit/Layer combinations, and returns full resolved version IDs. Branch-only comparisons remain
valid. Cross-branch comparisons stay within one project.

`branch.get_commit` returns id, kind, branch, parents/base, root, operation, message, recorded
time, merge/displacement facts, and available byte statistics. Publication/source identities
remain separate. Exact response schemas and optional argument details still need upstream agreement.

## File

| Call | Status | Purpose |
| --- | --- | --- |
| `file.list` | Update | Directory entries, resolved full version ID and pagination |
| `file.stat` | Update | Path metadata and resolved full version ID |
| `file.read` | Update | Bounded content/line reads and resolved full version ID |
| `file.glob` | Update pagination | Find paths by glob |
| `file.grep` | Update pagination | Search file content |
| `file.revision(project, branch, path, options)` | Added | Paged commits that changed a path |
| `file.blame` | Update | Typed owner details, originating branch where known, line ranges and explicit partial results |
| `file.diff` | Update | Added/deleted sides, reason for omitted text, line locations and bounded diff windows |
| `file.write` | Existing | Create or replace content |
| `file.edit` | Existing | Replace matching text |
| `file.cp` | Existing | Copy a path |
| `file.mv` | Existing | Move or rename a path |
| `file.mkdir` | Existing | Create a directory |
| `file.rm` | Existing | Remove a path |
| `file.apply` | Existing | Apply a batch of supported changes |

Existing write signatures and constraints stay as documented by LayerFS. File reads show saved
content, not live uncommitted Workspace overlays. Writes target side branches; publish updates main.

## Pagination and history semantics

- Public options: `page_size` and `page`, with page 1 first.
- First history response includes a full saved starting reference (`at_commit`, proposed name).
  Reuse it on later pages so a new branch head does not shift results.
- Preserve existing calls/options, including `commit.*`, as compatibility interfaces.
- Return `has_more`; do not require a full scan to compute total pages.
- `file.revision` distinguishes content, metadata and identity changes, including additions and
  deletions. A bounded scan may return no matches and still have more work.
- Explicitly distinguish branch-own history, inherited provenance and main publication order.
- Return full typed identities, clipping/omission reasons and incomplete-scan status.

```js
branch.commits(project, branch, { page_size: 50, page: 1 })
branch.get_commit(project, branch, commit)
branch.diff(project, branch, branch, { from_commit, to_commit })
file.revision(project, branch, path, { page_size: 50, page: 1 })
```

## Renderer simulation

The development web preview's `shop/api` Files view demonstrates this proposal with in-memory
sample commits, file trees, comparisons, blame and revisions. It calls no proposed SDK methods
and changes no Store, project, branch or file. Samples are labeled in the UI; the preview is disabled
in real mode and production builds. The existing host-backed Files view remains available through
the preview's exit control. This simulation is visualization, not evidence of native SDK behavior.

Verified in the existing browser preview at 1280x820 and 900x600: branch switching, saved-version
selection, comparisons against a parent/branch/arbitrary saved commit, swapping sides, added and
removed-file comparisons, inherited blame owner inspection, commit and revision paging, page size,
revision search/clear, keyboard view navigation, historical absent paths, binary content/blame
states, and returning to/from the original host Files view. The observed local preview interactions
made no project API requests and reported no new runtime errors during the monitored interval.
Desktop typecheck/build and fixture consistency checks passed. Native desktop behavior was not tested.

The same local samples also drive Storage `shop/api/history`: commit-parent and collapsed-group
net changes and explicit pinned From/To comparisons open a separate `/history/diff` page with
Back to History, changed paths and shared Content/Attribution/Code/Blame viewers.
Blame links to origin details and its producing change, with a return to the original comparison.
This remains a renderer visualization, with the original host-backed History available separately.

Attribution comparison aligns the content diff with blame at both pinned endpoints. Unchanged
lines with different owning Commit/Layer IDs are highlighted separately from additions/removals.
The example compares main with an earlier-forked review branch that independently reached the
same text. Published content retains its source Commit attribution; publication alone does not
mean the owner changed. Missing attribution is unknown, never an inferred owner change.

For future SDK support, keep these queries under `branch.diff` and `file.blame`/`file.diff`.
An optional attribution inclusion on `branch.diff` should discover attribution-only paths even
when file content is equal; content-only tree pruning cannot guarantee this. Return coverage
and explicit unknown/unavailable states with bounded page/page_size queries at pinned endpoints.
The renderer simulation demonstrates this contract without implementing SDK changes.

## Refinements after the separate comparison and attribution simulation

Proposed, not implemented. The upstream Git branch is `layerfs_v2_0_0`.

- Keep the three additions: `branch.commits`, `branch.get_commit`, `file.revision`.
- `branch.diff(..., { include_attribution: true })` must discover paths with equal content
  but different line ownership. Preserve existing Added/Removed/Modified item kinds; add an
  independent `attribution` change flag and explicit coverage. The UI's O badge is presentation.
- `file.diff` retains its existing left/right arguments and gains optional
  `include_attribution`. Return aligned line positions and typed before/after owners alongside
  content hunks, with separate unknown/coarse/clipped states. Use the same alignment semantics
  as the server's blame implementation; clients should not each reconstruct this themselves.
- Resolve both comparison endpoints once. Return full typed Commit/Layer references and reuse
  those exact endpoints for changed paths, file content, metadata and attribution pages.
- Commit details retain distinct parent, base Layer and publication source relationships.
  Source Commit and publication time/identity are separate; a source link is not a parent.
- Page/page_size remain public. Filter values, ordering, page size and pinned endpoints define
  the query. No total count is promised. Distinguish more results from an incomplete scan and
  document bounded query behavior; an empty bounded scan is not proof of no matching history.
- Metadata and identity changes remain independent from content and attribution. Missing file
  sides are explicit nulls for additions/removals, not failed file reads.
- The separate History and Comparison routes do not require a new SDK call or family.

## Proposed implementation locations

These are change locations and proposed files, not a completed migration. Existing source layout
is retained. No physical Store format change is implied by this API proposal; persistent indexes
for history/provenance need a separate measured design if query performance requires them.

### LayerFS repository

```text
api/crates/layerfs-api/src/
  calls/table.rs                 register calls/options
  calls/scope.rs                 explicit history/path authorization
  branch/{mod,commits,get_commit,diff,get,list}.rs
  file/{mod,revision,diff,blame,read,stat,list,glob,grep}.rs
control/crates/layerfs-store/src/
  calls.rs                       translate and forward options
engine/crates/layerfs-store-service/src/
  methods/branch/                expose saved history and mixed-version comparison
  methods/file/                  revision and attribution-aware file reads
  history/                       Commit/Layer lookup and distinct relationships
  read/                          snapshot, compare, blame; shared revision traversal
api/scripts/gen-node-types.mjs   regenerate Node declarations from call table
api/node/src/index.d.ts          generated declarations
api/python/tools/gen_stubs.py    regenerate Python declarations
api/python/src/layerfs/          generated declarations; same call contract
api/crates/layerfs-cli/src/      verify table-driven command/option exposure
api/crates/layerfs-api/tests/    contract, scope and pagination tests
engine/crates/layerfs-store-service/  focused engine tests in existing test layout
docs/architecture/api/sdk/
  branch/{commits,get_commit,diff,get,list}.md
  file/{revision,diff,blame,read,stat,list,glob,grep}.md
```

### Connect repository

```text
host/
  projects.js                    keep project operations; delegate history/file reads
  history.js                     proposed: bounded SDK history/comparison adapter
  files.js                       proposed: saved file/revision/blame/diff adapter
  server.js                      HTTP routes, preserving SDK refusals and coverage
  test/                          host contract tests
desktop/src/renderer/src/
  layerfs/
    host-api.ts                  host response types, Commit/Layer references
    history-api.ts               paged history and branch comparison requests
    file-api.ts                  proposed: saved file, revision, blame and diff requests
    simulation/
      files-history/             proposed: move shared fixture trees/adapters here
  components/history/
    ProjectHistory.tsx           graph view and data loading
    HistoryGraph.tsx             shared graph presentation
    BranchDiff.tsx               proposed: separate comparison page, Back to History
    model.ts                     graph layout/aggregation
  components/files/
    FilesTab.tsx                 shared tree and open files
    FileExplorer.tsx             proposed: shared saved-file views
    FileDiff.tsx                 content and file-fact comparison
    FileAttributionDiff.tsx      before/after line ownership
    FileBlame.tsx                single-endpoint ownership
    CommitDetails.tsx            shared inspector
    PageControls.tsx             page/page_size controls
  pages/storage/project/
    ProjectPage.tsx              /history and /history/diff route selection
    ProjectTabs.tsx              History remains active for comparison
  pages/chat/history/            reuse shared history/components in chat
desktop/tools/                  graph, fixture and attribution model checks
docs/ui/{chat-history,project}.md
docs/sdk-branch-file-proposal.md
```

`HistoryPreview.tsx` and `FileExplorerPreview.tsx` currently own the sample interactions. Before
connecting real SDK reads, extract shared views and put real and sample loading behind the same
view contract. Keep fixture data gated to development simulation; do not copy LayerFS's history
or blame engine into Connect. Host adapters preserve null/unknown and partial results instead
of calculating missing Store facts. Keep route selections and return state in Connect.

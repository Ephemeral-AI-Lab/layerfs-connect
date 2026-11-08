# Connect integration: branch and file history

Status: withdrawn from this task on 2026-11-08 at the owner’s request. Connect integration is not planned here; #135 is closed and removed from the parent/project. Historical proposal retained for context. No SDK or host implementation
is supplied by this document. Target upstream branch: `layerfs_v2_0_0`.

Contract authority: [shared schema and delivery gate](contract.md),
[branch contract](branch.md), and [file contract](file.md). Resolve their pagination,
compatibility and authorization gates before implementing these consumers.


The shared [contract and delivery gate](contract.md) governs unresolved cross-call choices;
examples below remain proposals until that gate is settled.

## Outcome and ownership

Connect uses the proposed branch/file SDK contract to browse saved project content, main
publications, branch commits, file revisions and attribution. `main` remains project core
content. Branch commits are checkpoints; no checkpoint or revision family is introduced.

The History graph and branch comparison are separate pages. Both use the same saved-version
identities and shared file viewers as Files. SDK/Store code owns snapshot resolution,
history traversal, diff alignment, and provenance. Connect owns navigation and presentation.
The existing renderer simulation is a visualization of this design, not SDK conformance proof.

## Verified current boundary

Read-only references used for this specification:

- LayerFS `origin/layerfs_v2_0_0`: `docs/architecture/api/sdk/README.md` and
  `branch/diff.md`; source paths are linked by those call pages.
- Connect `docs/sdk-branch-file-proposal.md`, `docs/layerfs-2.0-integration.md`,
  `docs/layerfs-model.md`, and `docs/ui/{chat-history,project}.md`.
- `host/projects.js`, `host/server.js`, renderer `layerfs/{host-api,history-api}.ts`,
  `components/history/{ProjectHistory,HistoryPreview}.tsx`,
  `components/files/{ProjectFiles,FilesTab,FileExplorerPreview}.tsx`, and
  `pages/storage/project/ProjectPage.tsx`.

Today the host History adapter uses `commit.list/get/diff`, returns no main history and
returns unavailable changes at the first Commit's Layer boundary. It exposes zero-based
`pos` and a moving-head check. The upstream documented `branch.diff` compares branch heads,
uses `page_pos`/`cursor`, and does not provide attribution. These limitations must not be
hidden by client-side reconstruction.

Current host Files reads target branch heads. `listDir` drains directory pages; `file`
performs a stat followed by line-window reads. Neither establishes one immutable saved
version across the whole operation. The new adapter must pin before reading and preserve
bounded responses instead of draining arbitrarily large histories, directories or files.

## Dependencies and rollout gates

| Required upstream contract | Connect consumer | Gate |
| --- | --- | --- |
| `branch.get/list` typed resolved heads; `branch.commits/get_commit` | graph and inspector | Main publications and separate source/parent/base relationships must be represented faithfully |
| Mixed Commit/Layer `branch.diff`, pinned endpoints, changed-path pagination | comparison page and collapsed-group net changes | First checkpoint, main-to-branch and arbitrary saved versions require upstream support |
| Attribution discovery in `branch.diff(include_attribution)` | ownership-only changed paths | Equal-content/root pruning must not silently discard provenance differences |
| `file.diff(include_attribution)` aligned owners and coverage | Content and Attribution tabs | Client does not join blame streams or implement LCS for real data |
| Pinned `file.read/stat/list`, bounded blame and `file.revision` | shared Files/Code/Blame/Revisions | Reads and later pages must refer to the same resolved saved version |
| Public `page_size`/`page`, immutable anchors, explicit scan status | all paged views | No fabricated totals, continuation or completeness |
| Generated SDK declarations and compatibility/error contract | host and typed client | Upgrade the linked SDK through the repository's normal dependency process |

Use the contracts agreed in the sibling branch/file specifications; this integration does
not invent an alternate schema. If a dependency is unavailable, keep the existing supported
host behavior and display the unavailable capability explicitly. Never fall back to sample
results in real mode. Existing `commit.*` callers remain supported during migration.

## Host and renderer contract

Keep HTTP routing in `host/server.js`; delegate SDK reads to focused host adapters. Proposed
route names below are Connect HTTP endpoints, not additional LayerFS API families:

| Request | Response responsibility |
| --- | --- |
| Existing `/api/projects/:encodedProject/history` | Branch pages and saved record pages with `branch`, `page`, `page_size`, immutable history anchor; migrate consumers together |
| `/api/projects/:encodedProject/history/commit` | Exact saved record details scoped by project/branch/version |
| `/api/projects/:encodedProject/history/diff` | Changed-path page for one pinned pair and fixed filters, with independent change flags and coverage |
| Existing `/api/projects/:encodedProject/fs` and `/file` | Bounded directory/content reads at an explicit saved version; retain legacy callers with explicit compatibility handling |
| `/api/projects/:encodedProject/file/diff` | One path's pinned before/after facts, hunks, aligned ownership and omission status |
| `/api/projects/:encodedProject/file/blame` | One endpoint's bounded ownership lines |
| `/api/projects/:encodedProject/file/revision` | Paged saved path changes at a pinned history anchor |

All routes are read-only GETs. Preserve structured SDK `code`, `message`, `detail`, null
sides, typed full references, scan status and omission reasons. Validate project/path,
page bounds, endpoint ownership and allowed options before forwarding. Apply SDK scope
rules without widening access; redact no error into a successful empty result. Route
parsing and project-key encoding require tests because project keys contain `/`.

Resolve mutable branch selections once through the SDK. The returned full typed endpoints
become the request identity for changed paths, file views and later pages. Cache keys include
project, full endpoints, path, include-attribution, filter/order, window and page size/page.
Cancel or ignore stale requests on selection changes. A late response must not overwrite a
new pair. Changing filters/page size restarts page 1 while retaining pinned endpoints.

For genuine history-anchor expiration or version unavailability, retain visible selections,
show the SDK reason and offer an explicit refresh. Do not silently substitute the new head.
Bound concurrency using the existing host pattern (currently four reads); lazily fetch
details and selected files rather than eager per-record or per-path diff/blame queries.

## Navigation and shared views

| Route | Behavior |
| --- | --- |
| `/storage/:store/:project/history` | Full graph. Selecting a node changes graph selection only. Open changes navigates explicitly. Use as base pins the From version. |
| `/storage/:store/:project/history/diff` | Full comparison page, no graph/diff split pane. History remains the active project tab. Back to History restores the prior graph. |
| Existing Files route | Shared tree/open files with saved version selector and Code, Compare, Attribution, Blame, Revisions |

Use existing hash-router query selections (`branch`, `commit`, `from`, `path`, `view`) as
the compatibility starting point. Serialization must retain both endpoint branch contexts
and typed full identities after the SDK resolves them; expand query fields if needed rather
than guessing the originating branch from a shortened ID. A direct comparison deep link
must load without an in-memory graph visit. A direct-link Back button returns to History
focused on the resolved destination if there is no prior graph state.

Before navigating from graph, retain selected node/group, pinned base, filters, expanded
groups/families, lane choices, zoom and viewport. Back restores this state. Browser Back and
Forward follow the route history. Do not create a history entry for every scroll event.
Keep graph state outside the comparison component, or retain a hidden mounted graph; either
implementation is acceptable if the state restoration tests pass.

Open changes uses the saved record's actual parent/base, including mixed Layer/Commit cases.
Init compares to an explicit empty side. A collapsed group compares its first predecessor
to its final saved version and is labeled net changes; it is not a sum of constituent diffs.
Source publication edges, parents and base links stay distinct; topology is never inferred
from timestamps. Unknown relationships are displayed as unknown.

Comparison supports pinned From/To selectors, swap, changed-path search/paging and shared
Content/Attribution/Code/Blame views. Code and Blame default to the destination and state
that endpoint. Deleted destinations offer Content comparison; missing sides are expected
states, not failed reads. File metadata and identity changes remain visible when text matches.

Attribution displays before/after owners only for server-aligned lines. An equal-text line
with two known unequal owner IDs is an ownership change. Added/removed lines are content
changes; missing owners are unknown. Preserve independent content/metadata/identity/
attribution flags. Retain ownership-only paths in the list, with a presentation badge rather
than a new SDK item kind. Published lines may retain source Commit ownership; do not assign
the publication Layer or a human author merely because a publish occurred.

Owner links open shared saved-record details. Show this change opens that record's producing
comparison. Back to comparison restores the original pair, path, active view, page/filter
and scroll. The inspector must distinguish publication identity/time from source Commit
identity/time and show only available metadata.

## Coverage, errors and pagination presentation

- Pages start at 1. Use `has_more` to enable Next, not a locally invented final page count.
  A retained earlier page permits Previous; a server scan-status response determines the
  continuation behavior agreed upstream. Never automatically scan to exhaustion.
- Matching-result pages are the preferred meaning. Sparse candidate-window pages are only
  an alternative for review under the shared pagination gate, not an approved UI behavior.
  A budget refusal leaves the requested page unchanged; do not increment past missing rows.
- An empty completed result is different from an empty bounded/incomplete scan. The latter
  shows incomplete coverage and the supported explicit continuation/retry action.
- Preserve unknown, unavailable, coarse and clipped states independently. Unknown
  attribution does not mean unchanged; no-text binary/large content does not mean empty.
- Coverage notices belong to the affected result or line window. A complete changed-path
  page does not imply complete attribution for every selected file.
- Keep graph/path selection while a local file query fails. Loading, empty, filtered-empty,
  absent-side, unavailable-version, binary and permission/refusal states are distinct.
- Do not invent total match counts, human author identity, rename-following semantics,
  unloaded ancestry or provenance from paths, filenames, repeated text or inode equality.

## Source layout and migration

```text
host/
  projects.js                       existing project lifecycle; delegate read adapters
  server.js                         existing HTTP dispatcher
  history.js                        NEW: saved records and branch comparison SDK adapter
  files.js                          NEW: pinned saved-file/revision/diff/blame adapter
host/test/
  history.test.js                   existing bounded history adapter tests
  branch-file.test.js               NEW: host contract tests with SDK doubles
desktop/src/renderer/src/
  layerfs/
    host-api.ts                     existing shared host types; add canonical read DTOs
    history-api.ts                  existing HTTP client; migrate paging and anchors
    file-api.ts                     NEW: saved file query client
    simulation/files-history/       NEW: move shared local fixtures/adapters here
  components/history/
    ProjectHistory.tsx              existing graph loader; shared view orchestration
    HistoryGraph.tsx                existing graph presentation
    model.ts                        existing graph layout/aggregation only
    BranchDiff.tsx                  NEW: separate shared comparison page
    HistoryPreview.tsx              existing sample wrapper, reduce to adapter wiring
    preview-model.ts                existing sample graph adapter, move with fixtures
  components/files/
    FilesTab.tsx                    existing shared tree and open-file shell
    FileExplorer.tsx                NEW: saved-file modes, independent of data source
    FileExplorerPreview.tsx         existing sample wrapper, reduce to adapter wiring
    FileDiff.tsx                    existing content/file-fact presentation
    FileAttributionDiff.tsx         existing ownership presentation
    FileBlame.tsx                   existing single-endpoint ownership presentation
    CommitDetails.tsx               existing common inspector
    PageControls.tsx                update for has_more/coverage without total count
  pages/storage/project/
    ProjectPage.tsx                 existing /history/diff route -> History tab
  pages/chat/history/               retain shared components and Trace links
desktop/tools/                     focused graph/fixture/attribution checks
docs/ui/{chat-history,project}.md   update behavior diagrams with final integration
```

This is a source-module migration, not a new on-disk Store/home layout. Extend the existing `host/test/history.test.js` and related host suites; older root
`test/*.test.mjs` suites may also apply to shared code. Do not duplicate the older
root renderer under `src/renderer/`. The shared fixtures currently live in
`components/files/file-preview-data.ts`; move them without leaking imports into real loaders.
The local sample alignment helper is test/sample code and must never become the real
provenance engine. Real loaders consume SDK-aligned results directly.

The sample entry gate remains `import.meta.env.DEV && connectBridge.mode === 'sim' &&
project === 'shop/api'`, excluding chat Trace History where it is currently excluded.
Keep a conspicuous Sample/read-only notice and explicit host-view switch. Production and
real mode must never select renderer fixture data, including on errors or missing SDK calls.

## Proposed issue slices and acceptance

### CONNECT-1 — Shared query contracts and bounded host adapters

Depends on upstream canonical saved references, pagination, branch history/mixed diff and
file revision/diff/blame contracts. Implement adapters/types and extract data-independent
shared views; keep existing supported endpoints compatible while consumers migrate.

Acceptance:

1. SDK doubles assert that first resolution occurs once and all downstream file/page
   queries reuse exact full endpoints. Main publication and source Commit remain distinct.
2. Tests cover first-Commit-vs-Layer, Init empty side, added/deleted files, metadata-only,
   identity-only and equal-content ownership-only results.
3. Structured refusals, unknown owners, incomplete scans, clipped/binary windows and
   has_more survive the HTTP round trip. No all-page/per-path eager scan occurs.
4. Invalid project/path/page and cross-project references fail without widening SDK scope.
   Existing chat/Trace and legacy head-reading callers retain their supported behavior.
5. Stale responses cannot replace a newer query; fixtures cannot substitute for real data.

### CONNECT-2 — Real saved history, separate comparison and file modes

Depends on CONNECT-1 and the complete upstream attribution-discovery/alignment contract.
Wire the shared graph, separate comparison route, inspector and saved Files modes to real
responses; retain development simulation as another adapter for the same views.

Acceptance:

1. In browser web preview, at 1280x820 and 900x600, graph selection does not open a diff;
   Open changes opens `/history/diff`; Back restores selection, pinned base, expanded
   groups, zoom and viewport. Direct links and browser Back/Forward behave coherently.
2. Swap reverses endpoints. Parent, mixed main/branch, arbitrary saved versions and group
   net comparisons use correct pinned roots. Branch head movement does not shift pages.
3. Content, Attribution, Code and Blame work for text, binary, omitted text, absent sides,
   equal content with changed owners, unknown attribution and local errors. Independent
   metadata/identity flags remain visible.
4. Owner -> details -> Show this change -> Back restores the original pair/path/view,
   path-page/filter and scroll. Publication/source ownership and time remain distinct.
5. Files directory/version navigation, open tabs and Revisions use shared components;
   incomplete/empty pages and page-size changes display honestly without exact totals.
6. Verify chat Example History/Trace links and host/sample exits. Monitor console errors
   and request counts; sample interactions issue no proposed SDK calls or writes.
7. Run `pnpm --dir desktop -s typecheck`, `pnpm --dir desktop -s build`, relevant host
   tests (`node --test host/test/history.test.js`), applicable root tests and focused desktop model tests. Record
   actual exercised flows. Use `pnpm --dir desktop web` and the existing preview on 1025;
   do not launch Electron unless native verification is separately requested.

## Risks and deliberately excluded work

Attribution-only discovery and deep path history may be expensive; upstream budgets/index
decisions must be measured there, not compensated by renderer scans. Page-number random
access over bounded scans requires a precise upstream continuation contract; Connect cannot
invent one. Large file alignment, repeated-text ownership and publish/merge provenance are
engine correctness concerns. Older linked SDKs need an explicit compatibility boundary.

This work does not alter physical Store format, write APIs, merge/publish semantics,
native IPC/window behavior, human author records, or rename-following history. Those require
separate requirements. Browser verification cannot establish native packaging/IPC behavior.

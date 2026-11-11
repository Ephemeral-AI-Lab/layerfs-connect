# Restored animated storage story — 2026-11-10

Restored the original DiskFlow/SavedRing/main-summary visual language in the
current desktop renderer, with measured populations and exact wire integers.

## Implemented

- Project: independent latest-main size/counts; explicit analysis leads with
  Referenced → Unique data → Encoded data; reuse ring; delayed stage/count
  entrances, finite traveling strokes and Replay; revision history/inspector below.
- Store: canonical allocation → encoded packs → database pages; separate composition
  and file lengths; all-canonical project-sharing bars visibly distinguished from
  the selected file-data population flow/ring.
- Optional `include_encoding:true` on project/store.storage_report returns
  `payload_encoding` for the same selected WholeFile/Chunk population. Referenced
  counts per-snapshot canonical bytes; unique and encoded record bytes count union
  IDs once. Shared group/pack framing, metadata and external delta-base storage
  are excluded. Distinct external direct bases are disclosed. Incomplete metrics
  remain null. Full-canonical accounting stays unchanged.
- Connect checks CLI option discovery before requesting encoding. Older CLIs retain
  two canonical deduplication stages with an encoding-unavailable explanation.
- Fixed preview lifecycle ownership: closeBundle disposes its own host instead
  of using a shared HTTP close event that could dispose replacement hosts during
  Vite reconfiguration. Added a regression check of that event ordering.

## Real measurements

Actual website feature-auth analysis (two revisions): referenced 1735B, unique 966B,
encoded records 724B; 0 external direct bases. Main stays 631B independently of the
selected branch. Store selection of website/design main snapshots: referenced 1534B,
unique 1259B, encoded 826B; 0 external direct bases. These are file-data record metrics,
not physical disk attribution or complete dependency reconstruction costs.
`live-api-results.json` retains full scoped responses and immutable pins.

## Validation

- Desktop typecheck and production build passed.
- Storage measure tests 4/4 passed, including large exact integers and reuse bounds.
- CLI adapter + host observation/report tests 22/22 passed, including capability
  opt-in for both scopes and older-CLI behavior.
- Preview host lifecycle tests 5/5 passed.
- LayerFS core payload tests 3/3 passed: WholeFile, Chunk, Singleton, external delta
  base and corruption. API tests 5/5 passed: native SQLite, real worker route,
  disposable PostgreSQL, project/Store equivalence, opt-in absence, incomplete
  nulls and identity protection.
- Changed five Rust crates: all-targets PostgreSQL Clippy with warnings denied,
  formatting and production boundary checks passed. Node/Python option types match
  source call metadata; Python type source parses.
- New sealed macOS bundle: build-macos-3337f06266154844a7b6992c072635eb.
  CLI advertises 68calls and include_encoding on both scopes, machine/postgresql
  features. Calls and commands match source-derived discovery; SDK option types
  were not regenerated unnecessarily. Identity and file hashes: build-identity.json.
- Real preview at 1280×820 and 900×600: project/Store explicit analysis, side-branch
  selection with main unchanged, revision inspection, Replay completion, no
  horizontal overflow or alerts. Reduced motion disables all checked animations.
  Browser success run captured no exceptions/console errors; browser-results.json.
- Captured entering and settled frames. Final screenshots:
  project-final-1280.png; store-population-flow-settled-1280.png.

## Runtime and limits

Preview uses the same retained private LFS_STATE and a matching sealed CLI/daemon.
Studio was reopened without rebuilding/resetting its data. A dedicated browser tab
`storage-stages-final` is left on website/feature-auth with analyzed stages visible.
No Electron verification was requested or performed. Existing running guest workers
were not replaced; the updated worker route was exercised by API tests. Browser
verification used native SQLite, not a full PostgreSQL/guest UI matrix. The shared
app shell's existing phone-width minimum remains outside this storage scope.

The first bundle attempt used the main checkout's older packaging launcher, which
expected api/agent; the selected worktree's current launcher packaged api/node and
sealed successfully. Failed-build receipts remain retained. Preview reload handling
was fixed after configuration changes exposed the lifecycle issue described above.
The owned temporary PostgreSQL container and credentials were removed after tests.

Private completed caches were released via
~/.cache/layerfs-worktrees/layerfs-storage-visuals-09c001eb6d3a/storage-stages-handoff-scope.json.
Source, pinned bundles and evidence remain protected; no caches were deleted.
Final host headroom 247.03GB; no cleanup required. No commits or pushes.

## Direct-link follow-up

The project flow initially required an Analyze click, so a fresh design URL showed
only its description. Project Storage now starts the bounded report automatically
on opening/changing its pinned population. The design direct URL, branch change,
range change and 900px layout were exercised without an Analyze click. See
autoload-results.json and design-autoload screenshots. Store analysis stays explicit.

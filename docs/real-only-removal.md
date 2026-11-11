# Real-only Connect removal

Implemented 2026-11-09 after approval of the full removal scope.

## Removed

- `host/sim/`: fake CLI executable, persisted world, presets, doctor handlers,
  saved call/discovery tables and saved-query handlers.
- `/api/sim` and reset endpoints; `tools/sim-table.mjs`; `dev:sim`.
- Both renderers’ simulation providers, data adapters, platform presets,
  API interception, pickers, notes, mode strips and styles.
- Desktop and legacy mode defaults, saved mode preferences, native menu
  choices, switch IPC and preview mode-switch endpoint/query handling.
- Example chat and its reserved API replies, fabricated conversation/files/
  traces/subagents, policy lifecycle states and navigation entry points.
- Sample Files and History explorers, their local trees, comparisons,
  attribution fixtures and sample-only support components.
- Sandbox scenario playback, sample detail adapters, synthetic metrics and
  explicit sample-metrics controls; illustrative Store breakdown ribbons.
- Simulator tests, population tooling, and smoke scripts dedicated to deleted
  samples. Useful paging/provenance and navigation tests retain isolated mocks.

## Result

Desktop and legacy apps use the real CLI. Browser preview remains on port 1025
with a private temporary home (or `LFS_STATE`). Configure an absolute pinned
`LAYERFS_CONNECT_CLI` and matching `LAYERFS_CONNECT_DAEMON`. No PATH discovery
or simulation fallback exists. Production packages default to real LayerFS.

Files, History and Sandbox use shared host-backed components. Empty data is
empty, unavailable data stays unavailable, and errors retain Retry.

`LAYERFS_CONNECT_MODE=sim` or other retired values fail before opening real
resources. Legacy `real` is accepted for compatibility. An old simulation home
without `layerfs.json` is refused. Existing simulation state and saved preferences
are left on disk and never migrated or read as live data.

Historical Doctor report markers remain readable so old simulated evidence
cannot be presented as a real resource check. All new reports use the real CLI.
Unit-test mocks, fault injection and real-resource scenario/fixture tools remain.
Historical evidence documents are retained as records, not operational guidance.

Docker controls say Start worker / Stop worker. A stopped worker card explains
that Docker Desktop can still be running. A LayerFS home owns its worker;
preview does not automatically attach other homes’ workers or start resources.

## Validation

- Root and desktop typecheck/build passed. Desktop type resolution is pinned
  to its own React types to avoid duplicate identities from shared source files.
- Broad host, root renderer and history-model suite: 438 passed, 2 skipped,
  no failures (440 tests). Separate real-only safety checks: 3 passed.
- Real browser preview: Storage empty state, Create Store, Add project,
  shared Files/History/Sandboxes; desktop sizes 1280×820 and 900×600.
  Final fresh-page console had no errors; startup receipt confirmed real mode.
- Test Store `real-only-verification` is owned disposable verification data
  and confirmed removed at completion. No Electron desktop verification requested.

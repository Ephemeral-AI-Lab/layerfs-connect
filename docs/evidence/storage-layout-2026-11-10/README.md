# Storage layout redesign — 2026-11-10

Implemented the user-approved Project and Store ASCII layouts in the current
shared desktop renderer. Existing CLI measurements and routes are retained;
this redesign requires no new SDK/API changes.

- Project: history first, branch/range controls, aligned Save bars, point/bar/native
  select revision inspector, explicit canonical reuse ribbon, exact data disclosures.
- Store: encoding ribbon first, database composition and separate file lengths,
  observation history beside explicit selected-project exclusive/shared bars.
- Shared semantic chart tokens: indigo canonical, teal stored/unique and exclusive,
  violet metadata/sharing, amber overhead, slate free space. Tinted chart surfaces.
- No invented metrics, physical ownership, historical points or live-transfer motion.

## Verification

- `pnpm --dir desktop -s typecheck` — passed.
- `pnpm --dir desktop -s build` — passed.
- `node --test desktop/tools/storage-measures.test.mjs` — 3 passed.
- Actual web preview at `127.0.0.1:1025`, Studio environment, existing website/design
  projects. Browser was the previously owned `connect-preview` external tab.
- Switched main to feature-auth; selected older revision via Save bar and latest
  via keyboard Enter on its chart point. Checked inspector and actual tree counts.
- Changed revision range to 10; ran project analysis explicitly.
- Followed View Store usage; ran Store analysis, deselected a project and reanalyzed.
- Checked 1280×820, 900×600 and 768×600 without horizontal overflow or UI alerts.
- Reduced-motion inspection found `animation-name: none` on all checked charts.
- Successful flow run captured no browser exceptions or console errors.
- Additional history network-error/retry, exact measurement disclosure and Store
  Refresh checks passed; results: `retry-results.json`. The shared preview changed
  to Original during the first attempt; reopening the existing Studio environment
  restored the intended test data without rebuilding or resetting it.
- Screenshots and machine-readable results are alongside this file.

## Limits

No Electron/native verification was requested or performed. PostgreSQL, incomplete
reports, empty branches and pagination beyond 20 revisions were not re-exercised in
this visual pass; existing measurement logic remains. At 414px the shared app shell's
fixed 260px sidebar and 400px minimum main width overflow the viewport, independently
of these panels. This pre-existing shell limitation was left unchanged; the observed
state is recorded in `project-overflow-414.png`. Supporting chart panels stack below
1050px and chart controls/legends adapt below 600px within the desktop shell.

Host free space at handoff check: 283.78 GB; no cleanup required. No commits or pushes.

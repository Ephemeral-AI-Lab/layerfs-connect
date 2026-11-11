# Simulation chat performance proof — 2026-11-10

The final renderer was exercised in the actual web preview, using real saved scripted-agent conversations, genuine bash tools and LayerFS CLI receipts. No model calls or fabricated chat fixtures were used.

## Run and acceptance

- Filesystem run: `1f609016-6707-4880-82d3-9ce70eab55ee`.
- Fresh saved project: `sim-design-cc4672da074ef73c2c62/design-cc4672da074ef73c2c62`.
- Actual `/simulation --project design --machine native` launch opened saved conversation `e4a49620-17d5-4081-8f98-a10a6e28c87c`.
- Final clean-document acceptance resumed the same run's second conversation `84a0ce7a-b5b4-4ac9-a1f7-435ba7e15bc1`. It did not launch another run. This fresh-document acceptance excludes development-only HMR warnings recorded during earlier edits.
- `acceptance.json` records a genuine bash call changing from running to done; explicit CLI command and script path; progressive earlier steps; Trace focus and real call link; reusable child transcript; three natural request turns in both main and child; actual saved README; actual saved History graph; zero console errors and uncaught exceptions.
- The acceptance snapshot was taken while the run was still executing (2,655 / 2,936 commands). Terminal verdict and complete project audits are recorded by the parent batch proof separately.
- Main and child screenshots show the real current renderer at 1280×820 and 900×600. Main screenshots were captured read-only after acceptance. Root-level earlier pre-bash screenshots with the same names were replaced with these actual bash screenshots.

## Observed frontend performance

Both profiles measured a foreground child conversation for approximately 15 seconds during concurrent real simulation work. They are observational samples, **not a controlled identical-workload benchmark**: the run, execution phase and visible rows differ. After optimization there were more visible command rows (170 versus 92).

| Metric | Before | After |
| --- | ---: | ---: |
| Sample duration | 15.240 s | 15.008 s |
| JavaScript execution | 9.780 s | 2.330 s |
| Main-thread task duration | 12.688 s | 6.687 s |
| Long tasks ≥50 ms | 70 | 7 |
| Longest task | 187 ms | 104 ms |
| Layout count | 181 | 6 |
| DOM elements | 5,122 | 4,231 |
| Visible command rows | 92 | 170 |
| JavaScript heap | 122.1 MB | 85.4 MB |

Observed JavaScript execution fell about 76%, total main-thread task duration 47%, and long-task count 90%. `profile-before.json` and `profile-after.json` retain the raw measurements. The changes combine lightweight simulation updates, reads limited to the visible chat/pane, coalesced nonoverlapping refreshes, stable unchanged transcript row identities and bounded live work-step rendering with earlier steps still accessible.

## Source and checks

`source-hashes.json` contains SHA-256 hashes of the final chat-performance sources; `source-files.txt` lists the files. Hashes were checked again when this evidence was curated. No production source changed during evidence capture.

The three focused refresh/sharing regression tests passed, including nonoverlapping coalesced reads, unchanged row sharing with late Trace updates, and newer-summary handling without starving a valid transcript response. Desktop typecheck passed. `desktop-build.log` records the successful final desktop build (exit 0).

The acceptance helpers operate only on the existing `simulation-ui` Chrome tab. No desktop app was launched or restarted. Credentials and private session-file fields are excluded from curated JSON; commands and fixture contents are retained because they are the actual evidence.

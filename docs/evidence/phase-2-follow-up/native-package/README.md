# Native desktop and macOS package follow-up

Overall: **BLOCKED**, exactly one required row: accepting an owned directory
containing spaces through the actual native chooser. Cancellation is PASS.
No simulated result, guessed URL, or debugger-synthesized dialog return is credited.

Product: `da2986c4771b9edb89db0b6761b3781ae8a1d7fa`, tree
`307af775ca8abebf2fbcbfcf7a49ed91fabc59d8`. macOS arm64, Electron 45.0.0;
Electron's embedded Node 24.22.0, bundled host Node 24.21.0. The CLI and daemon
match the original `833d04cf44e8e747929d50ab1170a48260d9381c` checksums.
The native Store contract is Disposable only. No upstream source was edited.

| Required flow | Outcome | Receipt |
| --- | --- | --- |
| Real native preload/IPC, management, explicit Doctor | PASS | `development-probefinal.json` |
| 1280×820 / 900×600, minimize/restore | PASS | final native/package probes and screenshots |
| Native window/input focus, scrolling, renderer console | PASS | `native-window-focus-scroll.json` (focused true, TEXTAREA, positive scrollTop, no console events) |
| Actual native directory cancellation | PASS | `native-dialog-runtime3.json` (real Cocoa panel cancel action, actual IPC null) |
| Actual accepted directory with spaces | BLOCKED | `native-dialog-space-runloop-timeout.json`, earlier selector/remote-control receipts |
| Native mounted execution and Stop | PASS | `development-probefinal.json` |
| Installed package, bundled runtime, minimal PATH | PASS | `packaged-probefinal.json` |
| Same package launched with owned cwd outside checkout | PASS | `packaged-probeoutside-final.json` |
| Actual partial-Commit failure separate from cancellation | PASS | `packaged-partial-commit.json` (exit143, Conflict/pending_merge, retained local markers, host alive) |
| Native host SIGKILL during actual active command; restart, fresh reads, no replay, explicit Stop | PASS | `development-actual-host-interruption.json` |
| Orderly native/package shutdown and relaunch | PASS | `development-relaunch.json`, `packaged-relaunch.json` (same execution IDs, heads, Commit counts) |
| Package missing CLI / incompatible discovery | PASS | `packaged-probemissing-final.json`, `packaged-probeincompatible-final.json`; incompatible CLI is explicitly a synthetic discovery fixture |
| Actual PG complete/incomplete report presentation | PASS | `pg-ui-probe2.json`, `pg-ui-report-0.png`, `pg-ui-report-1.png` |
| Owned runtime-resource cleanup | PASS | `cleanup-native.json`, `cleanup-final-package.json`, `cleanup-outside-package.json`, `cleanup-old-package-finalize.json`, `final-resource-cleanup.json` |

The model-free driver uses the actual Electron preload to create a mounted chat.
An explicitly nonexistent provider/model produces an expected model-selection
refusal after the real host has prepared the mount and owner-only approval
connection. No model is called. The scoped driver then invokes that same
Electron-owned production `/execute` HTTP route. Stop, fresh saved reads and
management checks traverse the real preload/IPC routes. CLI/daemon and mounted
filesystem work are real. The read-only Example chat is labelled sample data
and was used only for native scrolling, never as execution evidence.

The active boundary is an actually published mounted `partial` file plus a
persisted unfinished execution ID/PID. Pinned CLI output frames are delivered
after command completion; READY output is not a running-phase gate. A stale
check label in `development-probefinal.json` still says READY; its preceding
observed marker/custody row and driver define the actual supported boundary.
The package final driver labels it correctly. Earlier mistaken assumptions and
failures remain in `harness-errors.md` and their original receipts.

Two consequential defects found by actual native/package execution were repaired:
async output rejection after Stop crashed the host; startup discovery errors
lost actionable CLI configuration guidance. The real final flows cover both.
The footer also now identifies real/simulated mode from the actual bridge.
Source and independent reviews are retained in the lead/live evidence directories.

## Exact remaining action

macOS reports `AXIsProcessTrusted:false`. The real panel was found through
external LLDB, and cancellation passed through its actual Cocoa action. The
remote native chooser exposes no usable default-button control locally; direct
OK raised an Objective-C exception. Scheduling the actual OK action on the normal
AppKit runloop after detaching produced no accepted IPC result before the explicit
110-second deadline. All attempts are retained. This is not acceptance of the
folder path and is not relabelled PASS.

A person must make one actual selection, or grant Accessibility/Automation to
allow real UI input. The following bounded driver creates fresh owned state and
a directory with spaces, opens the **real native chooser**, and records its actual
preload result. Click **Choose** for the displayed directory. It contains no
mocked backend, return-value override, or product hook.

```sh
/Users/yifanxu/.nvm/versions/node/v24.21.0/bin/node \
  docs/evidence/phase-2-follow-up/native-package/resume-native-directory-selection.mjs \
  '/Users/yifanxu/Applications/LayerFS Connect Follow-up Final 20261109-137.app' \
  /tmp/connect-native-directory-selection-final.json
```

It creates `/tmp/connect-native-directory-check-XXXXXX/directory with spaces`,
prints the exact path, requires that exact actual selected result, and stops at
110 seconds, followed by bounded close/cleanup (under120 seconds total). Receipt
and log paths must both be fresh; exclusive creation prevents overwriting. TCP
bind checking detects HTTP and non-HTTP listeners. State is removed only after
owned Electron close; unconfirmed close retains state for reconciliation.
Debug port 19325 must be free; it refuses to take another owner’s
port. The driver remains **NOT_RUN pending real user/native control**; this
follow-up does not claim a manual selection happened.

## Artifact custody

The tested temporary installations were removed during cleanup. At the lead's
request the final uniquely named artifact was restored byte-identically without
launching it; the append-only sequence is in `final-artifact-custody.json`.
Both current retained copies have canonical SHA-256:

`73b50397a9a13437f9b5c964c2376e9ce6e10dc60c9ca339ef2df4d200acaad0`

- `~/Applications/LayerFS Connect Follow-up Final 20261109-137.app`
- `desktop/dist/mac-arm64/LayerFS Connect.app`

The canonical hash covers 28,191 sorted path/type/mode/content/target entries.
`canonical-package-hash.py` fails on a missing/inaccessible root. The earlier
native-order hash is historical; use `canonical-package-identity.json` and
`retained-package-identity.json`. `final-package-identity.json` preserves bundled
CLI/daemon/Node checksums and exact production source hashes. The app contains
bundled pi-tui platform addons but no linked LayerFS Node addon or external
package-store/source symlink. The packager checks every symlink remains inside
the app. Local ad-hoc signing enables execution; Developer ID signing,
notarization, distribution and other platforms remain unrequested/NOT_RUN.

All owned Stores, Workspaces, Sandboxes, app/test states and the synthetic
incompatible executable were removed after reconciliation. Pinned binaries,
evidence, the final package, `.hallmark/`, `.pnpm-store/` and unrelated owner work
remain protected. No push/PR/merge/distribution was performed. Doctor progress
and cancellation remain deferred upstream.

## Reproducible drivers

Exact bounded drivers are archived directly in this evidence directory as
`connect-*.mjs` (there is no separate `drivers/` directory).
`connect-final-ipc.mjs`, `connect-package-outside.mjs`,
`connect-partial-commit.mjs`, `connect-host-interruption.mjs`,
`connect-relaunch.mjs`, `connect-native-dialog-runtime3.mjs`, and
`connect-package-missing-final.mjs` and `connect-package-incompatible-final.mjs` correspond to the receipts
above. Their `PROBE_PACKAGE`, `PROBE_ROOT`, and `PROBE_ATTEMPT` environment
references identify explicit artifacts/owned fixtures; credentials are read only
from owner-only connection files, never embedded. `connect-fixture-init.mjs`
prepares fresh owned input. `connect-cleanup-owned.mjs` records fresh-read
reconciliation and explicit cleanup; its final version is
`connect-cleanup-owned-final.mjs`, preserving the earlier driver correction.
The remaining manual action has its standalone command above and uses
`connect-cdp-library.mjs` without CLI-entry side effects.

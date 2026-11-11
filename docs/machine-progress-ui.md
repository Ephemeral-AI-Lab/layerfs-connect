# Machine startup progress

Implemented locally on 2026-11-10 in the current desktop renderer. Two subagents
reviewed the presentation and event pipeline, then implemented the shared panel
and tracking model while the parent integrated and verified the real flows.

## Behavior

The machine card, detail page and Create dialog share an inline progress panel.
It shows the actual current CLI stage and elapsed time, a disclosure of completed
stages, and a link to the exact CLI Activity action. It uses no invented
percentages, download phases or boot estimates. The supported CLI currently
reports runtime validation, optional sandbox-image preparation, combined
provider/worker startup, and authenticated worker verification.

An explicit per-request action ID follows the mutation into the host. Stage
history comes from that action's complete detail events; SSE notifications and a
one-second read fallback update the panel without replaying mutations. Module
state retains progress across board/detail/Activity navigation. Running cards
sort with busy machines and suppress stale stopped notices. Duplicate starts
are blocked, terminal stages cannot regress from stale partial reads, and Stop
or Remove clears the retained result only after success.

Create freezes submitted fields/platform selection and prevents accidental dialog
closure while pending. Navigating to Activity does not cancel creation or force
navigation back when it completes. Recovery buttons use the submitted machine
identity even after the editable Name field changes. A refusal with vm_exists
provides access to the machine and its removal options.

Lost replies remain uncertain. Progress-read failures leave the mutation alone
and show that updates are unavailable. Failed operations retain the last stage,
elapsed time, refusal and activity link. Success means the request completed;
the historical label Startup completed does not replace current machine state.
Stage announcements are polite, timer ticks are separate, and reduced-motion
preferences disable spinning.

## Real verification

Used the actual preview at 127.0.0.1:1025, current renderer and real host/CLI.
No Electron app was launched. Screenshots were visually reviewed at 1280x820
and 900x600; forms scroll within the smaller viewport and progress labels wrap.

- Created owned Lima machine progress-ui-1110 through the actual Create form.
  The live dialog showed Starting machine and worker with a changing timer.
  Its one recorded CLI create completed in 10.263 seconds, then the detail page
  showed Running and retained all three completed stages.
- Started the same stopped machine through detail and board controls. The CLI
  starts took 8.295 and 8.280 seconds. Progress survived detail/board navigation;
  the final board check confirmed its card sorted first during startup and did
  not show the stale stopped notice. The completed-stage disclosure showed
  runtime compatibility, provider/worker startup, and worker verification.
- Followed View CLI activity and verified the matching action ID and single
  successful machine.start command, rather than a machine-name search.
- A shared preview host restart caused a separate request to lose its connection.
  The panel showed Outcome needs inspection and unavailable progress. It did
  not retry. Read-only checks found no machine record for that attempt in the
  original or studio home. That request was not replayed.
- Submitted a separate Apple Container Create with a deliberately missing archive.
  The single CLI invocation failed in 1.906 seconds after provisioning started.
  The UI retained Starting machine and worker - failed and its actionable error.
  Used View machine and removal options, then removed that exact owned machine
  and disk through the UI. No automatic retry occurred.

These observations verify presentation and behavior, not release performance or
fresh-host download speed. Installed artifacts were reused, host caches were
uncontrolled, and another active session updated the shared preview's CLI pin.
Each retained activity receipt includes the actual binary identity. A temporary
missing stylesheet in that session's preset changes also interrupted the shared
preview; verification resumed after its stylesheet appeared. No preset files
were changed by this task.

## Checks and cleanup

- Desktop typecheck and production build passed on the final implementation.
- Ten targeted regressions passed: request correlation, rapid stage history,
  terminal outcomes, stale responses, duplicate prevention, read fallback,
  refresh after partial effects, and frozen recovery identity.
- Scoped whitespace checks passed. The final preview had no Vite error overlay
  or horizontal document overflow at 1280x820. Historical console errors include
  the expected deliberate refusal, lost host connection and resolved preset
  stylesheet failure; they are not an empty-console claim.
- All owned machines and their Apple/Lima data volumes were verified absent.
  Existing native, Docker, demo-build and demo-research resources were preserved.
  The existing preview process and other browser tabs were not restarted or closed.

[Raw activity and DOM evidence](evidence/machine-progress-ui-2026-11-10/verification.json)
records the exact actions. Separate files retain starting-card order, expanded
completed stages, failed and uncertain DOM states, and cleanup verification.

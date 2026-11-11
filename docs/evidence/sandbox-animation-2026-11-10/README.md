# Sandbox live animation — fixed and verified

The live sandbox map now binds actual saved main/child agents to their Branches
and mounted Workspaces, animating connections while calls are in flight. It uses
real CLI/SDK traces; no example resources or synthetic animation events are used.

## Final verification

[Final evidence](fixed-1794318043779/verification.json) and
[interactions](fixed-1794318043779/interactions.json) passed on a real one-cycle
Native Mixed simulation:

- 553 planned commands, 550 agent Bash steps and 633 captured CLI calls, including
  setup and final verification. Full receipt/transcript/lifecycle audit passed.
- 48 mounted Workspace sessions, two exec/commit pairs each, all cleanly unmounted.
- 492 browser samples, including 130 visible observations overlapping confirmed
  in-flight mount, exec, commit or unmount calls.
- 173 samples recorded packet movement greater than one pixel along an unchanged
  SVG path, using the same connected element before and after the observation.
- Actual actor, Workspace and connection nodes were present; agent order had zero
  relative changes during updates.
- Completion left zero packets and `playing=false`.
- Reduced motion suppressed visible packets; 1280×820 and 900×600 had no horizontal
  overflow. Zero browser exceptions or console errors.
- Selected-child focus, Open Trace, Sandbox → Workspaces → Back and idle rendering
  passed. Screenshots and timestamped measurements are retained beside the report.

[Root tests](fixed-1794318043779/root-tests.log): 233 passed.
[Host tests](fixed-1794318043779/host-tests.log): 436 passed, two skipped.
[Typecheck](fixed-1794318043779/typecheck.log) and
[build](fixed-1794318043779/build.log) passed. Electron was not launched.

## Implementation

- Feed the shared map from the existing authenticated chat `/live` endpoint.
  Resolve child attribution using the actual Pi session identity and parent chat.
- Tail only new trace bytes, retain a bounded recent-call list, order cross-agent
  events by time, and retain correct named Workspace identity and users until unmount.
- Keep calls with identical local IDs distinct across agents. Clear cached in-flight calls when a chat becomes idle; retain resource state.
- Use a live clock and SVG motion only on in-flight edges. Completion and feed
  errors pause motion; reduced motion hides packets. Card order is stable.
- Keep polling single-flight and visible-pane-only. Inventory refresh now queues
  behind a slow read rather than repeatedly discarding it. Render at most fifty
  recent activity rows and link the full saved Trace.

## Retained attempts

The [before-fix live run](live-1794316404959/README.md) passed its simulation audit
but showed zero agents, wires and packets during real calls.
`fixed-1794317340347/` first recorded movement and reduced-motion support, then
navigation away from the map prevented its final idle assertion. This is retained
as a partial UI check, not the final pass. `fixed-1794317551256/` passed in a
separate labeled tab. `fixed-1794318043779/` reran the full check on final source.

Generated Stores/projects, plans, journals, saved Pi conversations and raw CLI
captures remain in the private verification state. The host and labeled preview
are left available for inspection; other sessions' preview processes were not
restarted. Resource detail remains a current-state inspector, not a playback view.

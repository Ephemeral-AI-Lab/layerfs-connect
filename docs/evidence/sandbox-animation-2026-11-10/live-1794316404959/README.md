# Live sandbox animation verification

Simulation execution **passed**. Live sandbox animation **failed**.

A fresh one-cycle `design` Mixed simulation ran on `native` through the same
Studio host used by the linked conversation. Internal fixture arguments were
`{project:"design", machine:"native", cycles:1, mixed:true}`. No model calls,
fabricated graph events, renderer overrides or application changes were used.

- Run: `a86a0663-cf4e-41d6-ba9b-3f4b9a71f3ae`.
- Main chat: `53e4cea8-c1e2-44e0-9e00-6812b4745a54`.
- 553 planned operations, 550 genuine agent Bash steps and 633 captured CLI calls
  including setup and verification. Full live audit passed.
- 48 mounted Workspace sessions, each with two exec/commit pairs; all unmounted.
- Browser viewport: 1280×820; the visible main and child Sandboxes routes were
  inspected in the actual preview.
- 281 total samples; 76 rendered samples overlapped confirmed in-flight Workspace
  calls. Coverage includes mount, exec, commit and unmount.
- In all 76 overlap samples: `playing=false`, zero agent nodes, zero wires and
  zero moving packets. No Workspace nodes were observed in those samples either.
- Reduced motion was off and the document was visible. Zero browser exceptions
  and console errors were observed.

The call overlap check reads actual operation-journal start/end timestamps before
and after each browser observation. A sample counts only if the Workspace call
started before the observation and had not completed by its end. This verifies
real live execution rather than an idle or completed conversation.

The current resource adapter supplies empty actors, events and Workspace users.
It does not pass a live clock or `playing` to the map, whose defaults are zero and
false. Moving SVG packets require both an active edge and `playing`. The detailed
Sandbox resource view separately passes `playing=false` and `time=0`.

Next: connect actual actor/Workspace bindings and in-flight calls to an incremental
live view, supply an advancing live clock, and enable motion only for current
activity. Then rerun this bounded scenario to verify moving packet positions and
correct cessation on completion. This check makes no production code changes.

`verification.json` contains the result; `samples.json` records timestamped browser
observations and overlapping call identities; `simulation-audit.json` contains the
successful run audit. The in-flight PNGs show actual unmodified page states.
`source-hashes.json` identifies the inspected code. Generated plans, journals,
transcripts, resources and raw captures remain in the retained Studio state.

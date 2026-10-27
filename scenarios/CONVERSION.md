# Scenarios: conversion to version 3

All ten scenarios moved to `scenario.json` version 3: no `lib`, no `run`, no
`bash.script`, no `layerfs` backend field. Every bash step is a literal command:
plain `layerfs` lines in a `cli` scenario, one inline SDK script in an `sdk`
scenario. Each step's `expect` is checked live, from the call's trace lines.

| Scenario | Form | Written by |
| --- | --- | --- |
| tour, merge, sandbox, agents | sdk | hand |
| depot | sdk | `tools/replay/convert.mjs` (its own [CONVERSION.md](depot/CONVERSION.md)) |
| parallel, checkpoints, conflicts | cli | hand |
| shop, crew | cli | `tools/replay/convert.mjs` (their own [shop](shop/CONVERSION.md), [crew](crew/CONVERSION.md)) |

This file covers the hand-written seven and the expect coverage of all ten.
The replays' own files list their dropped commands, forks and refs. Crew's
P1e-059 (a date-dependent burndown test) is dropped there.

## Expect coverage

The set of outcome codes `expect` checks across all ten did not shrink.
Compare the last version-2 commit, `087cbc4`, with the checkout:

```bash
node tools/replay/coverage.mjs 087cbc4 tour merge sandbox agents parallel checkpoints conflicts shop crew depot
```

- **Before (33 entries):** 26 method-qualified codes, plus 7 bare outcomes
  from the version-2 grammar, where an entry without a method matched any
  call: `Added`, `Forked`, `Merged`, `Mounted`, `Unmounted`, `exit:0` and
  `running`. Each of the 7 is now checked with its method:
  `branch.publish:Added`, `branch.fork:Forked`, `branch.merge:Merged`,
  `workspace.mount:Mounted`, `workspace.unmount:Unmounted`,
  `workspace.exec:exit:0` and `backend.daemon.process.start:running`.
- **After (29 codes):** every code from before, plus `branch.list_commits:ok`,
  `fs.glob:ok` and `fs.list:ok`.
- **Restored:** `sandbox.close:NoSuchSandbox`. In the old replays it came
  from closing a Sandbox that had closed itself when idle. With one Sandbox
  per step, none is idle long enough. Sandbox's teardown now closes its
  Sandbox a second time, and that close is refused NoSuchSandbox.
- **Still uncovered:** none.

## Dropped

- **checkpoints:** the final check counted the files on main. It now lists
  them with `fs glob` and checks no count.
- **agents:** the lead's shared-Sandbox helpers from the old library
  (`checkout`, `search`, `release`, `closeAll`) are gone. Each agent's step
  now creates and closes its own Sandbox (43 creates). The calls behind those
  helpers are still checked: `workspace.mount`, `workspace.unmount` and
  `sandbox.close`.

## Kept across steps

The exceptions to one Sandbox and one Workspace per step. In each, a later
step names the Sandbox or Workspace with `{{sandbox}}` or `{{ws}}`.

- **sandbox:** one Sandbox holds both Workspaces from Set up to Teardown.
  Keeping them is the point of the scenario.
- **agents:** Cy's Workspace stays mounted through its conflict and repair.
  Dee's server runs as a background process until `stop`.
- **merge:** the Workspace whose Commit conflicts stays mounted until the
  markers are resolved and committed.
- **conflicts:** the first Sandbox's Workspace stays mounted through its
  conflict, repair and unmount.

## Crew

- **Turns with no call:** the converter used to give each one a bash
  `echo`, so that the turn held a call. Those 113 echo steps are gone. Each
  such turn was a child answering the lead ("turn N done, through …"), so it
  is now the child's reply alone. No turn is dropped: the lead's message and
  its wait still need that answer. Crew now has 967 steps (354 bash), down
  from 1080. A turn may be a reply alone, but a reply next to one that waits
  for children (`until`) still needs a call between them.
- **Subagent prompts:** they describe each child's lane of the issue tracker,
  in place of the record's "replays your recorded steps" (`PROMPTS` in
  `tools/replay/convert.mjs`).
- **`CREW_WORKSPACE=<id>`:** 18 commands keep the recorded Workspace ids.
  The id is a label: `scripts/dependency-census.mjs` only prints it in its
  census line, and nothing in the app reads it back.
- **`project.list_branches`:** a crew run makes about 640 of these calls
  (5 s). They came from the recording host's own Branch
  poll, not from the scenario. Throttling it is
  left for later.

## Other changes

- **tour:** its phases are now Build, Commit, Serve, and the header fork is
  taken from `{{commit:build}}`.
- **The old scripts and shared helpers are deleted:** `scenarios/*/scripts/`,
  `scenarios/shared/` and `tools/checks/refs.mjs`.

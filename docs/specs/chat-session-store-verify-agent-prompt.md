# Agent prompt: verify project-owned sessions end to end with /simulation, then fix iteratively

## Assignment

In `/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect`, prove that the project-owned chat
session work is complete and correct in the real UI. Run `/simulation` workloads, use real
fixture chats, inspect every affected surface in the browser, and fix defects you find. Repeat
until every item in the checklist below has passing browser and test evidence, or carries a
precise blocker. Monitor running simulations and chats while they run, not only at the end.

This is a verification-and-repair loop, not a design task. Keep changes small, reviewable and
within the existing contracts. If a finding needs a new product decision, state the exact
conflict and the options, then continue with independent items.

## Read first

- Repository `AGENTS.md` (web preview, host tests, live-fixture rules) and the user's machine
  rules (disk checks with LayerFS `python3 tools/cleanup.py check`; protect other sessions' work).
- [chat-session-store.md](chat-session-store.md): the design.
- [chat-session-store-record.md](chat-session-store-record.md): what was built, every follow-up
  pass, evidence and remaining limits. **Treat it as claims to re-verify, not as proof.**
- [simulation.md](simulation.md): `/simulation --project <preset-project> --machine <machine> [--mixed[=true|false]]`.
- `docs/ui/chat.md` ("Recorded LayerFS operations", "Saved conversations and ownership"),
  `docs/ui/chat-history.md` ("Linked operations").
- Source: `host/sessions/*`, `host/agents/workspaces.js` (`sandboxEnv`, `hostShell`, `runOnHost`,
  `save`, `checkpoint`), `host/agents/index.js` (sessions wiring, routes in `routes.js`),
  `host/runs/{trace-line.js,scope-client.js,cli-shim.mjs}`, renderer
  `components/layerfs/Operations.tsx`, `components/chat/SavedConversations.tsx`,
  `pages/chat/trace/{TraceTab,TraceRow,TraceDetail,OperationsView}.tsx`,
  `components/history/ProjectHistory.tsx`.

The checkout holds many uncommitted changes from several sessions, and another session may be
editing `host/agents/` concurrently. Re-read a file immediately before editing it; never revert,
stash, reformat or commit unrelated work. No push, PR or desktop (Electron) launch.

## Environment

- Node 24. CLI and daemon: the paths in `desktop/.env.local` (the app's runtime build; it includes
  writer admission and the 69-call table). The older 58c548b pin lacks three calls and refuses
  concurrent writers with `Storage(Busy)`; do not judge results against it.
- Preview: from `desktop/`, `set -a; . ./.env.local; set +a; ./node_modules/.bin/vite --config vite.web.config.ts`
  (`pnpm` via corepack fails when `.env.local`'s `XDG_CACHE_HOME` is exported). Fixed port 1025.
  Restart the preview after **host** changes; renderer changes hot-reload. Reuse a server only if
  this checkout owns it; ask before stopping one you did not start.
- Use the local deterministic model pattern (a scripted OpenAI-compatible server on loopback, as in
  `host/test/session-live.test.js` `scriptedModel`) for chat fixtures. No paid model requests and no
  changes to the user's model configuration beyond a disposable fixture provider you remove afterwards.
- Keep owned fixtures (Stores, Docker machine containers, MinIO containers) private and remove
  exactly those at the end. The preview home already contains fixture Stores `dockerdemo`, `moved`,
  `moved2` and fixture chats from earlier passes; record what you add.

## Checklist to verify (original assignment + owner follow-ups)

For each item: reproduce in the real preview, check the UI at **1280x820 and 900x600**, check the
console, check no horizontal page overflow, and confirm the host data via the API. Save evidence.

Original assignment:
1. New project chats are mounted by default; folder and simulation chats keep their execution.
2. Every LayerFS invocation is one operation with an id, intent and exact receipt: SDK
   (`import 'layerfs'`), CLI (`layerfs …`) and host-generated (exec, saves, fork, mount, close).
   SDK→CLI nesting is not double counted.
3. Only `file.*`/`fs.*` writes, `workspace.commit`, `branch.fork/merge/publish` carry saved-version
   links; reads, exec, mounts and Sandbox/machine calls never do. `UpToDate` → `unchanged`; refusal →
   none; lost reply → `unknown` until reconciled.
4. Fork from Layer/Commit, merge (fast-forward and new, with typed sources), publish (source Commit →
   main Layer) show correct Store/project/branch/kind in Chat, Trace inspector and History.
5. A tool that fails after saved writes keeps all its operations and links.
6. Restore points: each user message's boundary carries a typed `workspace_ref`; Rollback/Edit forks a
   new code branch whose recorded input is that exact ref; copy (fork chat) inherits operations with
   the source's identities.
7. Journal saved to `connect.session.<id>` (manifest + bounded segments + artifacts); Trace badge shows
   Recorded locally / Saved to project / Save unknown / Not saved / Ownership conflict correctly and
   updates without reload; "Save to project" and "Check saved state" work.
8. Restart (stop and start the preview host): operations, links and save state survive; orphaned
   intents become `unknown`.
9. Portability: Store push to another machine, and full Store backup → restore in another home,
   rebuild chats (native Pi file, children, Trace, artifacts) on a fresh Connect home; a renamed
   Store needs an explicit binding, and the binding survives later saves and re-imports.
10. Chat ↔ Trace ↔ History navigation by exact ids (`?op=`, `?commit=&branch=`): History shows the
    producing operation separately from references; `No linked trace` when none; session branches are
    labelled as conversation journals.
11. Trace Operations view: agent/operation/project/status/links filters, paging, inspector tabs
    (Result, Inputs, Arguments, Receipt, Execution), coverage notes.
12. Older local chats migrate to their project in the background after startup.

Owner follow-ups:
13. Native mounted Sandbox: SDK and CLI calls inside commands are recorded with no coverage gap.
14. Docker/VM Sandbox chats run bash **on the host**, like the simulations' CLI scripts: the agent uses
    `layerfs workspace exec "$LAYERFS_CONNECT_WS" … --stream`; those calls are `cli` operations of the
    bash tool; the save after each bash call captures the change; Stop ends the host command and its
    `workspace exec`. Pi exposes only `bash` and subagent tools — no extra LayerFS tool.
15. Session-branch race detected from the receipt parent; explicit "Take over ownership" works and is
    refused when histories diverged.
16. Whole-prefix Pi rewrite detection; unchanged write on a branch without Commits links its base Layer
    only while that branch still has no head.
17. New-chat page: "Find conversations saved in this project", Import, binding form.

## Simulation runs

Run `/simulation` from the new-chat page in the preview (not by API alone), on at least `native` and
`docker` (and `--mixed` once), using preset projects that exist in the preview home (see
`docs/ui/presets.md`, Presets page). While each runs:

- Watch the chat list, the simulation status, Chat steps, Trace (Conversation and Operations views),
  History and Sandbox tabs as they update. Running rows must not turn successful before their own
  receipts; the sidebar order must not change from progress updates.
- Poll `GET /api/agent/sessions/:id/operations`, `/persistence` and the simulation journal
  (`simulations/<run-id>/journal.jsonl`) to cross-check what the UI shows.
- After completion, run the simulation's own verification (`verification/expectations.json`) and
  compare its LayerFS facts with the recorded operations and links.

**Known open question to resolve first:** simulation chats (`record.simulation`) are currently
excluded from the session journal (`sessions.ensure`, `withOperations`, `persistence` skip them) and
their scripts run under the simulation runner, not the chat bash tool. Determine whether the
simulation runner's CLI calls reach Connect's recorder (`LAYERFS_CONNECT_OPS`) at all. If simulation
chats show no recorded operations, that contradicts the owner's expectation that simulations verify
this work: report it with evidence and propose the smallest change (e.g. give the runner's scripts
the conversation's journal context and include simulation chats in the journal without altering
their execution), then implement it unless it needs a product decision.

## Fix loop

1. Reproduce → write or extend a failing test (`host/test/session-store.test.js` for logic;
   `host/test/session-live.test.js` with the env flags in `AGENTS.md` for real LayerFS; desktop smoke
   scripts for UI).
2. Fix at the root cause; keep Connect inside the LayerFS contract (never patch or build upstream
   LayerFS; report a precise upstream requirement instead).
3. Re-run: the failing case, `node --test host/test/session-store.test.js`, the full host suite
   `node --test --test-timeout=120000 host/test/*.test.js` with the `.env.local` CLI,
   `pnpm --dir desktop -s typecheck && pnpm --dir desktop -s build`, `pnpm -s typecheck && pnpm -s build`.
4. Re-verify in the browser with the existing smoke scripts and extend them for new coverage:
   `desktop/tools/smoke-chat-operations.mjs`, `smoke-session-ownership.mjs`, `smoke-host-shell.mjs`.
   Screenshots are evidence only alongside interaction checks.
5. Repeat until the checklist is green. Check disk at least every 30 minutes and after large batches.

## Delivery

Append a dated section to `chat-session-store-record.md`: each checklist item with pass/fail, the
exact command or browser flow that proved it, defects found and their fixes, and remaining
limitations or blockers. Update the affected `docs/ui/*.md`. Report owned resources created and
released, preview state, and anything left for the owner (including the undecided expiring
ownership lease, which is out of scope unless the owner decides its behaviour).

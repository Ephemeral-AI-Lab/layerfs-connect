# Web preview mode switch — 2026-11-09

PASS for this scoped browser change. Prior native chooser BLOCKED remains unchanged.
Parent: d9c9f9d0de106713a317915e50e6b8b8a9219b2e.

Implementation: sidebar Preview mode selector; independent <preview-root>/sim and
/real state and scratch folders. Default preview root is fresh private temporary
state; LFS_STATE optionally supplies a root. Real mode requires explicitly configured
CLI. Mode switch prepares host with authenticated preview POST then full-page
reload to new chat, discarding unsent text. Existing commands remain on their
original host; switching does not stop it. Host loss requires explicit restart,
never mutation replay. Server shutdown closes host stdin and retains state.

Reproduce from repo root with Node 24 on PATH:

```sh
LAYERFS_CONNECT_CLI=/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs \
LAYERFS_CONNECT_DAEMON=/Users/yifanxu/Ephemeral-AI-Lab/layerfs-connect-cli-137/target/debug/layerfs-daemon \
pnpm --dir desktop web
```

Open http://127.0.0.1:1025/. Select Real in sidebar footer; open Machines.
Select Simulated and return to Real. Refresh preserves query selection.

Actual browser verification: Simulated → Real → Simulated → Real succeeds;
footer, selector, bridge mode, and real host /api/status agree (HTTP 200). Real
Machines page read native/docker inventory; no Store/Sandbox or paid model run
created. At 1280×820 real host status was 200/real; at 900×600 selector was fully
visible and status again 200/real. Screenshot inspection at both sizes. Left
preview open in Real mode with both owned hosts active. No application installation
or Electron launch in this change. Runtime states retained for interactive use.

CLI SHA256 7d7a5b507eeb2abc914a0e151c63eb12bd49bcbb69a06083d08f0b4430a3619c;
daemon SHA256 664c991face739375b9c147c757575d4f12edbf84f64773eedd5a08c789d10c2;
unchanged prior pinned source 833d04cf44e8e747929d50ab1170a48260d9381c, version
2.0.0, machine/postgresql features. No upstream build or source change.

Failure checks: no configured CLI shows controlled actionable inline error and
retains Simulated selection (browser). Focused test with deliberately delayed
stderr initially failed: sending SIGTERM immediately on ready:false prevented
classification. Fixed by allowing natural exit, classifying after close with
30-second startup bound retained. Independent reviewer also caught removal of
that bound in malformed-envelope shutdown; corrected. Four regression tests pass:
mode validation, independent states/one host per mode, missing CLI, delayed safe
classification and no automatic respawn. No raw stderr or bearer token retained.

During source iteration, the old page retained an obsolete host address after a
Vite config restart. Browser navigation to the identical URL did not reload the
document. Fresh HTTP response was healthy; explicit location.reload restored the
page, then both switches/status reads passed. Historical console contains expected
503 from missing-CLI check and connection/CSP errors during development restarts;
these are not reported as a clean full-session console.

Checks (each invocation wall timeout 120 seconds): root node --test test/*.test.mjs
91 PASS; desktop typecheck PASS; desktop build PASS. After final timer adjustment,
focused 4 PASS. Shared-tree final typecheck FAILED with concurrent unrelated
simulation-removal edits (missing setSimHook/useSimulation/simulation and unused
useEffect). These edits were neither reverted nor included. Verified exact staged
product tree d6b0e34994389f5963291be09e543c9c6754d0e0 in an isolated archive:
typecheck PASS, build PASS, focused 4 PASS. First isolated attempt accidentally
used Node 22.7 and failed before execution; retained separately, then corrected
PATH to Node 24.21.0. See snapshot-node24-checks.json for successful commands.
Shared checkout integration with simultaneous removal work remains unqualified. Logs/check commands are adjacent. Host implementation unchanged, so prior
352-pass/2-explained-skip host evidence is reused without relabeling.

Review: /root/web_switch_review, read-only independent review; isolation/custody and
no-replay verified, both bounded-startup diagnostic findings addressed. Source
whitespace and staged secret checks executed before commit. Disk headroom checked
at start and handoff; no cleanup threshold reached. No other session resources
modified. Existing .hallmark/, .pnpm-store/ and untracked prompt preserved.

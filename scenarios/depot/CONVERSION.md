# Depot: conversion

Written by `node tools/replay/convert.mjs depot` from `0c7d9c47c1^` of the layerfs repository (`dsh/scenarios/depot/`). Rerun it to rewrite this folder; do not edit by hand.

Form `sdk`: every bash step is one inline Node script on the SDK. Each step that runs a command creates its own Sandbox from the configured runtime image, mounts a new Workspace, runs, Commits, unmounts and closes the Sandbox. The recorded outcome codes are each step's `expect`, checked live; the record id is each step's `note`.

| | count |
| --- | ---: |
| recorded steps (bash) | 102 |
| bash steps kept | 97 |
| coordination steps (subagent, send_message, reply) | 0 |
| steps in all | 97 |
| turns left with no call: the reply alone, no echo | 0 |
| commands recorded | 82 |
| dropped: identical re-run on an unchanged Branch | 0 |
| dropped: verification off (not applied) | 0 |
| dropped: date-dependent | 0 |
| commands kept | 82 |
| recorded seconds of the commands kept | 351.7 |
| recorded seconds of all commands | 351.7 |
| Workspace mounts now / recorded | 82 / 12 |
| Workspace Commits kept / recorded | 82 / 82 |
| Sandbox creates now / recorded | 81 / 1 (+80) |
| recorded Committed Commits this scenario does not make | 0 (0 not optional in the recorded history) |
| writes (fs.apply) | 9 |
| forks from a recorded Commit: own id / a reply's id / Branch head | 0 / 0 / 0 |
| forks from a Layer of main (now main's head) | 1 |

Forks from a recorded Commit or Layer:

- 071-publish-m6-fork-final (root) forks final-main-acceptance from L6: main's head (main showed L6 then)

Forks whose recorded call names another Commit than final.json's history (the history decides, as the order check compares with it):

- none

Workspaces the record had mounted on one Branch at once, kept together in one step:

- registry /workspaces/5 and registry /workspaces/6: records 027-registry-workspace-a, 028-registry-workspace-b

Commands dropped as identical re-runs (step: same as step):

- none

Commands dropped as date-dependent:

- none

Commands kept that repeat an earlier kept command on the same Branch, and why they run again:

- 010-m1-unchanged-build: same as 009-m1-cli-first-build; the Branch changed since (a write or a Commit recorded as Committed)
- 019-m3-server-build: same as 008-m1-server-first-build; the Branch changed since (a write or a Commit recorded as Committed)
- 020-m3-cli-build: same as 010-m1-unchanged-build; the Branch changed since (a write or a Commit recorded as Committed)
- 044-m6-candidate: same as 034-m5-merged-rebuild; the Branch changed since (a write or a Commit recorded as Committed)
- 068-m6-candidate: same as 036-m5-chromium-browser; the Branch changed since (a write or a Commit recorded as Committed)

Seed additions (tools/replay/check.mjs accepts exactly these):

- /.cargo (dir)
- /.cargo/config.toml (file: "[build]\ntarget-dir = \"target\"\njobs = 3\nrustc-wrapper = \"\"\nrustc-workspace-wrapper = \"\"\n\n[net]\nretry = 0\n")

The settings every recorded command set by environment (`CARGO_TARGET_DIR`, `CARGO_BUILD_JOBS=3`, `CARGO_NET_RETRY=0`, an empty `RUSTC_WRAPPER` and `RUSTC_WORKSPACE_WRAPPER`) are in the seed's `.cargo/config.toml`; `RUSTUP_HOME` is left to the image. `CARGO_HOME` cannot be set there, so each cargo command is prefixed with `CARGO_HOME=$PWD/.cargo-home`. The recorded first write replaces `.cargo/config.toml`, so the file it writes carries the same `[build]` table ahead of its recorded content, and its `mkdir /.cargo` is dropped (the seed has the folder).

final.json:

- main /.cargo/config.toml: 498d0583d775629753af2430c09d5aa98caec99488413e8a5484a9cc84a31a57 -> 3a993077b95d3c94d3e8e68b764250aa5c3e4f630652092a62348c55423103eb


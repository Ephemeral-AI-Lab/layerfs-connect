# Crew: conversion

Written by `node tools/replay/convert.mjs crew` from `0c7d9c47c1^` of the layerfs repository (`dsh/scenarios/crew/`). Rerun it to rewrite this folder; do not edit by hand.

Form `cli`: every bash step is plain `layerfs` lines. Each step that runs a command creates its own Sandbox from the configured runtime image, mounts a new Workspace, runs, Commits, unmounts and closes the Sandbox. The recorded outcome codes are each step's `expect`, checked live; the record id is each step's `note`.

| | count |
| --- | ---: |
| recorded steps (bash) | 1549 |
| bash steps kept | 354 |
| coordination steps (subagent, send_message, reply) | 613 |
| steps in all | 967 |
| turns left with no call: the reply alone, no echo | 113 |
| commands recorded | 304 |
| dropped: identical re-run on an unchanged Branch | 0 |
| dropped: verification off | 246 |
| dropped: date-dependent | 1 |
| commands kept | 57 |
| recorded seconds of the commands kept | 289.1 |
| recorded seconds of all commands | 2860.9 |
| Workspace mounts now / recorded | 57 / 304 |
| Workspace Commits kept / recorded | 57 / 304 |
| Sandbox creates now / recorded | 57 / 18 (+39) |
| recorded Committed Commits this scenario does not make | 40 (0 not optional in the recorded history) |
| writes (fs.apply) | 219 |
| forks from a recorded Commit: own id / a reply's id / Branch head | 5 / 2 / 1 |
| forks from a Layer of main (now main's head) | 0 |

Forks from a recorded Commit or Layer:

- lead-193 (root) forks work-w04-w05-w06-checkpoint from work.5#29: work.5#29 from work-b's W2b-084, carried to root by work-b's reply closing that turn
- lead-256 (root) forks insight.4 from people.5#6: people.5#6 from people's P1d-129, carried to root by people's reply closing that turn
- lead-267 (root) forks work.6 from people.5#10: people.5's head, which the record forked from (its step P1d-161 makes a Commit that may be UpToDate, so the ids it prints are not fixed)
- lead-312 (root) forks people.6 from int-depth-spine#1: its own int-depth-spine#0 from lead-307; this scenario does not make int-depth-spine#1 (its command is dropped), so int-depth-spine#0, the one before it
- lead-314 (root) forks insight.5 from int-depth-spine#1: its own int-depth-spine#0 from lead-307; this scenario does not make int-depth-spine#1 (its command is dropped), so int-depth-spine#0, the one before it
- lead-324 (root) forks lead-acceptance-review.1 from int-depth-spine#1: its own int-depth-spine#0 from lead-307; this scenario does not make int-depth-spine#1 (its command is dropped), so int-depth-spine#0, the one before it
- lead-352 (root) forks insight.6 from int-depth-admin#0: its own int-depth-admin#0 from lead-351
- lead-364 (root) forks insight.7 from int-filter-workflow.1#0: its own int-filter-workflow.1#0 from lead-363

Forks whose recorded call names another Commit than final.json's history (the history decides, as the order check compares with it):

- lead-193 (root) forks work-w04-w05-w06-checkpoint: the recorded call names work.5#26, final.json's history work.5#29
- lead-312 (root) forks people.6: the recorded call names int-depth-spine#0, final.json's history int-depth-spine#1
- lead-314 (root) forks insight.5: the recorded call names int-depth-spine#0, final.json's history int-depth-spine#1
- lead-324 (root) forks lead-acceptance-review.1: the recorded call names int-depth-spine#0, final.json's history int-depth-spine#1

Workspaces the record had mounted on one Branch at once, kept together in one step:

- none

Commands dropped as identical re-runs (step: same as step):

- none

Commands dropped as date-dependent:

- P1e-059 P1e targeted HTTP and canonical work revision regression exec: its workflow-impact test 16, "confirmed category changes reuse canonical issue and sprint ledger updates", reads today's burndown day of a sprint that ended 2026-10-20 (an app test unrelated to LayerFS)

Commands kept that repeat an earlier kept command on the same Branch, and why they run again:

- P1e-095 P1e final build and syntax exec: same as P1e-054 P1e prepare people build and syntax exec; the Branch changed since (a write or a Commit recorded as Committed)

Verification commands kept (install, a Branch's last build or test, or the latest build or prepare before that test):

- lead-013 L0: fresh Branch build syntax and four package tests (l0-verify; build, prepare, test; 2.7 s)
- lead-023 L0: published-main fresh-fork verification and source baseline (l0-main-check; build, prepare, test; 2.7 s)
- P1-0051 006 P-M1 final build and prepare tests exec (people.1; build, prepare; 1.6 s)
- P1-0063 009 P-M1 final affected tests and LOC exec (people.1; test; 3.3 s)
- lead-045 P-M1: integration install census build syntax and package tests (int-people-m1; install, build, prepare, test; 6.6 s)
- lead-061 L0: lifecycle integration install build tests and clean-stop proof (int-tools-shutdown; install, build, prepare, test; 6.9 s)
- W1-0037 004 W-M1 prepare syntax and build exec (work.2; build, prepare; 2.3 s)
- W1-0045 006 W-M1 combined all package tests exec (work.2; test; 4.8 s)
- lead-067 W-M1: integration install census build syntax and all package tests (int-work-m1; install, build, prepare, test; 8.2 s)
- W2-0063 W-M2 prepare build board and CLI tests plus frozen LOC (work.3; build, prepare, test; 4.5 s)
- W1-0081 013 W-M2 complete issue syntax bundle HTTP shared web CLI checks exec (work.3; build, prepare, test; 5.0 s)
- lead-082 W-M2: integration install census build syntax and all package tests (int-work-m2; install, build, prepare, test; 9.5 s)
- W1-0087 015 W-M3 actual HTTP CLI smoke and clean process restart proof exec (work.3; build, prepare; 4.1 s)
- W2-0109 W-M3 final complete package regression and frozen LOC (work.4; build, prepare, test; 10.5 s)
- P1b-0075 P1b 007 P-M2 actual HTTP smoke and process restart exec (people.2; build, prepare; 3.7 s)
- W2-0123 W-M3 final changed web regression and frozen production census (work.4; test; 0.4 s)
- P1b-0092 P1b 013 P-M3 current generation build and syntax exec (people.3; build, prepare; 3.1 s)
- P1c-010 P-04: build and syntax before changed verification execute (people.4; build, prepare; 3.2 s)
- I1-058 I-M3 shared HTTP web and actual token CLI search-filter proofs (insight.2; build, prepare, test; 6.8 s)
- I1-073 I-M3 actual scoped-token search filter and plain-help proofs (insight.2; prepare, test; 5.3 s)
- I2-074 changed M2 actual CLI proof (insight.2; test; 2.1 s)
- I2-134 approved preview flag changed actual streamed import CLI proof (insight.3; build, prepare, test; 6.8 s)
- I2-145 final changed transfer date proof acceptance audit and source census (insight.3; prepare, test; 6.9 s)
- W2b-086 verify restored sprint CLI compatibility and exact source count (work.5; prepare, test; 11.5 s)
- W1b-148 W-07: focused Markdown command selection and serialization proof (work.5; build, prepare, test; 5.4 s)
- W1b-166 W-07: final owned source hash ceiling and process custody after Markdown scopes (work.5; build; 0.4 s)
- P1d-161 P-05: 030 P-05 final cookie build and syntax exec (people.5; build, prepare; 5.5 s)
- P1d-173 P-05: 033 P-05 final source CLI package proof exec (people.5; test; 6.8 s)
- I2c-045 I-09: digest build and syntax before proof (insight.4; build, prepare; 2.9 s)
- I2c-050 I-09: digest targeted due HTTP CLI proof (insight.4; prepare, test; 7.7 s)
- W1c-045 W09/W10: build and prepare hierarchy syntax before tests (work.6; build, prepare; 5.8 s)
- W1c-061 W09/W10: prepare and corrected pure and same-timestamp HTTP field resolution proofs (work.6; prepare, test; 6.5 s)
- I2c-083 I-09: final source counter physical and live-process census (insight.4; build; 0.4 s)
- P1e-054 P1e prepare people build and syntax exec (people.6; build, prepare; 6.0 s)
- lead-327 L0: changed A13 census tooling proof and diagnostic current runtime smoke; formal acceptance remains open (lead-acceptance-review.1; build, prepare; 11.3 s)
- P1e-095 P1e final build and syntax exec (people.6; build, prepare; 6.1 s)
- I1c-045 I-11 I-12 product build and syntax before tests exec (insight.6; build, prepare; 6.2 s)
- I1d-087 I-13: build and prepare saved-filter view tests exec (insight.7; build, prepare; 6.7 s)
- I1d-091 I-13: focused canonical view and actual ownership CLI proof exec (insight.7; test; 4.3 s)
- P1f-028 people action lifetime: sandbox.exec (people-action-lifecycle-p1f.1; build, prepare; 6.7 s)
- lead-438 A01 reinstall: frozen acceptance command (acceptance; install; 1.6 s)
- lead-442 A02 build: frozen acceptance command (acceptance; build; 0.5 s)
- lead-446 A03 prepare tests: frozen acceptance command (acceptance; prepare; 5.7 s)
- lead-450 A04 shared tests: frozen acceptance command (acceptance; test; 0.3 s)
- lead-492 A01 reinstall: frozen acceptance command (acceptance.2; install; 1.5 s)
- lead-496 A02 build: frozen acceptance command (acceptance.2; build; 0.5 s)
- lead-500 A03 prepare tests: frozen acceptance command (acceptance.2; prepare; 5.7 s)
- lead-504 A04 shared tests: frozen acceptance command (acceptance.2; test; 0.3 s)
- lead-525 A01 reinstall: frozen acceptance command (acceptance.3; install; 1.7 s)
- lead-529 A02 build: frozen acceptance command (acceptance.3; build; 0.6 s)
- lead-533 A03 prepare tests: frozen acceptance command (acceptance.3; prepare; 6.6 s)
- lead-537 A04 shared tests: frozen acceptance command (acceptance.3; test; 0.4 s)

Seed additions (tools/replay/check.mjs accepts exactly these):

- /.npmrc (file: "before=2026-10-16T00:00:00.000Z\n")

The seed's `.npmrc` sets npm's `before=2026-10-16T00:00:00.000Z`, so `npm install` resolves the registry as it was when the run was recorded. The registry's transitive versions moved since: npm 11.19.0 on this scenario's final package.json files resolves /package-lock.json 06922ecc5ec4 with this date, the recorded one; without it 24489ac13f86, and with 2026-10-10 bb68d5de86af. The file is tracked, so main's record gains it.

final.json:

- main /.npmrc: added, 6cfbe8219bb2cdd92a9f87d06f65489b7b213701d1414eaccd50a5875ffb5348


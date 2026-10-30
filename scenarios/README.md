# Demo scenarios

Each folder here is one demo Connect replays on the real LayerFS: scripted
agents, no language model. The ten scenarios, their fixtures and their tools
come from dsh-layerfs (`scenarios/`, `demo-workspace/`, `tools/replay`,
`tools/checks`), renamed from dsh's names to LayerFS's own (see
[Name mapping](#name-mapping)). Each folder has one source of truth:

- **The seven hand-written scenarios** and `fixtures/demo-workspace` are what
  [`tools/port-scenarios.mjs`](../tools/port-scenarios.mjs) writes from
  dsh-layerfs. Only names changed: the steps, expects, exits, commits, `as`
  names, placeholders, shell and JavaScript are as dsh-layerfs has them,
  except agents' Sandboxes (see [Connect changes](#connect-changes)).
- **The replays (shop, depot, crew)** are what
  [`tools/replay/convert.mjs`](../tools/replay/convert.mjs) writes from the
  recording (layerfs `0c7d9c47c1^`). Connect's converter fixed two things
  dsh-layerfs's did not, so these differ from dsh-layerfs's copies (see
  [Replay fixes](#replay-fixes)).

`host/test/scenarios.test.js` checks both: the seven against a fresh port,
the three against a fresh conversion. **teams** is written in Connect, not
ported (see [Several sessions](#several-sessions)).


| Id | Order | Form | Fixture | Agents | Steps | Written by |
| --- | ---: | --- | --- | ---: | ---: | --- |
| tour | 1 | sdk | demo-workspace | 1 | 13 | hand |
| parallel | 2 | cli | demo-workspace | 3 | 8 | hand |
| conflicts | 3 | cli | demo-workspace | 1 | 13 | hand |
| merge | 4 | sdk | demo-workspace | 1 | 13 | hand |
| sandbox | 4 | sdk | demo-workspace | 1 | 6 | hand |
| agents | 5 | sdk | demo-workspace | 6 | 113 | hand |
| teams | 6 | cli | demo-workspace | 3 × 3 | 39 | hand, in Connect |
| shop | 7 | cli | seed.json | 1 | 17 | `tools/replay/convert.mjs` |
| depot | 8 | sdk | seed.json | 1 | 97 | `tools/replay/convert.mjs` |
| crew | 9 | cli | seed.json | 6 | 560 | `tools/replay/convert.mjs` |
| checkpoints | 10 | cli | demo-workspace | 3 | 24 | hand |

Steps count tool calls (not replies). [CONVERSION.md](CONVERSION.md) records
the move to format v3; each replay's own CONVERSION.md lists what its
conversion kept and dropped. Do not edit a replay folder by hand: rerun
`convert.mjs`.

## A folder

```
scenarios/<id>/
  scenario.json   the scenario (below); the folder name is its id
  seed.json       replays only: the fixture as a layerfs-demo-seed v1
  changes/        replays only: NNN.json, what `layerfs fs apply --from` reads
  final.json      replays only: the recorded run's final project, for the final checks
  CONVERSION.md   replays only: what the conversion kept, dropped and changed
fixtures/demo-workspace/   the fixture the hand-written seven Init from
```

## scenario.json (format v3)

```json
{ "type": "layerfs-scenario", "version": 3, "title": "Tour", "blurb": "…",
  "order": 1, "tags": ["sdk", "background", "sandbox", "publish"],
  "fixture": "../../fixtures/demo-workspace", "image": "sha256:…",
  "agents": { "root": [Step, …], "<child>": [Step, …] } }
```

- `title` (required), `blurb`, `prompt` (the user's request to root: its
  conversation opens with it), `order` (an integer; the list is sorted by it).
- `tags`: exactly one form, `cli` (every bash step is plain `layerfs …`
  lines; no SDK) or `sdk` (every bash step is one inline Node script on the
  SDK); at most one workload, `node` or `rust`, where real builds run; one to
  three topics from `conflicts`, `merge`, `publish`, `multi-agent`,
  `background`, `sandbox`. Anything else is refused.
- `fixture`: what a run copies into its folder `/<scenario>_<n>/` of the
  project it plays on, relative to the scenario's folder. A folder, or a
  seed file (`*.json`) that a run first writes out with
  [`host/seed.js`](../host/seed.js) `writeSeed(seed, dir)`. Scripts are
  written as if the fixture were the whole project on main: the engine keeps
  each call in the run's folder, Branches and Sandboxes
  ([host/README.md, "Where a run plays"](../host/README.md#where-a-run-plays)).
- `image`: optional runtime image digest; `{{image}}` in a command names it.
  No scenario sets one: Sandboxes run Connect's configured image.
- `agents`: `root` is the run's own agent; every other agent is started by a
  `subagent` step of its parent, with `description` equal to its name.
  Agent names are lowercase letters, digits and `-`.

### Several sessions

A scenario may hold `sessions` in place of `agents` (and no top-level
`prompt`): two or more sessions, each `{ prompt, agents }`.

```json
"sessions": {
  "checkout": { "prompt": "Build the checkout pages…",
                "agents": { "checkout": [Step, …], "cart": [Step, …], "pay": [Step, …] } },
  "search":   { "prompt": "…", "agents": { "search": […], "index": […], "results": […] } }
}
```

- Each session is a run of its own (a session in the app) with its own root
  agent, named after the session; its other agents are started by `subagent`
  steps as usual. Each session is checked as a scenario of its own, and agent
  names are unique over all sessions.
- One start plays them all at once (a launch): the first session sets up
  the folder, the others wait for it, then all play in it. They share the
  folder, Branches and Sandbox numbers, so Branch names must not collide,
  and Sandbox numbers are not known ahead: use `{{sandbox}}` and `{{ws}}`.
- They end together: once one fails or is stopped, the others stop, and the
  project's Sandboxes are closed once. A launch counts once against the two
  replays that may play at once.

**teams** (`3 sessions`): checkout, search and docs start at once. Each lead
starts two subagents; each subagent forks its own Branch from main, writes
its page with `fs`, opens a Sandbox of its own, adds data in a Workspace,
tests, commits, unmounts and closes it. Each lead merges its two Branches
into the session's Branch (`branch merge`) and tests it in its own Sandbox.
No session writes main, so the sessions never conflict. Up to six Sandboxes
are open at once.

### Steps

A step is one tool call or a reply:

```
{ <tool>: args, say?, phase?, note?, expect?, exit?, commits?, as? }
{ reply: "…", until?: [child, …], phase?, note? }
```

- `say` is said before the call, `phase` names the part of the run the run
  bar shows, `note` is for readers.
- A reply ends the agent's turn. The root's next turn starts when every child
  in `until` has finished its turn; a child's when its parent sends it a
  message. A turn may be a reply alone (a child answering its parent), but a
  reply next to one that waits (`until`) needs a call between them. A list
  that does not end in a reply ends with `Done.`.
- `exit` (bash only, default 0): the call's exit status must be this.
- `expect` (bash only): outcome codes its LayerFS trace lines must show in
  order, other lines between allowed (below).
- `commits` (bash only): refs naming, in order, the Commit ids the call prints
  (the `head` of its JSON lines whose kind is Committed or Merged).
- `as` (bash only, with `run_in_background`): names the background job, which
  `job_output` / `job_kill` then name as `@<as>`.

### Tools agents have

Agents have bash and the subagent tools, as in dsh-layerfs; nothing else.

| Tool | Arguments (required in bold) | Ids |
| --- | --- | --- |
| `bash` | **description**, **command**, timeoutMs, workdir, run_in_background | |
| `subagent` | **description** (the child's name), **prompt**, cwd | |
| `send_message` | **agent_id**, **message** | `@<child>` |
| `interrupt_agent` | **agent_id** | `@<child>` |
| `list_agents` | scope | |
| `job_output` | **job_id**, wait, timeout_ms | `@<job>` |
| `job_kill` | **job_id**, reason | `@<job>` |
| `job_list` | | |
| `working_directory` | cd | |

A subagent's prompt holds no placeholder and neither contains nor is
contained in another's: a child is known by its prompt. Each agent's bash
cwd is the run's `work/` folder. A bash call gets the project's `LAYERFS_*`
settings (PROJECT, HOME, DOCKER, IMAGE, DAEMON, VOLUME, STORE_PATH,
CONTAINER_PREFIX, WORKER_ENDPOINT, plus TRACE, TRACE_STEP and
TRACE_START=1), the `layerfs` command on PATH, and
`NODE_OPTIONS=--import=<connect>/host/resolve-layerfs.js`, so a bare
`@layerfs/agent` or `@layerfs/backend` import resolves from any cwd. cli
scenarios also pipe through `jq` on the host's PATH.

An sdk step is exactly one inline script, after optional `#` comment lines:

```bash
# a read needs no Workspace
node --input-type=module <<'JS'
const { LayerFS } = await import("@layerfs/agent");
const lf = await LayerFS.open(process.env.LAYERFS_PROJECT);
try {
  const { items } = await lf.fs.list("feature-home", "/app");
  for (const e of items) console.log(e.type, e.name);
} finally {
  await lf.close();
}
JS
```

A cli step must not use the SDK (`@layerfs/agent`, `@layerfs/backend`,
`LayerFS.open(`).

### Placeholders

Filled when the scenario loads:

- `{{scenario}}`: the scenario folder's absolute path. Write it inside double
  quotes (`layerfs fs apply main --from "{{scenario}}/changes/007.json"`); a
  folder whose path holds `"`, `$`, a backtick or a backslash is refused.
- `{{image}}`: the scenario's `image`.

Filled when an agent sends the step, from what that agent has seen (its tool
results and the messages it received):

- `{{sandbox}}`: the Sandbox number it saw last (`"sandbox":"N"`).
- `{{ws}}`: the Workspace it saw last (`"ws":"<sandbox>:<path>"`), for one
  kept mounted across steps.
- `{{commit:<ref>}}`: the Commit id a step with `commits: [<ref>]` printed, or
  one a received message carried. A send_message message or reply holding
  `{{commit:<ref>}}` is how an id reaches another agent. Each ref is named by
  one step, and every `{{commit:<ref>}}` names one.

Nothing else is replaced: `docker ps --format '{{.Names}}'` stays as it is.

### Expect codes

A trace line's code is `<method>:<kind>` for a call that succeeded (`ok` when
its answer has no kind) and `<method>:<code>` for one LayerFS refused, with
the SDK's method names as the trace writes them: `sandbox.create:ok`,
`workspace.mount:Mounted`, `workspace.exec:exit:0`,
`workspace.commit:Committed`, `workspace.commit:Conflict`,
`workspace.unmount:Busy`, `fs.apply:Committed`, `branch.fork:Forked`,
`branch.merge:Merged`, `branch.publish:Added`, `sandbox.close:Closed`,
`backend.daemon.process.start:running`. An entry is
`[<method>:]<outcome>[|<outcome>…]`; without a method it matches that outcome
of any call. Alternatives share what precedes the last `:` before the first
`|`: `workspace.exec:exit:1|0`, `workspace.commit:Committed|UpToDate`. The
older SDK's names (`sandbox.mount|exec|commit|unmount`, `operator.process.*`,
`sandbox.create:Ready`) are refused. A background bash step's expect is
checked after the run only. The ten scenarios check 29 codes
(`node tools/replay/coverage.mjs - <ids…>`), the same 29 as dsh-layerfs.

### Final checks

After the root's last step, a scenario with `final.json` (shop, depot, crew)
has its run checked by [`host/checks`](../host/checks/index.js)
`finalChecks`, through the run's open client. A run plays in a folder on
trunk Branches, so each check reads the record that way: main's Layers are
the run's trunks, main's files its folder on its last trunk, the project's
Sandboxes its own (host/README.md, "Where a run plays"):

- `final.order`: every Branch's Commits (message and how they were made:
  `fs` or `exec`), forks, merges and main's publishes as recorded, named by
  place (`L3`, `orders#2`). A recorded `optional` Commit may be missing; a
  Branch's `extras` may be present if it changes no tracked file.
- `final.tree`: every tracked file on main (not excluded by the project's
  .gitignore files) has the recorded SHA-256, and no other tracked file
  exists. `varies.stamp` matches clock readings in names; `varies.content`
  files are compared by presence. The bytes are hashed by `sha256sum` in a
  Workspace of a Branch `final-tree-check-<time>` forked from main, in a
  Sandbox of its own, unmounted without a Commit and closed.
- `final.closed`: no Sandbox of the project still runs.

## Connect changes

- **agents keeps two Sandboxes for the session.** dsh-layerfs's "5 agents"
  has every subagent command create a Sandbox, mount, run, commit, unmount
  and close it, so a Sandbox lives about a second and Live shows none most
  of the time. The port ([`tools/lib/agents-sandboxes.mjs`](../tools/lib/agents-sandboxes.mjs))
  changes it: after forking, the lead opens Sandbox 1 for checkout (Ava, Ben,
  Cy) and Sandbox 2 for search (Dee, Eli), checking it got those numbers (a
  run numbers its own Sandboxes from 1, whatever the project's numbers). Each subagent's prompt names
  its Sandbox; every command mounts a Workspace of its own there and unmounts
  it; the lead builds release in Sandbox 1 and closes both before its last
  reply. In a shared Sandbox, Cy finds the Workspace it keeps open by its
  path (`{{ws}}`) and Dee's stop unmounts only the server's Workspace. Two
  lead steps are added (113 tool calls, was 111). Each rewrite must match
  dsh's text exactly, or the port stops.

## Replay fixes

- **npm pin (shop, crew).** The registry's transitive versions moved after the
  recordings, so `npm install` on crew's final package.json files resolves
  another `/package-lock.json` (24489ac13f86) than the recorded one
  (06922ecc5ec4), and the final tree check fails. Both seeds gain
  `/.npmrc` with `before=2026-10-16T00:00:00.000Z` (`SEED_ADDITIONS`, as
  depot's `.cargo/config.toml`); npm 11.19.0 then resolves exactly the
  recorded lock for crew and for shop (8136d96782d2, which also still
  resolves unpinned today). The file is tracked, so its hash is added to
  final.json's main. Each CONVERSION.md says why.
- **Fork sources from final.json's history.** A recorded fork call names its
  source by its own count of the Branch's Commits, which can disagree with
  final.json's history, the record the order check compares with. crew's
  lead-193 call says `work.5#26`; the history says `work.5#29` (W2b-084's
  Commit, the head after W2b-087's UpToDate). The converter now takes the
  history's `forkedFrom`, so lead-193 forks from `{{commit:work.5#29}}`,
  which work-b's reply closing its turn 28 carries to root. It also moved
  lead-312, lead-314 and lead-324 from `int-depth-spine#0` to `#1` (an
  optional Commit, so the forks still name `#0`). CONVERSION.md lists each.
  `tools/replay/check.mjs` (`forkFailures`) now refuses a fork from
  `{{commit:<ref>}}` that is not final.json's `forkedFrom` (or an earlier
  Commit of that Branch with only optional Commits between).

## Fixtures and seeds

shop's and crew's seeds hold `/.npmrc` and depot's `.cargo/config.toml`
beyond the recorded seed (see [Replay fixes](#replay-fixes)).
`fixtures/demo-workspace` is a copy of the files dsh-layerfs tracks in
`demo-workspace/` (its untracked `gen/` and `nebula-5-htmls/` are not
copied). A seed (`layerfs-demo-seed` v1) is
`{ format, version: 1, entries: { "/<path>": { type: "file", mode?, text | base64 } | { type: "dir", mode? } | { type: "symlink", target } } }`;
it exists because a replay's fixture holds a `.git/HEAD`, which cannot live
in a repository as a file.

## Name mapping

What `tools/port-scenarios.mjs` changed, with counts over all ten:

| dsh-layerfs | Connect | Where |
| --- | --- | --- |
| `await import(process.env.DSH_LAYERFS_SDK)` | `await import("@layerfs/agent")` (the script's own quote) | 186 sdk steps |
| `await import(process.env.DSH_LAYERFS_BACKEND)` | `await import("@layerfs/backend")` | 5 steps (tour, sandbox, agents) |
| `process.env.DSH_LAYERFS_PROJECT` | `process.env.LAYERFS_PROJECT` | 186 steps |
| `$DSH_LAYERFS_<NAME>` / `process.env.DSH_LAYERFS_<NAME>`, NAME one of HOME, DOCKER, IMAGE, DAEMON, VOLUME, STORE_PATH, CONTAINER_PREFIX, WORKER_ENDPOINT, TRACE, TRACE_STEP, TRACE_START | `LAYERFS_<NAME>` | none used; mapped if one appears |
| `DSH_LAYERFS_CLI` (the layerfs command's path) | none: `layerfs` is on PATH | not in a scenario; the port refuses it |
| `DSH_SOURCE` (dsh's client build) | none | not ported |
| fixture `../../demo-workspace` | `../../fixtures/demo-workspace` | 7 scenarios |
| "the configured Host runtime image" | "the configured runtime image" | the replays' CONVERSION.md (convert.mjs writes it) |
| "the Host's own Branch poll (`packages/host/src/storage.js`)" | "the recording host's own Branch poll" | CONVERSION.md |
| loader rule: an SDK step uses `DSH_LAYERFS_(SDK\|BACKEND)` | uses `@layerfs/(agent\|backend)` | the form check |
| `packages/mock/src/scenario.js`, `expect.js`, `seed.js` | engine `host/runs/`; tools `tools/lib/scenario.mjs`, `tools/lib/expect.mjs`; `host/seed.js` | |
| run record `<profile>/dsh-layerfs-mock/runs.json`, lines `<profile>/dsh-layerfs/lines/<root>.jsonl` | `<state>/runs/<run id>/run.json`, `traces/<agent>.jsonl`, or `GET /api/runs/:id` | tools/checks/run.mjs |
| project `mock-<scenario>` | `<demo>-<n>` | |

`dsh/scenarios/<name>/` in the replays' CONVERSION.md is the recording's path
in the layerfs repository at `0c7d9c47c1^`, and stays.

## Tools

| Command | Does |
| --- | --- |
| `node tools/port-scenarios.mjs [--from <dsh-layerfs>] [--check]` | ports the seven hand-written scenarios, CONVERSION.md and the fixture again (replacing them whole) and prints a summary of each rule applied; `--check` only reports drift |
| `node tools/replay/check.mjs <id>` | loads a folder, `bash -n` every command (`node --check` every sdk script), checks changes/ files are applied lists; for a replay, each fork from a recorded Commit against final.json's history, and its seed against the recording plus its declared additions (`--repo`, default ../layerfs, `--rev`, default `0c7d9c47c1^`) |
| `node tools/replay/coverage.mjs <rev\|-> <id…> [--repo <git checkout>]` | the expect codes, one per line |
| `node tools/replay/convert.mjs <shop\|depot\|crew> [--repo] [--rev] [--out <dir>]` | regenerates a replay from the recording: the source of truth for shop, depot and crew |
| `node tools/checks/run.mjs <run folder>` or `--url <host> --token <t> <run id>` | checks a finished run: its state, every expect against its trace lines, and the final checks its record holds |
| `node --import ./host/resolve-layerfs.js tools/checks/final.mjs <project> <id>` | runs the final checks on a project of Connect's home outside a run (`--final <file>`, or `--record <out>` to write a final.json of a project's present state) |

The tests: `node --test host/test/scenarios.test.js host/test/seed.test.js`,
`node --import ./host/resolve-layerfs.js --test host/test/checks.test.js`,
`node --test tools/checks/tests/checks.test.mjs`.

## What depended on dsh

- `{{sandbox}}`, `{{ws}}` and `{{commit:<ref>}}` were filled by dsh's
  scripted model from each agent's own conversation; Connect's engine does it.
- The subagent and job tools followed dsh's tool schemas; their arguments are
  unchanged above.
- crew's ~640 `project.list_branches` lines came from dsh's host polling
  Branches, not from the scenario; the expect check passes over calls a step
  does not expect, so their absence changes nothing.
- dsh wrote a seed out under its profile when the scenario loaded; Connect
  writes it when a run starts.
- `{{scenario}}` must be a real folder path that `layerfs fs apply --from`
  and Node can read: a packaged app must ship scenarios/ outside an asar
  archive.

# Sandbox image integration — 2026-11-10

## Source and runtime identity

LayerFS feature branch `feat/sandbox-image-artifacts` is based on
`origin/layerfs_v2_0_0` at `58c548b3e0`. Production implementation is committed
as `00b24bc7259905e6c2532e5fca4840ad86e2ff26`; generated SDK signatures and
call-table assertions are corrected in `1edcf58caec2bf079a07891411a0151c9afa3e80`.
The strengthened live-proof scripts are committed as `f87d8664dc`; production
source is unchanged from the feature runtime at `1edcf58cae`.
The existing `layerfs-v2-merge` checkout has overlapping documentation edits and
was not modified or merged by this work.

The preview uses a separate, intentionally dirty integration snapshot combining
that feature with the concurrently developed Storage report APIs (69 calls).
The Storage checkout was read only; its changes are not included in the image
feature commits. Snapshot provenance is in `storage-source.patch` and
`storage-snapshot.json` in the integration registration root.

Registration roots under `/Users/yifanxu/.cache/layerfs-worktrees/`:

- Feature: `layerfs-sandbox-images-af7be8c8541a`.
- Combined preview runtime: `layerfs-connect-image-ru-5b7a74044d64`.

The original combined macOS sealed artifact was
`artifacts/build-macos-25a2f109dd4442b38bc9088ec36dac99`.
Its matching Linux bundle is `linux-runtime/2.0.0/linux-aarch64`, bundle hash
`794d1e4c85a745b58d8aa29cb1d0a360606027b69197c6e6c55b0bd78d89eeca`.
`desktop/.env.local` explicitly selects the preview CLI, daemon and bundle.
Existing workers were not restarted to adopt these binaries.

### Native Sandbox inventory regression

Commit `970dac8a70` fixes an image-validation regression discovered through
Studio's Build button. Existing native macOS Sandboxes record `image: "local"`.
The route forwarded that runtime marker as an explicit image selection, causing
`sandbox.get` to refuse `InvalidInput` during preset reset planning. Stored
digests are now forwarded; runtime markers are not. Public image input remains
strictly validated.

Before the fix, reading the existing `demo-website` Sandbox returned
`Sandbox image must be a full sha256 config digest`. Afterward the same read
returned Running and its two Workspaces without changing the record. The native
SDK lifecycle test passed with a real matching daemon (create, get, mount,
exec, commit, unmount, close), including explicit `image: "local"` rejection.
Formatting and whitespace checks passed; production LOC remained 157,223.

The preview's updated macOS artifact is
`build-macos-0869ec2ceccc4286bd1bb80fb17161b3`; its Linux bundle is unchanged.
The actual browser Build projects action now reaches the `Build Studio?`
confirmation instead of the digest error. The confirmation was cancelled;
this check did not reset or rebuild the user's existing Studio resources.

### Existing Studio worker recovery

The next user-started reset reached `sandbox.close demo-compiler`, where the
running worker still had bundle `29b69e47719660bcdab3d6761e5e63f3833490b37c83867db089f6a7200d0d7d`.
The reset stopped with no cleanup step completed. All three Studio guest
workers had that bundle mismatch. A direct machine stop correctly refused
`InUse` while their Sandbox records existed.

Recovery used the retained matching bundle under
`.cache/layerfs-bundles/833d04cf44e8e747929d50ab1170a48260d9381c/2.0.0/linux-aarch64`
to inspect and close only `demo-compiler`, `demo-embeddings`, and `demo-gateway`.
Their four remaining Workspaces were idle and clean; they were unmounted
without `--discard`. Each associated worker (`demo-build`, `demo-research`,
`docker`) was then stopped and started with the current explicit preview
bundle. All three current-bundle `machine.images` reads passed. Stores and
project history were preserved. Exact successful operations are retained in
[worker-bundle-recovery.jsonl](worker-bundle-recovery.jsonl).

## Contract

`machine.images(name)` reads the machine's configured rootfs archive and
previously imported archives. It does not enumerate a registry or Docker
Engine images, pull images, or start stopped machines. Native macOS returns
host mode with no selectable images.

`sandbox.create` accepts an available config digest or
`{image: {archive: "/absolute/caller/path.tar", digest?: "sha256:…"}}`.
The CLI also accepts `--image-archive` and an optional `--image` digest.
LayerFS validates, transfers and caches the archive, then injects its daemon
and helper through the existing creation mechanism. A custom image must be
compatible with the worker architecture and injected Linux binaries.

## Automated verification

- CLI image parsing: 5 passed.
- Backend inventory: 4 passed.
- Artifact validation/cache safety: 4 passed on macOS and Linux.
- Linux inventory resolution: 2 passed.
- Feature API call table and machine images: 17 passed with machine/postgresql.
- Real Node addon/package checks: 8 passed; TypeScript SDK sample passed.
- Combined runtime: Node/package 8 passed (69 calls); CLI image parsing and
  Storage report dispatch 6 passed.
- Formatting, boundary guard and whitespace checks passed.
- Python signatures were regenerated; the Python runtime was not exercised.

## Live Lima and Docker proof

Feature registration evidence directory: `live-proof-slim-1794278448405`.
`receipts.ndjson` has 21 terminal PASS receipts, including preparation,
creation, execution, reuse and cleanup. `events.ndjson` contains SDK results
and actual progress. Every live phase had a hard 110-second deadline.

The custom archive was 192,706,560 bytes, with config digest
`sha256:18959592d41bd40f27b442f227f416002d06297787b281be20225e3d0b70cba5`.
It contains two compatible base layers and an additional sentinel-file layer.
Both providers passed archive creation and discovery, mounted a real Store
workspace, checked the custom sentinel and workspace file, observed the
injected daemon process, and successfully executed inside the Sandbox.
After deleting the caller archive, both created and executed a second Sandbox
using only the cached digest. Sandbox, Store, machine and exact disposable
Docker worker/volume cleanup passed. A retained archive copy supports the
separate browser check.

An earlier independent 2,747,709,440-byte treatment in
`live-proof-1794277596559` exceeded the same 110-second import deadline on
both providers. Its import verdicts remain UNKNOWN and were not replayed.
Read-only reconciliation found the published image and no Sandbox runtime;
exact cleanup passed. The smaller fixture is a separate treatment, not a
replacement verdict. Large-image latency is not qualified by this proof.

## Browser verification

The actual web preview passed discovered-image creation and deletion on the own
Lima fixture `image-ui-1794278811`. Selecting the listed base digest
`sha256:1d91885de27a20805af0d1b99602ace066f0514983613e391ee1f73ac8e7c2e9`
created `app-1`; its machine card reported the same digest. Delete confirmation
removed it and returned the page to zero Sandboxes.

Provide archive then created another `app-1` from the retained 192,706,560-byte
caller-local archive, without specifying a digest, in approximately 12 seconds.
Pending inputs were disabled. Its recorded image was the custom digest
`sha256:18959592d41bd40f27b442f227f416002d06297787b281be20225e3d0b70cba5`.
Reopening the picker listed the imported tag `layerfs-proof:6dd79ef2736240d6`
alongside the base image. Cancel and final custom-Sandbox deletion succeeded;
the page again showed zero Sandboxes.

Native inventory returned HTTP 200 with `mode: "host"`; macOS native image
controls were hidden. Earlier actual-preview checks verified honest Unsupported
inventory on an older CLI, Default remaining selectable, relative-path and
incomplete-digest validation, and scrolling at 900×600 (dialog top 16, bottom
584, scroll height 734, overflow auto, no horizontal overflow). At 1280×820,
the final dialog bounds were (416,172)–(864,648), without horizontal overflow.
The final browser flow added no console errors; the console retained historical
CSP-worker and obsolete-host connection errors from earlier sessions/reloads.
No Electron app was launched. Forced deletion and Unknown creation recovery
were not induced in this browser pass.

Exact final browser checks are in [browser-checks.json](browser-checks.json).
Own fixture setup, cleanup and terminal results are retained in
[browser-fixture-cli.jsonl](browser-fixture-cli.jsonl) and
[browser-fixture.json](browser-fixture.json). All Sandbox, Store, VM and source
resources created for this browser proof were removed; existing resources and
workers were preserved. Desktop typecheck and build passed after renderer edits.

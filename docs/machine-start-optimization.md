# Machine startup optimization

Implemented locally on 2026-11-09. LayerFS changes are on the private
`machine-start-artifacts` branch in `/Users/yifanxu/Ephemeral-AI-Lab/layerfs-machine-start`,
based on `833d04cf44e8e747929d50ab1170a48260d9381c` (the pinned
`layerfs_v2_0_0` source). Published on 2026-11-10 to `origin/layerfs_v2_0_0` as
`58c548b3e0a45f11880e3511bf1267d11e315415`. The private worktree is clean.
Publication checks and source-size receipts are in
[the publication evidence](evidence/machine-start-2026-11-10/publication.json).
Connect's web preview selects that worktree's host CLI through its ignored
`desktop/.env.local`. The Linux runtime remains the previously verified matching
bundle `29b69e47719660bcdab3d6761e5e63f3833490b37c83867db089f6a7200d0d7d`.

## Observed startup

| Provider / condition | Full CLI-to-ready observation |
| --- | ---: |
| Docker, first content mapping missing; real import executed | 29.363 s |
| Docker, second fresh home, installed shared content tag | 0.462 s |
| Apple Container, installed stock Debian image, new guest | 11.974 s |
| Apple Container, installed prepared OCI image, new guest | 1.619 s |
| Apple Container through Connect's real web-preview host API | 1.640 s |
| Lima, installed prepared OS image built by the new tool, new powered-off guest | 8.639 s |
| Lima stop/start of that existing machine | 8.516 s |
| Already running: Apple Container / Lima | 0.160 s / 0.096 s |

The [prior Lima investigation](specs/lima-cold-start-optimization.md) measured a
matched stock/prepared pair of 28.498 / 8.471 seconds using bundle `9250c5…`.
Our 8.639-second implementation observation uses a different matching bundle;
it is not a new matched pair against the earlier stock observation.

These are single exploratory diagnostics on this Mac with provider services
running, installed local artifacts and uncontrolled ordinary host caches. Image
preparation, downloads, independent verification and cleanup are outside startup
measurements. The Docker import case had no content mapping; it does **not** prove
the underlying Engine image was absent. No shared image was purged to manufacture
a cold case. None is a fresh-host, page-cache-cold or release-admission claim.
No warm pool, saved guest memory or running spare machine is used.

First Sandbox preparation is separate: 3.657 seconds on prepared Apple Container
and 6.125 seconds on prepared Lima in these flows. It is not hidden in machine
startup or promised to be equally fast.

## Implementation

| LayerFS source | Result |
| --- | --- |
| `layerfs-machine/src/image.rs`, `layerfs-platform/src/platforms/docker/images.rs` | Engine-owned `layerfs-cache/sandbox:<config-hex>` maps image content to Docker's actual imported ID. Presence is checked; only missing images cause import. Locks serialize the same socket/content across homes. Runtime-only rebuilds keep the image. |
| `layerfs-platform/src/setup/artifacts.rs` | Apple and Lima compare per-file identities and presence. Changed artifacts are extracted into a staging directory and renamed; the manifest and completion marker are published last. Unchanged archives stay installed. |
| `tools/linux_bundle.py`, `layerfs-machine/src/bundle.rs` | Separate runtime/image identities, deterministic archive metadata and protocol/architecture preflight. Legacy manifests remain explicit compatibility cases with final worker validation; their whole-folder installation stages a complete copy before publication. |
| `tools/machine_image.py`, `tools/machine_image_guest/` | Explicit, versioned prepared-image builder from stock OS inputs and validated bundles. Lima seeds have a fixed build account; seed credentials, machine ID, host keys and worker state are scrubbed. Fresh cidata initializes each instance. Apple OCI images preinstall public artifacts. Workers are checked before publication. |
| machine create/start, endpoint and API table | `os_image` selects the VM OS separately from the Sandbox `image`. Compatible locally installed prepared images are resolved by provider, architecture, protocol and image content. `--progress` reports stages and elapsed milliseconds. Authenticated matching hello precedes ready recording; failed workers retain endpoint/data custody. |

Existing flat bundle and guest paths are retained. The prepared-image mappings
live under the private `XDG_CACHE_HOME` selected in `desktop/.env.local`, beneath
`layerfs/machine-images/<provider>/<platform>/<image-content>/current.json`.
Immutable Lima disks live under its `objects/` directory. Docker's mapping is in
the selected Engine, rather than a second host-side image-ID database. Writable
roots, data disks/volumes, endpoints and secrets remain private per machine.

The public create option is `--os-image`, distinct from `--image`. An explicit
selection reaches the provider without silent substitution. With no explicit
selection, the resolver uses an installed compatible prepared image, otherwise
the provider's stock image. Preparation is explicit and never hidden in Start.
The tool can be run with `--help`; it accepts a cached stock Lima OS file or an
installed Apple OCI base and writes versioned images and receipts. The experimental
host-specific disk from the earlier investigation is not shipped or selected.

Connect discovers whether machine progress is supported, requests it through the
normal CLI and retains rapid stage transitions in CLI Activity. Explicit local
preview pins reload through Vite even when its inherited shell held an older pin.
No desktop app was launched; packaging/native startup was not verified.

## Verification

- Real Disposable SQLite flows passed on Docker, stock/prepared Apple Container
  and prepared Lima: project Init, push, Branch fork, Sandbox, mount, exec read/write,
  explicit Commit, independent `file.read`, unmount and close. Prepared Apple and
  Lima also passed stop/start persistence and pull-back verification. The later
  Docker isolation proof includes committed writes and independent reads.
- Two instances of each provider were started concurrently and passed isolated
  marker checks with distinct worker endpoints and secrets. Two Lima instances
  had distinct machine IDs and SSH host keys, no seed account or Python build
  cache, and active AppArmor. Concurrent Lima creation observed 8.941 / 8.983 s;
  this is a separate contention diagnostic, not a single-instance latency promise.
- Regression coverage includes concurrent first import, runtime-only/image-only
  change, pruning, different Engines, legacy reuse, interrupted guest copy,
  missing artifact repair, architecture/protocol/prepared-image validation,
  progress declarations and current worker compatibility.
- Covering Rust tests, warning-denying Clippy, formatting, product boundary guard
  and its self-tests, Python builder tests, Connect host tests and desktop
  typecheck/build were run. Native binding execution tests were not run; the
  modified Node/Python table tests received syntax checks.
- The real renderer displayed the created prepared Apple machine as Running.
  It was removed afterward. The pre-existing Docker worker stayed running and
  unrelated machines were not restarted.

## Remaining verification limits

The [2026-11-10 follow-up](machine-start-first-use-verification.md) now verifies
PostgreSQL Sandbox/workspace read/write, explicit Commit and restart persistence
on Docker, Apple Container and Lima. It also records uncached public stock-image
downloads and a new stock Lima machine, with prerequisite installation excluded.

A complete fresh-host setup including runtime/prepared-image distribution,
genuinely absent provider images in an isolated Engine/image store, controlled
host page-cache-cold timing, and every provider's image-only invalidation/corruption
case remain unverified. Image invalidation and copy failure behavior have
regression coverage; that does not substitute for the missing live matrix cells.
Native Node/Python binding execution also remains unverified.

## Failures, recovery and evidence

Failures are retained in [the evidence directory](evidence/machine-start-2026-11-09/).
The first Lima seed path exceeded the Unix socket limit; a short private Lima home
fixed it. Lima 2.x names its root `disk`, while older versions used `diffdisk`; the
builder now handles both. The first prepared boot hit an identity/SSH socket
systemd ordering cycle, diagnosed from the stopped guest's syslog. SSH service
activation now depends on identity initialization. A new image built from stock
then passed functional and independent-instance proofs.

Apple's initial compressed multi-GB OCI build exceeded its 120-second bound.
The provider reported cancellation. The revised single uncompressed artifact
layer built in 63.001 seconds. That is preparation cost, not machine start time.
An image verification initially assumed Python existed in slim Debian; verification
now runs on the host over an authenticated private loopback connection instead.
A test fixture also needed a blocking accepted socket; its failed receipt remains.

All owned live test machines, data disks/volumes and verification containers were
removed. The idle builder started by this task was stopped and deleted. Superseded
owned images/build contexts were released after diagnosis; tested immutable images,
receipts, the private worktree and the active pinned host CLI remain protected.
Cleanup selections and actual host free-byte recovery are recorded in `cleanup.json`.

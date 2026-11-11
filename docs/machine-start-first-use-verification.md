# First-use downloads and PostgreSQL verification

Verified on 2026-11-10 using clean host CLI commit
`58c548b3e0a45f11880e3511bf1267d11e315415` (`machine`, `postgresql` features),
and matching protocol-3 Linux bundle `29b69e47719660bcdab3d6761e5e63f3833490b37c83867db089f6a7200d0d7d`.
The guest binaries in that bundle retain their independently recorded clean
`833d04cf44e8e747929d50ab1170a48260d9381c` source identity.

These are single exploratory diagnostics on this Mac, not release admission or
controlled host-page-cache-cold measurements. No warm pool was used. Provider
services and the host CLI/Linux runtime bundle were already installed.

## Downloads into empty owned destinations

| Acquisition | Verified payload | Observed wall time |
| --- | ---: | ---: |
| Debian trixie-slim linux/arm64 OCI content | 30,214,503 bytes | 8.922 s |
| Ubuntu 24.04 arm64 cloud image body | 616,522,752 bytes | 32.817 s |
| Ubuntu checksum metadata acquisition | 7,843 bytes | 1.762 s |
| Ubuntu local SHA-256 verification | entire image | 0.387 s |

Debian's acquisition includes token, index and manifest requests, concurrent
config/layer downloads and digest verification. Its selected manifest is
`sha256:24a01011d10eba3a023bc8585b9650b8b29021240d4217c05b905e09ef4a5232`.
Ubuntu matched the downloaded official SHA256SUMS entry:
`50e24e1fb79e89116e939d90aa7738f7af48c442fa1bc2510131e0b39c50348e`.
Every payload was fetched in full by HTTP GET without range, resume or retry.
Shared provider caches were not purged. Network/CDN caches are uncontrolled.

A new Lima guest using that newly downloaded stock OS and an empty LayerFS cache
then reached matching worker readiness in **30.188 s**. Body download plus create
sums to **63.005 s**; including the measured checksum-metadata and verification
stages gives **65.154 s**. This is a sum of staged timings, not one inclusive
wall-clock fresh-host sample. The provider and Linux bundle were preinstalled;
installing/downloading/building those prerequisites is excluded.

Apple's provider import was not measured as an empty-store import: its shared
store already held Debian layers, and those layers were preserved. Docker's
LayerFS sandbox archive comes from the sealed local bundle. This change has no
automatic acquisition path or published download URL for its newly prepared
LayerFS OS images. Therefore a complete fresh-host optimized setup, including
all provider/runtime/prepared-image installation, remains unverified. These
network samples must not be presented as that complete result or as a guaranteed
few-second first use.

## Real PostgreSQL execution

Each provider used a fresh private LayerFS home, fresh machine, distinct database
on a task-owned PostgreSQL 17 server, and unique marker. PostgreSQL used
`synchronous_commit=off` explicitly; the disposable server also disabled fsync
and full-page writes. No Durable profile was executed. Prepared OS/runtime
artifacts were installed locally before these samples.

| Provider | Machine ready | First PG Sandbox | Mount | First exec read/write | Commit | Independent file.read | Stop/start |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Docker | 0.520 s | 6.528 s | 0.109 s | 0.330 s | 0.195 s | 0.129 s | 0.516 s |
| Apple Container | 1.643 s | 4.132 s | 0.106 s | 0.039 s | 0.148 s | 0.163 s | 1.455 s |
| Lima | 9.812 s | 7.718 s | 0.064 s | 0.041 s | 0.158 s | 0.143 s | 7.641 s |

All three passed Store connect, project Init, Branch fork, Sandbox create,
Workspace mount, exec reading the fixture and writing a unique marker, explicit
Commit and independent host-side file.read. They then unmounted, closed the
Sandbox, stopped/started the machine, created another Sandbox and mounted the
same Branch. Exec read the persisted marker on every provider. The second
Sandbox creation took Docker 0.368 s, Apple 0.347 s and Lima 1.017 s; it reuses
prepared Sandbox content and is a different condition from the first creation.
All times include the individual CLI invocation; exec is a tiny cat/printf proof,
not a large workload benchmark. Startup, initial Sandbox preparation and Store
operations are separate costs and must not be collapsed into a single claim.

## Retained failure and recovery

The first Apple test used a server published only on host 127.0.0.1. Sandbox
creation refused before starting, with the existing documented hint that Apple
Container requires the server on its bridge. That failure remains in
`postgres-apple-container.json`. A separate fresh home/database/server then passed
with the server bound specifically to both loopback and private bridge
192.168.64.1; it never listened on all LAN interfaces. Its successful receipt is
`postgres-apple-bridge.json`. This was a fixture configuration correction; no
LayerFS source was changed and the failed call was not replayed.

Automatic approval review initially rejected the Docker test because its
built-in name did not establish isolation. Read-only inspection verified the
new home's unique ID, absent derived worker/volume and distinction from active
workers. The test added those assertions and was then approved. No active worker
was stopped or repurposed.

## Cleanup and evidence

All owned PostgreSQL containers and their anonymous volumes, Docker worker and
named data volume, Apple machines/volumes, and Lima machines/data disks were
removed. Exact owned prefixes, volume names and hashed Lima disk names were
checked against inventories. Private password files were deleted. Downloaded
artifacts (646,755,112 bytes) were removed after verification; manifests, timing,
checksum and failure receipts remain. Existing machines and shared caches were
preserved. The LayerFS source worktree remains clean at the published commit.

[Raw receipts and diagnostic scripts](evidence/machine-start-2026-11-10/first-use/)
include `downloads.json`, `lima-first-use.json`, `postgres-docker.json`,
`postgres-apple-bridge.json`, `postgres-lima.json`, the original Apple failure,
`binary.json`, and `cleanup-verification.json`.

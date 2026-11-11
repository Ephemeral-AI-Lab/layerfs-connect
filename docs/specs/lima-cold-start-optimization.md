# Lima cold-start optimization experiment

Status: exploratory prototype, 2026-11-09. A real LayerFS flow passed on the
optimized machine. No application or LayerFS production code was changed, and
Connect does not select this image yet. No warm pool or saved VM memory was used.

## Observed result

The matched pair used the same pinned host CLI and Linux bundle. Each command
created a new VM with 2 CPUs, 4 GiB memory and a fresh 20 GiB ext4 data disk.
Timing starts before CLI process launch and ends at CLI exit, after Lima's normal
readiness checks, data-disk attachment and LayerFS worker startup/readiness.

```text
                                     Before       After
Instance creation                      2.23 s      0.31 s
Lima start through full readiness      13.50 s      6.65 s
Other checks and LayerFS setup         12.77 s      1.52 s
-------------------------------------------------------
Total machine.create                  28.50 s      8.47 s
```

Observed reduction: 70.3%, or 3.36 times faster in this diagnostic pair. The
optimized guest reported 1.574 seconds in the kernel and 2.138 seconds in userspace
(3.713 seconds total). Guest boot time is a subset of machine creation.

These are single diagnostic observations on this Mac, with locally cached OS
images/bundles and uncontrolled ordinary host filesystem caches. They establish
powered-off guest creation, not cold host-storage performance, a latency
distribution, a cross-machine guarantee or release admission. One-time image
preparation/download, verification and cleanup are outside the create timer.
The stopped root disk is copied by Lima on local APFS; its cheap copying behavior
must not be generalized to another host filesystem without measurement.

## Changes evaluated

1. Prepare an Ubuntu 24.04 VZ root disk with the sealed LayerFS Linux bundle
   already installed at `/layerfs/bundle`, including its sandbox image archive.
   This removes the per-machine SSH transfer. Bundle identity is preserved;
   the stock LayerFS install path checks the existing `.sealed` marker.
2. Disable unused Snap, ModemManager, apport and udisks2 services in the prepared
   image. AppArmor and the LayerFS namespace restriction remain active. A reduced
   cloud-init configuration was an intermediate experiment.
3. Replace the general cloud-init startup path on this specialized image with
   two small systemd services. One mounts the instance's fresh cidata, applies its
   hostname/user/authorized keys and creates new SSH host keys. The second runs
   Lima's unchanged `boot.sh`, retaining its data-disk, guest-agent and readiness
   behavior. Network configuration uses the instance's own DHCP MAC rather than
   retaining the seed VM's MAC.
4. Clean the machine identity, SSH host keys, guest authorized keys and
   `/layerfs/state` before shutting down the image source. Every created VM has
   a private root-disk copy and a newly created data disk. LayerFS generates its
   worker secret through its normal startup path.

The prototype intercepts only the `limactl create` template inside a diagnostic
PATH wrapper, replacing `images` with the local prepared disk. Actual creation,
startup, worker launch and all functional calls use the pinned, unmodified
LayerFS CLI. This wrapper is not installed into Connect or offered as a product
integration.

## Functional verification

With the source-matched bundle, the optimized VM passed:

- `machine.status`, reporting running and available data-disk space;
- a Disposable SQLite Store, project Init and Store push to the VM;
- Branch fork and real namespaces/FUSE Sandbox creation;
- Workspace mount, reading the imported file and writing a new file through exec;
- explicit Workspace Commit and Store-side read of `/result.txt`, yielding
  `verified\n`;
- unmount, Sandbox close, Store removal and removal of all six owned test VMs
  and their private data disks.

The first Sandbox took another 7.31 seconds, measured separately. This experiment
does not optimize that operation. The archive was already installed at machine
creation; no new lazy transfer was introduced. The matched stock and optimized
VMs had different machine IDs and SSH host keys. Both optimized systemd services
reported success, and the data volume was ext4 on its separate device.

No GUI flow was changed or exercised. No production Rust build was needed.

## Failures and intermediate observations

Earlier diagnostics used the default cached bundle, which carried worker protocol
2 while the pinned CLI expected protocol 3. Machine creation succeeded, but a
Store push was correctly refused before sending a request. The incompatible
8.08-second result is not the final functional result. A matching sealed bundle
from the pinned source was then located and used in both final arms.

The earlier default-bundle observations were 33.00 seconds stock, 11.64 seconds
with preinstallation, 10.85 seconds with trimmed cloud-init, and 8.08 seconds
with specialized startup. They are exploratory history, not additional samples
of the final matched pair. An initial verification used a relative file path and
was refused `InvalidInput`; the corrected absolute path passed. All invocation
receipts retain these outcomes.

## Product integration still required

The pinned public `machine.create` CLI declares only CPU, memory, disk and Sandbox
image options; it cannot select this prepared guest OS image. `image` is the
Sandbox image, not the VM OS image. Connect should not implement a provider
wrapper to bypass that API.

The upstream implementation should own a versioned prepared-image builder and
an explicit image-selection path in LayerFS's Lima provider, with bundle identity
checks and fresh per-instance initialization. Connect can then consume the
declared API. The experimental disk is host-specific and is not a distributable
base image. Release binaries and a smaller Sandbox image were not evaluated;
they are not credited for the observed improvement.

## Evidence and retained artifact

The [evidence folder](../evidence/lima-cold-start-2026-11-09/) contains the matched
bundle manifest, environment declaration, all create timings, verification and
cleanup receipts, readiness events and the exact specialized image payload.
Repository receipts normalize host paths; original receipts and the stopped
prepared disk remain in the task's local artifact directory. The original
LayerFS checkouts, shared bundle cache and existing application configuration
were not modified.

The artifact directory is `~/.cache/layerfs-connect/lima-cold-start/2026-11-09-1223`.
It contains `prepared.raw`, the exact diagnostic scripts and raw logs. The image
is a sparse 100 GiB logical disk with approximately 4.9 GiB allocated; intermediate
images were removed. It is not a running VM and consumes no reserved guest RAM.

To reproduce the final diagnostic with the retained artifact and the recorded
matching CLI/bundle, set `LAYERFS_BUNDLE` to that bundle, then run
`python3 <artifact>/run.py stock <unique-name>` for the stock arm or
`python3 <artifact>/run.py prepared <unique-name>` for the prepared arm. Each call
appends its receipt and creates a real VM in the artifact's private home. Remove
the named VM with the same CLI and `LAYERFS_HOME=<artifact>/home` afterward.
Do not infer release qualification from rerunning this diagnostic.

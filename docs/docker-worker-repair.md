# Connect Docker worker repair — 2026-11-09

The pinned host CLI was built from `833d04cf44e8e747929d50ab1170a48260d9381c`
(protocol 3), while the default Linux bundle was sealed from
`d046e7e2c136ead10e3a8b46dc082c5c37f9c7ea` (protocol 2). Start created a
running container, then refused its incompatible worker.

Rebuilt daemon, worker and helper through the pinned checkout's registered
private resources using `tools/linux_bundle.py`; sealed into Connect's ignored
`.cache/layerfs-bundles/833d04cf44e8e747929d50ab1170a48260d9381c/2.0.0/linux-aarch64`.
Bundle hash: `29b69e47719660bcdab3d6761e5e63f3833490b37c83867db089f6a7200d0d7d`.
The original shared bundle is preserved for unrelated workers.

The web preview loads machine-local settings from ignored `desktop/.env.local`.
It retains the existing `LFS_STATE`, CLI and daemon paths and sets
`LAYERFS_BUNDLE` to the matching private bundle. Only that preview home's
idle `docker` worker was stopped and replaced. Its Docker data volume was
preserved. No unrelated worker or other container was restarted.

Validation:

- Worker version receipt: clean source commit `833d04cf44e8e747929d50ab1170a48260d9381c`.
- Machine inspect: running; no down reason; guest free space ~193 GB.
- Real Disposable SQLite Store create, Project Init, push to Docker, Branch fork,
  Sandbox create, Workspace mount, exec `cat proof.txt`: `MATCHING_BUNDLE_OK`.
- Workspace unmount, Sandbox close and test Store removal all succeeded.
- Desktop typecheck/build and three preview-host lifecycle tests passed.
- Cold replacement Start: 30,119 ms in CLI, 1 ms queued. Its source image archive
  is 2,747,719,680 bytes. No per-phase timing was collected.
- Already-running Start: 114 ms through the preview API; worker not replaced.

The private bundle is an active runtime dependency and must remain pinned.
These verification operations created no durable application data.

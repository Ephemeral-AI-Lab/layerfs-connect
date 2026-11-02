# Storage (LayerFS 2.0)

> **Status:** Current, 2026-11-02. Source: `src/renderer/src/components/storage/storage-page.tsx`,
> `storage-dialogs.tsx`, `host/storage.js`. Spec: [the 2.0 integration spec](../layerfs-2.0-integration.md)
> step 5.

One page, read from `GET /api/storage` again on the host's `storage` events.

- **Stores by machine.** One card per machine that holds sqlite Stores (native first, then docker,
  then VMs). Each Store row shows its projects (each opens the project), its size (file plus WAL,
  from `store.status`), its state (idle, in use, moving, down) and one backup chip per bucket it is
  linked to (the state from that bucket's last listing). Its menu: **Move to…** (idle only; the
  whole Store moves, every project in it), **Back up to…** (a bucket, an optional file name),
  **Add project** (native only: Init goes nowhere else) and **Remove…** (type the name).
- **PostgreSQL Stores.** Connected databases; they never move. **Connect…** takes a name, a URL
  without a password and a password *reference*; **Disconnect…** forgets the Store in this home.
- **Buckets and backups.** **Connect…** takes a name, a URL (MinIO `http(s)://host/bucket/prefix`,
  R2 `r2://account/bucket/prefix`) and a key *reference*. Each bucket card has **List files**
  (`backup.list(bucket)`, one call per bucket, which contacts it) and a table of files with their
  state: current, store changed, bucket changed, both changed, unknown, not linked, missing.
  **Restore…** installs a copy as a new Store on native. **Disconnect…** warns that every Store's
  link to the bucket goes too.
- **Jobs.** The moves, backups and restores this host started, with their phase and done/total
  where the call gives it. A failure names its phase; an `Unknown` one says both copies were kept.

Secrets are never typed: a reference is `file:/absolute/path` (owner-only; for a bucket, lines
`access_key=…` and `secret_key=…`) or `env:LAYERFS_<NAME>`. A URL with a password is refused.

Hidden behind one line (§9): Store totals (dedupe, compression, what Init stored).

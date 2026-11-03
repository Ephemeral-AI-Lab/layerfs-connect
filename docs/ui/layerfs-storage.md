# Storage (LayerFS 2.0)

> **Status:** Current, 2026-11-04 (#537 §5). Source: `src/renderer/src/components/storage/storage-page.tsx`,
> `storage-dialogs.tsx`, `needs-attention.tsx`, `new-dialog.tsx`, `host/storage.js`. Words for states and
> actions follow #537 §4.

One page, read from `GET /api/storage` again on the host's `storage` events. Its header has **New**
(an empty sqlite Store on native, or a Store restored from a bucket file), **Connect…** (a PostgreSQL
Store, or a bucket for backups) and **Refresh**. Opening a Store's link from another page (a project's
Store badge, a Compute Store row) scrolls to its row and marks it.

```text
Storage                                          [New] [Connect… v] [Refresh]
OPERATIONS                                       (while any operation or job is live)
  (Push) app -> dev-lima   send   640 MB / 1.2 GB  [=========-----]
  (Unresolved) big   store.pull · record           see layerfs store status big · clear: layerfs store pull big
native  native                                   2 Stores
  docs  (Idle)  r2: Backed up    shop, web · 340 MB                           [...]
dev-lima  lima  (Stopped)                        1 Store   [Start]
  app   (Down)                   api · 1.2 GB · dev-lima is stopped           [...]
PostgreSQL Stores                    Connected databases: never pushed or pulled
  pg    (In use)                 crm, billing · in its database             [...]
BUCKETS AND BACKUPS
  r2-main  listed 10 min ago              [List files] [Disconnect…]
NEEDS ATTENTION (layerfs doctor)  2 findings (1 refusing calls) · checked 1 min ago   [Show]
```

## Regions

- **Operations** (only while something is live or recent). Two kinds of row:
  - an *operation* LayerFS records on a Store this host is not running a job on (a push started from
    the CLI, say): the Store's state chip, its name, the operation's name and phase, and when it started.
    An unresolved one adds "see `layerfs store status <store>` · clear: `<the clearing call>`";
  - a *job* this host started (Push, Pull, Move, Backup, Restore, the newest 8): the Store and its
    target, the phase, and bytes done of total with a bar while it sends. A push or pull goes through
    `check`, `snapshot`, `send`, `verify`, `install`, `record`, `retire`. A Move job says which half it
    is in ("1 of 2: pull to native", "2 of 2: push to <machine>"). A failure shows LayerFS's refusal
    (below) and the phase it stopped in. When a Move's push half fails, the row says the pull finished
    and the Store is on native now, with **Push to <machine> again**.
- **sqlite Stores, by machine.** One card per machine that holds sqlite Stores: native first, then
  docker, then the rest by name. The heading's machine name opens its row on Compute; a machine other
  than native shows its state chip. A stopped machine has **Start** (`machine.start`): nothing starts a
  machine because a page looked at it.
  Each Store row shows its name, its state chip (an operation in flight replaces the word with its name
  and phase), one backup chip per bucket it is linked to, its projects (each opens the project), its
  size (file plus WAL; hover for each), and why it is down. An unresolved Store shows its status and
  clearing calls. Its menu:
  - on native: **Push to…** (idle only);
  - on a machine: **Pull to native** (starts at once) and **Move to another machine…** (both disabled
    while busy);
  - **Back up to…** (a bucket and an optional file name; not while down or busy);
  - **Add project** (any Store, on any machine; not while down or busy) opens New project on it;
  - **Remove…** (type the name; the Store and every project in it go, backups stay).
- **Push to… and Move to another machine…** (one sheet). The machine list holds every machine but
  native and the Store's own whose `supports.sqlite` is true, each with its platform and state. A
  chosen machine shows its free disk against the Store's size ("38 GiB free on dev-lima; the Store is
  1.2 GB"), or says its free disk is not known until it runs. A machine that is not running says
  "nothing starts it for you"; a stopped one offers **Start <machine>**. "Held now: the push is refused
  while these remain" lists open processes and the Sandboxes of the Store's projects. Push says the
  whole Store goes, every project in it. Move says it is a pull to native, then a push: two operations,
  and if the push fails the Store stays on native.
- **PostgreSQL Stores.** Connected databases, never pushed or pulled. A project's Sandboxes
  run on any machine that supports PostgreSQL Sandboxes. Menu: **Add project**, **Disconnect…**
  (this home forgets the Store; the database stays).
- **Buckets and backups.** Point-in-time copies, separate from where a Store lives. Each bucket card
  has **List files** (`backup.list(bucket)`, which contacts it), **Disconnect…** (every Store's link to
  it goes too) and a table of files: file, Store, state (Backed up, Store changed, Bucket changed,
  Both changed, Unknown, Not linked, Missing), size, when written, and **Restore…**, which always
  installs a new Store on native.
- **Needs attention (layerfs doctor).** `GET /api/doctor` runs `layerfs.doctor()`, which reads
  records, leases and workers, starts no machine and changes nothing. Read when the page loads or is
  refreshed. It shows "Nothing found" or a count with **Show**: each finding has its severity (error
  or warning), its entity, LayerFS's message and "fix: <call>". Connect runs no fix for you.

## Refusals

A refused action shows LayerFS's own words (`components/refusal.tsx`): the code, the message (which
names any status or clearing call), where it stopped (entity, phase, operation) and **In the way:**,
each `detail.related` item by kind and name. Sheet refusals show under the form; menu actions that
start at once (Pull, Start) show a dismissable "Refused" notice at the top. Connect's own guard, one
job per Store on this host, is `ConnectBusy`, not LayerFS's `Busy`.

## States

- **Loading:** "Reading the Stores"; a failed read shows `LoadError` with Retry.
- **No Stores:** "Create a Store on native, add projects, push it to any machine."
- **No bucket:** "No bucket connected. Connect an r2 or MinIO bucket to back Stores up."

Secrets are never typed: a reference is `file:/absolute/path` (owner-only; for a bucket, lines
`access_key=…` and `secret_key=…`) or `env:LAYERFS_<NAME>`. A URL with a password is refused.

Hidden behind one line: Store totals (dedupe, compression, what Init stored).

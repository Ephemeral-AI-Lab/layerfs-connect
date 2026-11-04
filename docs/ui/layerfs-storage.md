# Storage (LayerFS 2.0)

> **Status:** Current, 2026-11-05 (#537 §5). Source: `src/renderer/src/components/storage/storage-page.tsx`,
> `store-card.tsx`, `bucket-card.tsx`, `operations.tsx`, `needs-attention.tsx`, `storage-dialogs.tsx`,
> `new-dialog.tsx`, `host/storage.js`. Words for states and actions follow #537 §4.

Storage is the one home of Stores and their backups. The data tree is Store → project → Branch: a
project lives inside a Store (key `store/name`). Every Store-wide action lives here, and only here:
**Push**, **Pull**, **Move**, **Back up**, **Add project**, **Remove**, **Disconnect**. Machines show
only as a location chip (it opens the machine on Machines, `go.machine`); projects show as rows that
open the project.

One page, read from `GET /api/storage` on a 5 s poll and again on the host's `storage` events and
projects changes; jobs move on `storage-job` events. Its header has two tabs, **Stores | Backups**,
each with its own actions, and Refresh:

- **Stores:** **+ New Store**, the one way to add a Store ([New Store](#new-store)).
- **Backups:** **Back up a Store…** (a menu of the sqlite Stores, each with where it is; disabled with
  no bucket or no sqlite Store) and **+ New bucket** ([New bucket](#new-bucket)).

Buckets are connected and managed only on Backups; New Store never connects or disconnects one.

**Where a sqlite Store is.** LayerFS 2.0 keeps one `machine` in each sqlite Store's record. `native`
means the Store is saved under the LayerFS home (`<home>/store/<name>/store.sqlite`); any other
machine means it was pushed there (`/layerfs/data/store/<name>/store.sqlite` on that machine) and is
no longer in the home. A Store is in exactly one place: a push or pull switches the record at its
`record` phase and then retires the source's copy. The UI says **LayerFS Home** (or **Home** in
routes) for `native` and the machine's name otherwise. **Its backup locations** are the record's
`backups` links, one per bucket (`bucket/file` and the last write), read without contacting a
bucket. A PostgreSQL Store has neither: it is on no machine and has no backups. Its row carries
`postgresql: { target, reachable, version, latencyMs, error }`: the record's URL as
`user@host:port/db` (`host/storage.js` drops any password and parameters) and what `store.status`'s
`server` answered.

Two levels, like Machines: the **board** (the tabs below) and a **Store's page** (its projects,
backups and facts; see [A Store's page](#a-stores-page)). A Store's card opens its page; so does
every Store link elsewhere (`go.store`: a project's Store chip or badge, a backup file's Store, a
machine's Store chip), with the tab's `focus` set to `store:<name>`.

```text
Storage   [ Stores 7 | Backups 2 ]  (● 1 running · 1 failed)                       [+ New Store] [↻]
                                                  819 MB in 5 sqlite Stores   Doctor: 2 findings ›
┌────────────────────────────────┐ ┌────────────────────────────────┐ ┌──────────────────────────────┐
│ ⛁ scratch                  [⋯] │ │ ⛁ old  (red ring)          [⋯] │ │ ⛁ pg                     [⋯] │
│   (Idle) 200 KB                │ │   (Down) size unknown          │ │   (Idle)                     │
│ Location ⌂ LayerFS Home store/…│ │ Location ▤ lima-dev lima (Stopped)│ Location 🐘 app@db:5432/layerfs│
│ Backup   ⊟ minio/scratch.lfs   │ │ Backup   ⊟ No backup location  │ │ Server   (Connected) 16.4 · 3 ms│
│          (Store changed) 2 h   │ │ ▢ archive                      │ │ ▢ api           runs on native│
│ No projects yet  [Add project] │ │────────────────────────────────│ │──────────────────────────────│
│────────────────────────────────│ │ lima-dev is stopped            │ │ [      Add project       ]   │
│ [Push to…]   [Sync backup]     │ │ [      Start lima-dev      ]   │ └──────────────────────────────┘
└────────────────────────────────┘ └────────────────────────────────┘
 ⏱ Store totals (dedupe, compression, what Init stored) comes with a later LayerFS.
```

## Above both tabs

- No operations tray: a Store's job shows on its own card and page ([Job progress](#job-progress)).
  Beside the tabs, a chip counts the jobs running ("● 1 running", with "· N failed") or, with none
  running, the failed ones not dismissed ("✕ 1 failed"); clicking it shows the first such card
  (scrolls to it and rings it). The sidebar's Storage item has a dot: live blue while a job runs,
  red while a failure is not dismissed.
- **Refused:** a menu action that starts at once (Pull, Start) shows its refusal in a dismissable
  notice.
- **Summary row:** on Stores, the total of known sqlite sizes. On both tabs, the
  **Doctor** badge: `GET /api/doctor` runs `layerfs.doctor()`, which reads records, leases and
  workers, starts no machine and changes nothing; it is read when the page opens and on Refresh,
  never on the poll. The badge says checking, nothing found, or "Doctor: N findings"; clicked, it
  opens the findings (severity, entity, LayerFS's message, "fix: <call>"). Connect runs no fix.

## Stores tab

Every Store's card in one grid of glass cards at least 17.5 rem wide (one column in a narrow
window), with no headings, groups or filter: the card's Location says where it is. They are ordered
the sqlite Stores on `native` first, then those on machines (by machine), then PostgreSQL, by name
within each. The summary row gives the known size of the sqlite Stores.

A push in flight leaves the Store under Home (its record names `native` until the `record` phase),
with its card's footer showing the job; its Location changes when the view reads the new record. A
Store that needs you gets a tinted ring: red when it is down or unresolved, its job failed,
its PostgreSQL server is not reachable, or a backup is Both changed or Missing; amber when a backup is
Store or Bucket changed or its machine is stopped.

- **Head:** the family mark, the name and the menu; under the name the Store's state chip (an
  operation in flight replaces the word with its name and phase) and, for sqlite, its size (file
  plus WAL; hover for each). The name stretches over the card: a click anywhere on it opens the
  Store's page; the menu, the machine, the projects and the footer's controls sit above it and do
  their own thing.
- **Location:** ⌂ **LayerFS Home** with `store/<name>` (hover: "Saved under the LayerFS home
  (store/<name>/store.sqlite)…"); or the machine (opens it on Machines), its platform and its state
  chip; or a PostgreSQL Store's database, `user@host:port/db` from its record's URL (never the
  password or parameters; "PostgreSQL · its database" when the record has none).
- **Backup** (sqlite): one entry per bucket link from the record: `bucket/file`, then the state of
  the bucket's last listing (Backed up, Store changed, Bucket changed, Both changed, Unknown, Missing)
  or "not listed" before one, and when it was last written. With no link: "No backup location". A
  Store on a machine lists as Unknown until LayerFS reads its heads through its worker (#533 P1-14).
- **Server** (PostgreSQL): what `store.status`'s `server` said: **Connected** with the server version
  and latency, **Not reachable** with the reason, or Unknown ("usable from every machine").
- **Projects:** up to three, then "N more" (which unfolds the rest): each opens the project (the
  row's one target), with "runs on <machines>" in quiet words on the right when it has Sandboxes
  (from `GET /api/machines`, the Sandboxes whose project is this key; hover says "2 Sandboxes on
  native"). The words are left out when the machines cannot be read; the page never waits on that
  read, which runs on open, Refresh and changes, not on the poll. An empty Store says "No projects
  yet" with **Add project**.
- **Footer:** why it is down or an unresolved Store's status and clearing call, then its main moves
  as buttons, at most two:
  - where it goes: **Push to…** in the home (idle only), **Pull to home** on a running machine (not
    while busy), or **Start <machine>** when its machine is stopped (nothing starts it for you);
  - its backup (not while down or its machine is stopped; not while busy): **Sync backup** when a
    link's listing says Store changed (backs up again to that `bucket/file` at once), **Restore…**
    when it says Bucket changed (opens Restore on that file: a new Store in the home), **Back up
    now** to its first link otherwise, or **Back up…** (the sheet) with no link or when Both changed;
  - PostgreSQL: **Add project**.

  While the Store has a job to show (running, ended well in the last minute, or failed and not
  dismissed), the footer is that job ([Job progress](#job-progress)). While another client (the
  CLI, another window) runs an operation on it, the footer says so: "Being pushed by another client"
  with its step, a sweeping bar (no bytes: they are not reported) and when it started.
- **Menu:**
  - sqlite in the home: **Push to…** (idle only);
  - sqlite on a machine: **Pull to home** (starts at once) and **Move to another machine…** (both
    disabled while busy);
  - Push, Pull and Move each say under the item that the whole Store moves ("Moves data, web");
  - **Back up to…** (a bucket and an optional file name; not while down or busy);
  - **Add project** (any Store, on any machine; not while down or busy) opens New project on it;
  - **Remove…** (type the name; the Store and every project in it go, backups stay);
  - PostgreSQL: **Add project**, **Disconnect…** (this home forgets the Store; the database stays).
- **Push to… and Move to another machine…** (one sheet). The machine list holds every machine but
  native and the Store's own whose `supports.sqlite` is true, each with its platform and state. A
  chosen machine shows its free disk against the Store's size, or says its free disk is not known
  until it runs. A machine that is not running says "nothing starts it for you"; a stopped one offers
  **Start <machine>**. "Held now: the push is refused while these remain" lists open processes and
  the Sandboxes of the Store's projects. Push says the whole Store goes, every project in it. Move
  says it is a pull to the home, then a push: two operations, and if the push fails the Store stays in
  the home. With no other machine: "No other machine holds sqlite Stores. Add one on Machines."

## New Store

`storage/new-dialog.tsx` (`NewDialog`), opened by **+ New Store** (the header and the empty state).
The same wide sheet as [New bucket](#new-bucket) (`FormSheet`, `TileChoice`): the title **New
Store** with the chosen form's line under it, the family as two tiles at the top (**SQLite** |
**PostgreSQL**, each with its mark), then the form in titled sections. Under SQLite a segmented
switch picks **Empty Store** or **Restore from a backup**. "Still needed: …" until complete, then
Cancel and the action; a refusal shows under the form.

```text
┌ (⤓) New Store ───────────────────────────────────────────────────────── ✕ ┐
│ A new SQLite Store saved under the home from a bucket file, …              │
│ [ ▣ SQLite ]                          [ 🐘 PostgreSQL ]                    │
│ [ + Empty Store | ⤓ Restore from a backup ]                                │
│ SOURCE                                                                     │
│ Bucket [ minio · MinIO ▾ ] [↻ List files]                       ● listed   │
│ ┌ ● scratch.lfs                                 from scratch     100 KB ┐  │
│ └ ○ shop.lfs                                    from shop        408 MB ┘  │
│ STORE                                                                      │
│ New Store's name [ scratch-restored                                    ]   │
│                                           [Cancel] [⤓ Restore Store]       │
└────────────────────────────────────────────────────────────────────────────┘
```

- **SQLite → Empty Store:** Store: a name; **Create Store** (`store.create` on native).
- **SQLite → Restore from a backup:** Source: a bucket (its name and provider), **List files**
  (`backup.list`) and its listing state (listed, refused with LayerFS's code and message, not listed
  yet), its files as a radio list (file, the Stores linked to it, size). Store: the new Store's
  name; choosing a file fills it with the file's name, or `<name>-restored` when a Store has that
  name. **Restore Store** (`backup.restore` to the home). With no bucket: "No bucket connected yet…"
  and **New bucket…**, which closes this sheet and opens New bucket on the Backups tab.
- **PostgreSQL:** Store: Name with `synchronous_commit` beside it. Database: the URL without the
  password and the password reference, side by side. **Connect** (`store.connect`).

## New bucket

`BucketSheet` in `storage-dialogs.tsx`, opened by **+ New bucket** (the Backups header and empty
state, and New Store's restore pane with no bucket). One wide sheet (680 px), not a single column:
the providers LayerFS backs up to (MinIO, Cloudflare R2) as a two-tile choice, then two sections.
**Where:** Name, Bucket and Prefix on one row; the provider's own fields on the next (MinIO's
Endpoint; R2's Account ID with Jurisdiction beside it), then its notes (the R2 host, where each
backup goes). **Keys:** Access key and Secret key side by side, then how the keys are kept. Values
typed in a field both share are kept when switching. "Still needed: …" until complete; **Connect
bucket** (`backup.connect`; the keys go to an owner-only file, passed by reference).

```text
┌ (⏚) New bucket ──────────────────────────────────────────────────────── ✕ ┐
│ [ MinIO ]                         [ Cloudflare R2 ]                        │
│ WHERE                                                                      │
│ Name [ backups    ]   Bucket [ your bucket’s name ]   Prefix [ layerfs ]   │
│ Endpoint [ http://localhost:9000                                       ]   │
│ Each Store backup is layerfs/<file>/store.sqlite.                          │
│ KEYS                                                                       │
│ Access key [                     ]   Secret key [                      ]   │
│ Connect keeps the keys in a file only you can read …                       │
│                                          [Cancel] [⏚ Connect bucket]       │
└────────────────────────────────────────────────────────────────────────────┘
```

## A Store's page

`storage/store-page.tsx` (`StorePage`), shown by `StoragePage` in place of the board, so its
actions are the board's and their sheets and confirmations open over it.

```text
< Storage / shop                      (Back only when opened from another page)
[⛁] shop  SQLite Store  (In use)                                      [Push to…] [⋯]
    file in ⌂ Home · 408 MB · created yesterday
[ lima-dev is stopped                                          [Start lima-dev] ]   (when it needs you)
┌ Pushing to ui535-ac  for 45 s                          40 MB/s · under a minute ┐ (its job)
│ ✓ check                                                                       │
│ ✓ snapshot                                                                    │
│ ◌ send       [==========================------]                395 MB / 408 MB │
│ ○ verify   ○ install   ○ record   ○ retire  (one per line)                    │
└───────────────────────────────────────────────────────────────────────────────┘

Projects 2   A push, pull or move carries them all                      [Add project]
┌ PROJECT    RUNS ON              CHATS              LAST ACTIVITY          ┐
│ data       [native ×2]          1                  3 hours ago          > │
│ web        not running          2 · ● 1 working    1 minute ago         > │
└───────────────────────────────────────────────────────────────────────────┘
Activity  this session
│ ◌ Push   Home → ui535-ac   408 MB  running · 45 s          07:00 │
│ ✕ Push   Home → ui535-ac   408 MB  failed in verify        06:41 › │
Backups                                                                [Back up to…]
│ ▤ minio  shop.lfs                           408 MB  2 hours ago  (Backed up) │
Details
│ FAMILY  FILE ON  FILE  WAL  CREATED  OPEN NOW                                │
│ Danger zone  [Remove shop…]  The Store and every project in it go; …        │
```

- **Header:** the crumbs `Storage / <name>` (`tabs/crumbs.tsx`; Storage returns to the board,
  rewinding when the board is where the tab came from), after a Back chevron when the page was
  opened from another page (a project, a machine; it names it and returns there); the family mark,
  the name, "SQLite Store" or "PostgreSQL Store" and the state chip; under it "file on" the machine
  (opens it on Machines: where the file is, not where its projects run) and the size, or the
  PostgreSQL database (`user@host:port/db`, else "PostgreSQL · its database"), and when it was created. On the right
  the main move, **Push to…** in the home (idle only) or **Pull to home** on a machine (not
  while busy), and the same menu as the card. PostgreSQL has only the menu.
- **Needs you:** why it is down, an unresolved Store's status and clearing call, or a stopped
  machine with **Start <machine>** (nothing starts it for you). Its job (the card's, see
  [Job progress](#job-progress)) as a panel: what it does and for how long, its speed and time
  left, then each step on a line with ✓ done, a spinner on the current one (the byte step with its
  bar and bytes), ✕ where it failed, ○ to come, and how long each took as this window saw it (a move
  shows its two halves). A failure adds LayerFS's refusal, **Try again** and **Dismiss**. Another
  client's operation shows as the card's does.
- **Activity** (after Projects; only once this window knows a job on the Store): this session's
  jobs on it, newest first: a mark (running, ✕, ✓), the kind, the route ("Home → ui535-ac",
  "→ r2/shop.lfs"), the size, "running · 45 s", "failed in verify" or "took 2 min 40 s", and the
  time it started; a failure opens to its refusal.
- **Projects:** a table, one row per project, that opens the project (Back says the Store's name):
  Runs on (`RunsOnChips`: a chip per machine its Sandboxes are on, each opening the machine, "×N"
  for several there; "not running"; "—" when the machines were not read), chats that are not
  archived with "N working", and last activity (the newest chat, else when the project was made). **Add project** opens New project on this Store. "A push, pull
  or move carries them all" when a sqlite Store holds more than one.
- **Backups** (sqlite only): one row per bucket link: the bucket, the file, its size and when it
  was written (from the bucket's last listing, else the link's last backup) and its state chip, or
  "not listed yet". **Back up to…** (not while down or busy). With no link: "Not backed up."
- **Details:** family, machine, file and WAL sizes, created, and what has it open now. The danger
  zone: **Remove <store>…** (typed name; backups stay) or, for PostgreSQL, **Disconnect <store>…**.
- **Missing:** "No Store named <name>" with "It was removed or disconnected, or this home never
  had it." Removing the Store from its page leaves this state until Back.

Storage in the sidebar while a Store's page shows returns to the board.

## Job progress

`storage/job-progress.tsx`, modelled in `data/job-progress.ts` (pure; `test/job-progress.test.mjs`),
fed by `host/storage-jobs.ts`: the `storage-job` events and each Storage read's `jobs`, the byte
samples each job sent and the jobs dismissed (kept in local storage).

- **Steps**, as LayerFS reports them (`on_progress` phases): push and pull, and each half of a move,
  `check, snapshot, send, verify, install, record, retire`; a backup `snapshot, send, upload` (send
  only from a machine's worker: from the home it goes from snapshot to upload); a restore
  `download, install`. Only a push's or pull's `send` reports bytes. LayerFS has no cancel call, so
  there is no Cancel.
- **The bar**: one segment per step, the byte steps (send, upload, download) eight times as wide.
  Done segments are filled; the current one fills by bytes when its step gives them, else a light
  sweeps across it; a failed one is red; the rest are empty. A move shows its pull and its push side
  by side, the finished half full. There is no made-up overall percentage.
- **Running** (the card): "Pushing to docker" (Pulling from, Moving to, Backing up to, Restoring
  from) with the step in words ("sending", "verifying", "cleaning up" for retire) or a move's "2 of
  2" and its halves ("Pull to Home ✓ ▸ Push to lima-dev"); the bar; then bytes ("1.6 GB / 3.9 GB")
  or "step 4 of 7", and the speed with the time left ("40 MB/s · under a minute"). The speed is
  this window's: the bytes over the last 10 s of samples, shown once two samples are 2 s apart.
- **Ended well**: "✓ Pushed to docker · just now" with its size and "took 1 min 32 s", for a
  minute; then the card's own footer comes back.
- **Failed**, until dismissed (×) or another job starts: "✕ Push to docker failed in verify", the
  refusal's code and message (two lines; all of it on the Store's page), **Try again** (the same
  call; a move whose push half failed says "✓ Pulled to Home" above it and offers **Push to
  <machine> again**) and **Details** (the Store's page). The card gets a red ring.
- **Machines**: a Store tile on a machine's page shows a thin bar and "pulling…" (pushing…, backing
  up…) while a job moves it off (or onto) that machine.

## Backups tab

Point-in-time copies, separate from where a Store lives. One card per bucket: its name, provider and
when it was last listed, **List files** (`backup.list(bucket)`, which contacts it), **Disconnect…**
(every Store's link to it goes too) and a table of files: file, Store (opens its page), state, size,
when written, and **Restore…**. "A restore always saves the Store in the home; push it to a machine
afterwards." With no bucket: "No bucket connected" and **New bucket**. A backup of a Store on a
machine passes through this host and is staged in the home (`store/<name>/backup.staging`), so it
needs free disk the Store's size in the home as well as on the machine.

## Refusals

A refused action shows LayerFS's own words (`components/refusal.tsx`): the code, the message (which
names any status or clearing call), where it stopped (entity, phase, operation) and **In the way:**,
each `detail.related` item by kind and name. Sheet refusals show under the form. Connect's own
guard, one job per Store on this host, is `ConnectBusy`, not LayerFS's `Busy`.

## States

- **Loading:** "Reading the Stores"; a failed read shows `LoadError` with Retry.
- **No Stores:** "Create a Store in the home, restore one from a backup, or connect a PostgreSQL
  database." with **New Store**.
- **No bucket:** "No bucket connected. Connect an r2 or MinIO bucket to back Stores up."

Secrets are never typed: a reference is `file:/absolute/path` (owner-only; for a bucket, lines
`access_key=…` and `secret_key=…`) or `env:LAYERFS_<NAME>`. A URL with a password is refused.

In dev builds the header's flask picker (`components/simulation.tsx`, shared with Machines and
Projects) draws a simulated host instead: `data/home-sim.ts` derives its Stores, projects, a
PostgreSQL Store, a bucket and a push in flight from the Machines case (`data/compute-sim.ts`).
The page shows no "Simulated" note (the header's picker says it); every action is refused there
with "This is sample data: nothing is sent to the host."; doctor is not shown. A sample project's
row still opens it, on sample content (`data/project-sim.ts`).

# LayerFS: Storage

Every Store in one board: SQLite Stores, each linked to at most one file in a MinIO or R2 bucket or local only, PostgreSQL Stores under their connections, and every connection in one grid. Opening a Store, a bucket, a connection or the machine shows its page.
Opens from: Storage in the sidebar's RESOURCES group, or a `#storage…` hash.
Source: `src/renderer/src/components/storage/storage-page.tsx` (main file; others named in Regions). Design: [storage-links.md](storage-links.md) (links; layerfs#509), [storage-redesign.md](storage-redesign.md) (bands, progress, size, identity, states). Visual language: [frontend-polish-prompt.md](../frontend-polish-prompt.md) (Macaron liquid glass: `glass-liquid` `rounded-2xl` cards, `rounded-xl` controls, the single-hue `--cursor-hue` spotlight, restrained motion).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| Storage                                           [ + Add connection v ] [ + New Store v ]   |
| Where projects' history lives: SQLite Stores on this machine, ...                            |
+----------------------------------------------------------------------------------------------+
+-[2] SummaryStrip (glass card) ---------------------------------------------------------------+
| STORES          | SIZE              | LINKED                     | TRANSFERS                 |
| 4               | 3.1 GB            | 2 of 3 SQLite              | 1 running                 |
| 3 SQLite · 1 PG | 2.6 GB here · ... | 1 in sync · 1 newer        | work · Uploading 41%      |
+----------------------------------------------------------------------------------------------+
+-[3] TransferTray (while a job runs or just ended) -------------------------------------------+
| ↑ work -> minio-lab / work   Upload  [==========------]  412 MB / 1 GB               [Hide]  |
|   ✓ Check — ✓ Snapshot — ● Upload — ○ Finish              12.4 MB/s · about 47 s left        |
+----------------------------------------------------------------------------------------------+
+-[4] Capabilities (only when the LayerFS build lacks a part) ---------------------------------+
| (disk) This LayerFS build keeps one Store per project                                        |
|        Connect shows what the linked LayerFS build reports. ...                              |
| [▤] Shared Stores                      ( ◷ Not in this build )   reason from the host        |
| [☁] Buckets (MinIO, Cloudflare R2)     ( ◷ Not in this build )   reason from the host        |
| [⛁] PostgreSQL                          ( ◷ Not in this build )   reason from the host        |
| ✓ Works now: every project keeps its own SQLite Store in a Docker volume, listed below ...    |
+----------------------------------------------------------------------------------------------+
+-[5] Toolbar ---------------------------------------------------------------------------------+
| [ / Search Stores and projects ]   ( All 4 | Needs attention 1 )   Checked 2 min ago [Check] |
+----------------------------------------------------------------------------------------------+
+-[6] SQLite band (glass card) ----------------------------------------------------------------+
| (sq) SQLite Stores  3 Stores · 2.6 GB on this machine    This machine: 111 GB free · ● ... > |
|      One file per Store, in its own Docker volume. ...                         [ + New Store ] |
| STORE                       LINKED TO                       STATUS                           |
| [m] work                    [m] minio-lab / work            ( ↓ Remote newer )  [Push][Pull] |
|     2 projects · 412 MB                                                                 ...  |
| [ ] scratch                 Local only                      ( Local only )      [Publish…]   |
+----------------------------------------------------------------------------------------------+
+-[7] PostgreSQL band -------------------------------------------------------------------------+
| (pg) PostgreSQL Stores   1 Store in 1 connection · 512 MB in databases    [ + Add connection ] |
|  pg >  ● reachable · PostgreSQL 16   db.local:5432/layerfs    (sync_commit off)              |
|    work-pg             2      512 MB   ↳ from work      2 d ago     ( Live )            ...  |
+----------------------------------------------------------------------------------------------+
+-[8] Connections -------------------------------------------------------[ + Add connection ]--+
| [m] minio-lab       ↗   [r2] r2-team        ↗   [pg] pg              ↗                        |
|     MinIO                  Cloudflare R2           PostgreSQL 16                              |
|     lab.local:9000/…       <acct>.r2…/stores       db.local / layerfs                         |
|     ● reachable · 3 files  ● reachable · 1 file    ● reachable · 4 ms · 1 Store               |
+----------------------------------------------------------------------------------------------+
```

Opening a SQLite Store (`#storage/store/work`):

```text
( < Storage ) > SQLite > work
+-[9] DetailHeader ----------------------------------------------------------------------------+
| [m] STORE · SQLITE                                                                           |
|     work  ( ↓ Remote newer )                                       [Push] [Pull]  ...        |
|     2 projects · 412 MB on this machine · volume lfc-store-work · created 2 d ago            |
+----------------------------------------------------------------------------------------------+
| JobCard: ↑ work -> minio-lab / work   Stepper  [=========-------]  12 MB/s · about 47 s left |
| Link        [m] minio-lab / work   MinIO                               [Push] [Pull] ...     |
|             localhost:9000/stores/lfc/work/store.sqlite [copy]                               |
|             ( ↓ Remote newer )  reason                                                       |
|             THIS MACHINE  Unchanged since your push 3 h ago  -->  MINIO-LAB / WORK  Changed  |
|             Linked 2 d ago · Last push 3 h ago · 412 MB · Checked 1 min ago                  |
|             Sent to r2-team / work-copy · 2 min ago                              [Load…]     |
| Projects 2  (shop) (api)                                                   [ Add project ]   |
| Size        412 MB on this machine        Free in the Docker volumes 111 GB  [==|========]   |
| In PostgreSQL  [pg] work-pg · pg · 512 MB · imported 2 d ago  ↗                              |
| Facts       Volume lfc-store-work · Created …                                  [ Remove… ]   |
+----------------------------------------------------------------------------------------------+
```

## Regions

Every card is `glass-liquid` with the `spotlight` (its glow follows the one `--cursor-hue`), `rounded-2xl`, and enters with the `reveal` stagger (`--i`). Controls are `rounded-xl`; chips are `rounded-full`. Every string goes through `t()` (`@/i18n`); Chinese is in `src/renderer/src/i18n/storage.ts`.

1. **Page header** (`PageHeader` in `StoragePage`): "Storage", one line, and two split buttons (`SplitButton`). The header's live line runs while a transfer runs.
   - "Add connection ▾" opens the Add connection picker (`AddLocationDialog`), with menu items for "Bucket (MinIO, R2)…" and "PostgreSQL connection…".
   - "New Store ▾" opens `NewStoreDialog`; its menu adds "Load from a connection…" (opens the first bucket's file list) and "Import into PostgreSQL…".
   - A part the linked LayerFS build lacks makes its button disabled, with the build's reason in a tooltip (`Unavailable`).
2. **Summary strip** (`SummaryStrip`, `overview/summary-strip.tsx`): four cells on one glass card.
   - Stores: the count, split by family.
   - Size: the total, with what the SQLite and PostgreSQL parts are. It reads "size unknown" when no size is known.
   - Linked: "A of B SQLite". The urgent counts (to push, newer, both changed, missing, unreachable) are buttons that filter the board; unchecked links read "N not known".
   - Transfers: live (a still single-hue line on its top edge, a soft dot). It shows the running job's compact label, and reopens a hidden tray.
3. **Transfer tray** (`TransferTray`, `transfers/transfer-tray.tsx`): while a publish, push, pull, send, load or import runs, and for 10 minutes after one ends. Hide folds it into the Transfers cell.
   - Each `TransferRow` shows the kind and route (`store -> connection / file`), the bar (`JobBar`, `role=progressbar`; an unknown total shimmers), bytes done of total, a stepper (done ✓, now ●, later ○), and the rate and ETA ("about 47 s left"), or "N so far".
   - The phase is announced to screen readers. A failed job shows `RefusalCard` with its actions (Pull first… and Overwrite… on a push Conflict, Pull again in N s, Check now, This machine).
4. **Capabilities** (`Capabilities`, `overview/capabilities.tsx`, new in this design): shown only when a part of the storage view has `available: false`. It names each part (Shared Stores, Buckets, PostgreSQL), marks it Available or "Not in this build" (a dashed chip), quotes the build's reason in mono, and closes with what works now. This is the state the current LayerFS build shows; nothing on the page looks broken because of it.
5. **Toolbar** (`Toolbar`, `overview/toolbar.tsx`): search (`/` focuses it, Esc clears it), an All / Needs attention `Segmented` with counts, Clear, "Checked N ago" and Check now. Check now spins while it runs and rests 10 s afterwards; it shows only when the build can check.
6. **SQLite band** (`SqliteBand`, `overview/sqlite-band.tsx`): the band head (`BandHead` in `overview/row-parts.tsx`) shows the family mark, its counts and size, what the family is, a "This machine: N free · worker" link to the machine page, and New Store. Column heads: Store (sortable), Linked to, Status (sortable).
   - **Rows** (`SqliteStoreRow`, `overview/sqlite-store-row.tsx`):
     - The Store icon (`StoreIcon`, `identity/store-icon.tsx`) is one mark on a lit tile: SQLite when local only, MinIO or Cloudflare when linked there, PostgreSQL for a PostgreSQL Store. Under the name: the project count and the size (`SizeText`); an "own Store" chip marks a project's own pre-#506 Store.
     - Linked to: the provider mark and `connection / file` in mono (opens the bucket page), or "Local only".
     - One pill (`SyncPill`, `sync/sync-pill.tsx`), the Store's state, which is its link's. Under an unknown pill, the last push or pull.
     - Actions: Push and Pull for a linked Store; Publish… for a local-only one (Add a connection first when there is none). A "…" menu (`StoreMenu`) holds Push, Pull, Check now, Send a copy…, Unlink… (or Publish… and Send a copy…), Import into PostgreSQL…, Open and Remove…. Items for parts the build lacks are left out.
     - While a job runs, the Linked-to cell becomes the job (compact `TransferRow`) with a thin single-hue edge on the row. When the job ends, the row flashes once.
7. **PostgreSQL band** (`PostgresqlBand`, `overview/postgresql-band.tsx`): one header row per connection (health, version or when checked, host and database, a `synchronous_commit` chip), its Stores (`PostgresqlStoreRow`: size, "↳ from <SQLite Store>", created, a Live pill, a menu), and pending imports (`PendingImportRow`). A connection with no Stores shows "Import…". With no connections the band is one dashed line that invites adding one. Hidden while the build has no PostgreSQL.
8. **Connections** (`Connections`, `overview/connections.tsx`): one grid of glass cards (`sheen-sweep`, an arrow that wakes on hover), buckets sorted by provider then name, then PostgreSQL servers. A bucket card shows the mark, name, provider, location, health (or "no keys"), `N files · size` and how many are linked; a database card shows version, host and database, health, latency and `N Stores · size`. Hidden while the build has neither buckets nor PostgreSQL.
9. **Breadcrumb** (`Breadcrumb`, `detail/breadcrumb.tsx`): a glass "‹ Storage" pill, then family and name. Alt+←, the mouse back button and the browser back return to the board, which restores its scroll position.
10. **Store page, SQLite** (`SqliteStoreDetail`, `detail/sqlite-store-detail.tsx`): header (`DetailHeader` in `detail/parts.tsx`) with the pill or the running job, Push and Pull or Publish…, and the `StoreMenu`.
    - A running or last job as a `JobCard`.
    - Link (`LinkCard`, `detail/link-card.tsx`): linked, the connection and file, the copyable object path, Push, Pull and a menu (Send a copy…, Unlink…), the pill with its reason, a two-sided panel when the sides differ (`TwoSides`), and when it was linked, last pushed or pulled and checked; Check now on the section head. Local only: "Not linked to any remote file" and Publish…. Without buckets in the build: "Local only" and the build's reason. After a Send, a line names the new file with Load….
    - Projects (chips that open the project by its key, `projectKey`) and Add project (disabled with the reason when the build has no shared Stores).
    - Size (`SizeCard`, `detail/size-card.tsx`): the Store's size, the free space in the Docker volumes and a push's share of it; a Notice when a push would leave little room.
    - In PostgreSQL: the Stores imported from it, as small glass cards.
    - Facts, with Remove….
11. **Store page, PostgreSQL** (`PostgresqlStoreDetail`): connection with health, schema, `synchronous_commit`, size, created, where it was imported from, projects, a dashed "Nothing to sync" card, and Remove….
12. **Connection page** (`ConnectionDetail`): health, version, latency, the URL with the password hidden, its Stores (schema, projects, size, from, created), `synchronous_commit` with what it means, Import a SQLite Store…, Check now and Forget….
13. **Bucket page** (`BucketDetail`, `detail/bucket-detail.tsx`): provider, endpoint, bucket and prefix, health, keys; files in the bucket (`FilesHere`, from the last listing plus linked files it doesn't name) with "Linked to X" and Open, or "Not loaded" and Load…; Settings with Remove… (refused while a Store links to it).
14. **Machine page** (`MachineDetail`, `detail/machine-detail.tsx`): the worker chip, the home path, the disk gauges (`DiskGauge`), the LayerFS box (`WorkerSection`, `machine/worker.tsx`), the volume prefix, Store volumes and Docker.

### Dialogs (`dialogs/`, one owner: `StorageDialogs` in `dialogs/storage-dialogs.tsx`)

All dialogs share the branch's sheet (`SHEET`, `SheetHeader`, `SheetFooter`, `Field`, `FormError` in `dialogs/fields.tsx`): `rounded-3xl`, a title with its icon on a tinted tile, `h-8 rounded-xl` buttons.

- **Add connection** (`AddLocationDialog`): binds no Store.
  - Step 1 is a picker of provider tiles from the registry in `identity/providers.ts`; arrow keys move between them. Filtered by family; a search box appears with more than 8 providers.
  - MinIO, Cloudflare R2 and PostgreSQL are live when the build has them; Amazon S3, Google Cloud Storage, Google Drive and Folder are dashed "Coming" tiles.
  - Step 2 is the provider's form (`ProviderForm` or `PostgresqlForm` with `synchronous_commit`, in `provider-forms.tsx`).
  - After adding, the dialog runs one check: "Reachable. N Store files, M not loaded" or "Added, but not reachable", with Keep it or Remove it.
- **Publish** and **Send a copy** (`UploadDialog` in `publish-dialog.tsx`; `SendDialog` in `send-dialog.tsx`): a connection (with health) and a file name; a file that exists is refused under the field. The job runs in the dialog; "Run in background" leaves it to the tray.
- **Load** (`LoadDialog`): the new Store's name, the file's size and modified time, and room in the Docker volumes; a linked file is refused before the call ("Already linked as X", Open).
- **Pull** (`PullDialog`): only when the pull would discard local changes; you type the Store's name. Otherwise Pull runs at once.
- **Push conflict** (`PushConflictDialog`): before a push when the linked file is newer, diverged or missing: Pull first, or Overwrite (`force`).
- **Unlink** and **Remove** (`ConfirmByName`, which asks for the typed name where data is lost).
- **Import into PostgreSQL** (`ImportDialog`), **Add project** (`AddProjectDialog`: `host.createProject({ name, source?, store })`, then `host.projectInit`), **New Store** (`NewStoreDialog`).

## Sync states

`sync/sync-state.ts` holds one entry per state: a label, a tone, an icon, and what it means. A pill always shows an icon and words; colour is never the only signal. A Store's state is its one link's (storage-links §4).

| State | Pill | Means |
|---|---|---|
| in_sync | ✓ In sync | The Store matches its linked file |
| ahead | ↑ Changes to push | The Store changed since the last push or pull; the file didn't |
| behind | ↓ Remote newer | The file changed since the last push or pull |
| diverged | Both changed | Both sides changed |
| missing | File missing | The linked file was deleted |
| unreachable | Unreachable (dashed) | The last check failed; the tooltip gives the last known state |
| transferring | Transferring (turning icon) | A publish, push, pull or load runs on the Store |
| checking | Checking… (turning icon) | The first check is running |
| unknown | Sync unknown (dashed) | Not known; the reason names the unknown side |
| local_only | Local only | No link |
| live | Live | A PostgreSQL Store |

## Data and refresh

- `view.ts`: `normalizeView` turns any host's `/api/storage` answer into a complete `StorageView` (missing sync → `unknown` with a reason, missing sizes → "size unknown", missing totals and supports derived). A 404 means a host from before layerfs#506.
- When `stores.available` is false (or the route is missing), the page builds a fallback view from the project catalog (`/api/projects`): one Store per project, keeping the host's reasons for remotes and PostgreSQL.
- Polling: the view reloads every 15 s while visible and focused, at once on a `storage` host event (`useStorageEvents`), and on `onProjectsChanged`. Links are checked when the last check is over 2 minutes old, then every 5 minutes.
- Transfers (`transfers/use-transfers.ts`): a module-level store seeded from the view and fed by `sync` host events; it polls `host.syncJob(id)` once a second while the event stream is closed (`hostEventsOpen`) or a job has been quiet for 3 s. A job that ends reloads the view and the catalog and flashes its Store.
- Routes: `#storage`, `#storage/store/<name>`, `#storage/location/<bucket>`, `#storage/connection/<name>`, `#storage/machine` (`routeHash`, `parseRoute` in `actions.ts`). Leaving the page clears the hash.

## States

- **Loading**: skeleton strip and band rows (`OverviewSkeleton`).
- **Error**: `LoadError` with Retry.
- **No Stores**: a glass empty card with the SQLite mark, New Store and, with a bucket, Load….
- **Build without Stores, buckets or PostgreSQL**: the Capabilities card, the fallback SQLite band (one Store per project), disabled header buttons with reasons; the PostgreSQL band and Connections are hidden.
- **LayerFS box down**: a warning Notice with This machine. SQLite sizes read "size unknown" with the reason.
- **Low disk**: a warning Notice; the Size card and the machine gauges turn warning-coloured.
- **Nothing to show**: "Nothing needs attention…" under Needs attention, or "No Stores match." for a search.

## Narrow windows

The body is a container (`@container/storage`), with the grid layouts in `storage.css`:

- **1040 px and wider**: every column.
- **760–1039 px**: the Linked-to cell keeps the mark and file; the project count and size stay under the name. The summary strip is two by two; Connections two cards wide.
- **Below 760 px**: each row becomes a two-line card ("name, pill" over "facts, action"); the summary strip scrolls sideways; the tray rows stack.

## Elsewhere

- Projects use `StoreIcon`, `storeProviders` (`identity/store-icon.tsx`) and `SyncPill` (`sync/sync-pill.tsx`); keep their names and props stable.
- `compute/docker-card.tsx` imports `workerChip` from `storage/local-detail.tsx`, which re-exports `machine/worker.tsx`.
- `chips.tsx`, `icons.tsx`, `meters.tsx`, `notice.tsx` and `unavailable.tsx` are shared with Projects, Compute and Runs.

## Files

`storage/`:

- `storage-page.tsx`, `actions.ts`, `view.ts`, `size.tsx`, `local-detail.tsx` (re-export);
- `chips.tsx`, `icons.tsx`, `meters.tsx`, `notice.tsx`, `unavailable.tsx` and `storage.css`;
- `identity/`: `providers.ts`, `store-icon.tsx`;
- `sync/`: `sync-state.ts`, `sync-pill.tsx`, `health-dot.tsx`;
- `transfers/`: `phases.ts`, `use-transfers.ts`, `transfer-row.tsx`, `job-card.tsx`, `transfer-tray.tsx`, `refusal.tsx`;
- `overview/`: `overview.tsx`, `capabilities.tsx`, `summary-strip.tsx`, `toolbar.tsx`, `row-parts.tsx`, `sqlite-band.tsx`, `sqlite-store-row.tsx`, `postgresql-band.tsx`, `postgresql-store-row.tsx`, `connections.tsx`;
- `detail/`: `breadcrumb.tsx`, `parts.tsx`, `sqlite-store-detail.tsx`, `postgresql-store-detail.tsx`, `link-card.tsx`, `size-card.tsx`, `bucket-detail.tsx`, `connection-detail.tsx`, `machine-detail.tsx`;
- `machine/`: `worker.tsx`;
- `dialogs/`: `storage-dialogs.tsx`, `fields.tsx`, `confirm-by-name.tsx`, `add-location-dialog.tsx`, `provider-forms.tsx`, `publish-dialog.tsx`, `send-dialog.tsx`, `load-dialog.tsx`, `pull-dialog.tsx`, `push-conflict-dialog.tsx`, `import-dialog.tsx`, `add-project-dialog.tsx`, `new-store-dialog.tsx`.

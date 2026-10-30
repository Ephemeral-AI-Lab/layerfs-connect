# LayerFS: Storage

Every Store in one board: SQLite Stores, each linked to at most one file in a MinIO or R2 bucket or local only, PostgreSQL Stores under their connections, and every connection in one grid. Opening a Store, a bucket, a connection or the machine shows its page.
Opens from: the Storage tab on the LayerFS page, or a `#storage…` hash.
Source: `src/renderer/src/components/storage/storage-page.tsx` (main file; others named in Regions). Design: [storage-links.md](storage-links.md) (links; layerfs#509), [storage-redesign.md](storage-redesign.md) (bands, progress, size, identity, states).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| LayerFS                                           [ + Add connection v ] [ + New Store v ]   |
| Where projects' history lives. ...                                                           |
|  Projects   Storage   Compute                                                                |
+----------------------------------------------------------------------------------------------+
+-[2] SummaryStrip ----------------------------------------------------------------------------+
| STORES          | SIZE              | LINKED                     | TRANSFERS                 |
| 4               | 3.1 GB            | 2 of 3 SQLite              | 1 running                 |
| 3 SQLite · 1 PG | 2.6 GB SQLite ... | 1 in sync · 1 remote newer | push work -> minio 41%    |
+----------------------------------------------------------------------------------------------+
+-[3] Toolbar ---------------------------------------------------------------------------------+
| [ / Search Stores and projects ]   ( All | Needs attention )               [ Check now ]     |
+----------------------------------------------------------------------------------------------+
+-[4] SQLite band -----------------------------------------------------------------------------+
| (sq) SQLite   3 Stores · 2.6 GB      Local files, each linked to one remote file             |
| Store                       Linked to                       Sync                             |
| [m] work                    [m] minio-lab / work            ( v Remote newer )  [Push][Pull] |
|     2 projects · 412 MB                                                                      |
| [ ] scratch                 Local only                      ( Local only )      [Publish…]   |
| [m] team-examples           ~~ Uploading 41% [=====-----]   ( ◌ Transferring )       [Push][Pull] |
+----------------------------------------------------------------------------------------------+
+-[5] PostgreSQL band -------------------------------------------------------------------------+
| (pg) PostgreSQL   1 Store · 1 connection     Live schemas under named connections            |
|  pg   * Reachable · PostgreSQL 16   db.local:5432/layerfs    [sync_commit off]               |
|    work-pg             2      512 MB   from work                                        ...  |
+----------------------------------------------------------------------------------------------+
+-[6] Connections -----------------------------------------------------------------[+ Add]-----+
| [m] minio-lab          [m] minio-backup        [r2] r2-team           [pg] pg                |
|     MinIO                  MinIO                   Cloudflare R2          PostgreSQL 16      |
|     lab.local:9000/…       lab.local:9000/…        <acct>.r2…/stores      db.local / layerfs |
|     * Reachable · 3 files  * Reachable · 0 files   * Reachable · 1 file   * Reachable · 1 St |
+----------------------------------------------------------------------------------------------+
+-[7] TransferTray (while a job runs or just ended) -------------------------------------------+
| push  work -> minio-lab   Uploading  (x)(x)(*)( )  [==========------]  412 MB of 1 GB [Hide] |
+----------------------------------------------------------------------------------------------+
```

Opening a SQLite Store (`#storage/store/work`):

```text
+-[8] Breadcrumb: Storage / SQLite / work -----------------------------------------------------+
+-[9] DetailHeader ----------------------------------------------------------------------------+
| [m] work   SQLite Store · 2 projects · 412 MB      ( v Remote newer )   [Push] [Pull]  ...   |
+----------------------------------------------------------------------------------------------+
| JobCard: push work -> minio-lab   Stepper  [=========-------]  12 MB/s · about 47 s left     |
| Link        [m] minio-lab / work   MinIO                       [Push] [Pull] ...             |
|             localhost:9000/stores/lfc/work/store.sqlite [copy]                               |
|             ( v Remote newer )  minio-lab / work changed since the last push or pull; …      |
|             THIS MACHINE  Unchanged since your push 3 h ago  -->  MINIO-LAB / WORK  Changed  |
|             Linked 2 d ago · Last push 3 h ago · 412 MB · Checked 1 min ago                  |
|             Sent to r2-team / work-copy · 2 min ago                              [Load…]     |
| Projects    shop  api                                                     [ Add project ]    |
| Size        412 MB (SQLite)       free 111 GB  [=====|=================]  this push 412 MB    |
| In PostgreSQL  work-pg on pg                                                                 |
| Facts       Docker volume lfc-store-work · Created 2 d ago                     [ Remove ]    |
+----------------------------------------------------------------------------------------------+
```

Opening a bucket (`#storage/location/minio-lab`):

```text
+-[12] Bucket page ----------------------------------------------------------------------------+
| [m] minio-lab   MinIO · lab.local:9000 · bucket stores · prefix lfc   * Reachable   [Check]  |
| Files in this bucket                                                                         |
| File              Size      Modified     On this machine                                     |
| work              412 MB    3 h ago      Linked to work                [ Open ]              |
| team-examples     88 MB     1 d ago      Not loaded                    [ Load… ]             |
+----------------------------------------------------------------------------------------------+
```

## Regions

1. **Page header** (`PageHeader` in `StoragePage`): "LayerFS", one line and the tab row. Two split buttons (`SplitButton`):
   - "Add connection ▾" opens the Add connection picker (`AddLocationDialog`), with menu items for "Bucket (MinIO, R2)…" and "PostgreSQL connection…".
   - "New Store ▾" opens `NewStoreDialog`; its menu adds "Load from a connection…" (opens the first bucket's file list) and "Import into PostgreSQL…".
   - A route the linked LayerFS build lacks makes its item disabled, with the reason in a tooltip (`Unavailable`).
2. **Summary strip** (`SummaryStrip`, `overview/summary-strip.tsx`): four cells.
   - Stores: the count, split by family.
   - Size: the total (`totalText`), with what the SQLite and PostgreSQL parts are. It reads "size unknown" when no size is known.
   - Linked: "A of B SQLite". The urgent counts (remote newer, diverged, missing, unreachable) are buttons that filter the board; unchecked links read "N not known".
   - Transfers: live. It shows the running job's compact label, and reopens a hidden tray.
3. **Toolbar** (`Toolbar`, `overview/toolbar.tsx`): search (`/` focuses it, Esc clears it), an All / Needs attention switch, Clear, and Check now. Check now spins while it runs, rests for 10 s afterwards, and its tooltip says when the links were last checked.
4. **SQLite band** (`SqliteBand`, `overview/sqlite-band.tsx`): the band head (`BandHead`) shows the family mark, its counts and size, what the family is, and a link to the LayerFS box page. Column heads: Store, Linked to, Sync.
   - **Rows** (`SqliteStoreRow`, `overview/sqlite-store-row.tsx`):
     - The Store icon (`StoreIcon`, storage-links §3.6) is one mark on a neutral tile: SQLite when local only, MinIO or Cloudflare when linked there, PostgreSQL for a PostgreSQL Store; its name and tooltip say "Local only", "MinIO", "Cloudflare R2" or "PostgreSQL". Under the name: the project count and the size (`SizeText`).
     - Linked to: the provider mark, `connection / file` in mono (opens the bucket page), or "Local only".
     - One pill (`SyncPill`), the Store's state, which is its link's (storage-links §4). Under an unknown pill, the last push or pull.
     - Actions: Push and Pull for a linked Store; Publish… for a local-only one (Add a connection first when there is none). A "…" menu (`StoreMenu`) holds Push, Pull, Check now, Send a copy…, Unlink… (or Publish… and Send a copy…), Import, Open and Remove.
     - While a job runs, the Linked-to cell becomes the job (compact `TransferRow`) and the row shows a live edge. When the job ends, the row flashes once.
5. **PostgreSQL band** (`PostgresqlBand`, `overview/postgresql-band.tsx`): one header row per connection.
   - Each header shows the connection's health, its version or when it was checked, host and database, and a `synchronous_commit` chip.
   - Its Stores follow (`PostgresqlStoreRow`), each with a "from <SQLite Store>" link and a Live pill. An import still running shows as a pending row (`PendingImportRow`).
   - A connection with no Stores shows a muted row with "Import…". With no connections, the band is one line that invites adding one.
6. **Connections** (`Connections`, `overview/connections.tsx`): one grid of cards, buckets (sorted by provider, then name) and PostgreSQL servers together. A bucket card shows its mark, name, provider, location, health (or "no keys"), `N files · size` and how many are linked, and opens the bucket page. A database card shows the version, host and database, health and latency, and `N Stores · size`, and opens the connection page. With no connections, a dashed card says what to add.
7. **Transfer tray** (`TransferTray`, `transfers/transfer-tray.tsx`): pinned at the bottom while a publish, push, pull, send, load or import runs, and for 10 minutes after one ends. Hide removes it until the Transfers cell is clicked.
   - Each `TransferRow` shows the job's kind and route (`store -> connection / file`), a stepper (done, now, later), and a real bar (`JobBar`, `role=progressbar`).
   - It also shows bytes done of total, the rate and the ETA ("about 47 s left"), or "N so far" when the total is unknown. An unknown total gives an indeterminate shimmer.
   - The phase is announced to screen readers. A job that fails shows `RefusalCard` with its own actions (Pull first… and Overwrite… on a push Conflict, Pull again in N s, Check now, This machine).
8. **Breadcrumb** (`Breadcrumb`, `detail/breadcrumb.tsx`): "Storage / family / name". Alt+←, the mouse back button and the browser back all return to the board, and the board restores its scroll position.
9. **Store page, SQLite** (`SqliteStoreDetail`, `detail/sqlite-store-detail.tsx`):
   - The header shows the pill and the row's actions (Push and Pull, or Publish…) with the `StoreMenu`.
   - A running job shows as a `JobCard` with a stepper, bar, rate and ETA.
   - Link (`LinkCard`, `detail/link-card.tsx`): linked, the connection and file, the copyable object path, Push, Pull and a menu (Send a copy…, Unlink…), the pill with its reason in full, a two-sided panel when the sides differ (`TwoSides`), and when it was linked, last pushed or pulled and checked; Check now on the section head. Local only: "Not linked to any remote file" and Publish…. After a Send, a notice names the new file with Load….
   - Projects (chips that open the project) and "Add project".
   - Size (`SizeCard`): the Store's size, the free space where it lives, and this push's share of it. A Notice warns when the push would leave little room.
   - In PostgreSQL: the Stores imported from it.
   - Facts, with Remove.
10. **Store page, PostgreSQL** (`PostgresqlStoreDetail`): its connection and schema, size, the SQLite Store it came from, projects, and Remove.
11. **Connection page** (`ConnectionDetail`): the connection's health, version, URL with the password hidden, `synchronous_commit`, its Stores, and Forget.
12. **Bucket page** (`BucketDetail`, `detail/bucket-detail.tsx`): the bucket's provider, endpoint, bucket and prefix, health, and the Stores linked to it; Check, and Remove (refused while a Store links to it, `InUse`). Files in this bucket (`FilesHere`, from `GET /api/remotes/:name/files`): each file's size and modified time, and "Linked to X" with Open, or "Not loaded" with Load…. An empty bucket says to publish a Store to it.
13. **Machine page** (`MachineDetail`, `detail/machine-detail.tsx`): the LayerFS box (`WorkerSection`, `machine/worker.tsx`), the disk gauges (`DiskGauge`), the home path and the volume prefix.

### Dialogs (`dialogs/`, one owner in `Dialogs` inside `storage-page.tsx`)

- **Add connection** (`AddLocationDialog`): binds no Store.
  - Step 1 is a picker of provider tiles, from the registry in `identity/providers.ts`. Arrow keys move between the tiles. It is filtered by family (bucket or database), and has a search box when there are more than 8 providers.
  - MinIO, Cloudflare R2 and PostgreSQL are live. Amazon S3, Google Cloud Storage, Google Drive and Folder show as "coming".
  - Step 2 is the provider's form (`ProviderForm` or `PostgresqlForm` in `provider-forms.tsx`), with Back.
  - After adding, the dialog runs one check and lists a bucket's files: "Reachable. N Store files, M not loaded" or "Added, but not reachable", with Keep it or Remove it.
- **Publish** and **Send a copy** (`PublishDialog` and `SendDialog`, one form: `UploadDialog` in `publish-dialog.tsx`): a connection (buckets only, each with health) and a file name (the Store's name, or `<store>-copy`); a file that exists is refused under the name field (`Exists`). Send says the Store's link does not change.
- **Load** (`LoadDialog`): the new Store's name (the file's name by default), the file's size and modified time, and room on this machine; a linked file is refused before the call ("Already linked as X", with Open).
- **Pull** (`PullDialog`): only when the pull would discard local changes (ahead, diverged, or local changes not known); you confirm by typing the Store's name. Otherwise Pull runs at once.
- **Push conflict** (`PushConflictDialog`): shown before a push when the linked file is newer, diverged or missing, and from a push refused with `Conflict`: Pull first, or Overwrite.
- **Unlink** (`ConfirmByName`): the Store becomes local only; its file stays, not loaded.
- **Import** (`ImportDialog`), **Add project**, **New Store**, and **Remove** (`ConfirmByName`, which asks for the typed name).

## Sync states

`sync/sync-state.ts` holds one entry per state: a label, a tone, an icon, and what the state means. A pill always shows an icon and words; colour is never the only signal. A Store's state is its one link's (storage-links §4); there is no aggregate.

| State | Pill | Means |
|---|---|---|
| in_sync | ✓ In sync | The Store matches its linked file |
| ahead | ↑ Changes to push | The Store changed since the last push or pull; the file didn't |
| behind | ↓ Remote newer | The file changed since the last push or pull; the Store didn't |
| diverged | ⇅ Both changed | Both sides changed |
| missing | File missing | The linked file was deleted |
| unreachable | Unreachable (dashed) | The last check failed; the tooltip gives the last known state |
| transferring | ◌ Transferring (spinning) | A publish, push, pull or load runs on the Store |
| checking | ◌ Checking (spinning) | The first check is running |
| unknown | Sync unknown (dashed) | Not known; the reason names the unknown side |
| local_only | Local only | No link |
| live | Live | A PostgreSQL Store |

Push asks first (Push conflict) when the file is newer, diverged or missing. Pull asks first when it would discard local changes.

## Data and refresh

- `view.ts` has `normalizeView`, which turns any host's `/api/storage` answer into a complete `StorageView`:
  - a missing sync becomes `unknown` with a reason;
  - missing sizes read "size unknown";
  - missing totals, supports and providers are derived from what is there.
  - A 404 means a host from before layerfs#506. The page then builds a fallback view from `/api/status`, with one Store per project.
- Polling: the page reloads every 15 s while visible and focused, and at once on a `storage` host event.
  - Links are checked (one HEAD of each linked file) and buckets listed automatically when the last check is more than 2 minutes old, and every 5 minutes after that.
- Transfers (`transfers/use-transfers.ts`): a module-level store fed by `sync` host events.
  - It falls back to polling `/api/storage/jobs/:id` every second when the event stream is closed, or when a job has been quiet for 3 s.
- Routes: `#storage`, `#storage/store/<name>`, `#storage/location/<name>` (a bucket), `#storage/connection/<name>` and `#storage/machine` (`routeHash`, `parseRoute` in `actions.ts`).

## States

- **Loading**: skeleton strip and band rows (`OverviewSkeleton`).
- **Error**: `LoadError` with Retry.
- **No Stores**: an empty card with the SQLite mark, "New Store" and, with a bucket, "Load…".
- **LayerFS box down**: a warning Notice. SQLite sizes then read "size unknown" with the reason.
- **Low disk**: a warning Notice; the Size card and the machine page's gauges turn warning-coloured.
- **Nothing to show**: "Nothing needs attention…" under the Needs attention filter, or "No Stores match." for a search.
- **Host from before #506**: an info Notice ("One Store per project") over the fallback board. Add connection and the link actions are disabled with a reason.

## Narrow windows

The board is a container (`@container/storage`), with the layouts in `storage.css`:

- **1040 px and wider**: every column.
- **760–1039 px**: the Linked-to cell keeps the mark and the file. The project count and size stay under the name. The summary strip becomes two columns; the Connections grid two cards wide.
- **Below 760 px**: each row becomes a two-line card ("name, pill" over "facts, action"). The summary strip scrolls sideways, and the tray rows stack.

## Elsewhere

- The project card's Store well (`projects/home/project-card.tsx`) and the project Storage tab (`projects/project-storage.tsx`) use the same `StoreIcon`, `SyncPill`, size and compact `TransferRow`; the Storage tab adds one link chip (`connection / file`, or local only).
- The New project dialog's Store picker shows each Store's icon, project count, size and pill.
- `compute/docker-card.tsx` imports `workerChip` from `storage/machine/worker.tsx`.

## Files

`storage/`:

- `storage-page.tsx`, `actions.ts`, `view.ts` and `size.tsx`;
- `chips.tsx`, `icons.tsx`, `meters.tsx`, `notice.tsx`, `unavailable.tsx` and `storage.css`;
- `identity/`: `providers.ts` and `store-icon.tsx`;
- `sync/`: `sync-state.ts`, `sync-pill.tsx` and `health-dot.tsx`;
- `transfers/`: `phases.ts`, `use-transfers.ts`, `transfer-row.tsx`, `job-card.tsx`, `transfer-tray.tsx` and `refusal.tsx`;
- `overview/`: `summary-strip.tsx`, `toolbar.tsx`, `row-parts.tsx`, `sqlite-band.tsx`, `sqlite-store-row.tsx`, `postgresql-band.tsx`, `postgresql-store-row.tsx` and `connections.tsx`;
- `detail/`: `breadcrumb.tsx`, `parts.tsx`, `sqlite-store-detail.tsx`, `postgresql-store-detail.tsx`, `link-card.tsx`, `size-card.tsx`, `bucket-detail.tsx`, `connection-detail.tsx` and `machine-detail.tsx`;
- `machine/`: `worker.tsx`;
- `dialogs/`: `add-location-dialog.tsx`, `provider-forms.tsx`, `fields.tsx`, `confirm-by-name.tsx`, `publish-dialog.tsx`, `send-dialog.tsx`, `load-dialog.tsx`, `pull-dialog.tsx`, `push-conflict-dialog.tsx`, `import-dialog.tsx`, `add-project-dialog.tsx` and `new-store-dialog.tsx`.

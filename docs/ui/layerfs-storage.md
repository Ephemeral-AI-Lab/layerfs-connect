# LayerFS: Storage

Every Store as one card with its projects: SQLite Stores, each linked to at most one file in a MinIO or R2 bucket or local only, and PostgreSQL Stores that live in a database. One line of facts above the cards opens this machine and the connections. Opening a Store, a bucket, a connection or the machine shows its page.
Opens from: Storage in the sidebar's RESOURCES group, or a `#storage…` hash.
Source: `src/renderer/src/components/storage/storage-page.tsx` (main file; others named in Regions). Design: [storage-links.md](storage-links.md) (links; layerfs#509), [storage-redesign.md](storage-redesign.md) (progress, size, identity, states). Visual language: [frontend-polish-prompt.md](../frontend-polish-prompt.md) (Macaron liquid glass: `glass-liquid` `rounded-2xl` cards, `rounded-xl` controls, the single-hue `--cursor-hue` spotlight, restrained motion).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| Storage                                                                           [ + New ]  |
+----------------------------------------------------------------------------------------------+
  [2] 16 Stores · 1.9 GB · (disk) 77.9 GB free on this machine · 2 buckets · 2 databases   [ / ]
+-[4] TransferTray (only a failed job, or an import still copying) ----------------------------+
| (!) mirror <- r2 / mirror   Pull failed: The Store file is open; close its Sandboxes first.  |
+----------------------------------------------------------------------------------------------+
+-[3] StoreCard (amber ring) ---+ +-[3] StoreCard -------------+ +-[3] StoreCard -------------+
| [r2] services            ...  | | [r2] r2-examples       ... | | [sq] connect-test-13321 ...|
|      r2 / services · 156 MB   | |      r2 / r2-examples · 213| |      This machine · 238 MB |
| [] api-service                | | [] landing-page            | |                            |
|                               | | [] etl-jobs                | |                            |
|-------------------------------| |----------------------------| |----------------------------|
| ↑ Changes to push     [Push]  | | ✓ In sync                  | | Not published   (Publish…) |
+-------------------------------+ +----------------------------+ +----------------------------+
```

Opening a SQLite Store (`#storage/store/work`):

```text
( < Storage ) > SQLite > work
+-[6] DetailHeader ----------------------------------------------------------------------------+
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

1. **Page header** (`PageHeader` in `StoragePage`): "Storage" and one **New** button, which opens the New dialog (below) on the SQLite tab. The header's live line runs while a transfer runs. When the build has none of Stores, buckets or PostgreSQL, New is disabled with the build's reason in a tooltip (`Unavailable`).
2. **Facts line** (`FactsLine` in `overview/overview.tsx`): `N Stores · size · 77.9 GB free on this machine · N buckets · N databases`, and search on the right.
   - The free space (the lower of the home disk and the Docker volumes) opens the machine page; it turns warning-coloured when low, and reads "Docker is not answering" when Docker is down.
   - "N buckets" and "N databases" open the New dialog on the SQLite or PostgreSQL tab, where those connections are listed and added ("Add a bucket" / "Add a database" when there are none). An amber dot marks one that isn't answering. Each is hidden while the build lacks it.
   - Search shows from six Stores up: it matches Store and project names (`/` focuses it, Esc clears it). A card found by a project lists that project first, highlighted.
3. **Store cards** (`StoreCard`, `overview/store-card.tsx`): a grid of glass cards, at least 17.5 rem wide (one column in a narrow window). Order: Stores that need you (`attentionOf`), Stores with a running job, shared Stores, then projects' own pre-#506 Stores; by name within each.
   - **Head:** the Store icon (`StoreIcon`: SQLite when local only, MinIO or Cloudflare when linked there, PostgreSQL for a PostgreSQL Store), the name (opens the Store page), and the `…` menu (`StoreMenu` in `overview/sqlite-store-row.tsx`: Push, Pull, Check now, Send a copy…, Unlink… or Publish… and Send a copy…, Import into PostgreSQL…, Open, Remove…; `PostgresqlStoreMenu`: Open, Remove…).
   - **Where:** `connection / file` in mono with the provider mark (opens the bucket page), "This machine", or the PostgreSQL connection (opens its page); then the size (`SizeText`).
   - **Projects:** up to three, each opens the project (`openProject`); "N more" opens the Store page. An empty Store says "No projects yet" with Add project. A project's own Store (one project with the Store's name) lists nothing, and its name opens the project.
   - **Footer:** the state in its tone (`SYNC` in `sync/sync-state.ts`, with the link's tooltip from `copyTip`), "Not published" for a local-only Store, "Live in the database" or "↳ from <SQLite Store>" for PostgreSQL. At most one button, only when the state asks: Push (changes to push, file missing), Pull (remote newer), Resolve… (both changed: opens the Store page). Publish… on a local-only Store wakes on hover and focus. While a job runs, the footer is the job (compact `TransferRow`); when it ends, the card flashes once.
   - **Needs you:** a warning ring for changes to push, remote newer, file missing, unreachable, or a PostgreSQL connection that isn't answering; a danger ring for both changed or a failed job ("Last transfer failed").
4. **Warnings and failed transfers**, each only while true: the transfer tray (`TransferTray`) with failed jobs (`RefusalCard` and its actions: Pull first…, Overwrite…, Pull again, Check now, This machine) and imports still copying into a new PostgreSQL Store; Hide dismisses the failed ones. Then "The LayerFS box is down" and "Disk space is low" Notices, and one quiet line naming the parts this LayerFS build lacks (`BuildLine`, the build's reasons in its tooltip).
5. **Breadcrumb** (`Breadcrumb`, `detail/breadcrumb.tsx`): a glass "‹ Storage" pill, then family and name. Alt+←, the mouse back button and the browser back return to the cards, which restore their scroll position.
6. **Store page, SQLite** (`SqliteStoreDetail`, `detail/sqlite-store-detail.tsx`): header (`DetailHeader` in `detail/parts.tsx`) with the pill or the running job, Push and Pull or Publish…, and the `StoreMenu`.
    - A running or last job as a `JobCard`.
    - Link (`LinkCard`, `detail/link-card.tsx`): linked, the connection and file, the copyable object path, Push, Pull and a menu (Send a copy…, Unlink…), the pill with its reason, a two-sided panel when the sides differ (`TwoSides`), and when it was linked, last pushed or pulled and checked; Check now on the section head. Local only: "Not linked to any remote file" and Publish…. Without buckets in the build: "Local only" and the build's reason. After a Send, a line names the new file with Load….
    - Projects (chips that open the project by its key, `projectKey`) and Add project (disabled with the reason when the build has no shared Stores).
    - Size (`SizeCard`, `detail/size-card.tsx`): the Store's size, the free space in the Docker volumes and a push's share of it; a Notice when a push would leave little room.
    - In PostgreSQL: the Stores imported from it, as small glass cards.
    - Facts, with Remove….
7. **Store page, PostgreSQL** (`PostgresqlStoreDetail`): connection with health, schema, `synchronous_commit`, size, created, where it was imported from, projects, a dashed "Nothing to sync" card, and Remove….
8. **Connection page** (`ConnectionDetail`): health, version, latency, the URL with the password hidden, its Stores (schema, projects, size, from, created), `synchronous_commit` with what it means, Import a SQLite Store…, Check now and Forget….
9. **Bucket page** (`BucketDetail`, `detail/bucket-detail.tsx`): provider, endpoint, bucket and prefix, health, keys; files in the bucket (`FilesHere`, from the last listing plus linked files it doesn't name) with "Linked to X" and Open, or "Not loaded" and Load…; Settings with Remove… (refused while a Store links to it).
10. **Machine page** (`MachineDetail`, `detail/machine-detail.tsx`): the worker chip, the home path, the disk gauges (`DiskGauge`), the LayerFS box (`WorkerSection`, `machine/worker.tsx`), the volume prefix, Store volumes and Docker.

### Dialogs (`dialogs/`, one owner: `StorageDialogs` in `dialogs/storage-dialogs.tsx`)

All dialogs share the branch's sheet (`SHEET`, `SheetHeader`, `SheetFooter`, `Field`, `FormError`, `BackLink` in `dialogs/fields.tsx`): `rounded-3xl`, a title with its icon on a tinted tile, `h-8 rounded-xl` buttons.

- **New** (`NewDialog` in `new-dialog.tsx`): two tabs (`Segmented`), one per kind of Store; each opens with one sentence on what that kind is.
  - **SQLite**: Empty Store (opens New Store) and From a bucket file (lists each bucket's files in place: Load… a file that isn't loaded, or open the Store that has it). Then Buckets, grouped by provider: name, where it points (`location`: endpoint or account, bucket and prefix), file count and health; each opens its bucket page. "+ MinIO bucket" and "+ Cloudflare R2 bucket" open that provider's add form. Check now reads them again.
  - **PostgreSQL**: Copy a SQLite Store in (opens Import). Then Databases: name, host and database, Store count and health; each opens its connection page. "+ PostgreSQL database".
  - A way that can't be used yet stays listed, dimmed, with why in its second line (Add a bucket first, Add a database first, the build's reason).
  - Each dialog it opens has a "‹ New" link (`BackLink`) back to the same tab. Several connections of one provider are fine; only names must differ.

- **Add connection** (`AddLocationDialog`): binds no Store.
  - Step 1 is a picker of provider tiles from the registry in `identity/providers.ts`; arrow keys move between them. Filtered by family; a search box appears with more than 8 providers.
  - MinIO, Cloudflare R2 and PostgreSQL are live when the build has them; Amazon S3, Google Cloud Storage, Google Drive and Folder are dashed "Coming" tiles.
  - Step 2 is the provider's form (`ProviderForm` or `PostgresqlForm` with `synchronous_commit`, in `provider-forms.tsx`). Opened from New, it starts on the form, with "‹ New" in place of "All providers".
  - A bucket form that matches an existing connection's provider, endpoint (or account), bucket and prefix shows a warning naming it (`sameBucket`): both would list and change the same files. It doesn't block the add.
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

- **Loading**: a shimmering facts line and six card placeholders (`OverviewSkeleton`).
- **Error**: `LoadError` with Retry.
- **No Stores**: a glass empty card with the SQLite mark, New Store and, with a bucket, Load….
- **Build without Stores, buckets or PostgreSQL**: the build line, one card per project's own Store (the fallback view), and only the New items the build has.
- **LayerFS box down**: a warning Notice with This machine. SQLite sizes read "size unknown" with the reason.
- **Low disk**: a warning Notice and a warning-coloured free space in the facts line; the Size card and the machine gauges turn warning-coloured.
- **No match**: "No Stores match." with Clear.

## Narrow windows

The cards fill as many columns as fit at 17.5 rem or wider (`repeat(auto-fill, minmax(17.5rem, 1fr))`), down to one. The facts line wraps, and search takes the full width below it on small screens.

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
- `overview/`: `overview.tsx` (facts line, connections menu, search, build line), `store-card.tsx`, `row-parts.tsx` (`Card`, `MoreButton`), `sqlite-store-row.tsx` (`StoreMenu`, `ContextAction`), `postgresql-store-row.tsx` (`FromLink`, `PostgresqlStoreMenu`);
- `detail/`: `breadcrumb.tsx`, `parts.tsx`, `sqlite-store-detail.tsx`, `postgresql-store-detail.tsx`, `link-card.tsx`, `size-card.tsx`, `bucket-detail.tsx`, `connection-detail.tsx`, `machine-detail.tsx`;
- `machine/`: `worker.tsx`;
- `dialogs/`: `storage-dialogs.tsx`, `new-dialog.tsx`, `fields.tsx`, `confirm-by-name.tsx`, `add-location-dialog.tsx`, `provider-forms.tsx`, `publish-dialog.tsx`, `send-dialog.tsx`, `load-dialog.tsx`, `pull-dialog.tsx`, `push-conflict-dialog.tsx`, `import-dialog.tsx`, `add-project-dialog.tsx`, `new-store-dialog.tsx`.

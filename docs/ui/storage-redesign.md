# LayerFS: Storage redesign (spec)

> **Status:** Proposal, 2026-10-30. Nothing here is built yet. Once it is,
> this file replaces [layerfs-storage.md](layerfs-storage.md) and takes its
> name. The current page, its data (`host/storage.js`) and LayerFS #506
> (branch `issue506-store-backends-remote`) were read for this spec. Fields
> marked **E** need LayerFS. The rest the Connect host can make from what it
> already has.

Where projects' history lives. The page lists Stores in two families: SQLite
Stores on this machine with copies in buckets, and PostgreSQL Stores that live
in a database. Each Store shows its size, whether it is in sync with each copy,
and the progress of any transfer.
Opens from: the Storage tab on the LayerFS page.
Source (planned): `src/renderer/src/components/storage/storage-page.tsx` and the files in [§9](#9-file-plan).

## Contents

0. [What changes, complaint by complaint](#0-what-changes-complaint-by-complaint)
1. [Concept](#1-concept)
2. [The two families: SQLite and PostgreSQL](#2-the-two-families-sqlite-and-postgresql)
3. [Screens and dialogs](#3-screens-and-dialogs)
4. [Sync status model](#4-sync-status-model)
5. [Transfer progress model](#5-transfer-progress-model)
6. [Size](#6-size)
7. [Provider identity](#7-provider-identity)
8. [Data contract](#8-data-contract)
9. [File plan](#9-file-plan)
10. [States](#10-states)
11. [Tokens, accessibility and motion](#11-tokens-accessibility-and-motion)
12. [Open questions](#12-open-questions)

---

## 0. What changes, complaint by complaint

| # | Complaint | Answer in this spec |
|---|---|---|
| 1 | With many providers the page looks disorganized | The provider list on the left is gone. Stores are the rows, in two family bands. Copy locations are grouped by provider inside the SQLite band, listing only providers the user has added. Providers not available yet appear only in the Add location picker, marked "Coming" ([§1](#1-concept), [§3.7](#37-add-location-dialog)). |
| 2 | No real progress bar for push, pull and clone | Every job has named phases with bytes/total, rate, ETA and a phase stepper. It shows in a transfer tray, in its Store's row and on the Store's page ([§5](#5-transfer-progress-model)). |
| 3 | No size for each SQLite Store | Every Store row has a Size column (file + WAL), with totals per family and in the summary strip ([§6](#6-size)). |
| 4 | Nothing says if a Store is in sync with its copy | A three-way sync model (last transfer, local now, remote now) gives eight states. Each copy and each Store carries a pill with an icon and words ([§4](#4-sync-status-model)). |
| 5 | A Store linked to MinIO/R2 should show that mark | `StoreIcon` puts the provider mark as a badge on the SQLite mark. Two copies show two stacked badges; three or more show one badge and "+N" ([§7](#7-provider-identity)). |
| + | SQLite and PostgreSQL as two clear families | Two bands, each with its own header, mark, counts, totals, columns and actions. Import is the one bridge between them, shown at both ends ([§2](#2-the-two-families-sqlite-and-postgresql)). |

---

## 1. Concept

**Stores first, places second, and the two families kept apart.**

1. **The Store is the row.** It is the unit of storage, sync and writing:
   push, pull and import each move a whole Store. So the overview is one
   board of every Store, with size, copies, sync state and any running
   transfer shown inline. Users act on Stores, so Stores come first.
2. **Two families, two bands.** SQLite Stores (files on this machine, copied
   to buckets) and PostgreSQL Stores (schemas, live in a database, nothing
   to sync) differ in kind. Each gets its own band, header, columns and
   verbs. A table never mixes a "Copies" column that is meaningless for half
   its rows.
3. **Places belong to their family.** Buckets ("copy locations") sit at the
   foot of the SQLite band, grouped by provider. PostgreSQL connections are
   the group headers inside the PostgreSQL band. A place opens its own detail
   page. Nobody browses a list of providers they have not set up: the Add
   location picker is the only place that lists every provider, and it
   scales to any number.

Why not keep the left nav of choices? It made the user pick a *storage type*
before seeing their *data*. It gave every unconfigured provider the same
weight as a working one, which caused complaint 1. It also hid sync state
behind one click per Store. With a board, a five-second glance answers "what
needs pushing, what changed elsewhere, what is running, what does it cost".

Why not a sync matrix (Stores × buckets)? It reads well with three buckets
and breaks with twelve. Per-copy pills in the row hold the same facts without
a column per bucket, and the location page shows the matrix's other axis
(every Store copy in that bucket).

Navigation is two levels deep inside the Storage tab, with a breadcrumb and
no left nav:

```text
Storage (overview)
 |- a SQLite Store row ---------> SQLite Store page       Storage / SQLite / work
 |- a PostgreSQL Store row -----> PostgreSQL Store page   Storage / PostgreSQL / pg-local / work-pg
 |- a copy location row --------> Copy location page      Storage / Copy locations / r2-team
 |- a connection header --------> Connection page         Storage / PostgreSQL / pg-local
 '- "This machine" -------------> This machine page       Storage / This machine
Dialogs: Add location, New Store, Clone, Import, Pull, Push anyway, Remove
```

The page state is `{ view: 'overview' | 'store' | 'location' | 'connection' | 'machine', id?: string }`,
kept in the URL hash (`#storage/store/work`, `#storage/location/r2-team`,
`#storage/connection/pg-local`, `#storage/machine`), so `CONNECT_VIEW` and the
browser's back button work. Changing view cross-fades (`viewTransition`), and
the overview keeps its scroll position on the way back.

---

## 2. The two families: SQLite and PostgreSQL

### 2.1 What each family is

| | SQLite family | PostgreSQL family |
|---|---|---|
| Mark | `siSqlite` in a `Tile` | `siPostgresql` in a `Tile` |
| Band title | SQLITE STORES | POSTGRESQL STORES |
| One Store is | one `store.sqlite` file in its own Docker volume (`<prefix>store-<name>`) | one schema in a database, reached through a named connection |
| Where it lives | this machine (the Docker volumes; the LayerFS box opens it on macOS and Windows) | the database server of its connection |
| Places | copy locations: buckets at MinIO, Cloudflare R2, later S3, GCS, Google Drive, a folder | connections: `name`, host, database, `synchronous_commit` |
| Verbs | New Store, Add project, Push, Pull, Clone, Import into PostgreSQL, Remove | Add connection, Import (from a SQLite Store), Remove Store, Forget connection |
| Sync | per copy, eight states ([§4](#4-sync-status-model)) | none: a "Live" pill instead. Every Commit goes straight to the database |
| Size | file + WAL on disk | schema size in the database (tables, indexes, TOAST) |
| Health | the LayerFS box (worker) and free disk | connection reachable or not, server version, round trip |
| How a Store gets here | New Store, Init a project, Clone | Import from a SQLite Store only |
| Runs | projects, Workspaces in local Sandboxes | projects, Sandboxes, sessions and scenarios (also cloud Sandboxes later) |

### 2.2 How they sit together in the overview

- **Order:** the SQLite band comes first, because every home has one (the
  first Init makes a SQLite Store). The PostgreSQL band follows. A band with
  no Stores collapses to a one-line invitation ([§10](#10-states)), so a home
  with SQLite only does not show an empty PostgreSQL table.
- **Headers:** each band starts with a header row: the family mark (md tile),
  the uppercase title, then the counts and totals in plain words, then the
  band's place summary and actions on the right:
  - SQLite: `5 Stores · 1.1 GB on this machine` ··· `This machine: 111 GB free · ● box running` `[ + New Store ]`
  - PostgreSQL: `2 Stores in 2 connections · 312 MB in databases` ··· `[ + Add connection ]`
  
  A one-line description under the title says what the family is:
  - SQLite: "One file per Store, in its own Docker volume. Copies go to buckets: push, pull, clone."
  - PostgreSQL: "Live: each Store is a schema, and every Commit goes straight to the database. Nothing to sync."
- **Counts and totals:** the summary strip ([§3.1](#31-storage-overview)
  region 2) totals across both families, always split as `N SQLite · M
  PostgreSQL`. Bytes are never added across families into one number without
  that split: "1.4 GB" is shown with "1.1 GB here · 312 MB in PostgreSQL". A
  total with unknown members says so: "1.1 GB + 1 unknown".
- **Columns differ by family:**
  - SQLite: `Store · Projects · Size · Copies · Status · action`
  - PostgreSQL: `Store · Projects · Size · From · Created · action`, grouped under one header row per connection
- **The bridge (import):** a Store moves from SQLite to PostgreSQL only by
  import, which *copies*: the SQLite Store stays, and from then on the two are
  separate (Commits to one do not reach the other). The link shows at both
  ends:
  - On the PostgreSQL row, the From column reads `↳ from work`, a link to the SQLite Store, with the import's time as a tooltip.
  - On the SQLite Store's page, an "In PostgreSQL" section lists `work-pg on pg-local · 2 h ago` and has Import into PostgreSQL…
  - On the SQLite row, the `…` menu has "Import into PostgreSQL…". The row shows no import badge, because the Store's sync state is about its copies, not its imports.
  - There is no PostgreSQL → SQLite path today (a PostgreSQL Store has no remote copy, #506 "not in this phase"). The PostgreSQL Store page says so in one quiet line.
- **During an import**, the new PostgreSQL row appears at once, under its
  connection, in a pending state: name, "Importing 38%" and the phase bar. It
  is not openable until the job ends. The source SQLite row shows the same job
  in its Status cell ("Importing to pg-local").

### 2.3 How a project shows its family

- **Project cards** (`projects/home/project-card.tsx`, the Store well): the
  well's leading icon becomes `StoreIcon` (family mark, plus provider badges
  for SQLite). Its line reads by family:
  - SQLite: `work · 1.0 GB · ↑ Changes to push` (the sync pill in its compact form), or `work · 1.0 GB · Local only`.
  - PostgreSQL: `work-pg on pg-local · 296 MB · Live`.
  
  The Store name is shown only when the Store is shared (the card title is
  already `name · store`). Otherwise the line starts with the family word
  ("SQLite", "PostgreSQL") as today.
- **Project page, Storage tab** ([project-storage.md](project-storage.md)):
  the StoreCard title becomes "<family> Store <name>" with `StoreIcon`, and,
  for SQLite, the Store's sync pill. This is a header change only; the rest of
  that tab is out of scope.
- **New project dialog** ([dialog-new-project.md](dialog-new-project.md)):
  the Store select shows `StoreIcon`, the size and the sync pill per Store, so
  the user sees that adding a project to `team` means it travels with `team`'s
  pushes. PostgreSQL Stores stay unlisted, as today.

---

## 3. Screens and dialogs

Widths in the skeletons are for a 1440 px window with the sidebar open. The
page body is `max-w-6xl`, centered. Narrow layouts are in [§10](#10-states).
Region numbers restart for each screen.

### 3.1 Storage overview

```text
+-[1] PageHeader --------------------------------------------------------------------------------+
| LayerFS                                                   [ Add location v ] [ + New Store v ] |
| Where projects' history lives: SQLite Stores on this machine, copied to buckets, and           |
| PostgreSQL Stores that live in a database.                                                     |
|  Projects   Storage   Compute                                                                  |
|             =======                                                                            |
+------------------------------------------------------------------------------------------------+
+-[2] SummaryStrip ------------------------------------------------------------------------------+
| STORES                  | SIZE                     | SYNC                     | TRANSFERS      |
| 7                       | 1.4 GB                   | 3 of 5 in sync           | 1 running      |
| 5 SQLite - 2 PostgreSQL | 1.1 GB here - 312 MB pg  | 1 to push - 1 newer      | work 41%       |
+------------------------------------------------------------------------------------------------+
+-[3] TransferTray ------------------------------------------------------------------- [ Hide ] -+
| ^  work  ->  [R2] r2-team           Upload   [=============----------------]  412 MB / 1.0 GB  |
|    Check v - Snapshot v - Upload * - Finish                      12.4 MB/s - about 47 s left   |
| v  team  <-  [M] minio-a            Pulled   v 248 MB in 21 s                       5 min ago x |
+------------------------------------------------------------------------------------------------+
+-[4] Toolbar -----------------------------------------------------------------------------------+
| [ / Search Stores and projects          ]       ( All 7 | Needs attention 2 )   [ Check now ] |
+------------------------------------------------------------------------------------------------+
+-[5] SqliteBand --------------------------------------------------------------------------------+
| [sq] SQLITE STORES  5 Stores - 1.1 GB on this machine     This machine: 111 GB free  * box  > |
|      One file per Store, in its own Docker volume. Copies go to buckets: push, pull, clone.    |
| ---------------------------------------------------------------------------------------------- |
| STORE              PROJECTS  SIZE      COPIES                          STATUS                   |
| [sq|R2] work       3         1.0 GB    [R2] r2-team ^                  ^ Changes to push [Push] |
| [sq|M ] team       2         248 MB    [M] minio-a v                   v Remote newer [Pull...] |
| [sq|M+] scratch    1         12.1 MB   [M] minio-a = [R2] r2-team !    ! Both changed   [...]   |
| [sq   ] playground 1         78.6 MB   -                               - Local only  [Copy...] |
| [sq|R2] heavy      1         265 MB    [R2] r2-team =                  = In sync         [...]  |
| ---------------------------------------------------------------------------------------------- |
| +-[6] CopyLocations ------------------------------------------------------------------------+ |
| | COPY LOCATIONS  3 buckets at 2 providers - 1.5 GB of copies          [ + Add location ]  | |
| | [R2] Cloudflare R2   1 bucket                                                           | |
| |      r2-team    3f2a...e1/layerfs-prod/lfc        3 copies - 1.3 GB    * reachable    >  | |
| | [M ] MinIO           2 buckets                                                          | |
| |      minio-a    localhost:9000/layerfs/lfc        2 copies - 260 MB    * reachable    >  | |
| |      minio-b    minio.lab:9000/backups/home2      no copies yet        ! no keys      >  | |
| +------------------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------------------+
+-[7] PostgresqlBand ----------------------------------------------------------------------------+
| [pg] POSTGRESQL STORES  2 Stores in 2 connections - 312 MB in databases  [ + Add connection ] |
|      Live: each Store is a schema, and every Commit goes straight to the database.            |
| ---------------------------------------------------------------------------------------------- |
| [pg] pg-local  * reachable - PostgreSQL 17.2 - localhost:5432/layerfs - sync_commit off     > |
|      STORE            PROJECTS  SIZE          FROM                  CREATED                    |
|      work-pg          3         296 MB        <- from work          2 h ago            [...]   |
| [pg] pg-cloud  x unreachable - db.example.com:5432/lfs - checked 1 min ago                  > |
|      prod             1         size unknown  <- from team          yesterday          [...]   |
+------------------------------------------------------------------------------------------------+
```

Legend: `[sq|R2]` is the SQLite mark with an R2 badge, and `[sq|M+]` a MinIO
badge with a second one behind it ([§7](#7-provider-identity)). The pill icons
are `^` Changes to push, `v` Remote newer, `!` Both changed, `=` In sync and
`-` Local only ([§4](#4-sync-status-model)).

#### Regions

1. **Page header** (`PageHeader` in `StoragePage`, `storage/storage-page.tsx`): "LayerFS", the description and `LayerFSTabs`. `live` is set while any transfer runs, which draws the header's line of brand light.
   - **Add location ▾** is a split button. The main part opens the Add location dialog on its picker ([§3.7](#37-add-location-dialog)). The menu has "Copy location (bucket)…" and "PostgreSQL connection…", which open the picker already filtered to that family.
   - **+ New Store ▾**: the main part opens `NewStoreDialog` (an empty SQLite Store). The menu has "Clone from a copy location…" ([§3.8](#38-clone-dialog)) and "Import into PostgreSQL…" ([§3.9](#39-import-dialog)).
   - Without layerfs#506 both buttons are disabled inside `Unavailable`, with the host's `reason`.
2. **Summary strip** (`SummaryStrip`, `storage/overview/summary-strip.tsx`): four cells in one `surface` row, with numbers that count up (`CountUp`, `CountBytes`).
   - **Stores**: the total, with "N SQLite · M PostgreSQL".
   - **Size**: the total of known sizes, with "X here · Y in PostgreSQL" ("+ N unknown" when some are unknown).
   - **Sync**: "A of B in sync", where B counts SQLite Stores that have at least one copy. The note gives the non-zero counts that need action: "1 to push · 1 newer · 1 both changed". Each count is a button that sets the toolbar filter to Needs attention and scrolls to the SQLite band. With no copies anywhere it reads "No copies yet" and "Add a location to keep one".
   - **Transfers**: "N running" with the first job's "store pct%", or "None running" with the last ended job ("last: pushed work 5 min ago"). Clicking it opens the tray if it is hidden.
3. **Transfer tray** (`TransferTray`, `storage/transfers/transfer-tray.tsx`): shown while any job runs, or ended less than 10 minutes ago (the host's `KEEP_ENDED_MS`). One `TransferRow` per job ([§5.3](#53-how-a-job-shows)), running jobs first, then ended ones newest first. Hide collapses it to the strip's Transfers cell. An ended row has a dismiss `x`, which hides it in this window only. A failed or refused job stays until dismissed and shows its refusal card ([§5.5](#55-refusals-and-failures)).
4. **Toolbar** (`Toolbar`, `storage/overview/toolbar.tsx`):
   - A search box filters both bands by Store name and project name. A match on a project shows "has <project>" under the Store's name. `/` focuses the box, and Esc clears it.
   - A `Segmented` switch: All (count) and Needs attention (count of SQLite Stores whose state is `ahead`, `behind`, `diverged` or `missing`, plus Stores with a failed job, plus PostgreSQL Stores on an unreachable connection).
   - **Check now** re-reads every copy's remote state and every connection's status (`POST /api/storage/check`, [§8.4](#84-routes-events-and-polling)). It shows a spinner while checks run and is disabled for 10 s after. Its tooltip says when the last check ran: "Checked 2 min ago".
5. **SQLite band** (`SqliteBand`, `storage/overview/sqlite-band.tsx`): the band header ([§2.2](#22-how-they-sit-together-in-the-overview)), then a `Table` of SQLite Stores sorted by name. Store, Size and Status headers sort on click: Status sorts by severity ([§4.4](#44-states)).
   - **Header right**: "This machine: <free> free" (the lower of `disk.home` and `disk.volumes`, warning tone under 20 GB) and the worker dot with its label (`workerChip`). The whole group is a link to the This machine page ([§3.6](#36-this-machine)).
   - **Store** cell: `StoreIcon` (sm) and the name (a button that opens the Store page). A legacy Store (a project's own pre-#506 Store) shows a faint "own Store" after the name, with a tooltip.
   - **Projects** cell: the count. Hovering it shows the first 8 names.
   - **Size** cell: `SizeText` ([§6](#6-size)), right-aligned, tabular.
   - **Copies** cell: up to two `CopyPill`s (provider mark, remote name, state icon), then "+N", which opens a popover listing all copies. A Store with none shows "—".
   - **Status** cell: the Store's aggregate `SyncPill` ([§4.5](#45-a-stores-aggregate)), then one contextual button: "Push" for `ahead` (to the copy that is ahead, or to the linked remote when several are), "Pull…" for `behind`, "Copy to…" for Local only (opens a location menu, then pushes), and nothing extra for the other states. A `…` menu always follows, with Push to ▸, Pull from ▸, Check now, Clone into a new Store…, Import into PostgreSQL…, Open and Remove….
   - **While a job runs** on the Store, the Status cell shows the job's compact form instead ("Uploading 41%" with a 2 px bar beneath), the row gets the `sc-live-row` edge, and the contextual button and push/pull items are disabled ("A transfer is running").
   - The whole row is hover-lit, but only the name button and the action buttons are focusable, so the keyboard order stays short ([§11](#11-tokens-accessibility-and-motion)).
6. **Copy locations** (`CopyLocations`, `storage/overview/copy-locations.tsx`), the last block of the SQLite band:
   - A header: "COPY LOCATIONS", "N buckets at M providers · <bytes> of copies", and "+ Add location" (the picker, filtered to copy locations).
   - One group per provider *that has locations*, ordered by number of locations (most first), then by label. The group header is the provider mark (sm) and label, with "N buckets".
   - Under it, one row per bucket, sorted by name: the remote name (mono), the location line (`location`: host/bucket/prefix, truncated in the middle), "N copies · bytes" (or "no copies yet"), the `HealthDot` with words, and a chevron. The row opens the Copy location page ([§3.4](#34-copy-location-page)).
   - **Scale:** a group with more than 4 buckets shows 4 and "Show all 9". With more than 8 buckets in all, every group starts collapsed to its header line plus a health summary ("9 buckets · 1 unreachable"). Expanded state is kept per provider in `localStorage`.
   - A bucket with a job running shows a small spinner before its health dot.
7. **PostgreSQL band** (`PostgresqlBand`, `storage/overview/postgresql-band.tsx`): the band header, then one group per connection, sorted by name.
   - **Connection header row**: the PostgreSQL mark (sm), the name (mono, a button to the Connection page), the `HealthDot` with words ("reachable", "unreachable", "checking…", "status unknown"), the server version when known ("PostgreSQL 17.2"), `host:port/database`, and the `synchronous_commit` value as a neutral chip. When unreachable it shows "checked 1 min ago" instead of the version.
   - **Store rows** under it (indented): `StoreIcon` (the pg mark, no badge), name, Projects, Size (the schema size, or "size unknown"), From ("↳ from <sqlite store>", a link to it; "—" when not recorded) and Created (`ago`, `when` as tooltip). The Status cell holds the "Live" pill. The `…` menu has Open and Remove….
   - A connection with no Stores shows one muted row: "No Stores yet. Import a SQLite Store into it." with "Import…".
   - An import in progress shows a pending row ([§2.2](#22-how-they-sit-together-in-the-overview)).

#### States

See [§10](#10-states) for the shared states. Specific to the overview:
- **Filter with no match**: each band shows "No Stores match", and the toolbar has "Clear".
- **Needs attention with none**: "Nothing needs attention. Every copy is in sync or being checked."

### 3.2 SQLite Store page

```text
+-[1] Breadcrumb ---------------------------------------------------------------------------------+
| < Storage  /  SQLite  /  work                                                                   |
+-------------------------------------------------------------------------------------------------+
+-[2] StoreHeader --------------------------------------------------------------------------------+
| [sq|R2]  STORE - SQLITE                                                                         |
|  (lg)    work   ^ Changes to push                       [ ^ Push to r2-team ]  [ Pull... ] [...] |
|          3 projects - 1.0 GB on this machine - volume lfc-store-work - created Oct 27            |
+-------------------------------------------------------------------------------------------------+
+-[3] JobCard (a job on this Store: running, just ended, or refused) -----------------------------+
| ! Push refused: the copy in r2-team changed since this machine last pushed or pulled.          |
|   Pull it first to keep its changes, or push anyway to replace it.  [ Pull first... ] [ Push anyway... ] |
+-------------------------------------------------------------------------------------------------+
+-[4] Copies -------------------------------------------------------------------------------------+
| Copies   Whole-file copies of this Store. Push uploads all 3 projects; pull replaces them.     |
|                                                                                [ Check now ]   |
| ----------------------------------------------------------------------------------------------- |
| [R2] r2-team   Cloudflare R2 - 3f2a...e1/layerfs-prod/lfc/work/store.sqlite                     |
|      ^ Changes to push                                                 [ Push ]  [ Pull... ]   |
|      +-THIS MACHINE---------------------+         +-R2-TEAM---------------------------+         |
|      | Changed since your push 3 h ago  | ------> | Same as your push 3 h ago         |         |
|      | 1.0 GB now                       |         | 980 MB - checked 1 min ago        |         |
|      +----------------------------------+         +-----------------------------------+         |
|      Pushed 3 h ago - 980 MB      Pulled never                                               |
| ----------------------------------------------------------------------------------------------- |
| [M ] minio-a   MinIO - localhost:9000/layerfs/lfc/work/store.sqlite                            |
|      = In sync                                                         [ Push ]  [ Pull... ]   |
|      Pushed 2 days ago - 940 MB   Pulled yesterday - 940 MB   Checked 1 min ago                 |
| ----------------------------------------------------------------------------------------------- |
| [ + Copy to another location v ]                                                               |
+-------------------------------------------------------------------------------------------------+
+-[5] Projects -----------------------------------------------------------------------------------+
| Projects  3                                                               [ + Add project ]    |
| /\ shop     /\ api     /\ docs                                                                  |
+-------------------------------------------------------------------------------------------------+
+-[6] SizeCard -----------------------------------------------------------------------------------+
| Size on this machine  1.0 GB             store.sqlite 988 MB - WAL 12.4 MB                      |
| Free in the Docker volumes  111 GB       [======|============================]  push needs ~1.0 GB |
+-------------------------------------------------------------------------------------------------+
+-[7] InPostgresql -------------------------------------------------------------------------------+
| In PostgreSQL   Copies made by import. They don't sync with this Store.                        |
| [pg] work-pg  on pg-local - 296 MB - imported 2 h ago                 [ Import into PostgreSQL... ] |
+-------------------------------------------------------------------------------------------------+
+-[8] Facts and remove ---------------------------------------------------------------------------+
| VOLUME lfc-store-work    FILE .../global/store.sqlite    CREATED Oct 27, 08:01    [ Remove... ] |
+-------------------------------------------------------------------------------------------------+
```

#### Regions

1. **Breadcrumb** (`Breadcrumb`, `storage/detail/breadcrumb.tsx`): "Storage" (back to the overview at its scroll position), the family, then the Store. `Alt+←` and the mouse back button go back.
2. **Header** (`SqliteStoreDetail`, `storage/detail/sqlite-store-detail.tsx`): `StoreIcon` (lg) with a brand glow, "STORE · SQLITE", the name, the aggregate `SyncPill`, and one line of facts: projects, `SizeText`, volume, created.
   - The primary button follows the state: "Push to <remote>" for `ahead`, "Pull from <remote>…" for `behind`, "Copy to…" for Local only, and "Push" in outline for `in_sync` (no-op pushes are allowed, but the button does not invite them).
   - With several copies, the primary acts on the copy with the most urgent state, and the copy's name is in the label.
   - `…` has Clone into a new Store…, Import into PostgreSQL…, Check now and Remove….
3. **Job card** (`JobCard`, `storage/transfers/job-card.tsx`): the running or last job on this Store, in its full form ([§5.3](#53-how-a-job-shows)), or its refusal card ([§5.5](#55-refusals-and-failures)). It is absent when there is none.
4. **Copies** (`CopiesSection`, `storage/detail/copies-section.tsx`): one `CopyCard` per copy, ordered with the linked remote (`store.remote`) first, then by the last transfer, newest first.
   - The card head: provider mark, remote name, provider label, and the full object path `<location>/<store>/store.sqlite` (mono, middle-truncated, copyable on click).
   - The copy's `SyncPill` and its Push and Pull… buttons.
   - **The two-sided panel** is shown for every state except `in_sync` and `unknown`. Left is THIS MACHINE ("Changed since your push 3 h ago" or "Unchanged since your pull yesterday", and the size now). Right is the remote ("Same as your push 3 h ago", "Changed since: 1.1 GB, modified 20 min ago" or "Missing: no copy at this path"). An arrow between them shows which way a transfer would go: → for push, ← for pull, ⇄ crossed for both changed. The panel is all text, so colour is never the only signal.
   - A history line: Pushed <ago> · bytes, Pulled <ago> · bytes, Checked <ago>.
   - **"+ Copy to another location ▾"** lists, grouped by provider, every remote with no copy of this Store, plus "Add location…". Choosing one starts a push to it (a first push expects no copy there; if one exists, it is refused with `Conflict`, see [§5.5](#55-refusals-and-failures)).
   - Without remotes in the build, the section shows `view.remotes.reason`. With remotes but none added, it shows "No copy locations yet" and "+ Add location".
5. **Projects** (`ProjectsSection`): a wrapping list of project chips (LayerFS mark and name) that open the project page, and "+ Add project" (`AddProjectDialog`, moved unchanged to `storage/dialogs/add-project-dialog.tsx`). With none: "No projects yet. Add one: empty, or a copy of a folder."
6. **Size card** (`SizeCard`, `storage/detail/size-card.tsx`): the Store's bytes with the split (store.sqlite, WAL). Then free space in the Docker volumes (`disk.volumes`) as a `Bar`, with "push needs ~<file + wal>" and a marker at that point. When free space is under the needed amount plus 20 GB, the push buttons get a warning tooltip, and the card shows a warning `Notice`: "A push stages a copy beside the Store. Free about X first." The push is still allowed: LayerFS refuses with `Capacity` if it must.
7. **In PostgreSQL** (`InPostgresqlSection`): the PostgreSQL Stores whose `importedFrom.store` is this Store, each a link (pg mark, name, connection, size, `ago`), and "Import into PostgreSQL…" ([§3.9](#39-import-dialog), with the source fixed). Hidden when the build has no PostgreSQL; with no connection added, it shows "Add a PostgreSQL connection to import this Store."
8. **Facts and remove**: Volume, File (the Store file path), Created, and "Remove…" (destructive outline, [§3.12](#312-remove-dialog)).

#### States

- **Open in a Sandbox or Workspace** (`open: true`): Pull… stays enabled, with an info tooltip: "work is open. Pull is refused until every Sandbox and Workspace lets go; the LayerFS box lets go a minute after its last use."
- **No projects**: Push is disabled ("Nothing to push yet"), as today.
- **Store not found** (removed elsewhere): "work is gone. It was removed or renamed." with "Back to Storage".

### 3.3 PostgreSQL Store page

```text
+-[1] Breadcrumb ---------------------------------------------------------------------------------+
| < Storage  /  PostgreSQL  /  pg-local  /  work-pg                                               |
+-------------------------------------------------------------------------------------------------+
+-[2] StoreHeader --------------------------------------------------------------------------------+
| [pg]  STORE - POSTGRESQL                                                                        |
| (lg)  work-pg   * Live                                                              [ ... ]     |
|       3 projects - 296 MB in pg-local - schema lfc_work_pg                                      |
+-------------------------------------------------------------------------------------------------+
+-[3] Facts --------------------------------------------------------------------------------------+
| CONNECTION                 SCHEMA          SYNCHRONOUS_COMMIT   SIZE IN DATABASE   CREATED       |
| pg-local  * reachable      lfc_work_pg     off                  296 MB             Oct 30 14:02  |
| PostgreSQL 17.2 - 3 ms                                          checked 40 s ago                 |
| ----------------------------------------------------------------------------------------------- |
| <- Imported from [sq] work (SQLite) on Oct 30, 14:02 - 980 MB                                   |
+-------------------------------------------------------------------------------------------------+
+-[4] Projects -----------------------------------------------------------------------------------+
| Projects  3                                                                                     |
| /\ shop     /\ api     /\ docs                                                                  |
+-------------------------------------------------------------------------------------------------+
+-[5] Nothing to sync (quiet card) ---------------------------------------------------------------+
| This Store lives in the database: every Commit goes straight there. It has no copies to push   |
| or pull. To make a file copy, keep using the SQLite Store it came from.                        |
+-------------------------------------------------------------------------------------------------+
+-[6] Remove -------------------------------------------------------------------------------------+
|                                                                                 [ Remove... ]  |
+-------------------------------------------------------------------------------------------------+
```

#### Regions

1. **Breadcrumb**: Storage / PostgreSQL / the connection (a link to its page) / the Store.
2. **Header** (`PostgresqlStoreDetail`, `storage/detail/postgresql-store-detail.tsx`): pg mark (lg), "STORE · POSTGRESQL", the name, the "Live" pill (success tone, `Radio` icon), and facts: projects, schema size "in <connection>", schema. The `…` menu has Remove….
3. **Facts**: Connection (a link, with the `HealthDot` and words, and the server version and round trip when known), Schema, `synchronous_commit` (from the Store, else the connection), Size in database (with "checked <ago>"), Created.
   - **Imported from**: the source SQLite Store (`StoreIcon`, a link, or plain text "work (removed)" when it no longer exists), the import time and the bytes read. When not recorded (an import made by an older build, or outside Connect): "Origin not recorded".
4. **Projects**: as on the SQLite page, without Add project. PostgreSQL Stores get projects only by import, as today.
5. **Nothing to sync**: a `sc-soon`-style quiet card, so nobody looks for missing Push buttons.
6. **Remove**: the remove dialog ([§3.12](#312-remove-dialog)). Removing drops the Store's registration and schema (runtime `store.remove`) and needs the connection to be reachable.

#### States

- **Connection unreachable**: a warning `Notice`, "pg-local is not answering: <message>. Projects in this Store can't be opened until it is." with "Check again". Size reads "size unknown". Projects still list (from the home's `stores.json`).
- **Connection forgotten** (Connect has no URL for it): a danger `Notice`, "Connect has no URL for pg-local. Add the connection again with the same name to open this Store."

### 3.4 Copy location page

```text
+-[1] Breadcrumb ---------------------------------------------------------------------------------+
| < Storage  /  Copy locations  /  r2-team                                                        |
+-------------------------------------------------------------------------------------------------+
+-[2] LocationHeader -----------------------------------------------------------------------------+
| [R2]  COPY LOCATION - CLOUDFLARE R2                                                             |
| (lg)  r2-team   * reachable   Keys saved   EU                     [ Clone a Store... ]  [ ... ] |
|       https://3f2a...e1.eu.r2.cloudflarestorage.com / layerfs-prod / lfc                        |
|       3 copies - 1.3 GB - checked 1 min ago                                                     |
+-------------------------------------------------------------------------------------------------+
+-[3] CopiesHere ---------------------------------------------------------------------------------+
| Store copies here                                                              [ Check now ]   |
| COPY          SIZE      LAST PUSH (THIS MACHINE)    ON THIS MACHINE             STATUS          |
| work          980 MB    3 h ago                     [sq|R2] work                ^ Changes to push [Push] |
| heavy         265 MB    yesterday                   [sq|R2] heavy               = In sync        |
| scratch       12.0 MB   4 days ago                  [sq|M+] scratch             ! Both changed   |
| team-old      1.9 GB    -                           not on this machine         [ Clone... ]    |
| ----------------------------------------------------------------------------------------------- |
| Copies pushed by other machines show here once this LayerFS build can list a bucket.           |
+-------------------------------------------------------------------------------------------------+
+-[4] Settings -----------------------------------------------------------------------------------+
| Name r2-team   Provider Cloudflare R2   Account 3f2a...e1   Jurisdiction EU                     |
| Bucket layerfs-prod   Prefix lfc   Keys saved in Connect (your user only)        [ Remove... ]  |
+-------------------------------------------------------------------------------------------------+
```

#### Regions

1. **Breadcrumb**: Storage / Copy locations / the remote.
2. **Header** (`LocationDetail`, `storage/detail/location-detail.tsx`): provider mark (lg), "COPY LOCATION · <PROVIDER>", the name, `HealthDot` with words, a keys chip ("Keys saved", or warning "No keys in Connect"), the jurisdiction chip (R2), then the endpoint / bucket / prefix (and, for MinIO, "The LayerFS box reaches it as <reachAs>" when that differs). Then "N copies · bytes · checked <ago>".
   - "Clone a Store…" opens the Clone dialog with this location fixed.
   - `…` has Check now and Remove….
3. **Store copies here** (`CopiesHereTable`): the other axis of the sync board. Rows:
   - every local SQLite Store with a copy record for this remote: the copy name, its remote size (`check.bytes`, else the last transfer's bytes), the last push from this machine, the local Store (`StoreIcon` and link) and the copy's `SyncPill` with its contextual action;
   - with remote listing (E9, optional), every other `<prefix>/<name>/store.sqlite` in the bucket, as "not on this machine" with "Clone…".
   
   Without E9, the footnote above is shown, and Clone… takes a typed name.
4. **Settings**: what LayerFS and Connect keep for this remote, read-only. A remote cannot be edited (runtime has add and remove only): to change it, remove and add again. "Remove…" says the copies in the bucket stay and Connect deletes the keys ([§3.12](#312-remove-dialog)).

#### States

- **No keys in Connect**: a warning `Notice`, "Connect has no keys for r2-team, so it can't check, push or pull. Remove it and add it again with keys." Every copy on it reads `unknown` with that reason.
- **Unreachable**: a warning `Notice` with the last check's message and "Check again". Copies keep their last known state, marked "as of <ago>" ([§4.6](#46-staleness-and-unreachable)).

### 3.5 PostgreSQL connection page

```text
+-[1] Breadcrumb ---------------------------------------------------------------------------------+
| < Storage  /  PostgreSQL  /  pg-local                                                           |
+-------------------------------------------------------------------------------------------------+
+-[2] ConnectionHeader ---------------------------------------------------------------------------+
| [pg]  POSTGRESQL CONNECTION                                                                     |
| (lg)  pg-local   * reachable   PostgreSQL 17.2   3 ms          [ Import a SQLite Store... ] [...] |
|       postgresql://layerfs:***@localhost:5432/layerfs                                           |
|       2 Stores - 412 MB - synchronous_commit off - checked 40 s ago                             |
+-------------------------------------------------------------------------------------------------+
+-[3] StoresHere ---------------------------------------------------------------------------------+
| STORE        SCHEMA          PROJECTS  SIZE      FROM            CREATED                        |
| work-pg      lfc_work_pg     3         296 MB    <- from work    2 h ago                        |
| lab          lfc_lab         1         116 MB    <- from lab     3 days ago                     |
+-------------------------------------------------------------------------------------------------+
+-[4] Settings -----------------------------------------------------------------------------------+
| synchronous_commit  off - fastest; a server crash can lose the last moments of Commits         |
| The URL, password included, stays in Connect (your user only). On macOS the LayerFS box        |
| reaches this machine's localhost as host.docker.internal.                     [ Forget... ]     |
+-------------------------------------------------------------------------------------------------+
```

#### Regions

1. **Breadcrumb**: Storage / PostgreSQL / the connection.
2. **Header** (`ConnectionDetail`, `storage/detail/connection-detail.tsx`): pg mark, "POSTGRESQL CONNECTION", the name, `HealthDot` with words, the server version and round trip when known, the redacted URL, then "N Stores · bytes · synchronous_commit <value> · checked <ago>". "Import a SQLite Store…" opens the Import dialog with this connection fixed. `…` has Check now and Forget….
3. **Stores here**: the connection's Stores with schema, projects, schema size, From and Created. Rows open the Store page.
4. **Settings**: `synchronous_commit` and its meaning (the existing `SYNC` table). It is not editable in v1 (the host stores it per connection; changing it is a later item). Then the note on where the URL lives, and "Forget…" ([§3.12](#312-remove-dialog)): "Its Stores stay in the database. Connect forgets the URL and can't open them until you add it again."

#### States

- **Unreachable**: as on the PostgreSQL Store page, plus "Its N Stores can't be opened."
- **Denied** (wrong password, no permission): a danger `Notice` with the server's message. Forget and add again to change the URL.

### 3.6 This machine

```text
+-[1] Breadcrumb ---------------------------------------------------------------------------------+
| < Storage  /  This machine                                                                      |
+-------------------------------------------------------------------------------------------------+
+-[2] MachineHeader ------------------------------------------------------------------------------+
| [sq]  WHERE SQLITE STORES LIVE                                                                  |
|       This machine   * Worker running                                                           |
|       5 Stores - 1.1 GB - /Users/yifanxu/.layerfs-connect/home                                  |
+-------------------------------------------------------------------------------------------------+
+-[3] Disk --------------------------------------------------------------------------------------+
| Disk  free space where the Stores are written                                                  |
| Beside the home             For Docker volumes                                                  |
| 345 GB                      111 GB                                                              |
| [=====|==================]  [=====|==================]                                          |
+-------------------------------------------------------------------------------------------------+
+-[4] WorkerSection -----------------------------------------------------------------------------+
| LayerFS box  * Worker running   Container lfc-worker   State running   Build build-linux-36b... |
+-------------------------------------------------------------------------------------------------+
+-[5] Facts --------------------------------------------------------------------------------------+
| VOLUME PREFIX lfc-     STORE VOLUMES 5                                                          |
+-------------------------------------------------------------------------------------------------+
```

This is the old Local SQLite detail without the projects table, since
projects are on the Projects tab and on each Store page. `DiskGauge`, `Stat`
and `WorkerSection` are reused. `WorkerSection` and `workerChip` move to
`storage/machine/worker.tsx` (Compute's `docker-card.tsx` imports
`workerChip`; update that import). On Linux the worker section reads "Store
access: in process", as today.

### 3.7 Add location dialog

One dialog, two steps. It replaces `AddRemoteDialog` and the inline Add a
connection form.

**Step 1: the provider picker**

```text
+-[1] DialogHeader ------------------------------------------------------------+
| Add a location                                                             x |
| Where SQLite Stores keep copies, or where PostgreSQL Stores live.            |
+------------------------------------------------------------------------------+
+-[2] Search ------------------------------------------------------------------+
| [ / Search providers                                                       ] |
+------------------------------------------------------------------------------+
+-[3] CopyProviders -----------------------------------------------------------+
| COPY LOCATIONS   For SQLite Stores: push, pull and clone whole Store files   |
| +----------------+ +----------------+ +----------------+ +----------------+  |
| | [M] MinIO      | | [R2] Cloudflare| | [aws] Amazon S3| | [gcs] Google   |  |
| |  2 added       | |  R2  1 added   | |  Coming        | |  Cloud Storage |  |
| |                | |                | |                | |  Coming        |  |
| +----------------+ +----------------+ +----------------+ +----------------+  |
| +----------------+ +----------------+                                        |
| | [gd] Google    | | [f] Folder     |                                        |
| |  Drive  Coming | |  Coming        |                                        |
| +----------------+ +----------------+                                        |
+------------------------------------------------------------------------------+
+-[4] DatabaseProviders -------------------------------------------------------+
| LIVE DATABASES   For PostgreSQL Stores: live, nothing to sync                |
| +----------------+                                                           |
| | [pg] PostgreSQL|                                                           |
| |  1 added       |                                                           |
| +----------------+                                                           |
+------------------------------------------------------------------------------+
|                                                                 [ Cancel ]   |
+------------------------------------------------------------------------------+
```

**Step 2: the provider's form** (Cloudflare R2 shown)

```text
+-[5] DialogHeader ------------------------------------------------------------+
| < Back   [R2] Add a Cloudflare R2 location                                 x |
| A bucket that keeps whole-file copies of your SQLite Stores.                 |
+------------------------------------------------------------------------------+
+-[6] ProviderForm (fields from the provider registry) ------------------------+
| Name        [ r2                ]   Account ID  [ from the R2 overview page ] |
| Jurisdiction [ None v ]   https://<account>.r2.cloudflarestorage.com          |
| Bucket      [ your bucket's name ]   Prefix     [ layerfs           ]         |
| Each Store's copy is layerfs/<store>/store.sqlite.                            |
| Access key  [                    ]   Secret key [ ********          ]         |
| The keys stay in Connect, readable by your user only.                         |
+------------------------------------------------------------------------------+
+-[7] AfterAdd (once added) ---------------------------------------------------+
| (o) Checking r2 ...   ->   * Reachable. Ready for a push.                    |
+------------------------------------------------------------------------------+
|                                     Still needed: bucket, keys.             |
|                                               [ Cancel ]  [ Add location ]   |
+------------------------------------------------------------------------------+
```

#### Regions

1. **Header** (`AddLocationDialog`, `storage/dialogs/add-location-dialog.tsx`): "Add a location" and one line.
2. **Search**: filters the provider tiles by label and aliases (`s3` matches Amazon S3, MinIO and R2, since all speak the S3 API). Shown when there are more than 8 providers in the registry. The Header's Add location ▾ menu can open the dialog filtered to one family.
3. **Copy providers** (`ProviderTile` grid, 4 per row at `sm:max-w-[640px]`): one tile per provider in the registry ([§7.3](#73-provider-registry)) with family `copy`. It shows the mark (md), the label, and "N added" when the user has some.
   - **Available** providers (in `view.providers` with `available: true`) are buttons.
   - **Coming** providers are `sc-soon` tiles (greyed mark, "Coming", the reason as tooltip). They are focusable but do nothing.
   - Order: available first (most-used first), then coming, alphabetically.
4. **Database providers**: PostgreSQL (one tile today), with "N added". It goes to the connection form (name, URL, `synchronous_commit`, from today's `AddConnection`).
5. **Step 2 header**: "< Back" returns to the picker with the search kept. Then the mark and "Add a <Provider> location" (or "Add a PostgreSQL connection").
6. **Provider form** (`ProviderForm`, `storage/dialogs/provider-forms.tsx`): its fields come from the provider's registry entry (`fields`), so a new provider is a registry entry and a host validator, not a new dialog. The MinIO and R2 fields, checks and hints are today's (`add-remote-dialog.tsx`), unchanged in wording. PostgreSQL's are today's `AddConnection`.
7. **After add**: the dialog stays open on one status line while the host runs the first check (`POST /api/storage/check { remote }`, or `{ connection }`).
   - Reachable: "Reachable. Ready for a push." (or "Reachable. PostgreSQL 17.2.") and the button turns into "Done".
   - Unreachable or denied: "Added, but not reachable: <message>", with "Keep it" (closes) and "Remove it" (removes it, back to the form with the fields kept and the secret cleared).
   - With a build without E3, this step is skipped and the dialog closes, as today.

#### States

- **Adding**: every field is disabled, the button reads "Adding…", and the dialog cannot close.
- **Refused** (name taken, invalid input): the host's message under the form, as today.

### 3.8 Clone dialog

```text
+-[1] DialogHeader ------------------------------------------------------------+
| Clone a Store                                                              x |
| A new SQLite Store on this machine from a copy, with all of its projects.    |
+------------------------------------------------------------------------------+
+-[2] From --------------------------------------------------------------------+
| Location  [ [R2] r2-team          Cloudflare R2 - 3 copies               v ] |
| Copy      [ team-old        1.9 GB - modified 2 days ago                 v ] |
|           or type a Store name the location holds                            |
+------------------------------------------------------------------------------+
+-[3] Into --------------------------------------------------------------------+
| New Store [ team-old                     ]                                   |
| Needs 1.9 GB in the Docker volumes; 111 GB free.                             |
+------------------------------------------------------------------------------+
+-[4] Progress (once started) -------------------------------------------------+
| v Download  [===========--------------]  820 MB / 1.9 GB  31 MB/s  ~35 s     |
|   Download * - Verify - Install - Finish                                     |
+------------------------------------------------------------------------------+
|                         [ Run in background ]  [ Cancel ]  [ Clone ]         |
+------------------------------------------------------------------------------+
```

#### Regions

1. **Header** (`CloneDialog`, `storage/dialogs/clone-dialog.tsx`).
2. **From**:
   - **Location**: a select of copy locations grouped by provider (mark, name, provider, copy count). It is fixed when the dialog opens from a location page.
   - **Copy**: with E9, a select of the location's copies (name, size, modified), with ones already on this machine marked "on this machine as <store>". Without E9, a text field ("Store in the location"), and after typing, a check (E3) shows "Found: 1.9 GB, modified 2 days ago" or "No copy named team-old here".
3. **Into**: the new Store's name, filled from the copy's name until typed, with today's rules and messages ("A Store named X exists here; pick another name."). Below it, the space line: the copy's size (from the check) against `disk.volumes`, in warning tone when it would leave under 20 GB.
4. **Progress**: once started, the job's `TransferRow` in its full form. "Run in background" closes the dialog; the job continues in the tray. When the job ends well, the dialog closes and the overview scrolls to the new Store's row, which flashes once (`live-flash`).

### 3.9 Import dialog

```text
+-[1] DialogHeader ------------------------------------------------------------+
| Import into PostgreSQL                                                     x |
| Copies a SQLite Store, all of its projects, into a new PostgreSQL Store.     |
| Both stay. They don't sync after this.                                       |
+------------------------------------------------------------------------------+
+-[2] Bridge ------------------------------------------------------------------+
|   [sq|R2] work                    ===>           [pg] pg-local               |
|   SQLite - 3 projects - 1.0 GB                   new Store work-pg           |
+------------------------------------------------------------------------------+
+-[3] Fields ------------------------------------------------------------------+
| SQLite Store  [ [sq] work    3 projects - 1.0 GB                         v ] |
| Connection    [ [pg] pg-local   * reachable - sync_commit off            v ] |
| New Store     [ work-pg            ]   Schema  lfc_work_pg                   |
+------------------------------------------------------------------------------+
+-[4] Progress (once started) -------------------------------------------------+
|   Copy  [========-----------------]  310 MB / 1.0 GB   about 1 min left      |
|   Copy * - Finish                                                            |
+------------------------------------------------------------------------------+
|                         [ Run in background ]  [ Cancel ]  [ Import ]        |
+------------------------------------------------------------------------------+
```

#### Regions

1. **Header** (`ImportDialog`, `storage/dialogs/import-dialog.tsx`): "Both stay. They don't sync after this." is the line that keeps the two families honest.
2. **Bridge**: the source `StoreIcon` and the target pg mark with an arrow, filled as the fields are chosen. It is decorative (`aria-hidden`); the fields carry the meaning.
3. **Fields**:
   - **SQLite Store**: a select of SQLite Stores (fixed when opened from a Store).
   - **Connection**: a select of connections with health. An unreachable one is listed but shows its state, and Import warns "pg-local is not answering" without blocking.
   - **New Store**: defaults to `<store>-pg`. The schema is derived (`lfc_<name with _>`), shown read-only, as the host makes it today.
4. **Progress**: as in Clone. When the job ends, the dialog closes, and the new row in the PostgreSQL band flashes.

### 3.10 Pull dialog

```text
+------------------------------------------------------------------------------+
| Pull work from r2-team?                                                    x |
| Pull replaces work and all 3 of its projects with the copy in r2-team.       |
+------------------------------------------------------------------------------+
| ! work has changes not pushed to r2-team. Pulling discards them.             |
|   Push first, or clone the copy into a new Store to keep both.  [ Clone... ] |
+------------------------------------------------------------------------------+
| Copy in r2-team: 1.1 GB, modified 20 min ago                                 |
| Type work to pull                                                            |
| [                                ]                                           |
|                                              [ Cancel ]  [ Pull and replace ] |
+------------------------------------------------------------------------------+
```

`PullDialog` (`storage/dialogs/pull-dialog.tsx`) replaces `window.prompt`. The
warning block shows only when the copy's local side is `changed` (states
`ahead` and `diverged`). For `unknown` it reads "Connect can't tell whether
work changed since your last transfer." The button is destructive and enabled
only when the typed name matches. "Clone…" opens the Clone dialog with this
location and copy, so the user keeps both.

### 3.11 Push anyway dialog

```text
+------------------------------------------------------------------------------+
| Replace the copy in r2-team?                                               x |
| The copy changed since this machine last pushed or pulled it (1.1 GB,        |
| modified 20 min ago). Pushing anyway replaces it with work as it is here.    |
| Commits in that copy that this machine doesn't have are lost for everyone    |
| who pulls it.                                                                |
+------------------------------------------------------------------------------+
| Type work to push anyway                                                     |
| [                                ]                                           |
|                                    [ Pull first... ]  [ Cancel ]  [ Push anyway ] |
+------------------------------------------------------------------------------+
```

`ForcePushDialog` (`storage/dialogs/force-push-dialog.tsx`) opens from the
refusal card's "Push anyway…", or directly from Push when the copy's state is
already `behind`, `diverged` or `missing` (so the user is not sent through a
refusal they can predict). It sends `force: true`. The button is destructive.

### 3.12 Remove dialog

One `ConfirmByName` dialog (`storage/dialogs/confirm-by-name.tsx`) for every
removal, replacing `window.prompt` and `window.confirm`:

| What | Title | Body | Type to confirm |
|---|---|---|---|
| SQLite Store | Remove work? | Deletes work and all 3 of its projects from this machine. Copies in locations stay. | yes, the Store name |
| PostgreSQL Store | Remove work-pg? | Drops the schema lfc_work_pg and its 3 projects from pg-local. | yes |
| Copy location | Remove r2-team? | The copies in the bucket stay. LayerFS forgets the location, and Connect deletes its keys. | no, one click |
| Connection | Forget pg-local? | Its 2 Stores stay in the database. Connect forgets the URL and can't open them until you add it again. | no, one click |

---

## 4. Sync status model

### 4.1 What is compared

Each SQLite Store has zero or more **copies**, one per remote it has
transferred with. For each copy, three facts are compared:

- **Base (B):** the copy's last transfer recorded in this home: the newer of `pushed` and `pulled` by `at`. Each has `sha256` (of the file moved) and, with E2, `heads` (the Store's history heads digest at that moment).
- **Local now (L):** the Store's `heads` digest now (E2). Cheap: read only when the Store's files changed since the last read ([§8.3](#83-engine-asks)).
- **Remote now (R):** one `HEAD` of `<prefix>/<store>/store.sqlite` (E3): present or not, its `layerfs-sha256` metadata, size, modified time and, with E2, its `layerfs-heads` metadata.

No file is hashed to decide state. Local is a digest of a few hundred rows,
and remote is the hash the pusher already stored as metadata.

**Why a heads digest and not a counter or mtime.** File size and mtime change
when SQLite checkpoints the WAL, with no change to history. A Store-local
counter would be cheap, but it means nothing on another machine. The heads
digest is the sha256 over every project's head Layer and every Branch's base
Layer and head Commit. It changes exactly when history visible to a pull
changes, and it is equal on two machines with the same history. So "this
machine has what the copy has" can be told even when the base is missing or
was made elsewhere.

### 4.2 The two sides

`local`:

| Value | When |
|---|---|
| `same` | `L` and `B.heads` are known and equal |
| `changed` | both known and different |
| `unknown` | either is null (a build without E2, a Store not readable now, a transfer recorded before E2) |

`remote`:

| Value | When |
|---|---|
| `same` | the check found the object and `R.sha256 == B.sha256` |
| `changed` | found, and its sha256 differs (or the metadata has none) |
| `missing` | the check found no object at that path |
| `unknown` | no check yet, the last check failed, no keys, or a build without E3 |

### 4.3 The state function

The host computes it (`host/storage-sync.js`, pure, unit-tested), in this
order:

```text
syncState(copy, job):
  if job running for (store, remote)                -> transferring
  if remote == missing                              -> missing
  if R.heads and L and R.heads == L                 -> in_sync      (same history, whatever the base)
  if check in flight and no earlier check           -> checking
  local same,    remote same                        -> in_sync
  local changed, remote same                        -> ahead
  local same,    remote changed                     -> behind
  local changed, remote changed                     -> diverged
  local unknown, remote changed                     -> behind       (a push will be refused; reason says local is unknown)
  local changed, remote unknown                     -> ahead        (reason: "remote not checked")
  otherwise                                         -> unknown      (reason says which side is unknown)
```

`reason` is a short sentence for the tooltip and the two-sided panel, for
example "This LayerFS build can't tell whether work changed" or "r2-team
didn't answer: connection refused".

### 4.4 States

| State | Label | Means | Tone (Chip) / token | Icon (lucide) | Action offered |
|---|---|---|---|---|---|
| `in_sync` | In sync | Both sides match the last transfer, or have the same history | `success` / `--sync-ok` | `CircleCheck` | none |
| `ahead` | Changes to push | This machine has Commits the copy doesn't; the copy hasn't moved | `info` / `--sync-ahead` | `ArrowUp` | Push |
| `behind` | Remote newer | The copy changed since the last transfer; this machine hasn't (or can't tell) | `warning` / `--sync-behind` | `ArrowDown` | Pull… |
| `diverged` | Both changed | Both moved since the last transfer; a push is refused, and a pull loses local Commits | `danger` / `--sync-diverged` | `Split` | Open (resolve on the Store page: Pull…, Push anyway…, or Clone the copy) |
| `missing` | Copy missing | A transfer is recorded, but nothing is at the path now | `warning` / `--sync-behind` | `CloudOff` | Push (as a first push) |
| `checking` | Checking… | The first check of this copy is running | `neutral` | `LoaderCircle` (spinning) | none |
| `unknown` | Sync unknown | Either side can't be read; `reason` says why | `neutral`, dashed ring / `--sync-unknown` | `CircleDashed` | Check now |
| `transferring` | Pushing 41% / Pulling 12% | A job runs on this copy | `info`, live | `LoaderCircle` | none (no cancel in v1) |

Two Store-level states exist only in the aggregate:

| State | Label | Means | Tone | Icon |
|---|---|---|---|---|
| `local_only` | Local only | A SQLite Store with no copy anywhere | `neutral` | `HardDrive` |
| `live` | Live | A PostgreSQL Store: nothing to sync | `success` | `Radio` |

Severity, for sorting and aggregation, from most to least urgent:
`diverged > behind > missing > ahead > unknown > checking > transferring > in_sync > local_only`.

### 4.5 A Store's aggregate

- The Store's state is its copies' most severe state, except that
  `transferring` wins while a job runs on the Store (the row shows the job).
- With no copies, it is `local_only`. A PostgreSQL Store is `live`.
- `counts` holds how many copies are in each state, so the pill can read
  "Changes to push · 2" and its tooltip can list each copy ("r2-team: Changes
  to push; minio-a: In sync").

### 4.6 Staleness and unreachable

- A copy's state keeps its last check. When the check is older than 10
  minutes, the pill's tooltip adds "as of 12 min ago". The pill itself does
  not change, so states don't flicker on a slow network.
- When the latest check failed (unreachable, denied), the copy's `remote`
  becomes `unknown`, *but* the host keeps the last successful check. The pill
  then reads the last known state with a dashed ring and the tooltip says
  "r2-team didn't answer 2 min ago; last known: In sync, 40 min ago". This is
  `unknown` in data (`sync: 'unknown'`, `lastKnown: 'in_sync'`), so the
  renderer can show both.

### 4.7 Where state appears

| Place | Form |
|---|---|
| Overview SQLite row, Status cell | the aggregate `SyncPill` (icon + label) and its action |
| Overview SQLite row, Copies cell | one `CopyPill` per copy: provider mark, remote name, state icon. The icon has an `aria-label`, and the pill's tooltip gives the label |
| Summary strip, Sync | counts of non-zero urgent states |
| Toolbar, Needs attention | the filter count |
| Store page header | the aggregate pill |
| Store page, each copy | the copy's pill and the two-sided panel |
| Copy location page | each copy's pill |
| Project cards | the Store's aggregate pill in compact form (icon + short label) in the Store well |
| New project dialog | the Store's aggregate pill, compact |
| Sidebar | nothing (out of scope) |

---

## 5. Transfer progress model

### 5.1 Phases

Each job reports one `phase` at a time (E4). The UI shows each kind's phases
as a stepper:

| Kind | Phases (stepper labels) | `bytes / total` in each phase |
|---|---|---|
| push | `check` Check · `snapshot` Snapshot · `hash` + `upload` Upload · `record` Finish | check: none. snapshot: bytes copied / file + WAL (SQLite backup steps). hash: bytes hashed / snapshot size. upload: bytes sent / snapshot size. record: none |
| pull | `check` Check · `download` Download · `verify` Verify · `install` Replace · `record` Finish | download: bytes received / remote size. verify: bytes hashed / size. install: none |
| clone | `download` Download · `verify` Verify · `install` Install · `record` Finish | as pull |
| import | `copy` Copy · `record` Finish | copy: source bytes read / source file size |

- `hash` is shown as "Upload" with the sub-label "Preparing" (the sha256 that
  signs each request is computed before it is sent). It has its own bar, and
  the stepper does not get a fifth step for it.
- When a remote takes the file as pieces (larger than the provider's max
  file), the upload line adds "piece 3 of 12" (`pieces`).
- A phase without bytes shows an indeterminate bar (the existing `Bar` with
  the `shimmer` animation, no fill).

### 5.2 Rate and ETA

The host computes both from successive `sync.get` samples (it polls every 500
ms while a job runs):

- `rate` is an exponentially weighted mean of `Δbytes / Δt` over the current
  phase (α = 0.3), in bytes per second. It resets when the phase changes. It
  is null for the first 2 s of a phase and in phases without bytes.
- `eta` is `(total − bytes) / rate` for the current phase only, in seconds,
  rounded for display: "about 47 s left", "about 3 min left", "less than 10 s
  left". It is null when `rate` is null or below 1 KB/s. ETA is never shown
  for the whole job, since later phases have no reliable size.
- Display: "12.4 MB/s · about 47 s left". With rate unknown: just bytes.

### 5.3 How a job shows

`TransferRow` (`storage/transfers/transfer-row.tsx`) has three forms:

| Form | Where | Shows |
|---|---|---|
| **compact** | overview Status cell, project card well | state icon, "Uploading 41%" (or the phase word when there is no total), and a 2 px bar under the row |
| **row** | transfer tray | direction icon (`ArrowUp` push, `ArrowDown` pull, `CopyPlus` clone, `DatabaseZap` import), the Store, `->` or `<-`, the target with its provider mark, the phase label, the bar, `bytes / total`, then the stepper with rate and ETA |
| **card** | Store page job card, Clone and Import dialogs | the row form, plus the started time, the snapshot size once known, and the refusal or error block |

- The bar is `Bar` with `live`. Its fill is `bytes / total` of the phase. On
  a phase change, it resets to 0 with a 150 ms fade, not a backwards slide.
- **Stepper**: done phases have a check (`CircleCheck`), the current one a
  brand dot that pulses, and later ones a hollow dot. The labels stay visible,
  so it is not colour-only.
- **Finished** (`step: 'done'`): `CircleCheck` in success tone, "Pushed work
  to r2-team · 980 MB in 1 min 12 s" (bytes from `result.bytes`, duration
  from `ended − started`). The row stays in the tray for 10 minutes. The
  host then runs a check of that copy, so the pill turns In sync from real
  data, not by assumption.
- **Failed**: `TriangleAlert` in danger tone, the verb + "failed", and the
  refusal card or error block ([§5.5](#55-refusals-and-failures)).
- **Live region**: the row's container is `aria-live="polite"`, and it
  announces only phase changes and the end ("work: upload started",
  "work pushed to r2-team"), never byte updates.

### 5.4 Cancel

**No Cancel in v1.** LayerFS jobs are one binding call each, made once, with
no cancel. Stopping an upload mid-request makes its outcome `Uncertain`.
Leaving the page or closing a dialog never stops a job ("Run in background").
The type keeps `cancellable: boolean` (always `false` now), so a later
`sync.cancel` (E10) can add a Cancel button in phases before the point of no
return (`check`, `snapshot`, `hash`, `upload` before the manifest; `download`,
`verify`) without a contract change.

### 5.5 Refusals and failures

The host passes the runtime's `error.code` through. The renderer maps known
codes to cards (`RefusalCard`, `storage/transfers/refusal.tsx`). Unknown codes
fall back to the message.

| Code (kind) | Title | Body | Buttons |
|---|---|---|---|
| `Conflict` (push) | Push refused: the copy changed | The copy in r2-team changed since this machine last pushed or pulled. Pull it first to keep its changes, or push anyway to replace it. | Pull first… · Push anyway… |
| `Busy` / open Store (pull) | Pull refused: work is open | A Sandbox, a Workspace or the LayerFS box holds it. The box lets go about a minute after its last use. | Pull again (enabled after 60 s with a countdown; the user starts it, no automatic retry) |
| `Capacity` (push, clone) | Not enough space | A push stages a copy beside the Store: it needs 1.1 GB, and the Docker volumes have 400 MB free. | This machine |
| `Unknown` / `Uncertain` | Outcome unknown | The connection dropped after sending. The copy may or may not have changed. Check it before pushing again. | Check now |
| `Unavailable` | Couldn't reach r2-team | <message>. Nothing was sent. | Check now |
| `Integrity` (pull, clone) | The copy didn't verify | The downloaded file didn't match its sha256. Nothing was replaced. The partial file is kept at <path>. | none |
| `Exists` (clone, import) | Name taken | A Store named team exists. Pick another name. | (inline in the dialog) |
| `Unsupported` | Not in this LayerFS build | <message> | none |

The `Conflict` card also notes the engine's own limit in its tooltip: "The
check runs before the upload; a push from another machine in between is not
caught." The UI never claims the check is atomic.

---

## 6. Size

### 6.1 What size means

| Family | `size.bytes` is | Split | Not counted |
|---|---|---|---|
| SQLite | `store.sqlite` + `store.sqlite-wal`, as stat reports them now | `file`, `wal` | `-shm` (index, a few KB), a `.pushing` / `.pulling` staging copy, Docker volume overhead |
| PostgreSQL | the sum of `pg_total_relation_size` over the schema's tables and materialized views (heap, indexes, TOAST) | none | WAL and other schemas in the database, the server's free space |

- A copy's size is the remote object's size (`check.bytes`, else the last
  transfer's `bytes`). It is usually smaller than file + WAL, because the
  snapshot is a checkpointed copy. The Store page shows both, labeled ("1.0 GB
  now", "980 MB copy"), and never subtracts them.
- `size.at` is when it was read. Sizes older than 5 minutes show "as of
  <ago>" in the tooltip.

### 6.2 How it shows

`SizeText` (`storage/size.tsx`):

- Known: `bytes()` (decimal units, as Docker and Finder), tabular. The tooltip
  gives the split: "store.sqlite 988 MB · WAL 12.4 MB" or "Tables, indexes and
  TOAST in schema lfc_work_pg".
- Unknown: "size unknown" in `text-faint`, with the reason ("This LayerFS
  build doesn't report sizes", "pg-cloud is not answering", "Docker is not
  answering").
- While a push stages its snapshot, the Size cell does not show the staged
  copy; the size card shows "+ a staged copy while pushing".

### 6.3 Totals

| Total | Where | Rule |
|---|---|---|
| SQLite on this machine | SQLite band header, summary strip | sum of known SQLite sizes; "+ N unknown" when any is unknown |
| PostgreSQL per connection | connection header, connection page | sum of its Stores' schema sizes |
| PostgreSQL overall | PostgreSQL band header, summary strip | sum over connections |
| Copies per location | copy location row and page | sum of known copy sizes in that location |
| Copies overall | Copy locations header | sum over locations |
| Size cell of the summary strip | strip | SQLite + PostgreSQL, always with the split under it; copies are never added in |

Totals use `CountBytes` and count up on first show only.

---

## 7. Provider identity

### 7.1 StoreIcon

`StoreIcon` (`storage/identity/store-icon.tsx`) replaces `DatabaseIcon` for
Stores:

```text
  one copy          two copies         three or more      PostgreSQL       local only
  +------+          +------+           +------+           +------+         +------+
  |  sq  |          |  sq  |           |  sq  |           |  pg  |         |  sq  |
  |    (R2)         |  (M)(R2)         |   (R2)+2         |      |         |      |
  +------+          +------+           +------+           +------+         +------+
```

- The base is today's `Tile` with the family mark (`siSqlite` or `siPostgresql`).
- The badge is a circle at the bottom-right (offset −3 px), with the provider
  mark (`ProviderGlyph`) on `var(--card)`, a 1.5 px ring of `var(--card)`
  (which cuts it out of the tile) and a hairline `ring-foreground/10`.
- Sizes: tile sm 28 / md 36 / lg 44 px; badge 14 / 16 / 20 px; mark 9 / 10 / 13 px.
- **Order**: the linked remote (`store.remote`) first, then by the last
  transfer, newest first.
- **Two copies**: two badges, the second 6 px to the left and behind, so both
  marks show.
- **Three or more**: the first badge and a "+N" badge (text-[9px], neutral)
  behind it.
- **Two copies at one provider**: one badge for that provider; the count
  shows only in the Copies cell.
- The badge is identity only, never state, so state stays on the pill in words.
- `aria-label`: "SQLite Store, copies in Cloudflare R2 and MinIO", or
  "PostgreSQL Store", or "SQLite Store, no copies".

### 7.2 Everywhere a Store or location appears

| Place | Mark |
|---|---|
| Overview SQLite rows | `StoreIcon` sm with badges |
| Overview Copies cell | each `CopyPill` leads with its provider mark |
| Copy locations block | the provider group header (sm) and nothing per bucket row (the group carries it); a bucket row in a flat list (search results) gets its own mark |
| PostgreSQL band | pg mark on connection headers and Store rows |
| Transfer rows | the target's provider mark (pg mark for an import) |
| Store page header | `StoreIcon` lg |
| Copy location / connection page header | provider / pg mark lg |
| Dialogs (selects, picker tiles) | marks beside each option |
| Project cards, New project dialog | `StoreIcon` sm |

### 7.3 Provider registry

`storage/identity/providers.ts` keeps one entry per provider, so adding one
is data, not layout:

```ts
export interface ProviderEntry {
  id: RemoteProvider            // 'minio' | 'r2' | 's3' | 'gcs' | 'google-drive' | 'folder'
  label: string                 // 'Cloudflare R2'
  family: 'copy'                // PostgreSQL is not in this registry; it is a database
  mark: BrandMark | LucideIcon  // siMinio, siCloudflare, AWS_MARK, siGooglecloudstorage, siGoogledrive, FolderOpen
  aliases: string[]             // ['s3', 'cloudflare'] for search
  /** How the location line reads, from a RemoteInfo. */
  where: (r: RemoteInfo) => string
  /** The add form: ordered fields with label, kind ('text' | 'secret' | 'select' | 'url'), hint, validator. */
  fields: ProviderField[]
}
```

- Today MinIO and R2 have full entries. S3, GCS, Google Drive and Folder have
  `label`, `mark` and `aliases` and show as Coming until `view.providers`
  marks them available.
- An unknown provider id from LayerFS (a newer build) gets a generic entry:
  the `Cloud` icon, the id as its label, and no form.
- `brandColor` keeps marks visible in both themes, as today.

---

## 8. Data contract

All types live in `src/shared/host-api.ts` and change on both sides together.
**Producer** says who makes each field:

- **H**: the Connect host can make it now, from the runtime's current answers, its own `storage.json`, its job samples or a `docker`/`stat` call it already makes.
- **E*n***: it needs LayerFS (`@layerfs/runtime` and the engine below it). The exact ask is in [§8.3](#83-engine-asks).
- **H←E*n***: the host derives it from an engine field, and it is null without that field.

### 8.1 Types

```ts
// ---------- Storage (redesign, layerfs#506) ----------

export type StoreFamily = 'sqlite' | 'postgresql'                   // = StoreInfo.kind
export type RemoteProvider = 'minio' | 'r2' | 's3' | 'gcs' | 'google-drive' | 'folder'

/** A copy's sync state (§4.4). */
export type SyncState = 'in_sync' | 'ahead' | 'behind' | 'diverged' | 'missing' | 'checking' | 'unknown' | 'transferring'
/** A Store's aggregate: a copy state, or one of the two Store-only states. */
export type StoreSyncState = SyncState | 'local_only' | 'live'

export interface Health {
  state: 'ok' | 'unreachable' | 'denied' | 'checking' | 'unknown'
  /** When the last check ended; null before the first. */
  at: number | null
  /** The failure's message, readable as is. */
  message: string | null
}

/** One push or pull of a whole Store file. */
export interface TransferInfo {
  at: number | null
  bytes: number | null
  sha256: string | null
  /** The Store's history heads digest at that transfer (§4.1). */
  heads: string | null                                              // E2
}

/** The last look at a copy in its remote: one HEAD. */
export interface CopyCheck {
  at: number                                                        // H (when the host ran it)
  present: boolean                                                  // E3
  bytes: number | null                                              // E3
  sha256: string | null                                             // E3 (layerfs-sha256 metadata)
  heads: string | null                                              // E3 + E2 (layerfs-heads metadata)
  modified: number | null                                           // E3 (Last-Modified)
  error: { code: string; message: string } | null                   // E3
}

/** A Store's whole-file copy in one remote. */
export interface CopyInfo {
  remote: string                                                    // E (exists)
  provider: RemoteProvider | null                                   // H (joined from remote.list)
  pushed: TransferInfo | null                                       // E (exists; gains heads, E2)
  pulled: TransferInfo | null                                       // E (exists; gains heads, E2)
  /** The newer of pushed and pulled: what both sides are compared with. */
  base: TransferInfo | null                                         // H
  /** The last successful check, and the last check if it failed. */
  check: CopyCheck | null                                           // H←E3 (host cache)
  failedCheck: CopyCheck | null                                     // H←E3
  local: 'same' | 'changed' | 'unknown'                             // H←E2
  remoteSide: 'same' | 'changed' | 'missing' | 'unknown'            // H←E3
  sync: SyncState                                                   // H (§4.3)
  /** The state before the last failed check, shown dashed (§4.6). */
  lastKnown: SyncState | null                                       // H
  reason: string | null                                             // H
  /** The full object path, for display: <location>/<store>/store.sqlite. */
  object: string                                                    // H
}

export interface StoreSize {
  /** SQLite: store.sqlite + its WAL. PostgreSQL: the schema's tables, indexes and TOAST. */
  bytes: number
  file: number | null                                               // SQLite only
  wal: number | null                                                // SQLite only
  at: number
}

/** A Store: many projects in one SQLite file (its own Docker volume) or one PostgreSQL schema. */
export interface StoreInfo {
  name: string                                                      // E (exists)
  kind: StoreFamily                                                 // E (exists)
  volume: string | null                                             // E (exists)
  connection: string | null                                         // E (exists)
  schema: string | null                                             // E (exists)
  synchronousCommit: SynchronousCommit | null                       // H (pass through store.list)
  remote: string | null                                             // E (exists)
  projects: string[]                                                // E (exists)
  created: number | null                                            // H (pass through store.list)
  legacy: boolean                                                   // H (pass through store.list)
  size: StoreSize | null                                            // SQLite: E1, else H (docker exec stat, as storeBytes does); PostgreSQL: E5
  /** @deprecated size?.bytes; kept one release for project-card.tsx. */
  bytes: number | null                                              // H
  /** The Store file is open now (its -shm exists): a pull would be refused. */
  open: boolean | null                                              // E1, else H (same stat)
  copies: CopyInfo[]
  sync: {
    state: StoreSyncState                                           // H (§4.5)
    counts: Partial<Record<SyncState, number>>                      // H
  }
  /** PostgreSQL: the SQLite Store it was imported from. */
  importedFrom: { store: string; at: number | null; bytes: number | null } | null   // E6, else H (Connect's own import log)
  /** SQLite: PostgreSQL Stores imported from this one. */
  imports: string[]                                                 // H←E6
  /** The running job on this Store, if any. */
  job: string | null                                                // H
}

/** A remote LayerFS knows; its keys stay in Connect. */
export interface RemoteInfo {
  name: string                                                      // E (exists)
  provider: RemoteProvider                                          // E (exists; widened union)
  endpoint: string                                                  // H (exists)
  reachAs: string                                                   // E (exists)
  account?: string | null                                           // E (exists)
  jurisdiction?: string | null                                      // E (exists)
  bucket: string                                                    // E (exists)
  prefix: string                                                    // E (exists)
  hasSecret: boolean                                                // H (exists)
  /** host/bucket/prefix, for display. */
  location: string                                                  // H
  /** Local Stores with a copy record here (was: pushed only). */
  stores: string[]                                                  // H
  copies: { store: string; bytes: number | null; sync: SyncState }[] // H
  bytes: number | null                                              // H (sum of known copy sizes)
  health: Health                                                    // H←E3 (the latest check against this remote)
  /** Copies in the bucket, including ones other machines pushed; null without E9. */
  listed: { store: string; bytes: number; modified: number | null }[] | null   // E9 (optional)
}

export type SynchronousCommit = 'off' | 'local' | 'remote_write' | 'on' | 'remote_apply'

/** A named PostgreSQL connection Connect keeps; its URL (with the password) stays in Connect. */
export interface PostgresqlConnection {
  name: string                                                      // H (exists)
  url: string                                                       // H (exists, redacted)
  synchronousCommit: SynchronousCommit                              // H (exists)
  stores: string[]                                                  // H (exists)
  host: string | null                                               // H (parsed from the URL: host:port)
  database: string | null                                           // H (parsed from the URL)
  health: Health & {
    serverVersion: string | null                                    // E7
    latencyMs: number | null                                        // H (timed around E7)
  }
  bytes: number | null                                              // H←E5 (sum of its Stores)
}

export type SyncPhase = 'check' | 'snapshot' | 'hash' | 'upload' | 'download' | 'verify' | 'install' | 'copy' | 'record'

/** A push, pull, clone or PostgreSQL import in progress or just ended. */
export interface SyncJob {
  id: string                                                        // E (exists)
  kind: 'push' | 'pull' | 'clone' | 'import'                        // E (exists)
  /** The Store it moves (for a clone, the new Store; for an import, the source). */
  store: string                                                     // E (exists)
  /** The remote's name, or connection/schema for an import. */
  target: string                                                    // H (exists)
  /** A clone's Store in the remote; an import's new PostgreSQL Store. */
  from: string | null                                               // H (from the request)
  provider: RemoteProvider | 'postgresql' | null                    // H
  force: boolean                                                    // H (from the request)
  step: 'running' | 'done' | 'failed'                               // E (exists; narrowed)
  phase: SyncPhase | null                                           // E4
  /** Within the current phase, updated while running. */
  bytes: number | null                                              // E4 (today: only at the end)
  total: number | null                                              // E4 (today: file size at start, Linux only)
  pieces: { done: number; of: number } | null                       // E4 (optional)
  rate: number | null                                               // H (§5.2)
  eta: number | null                                                // H (§5.2), seconds
  cancellable: boolean                                              // H (always false in v1; E10 later)
  error: { code: string; message: string } | null                   // H (was a string; pass the runtime's code through)
  result: { bytes: number | null; sha256: string | null } | null    // H (pass through result.transfer)
  started: number                                                   // E (exists)
  ended: number | null                                              // E (exists)
}

export interface ProviderInfo {
  id: RemoteProvider
  /** This LayerFS build can add it. */
  available: boolean                                                // E8, else H (constant: minio, r2 when remotes are on)
  reason: string | null                                             // H
}

/** What the linked LayerFS build reports, for graceful fallbacks (§10). */
export interface StorageSupports {
  size: boolean           // E1 present (else the host's stat fallback, SQLite only)
  heads: boolean          // E2
  check: boolean          // E3
  progress: boolean       // E4
  postgresqlStatus: boolean // E5/E7
  listCopies: boolean     // E9
}                                                                   // H (feature-detects the runtime)

export interface StorageTotals {
  sqlite: { stores: number; bytes: number; unknown: number }
  postgresql: { stores: number; connections: number; bytes: number; unknown: number }
  copies: { bytes: number; unknown: number }
  sync: Partial<Record<StoreSyncState, number>>
}                                                                   // H

/** Each part's `available` is false while the linked LayerFS build lacks it, and `reason` says why. */
export interface StorageView {
  stores: { available: boolean; reason: string | null; list: StoreInfo[] }            // exists
  remotes: { available: boolean; reason: string | null; list: RemoteInfo[] }          // exists
  postgresql: { available: boolean; reason: string | null; connections: PostgresqlConnection[] } // exists
  jobs: SyncJob[]                                                                     // exists
  providers: ProviderInfo[]                                                           // H / E8
  totals: StorageTotals                                                               // H
  supports: StorageSupports                                                           // H
  /** The newest finished check, for "Checked 2 min ago". */
  checkedAt: number | null                                                            // H
  /** Checks running now. */
  checking: number                                                                    // H
}

// Projects home joins (H, from the cached StorageView):
export interface ProjectSummary {
  // ...existing fields
  storeSync?: StoreSyncState | null                                 // H
  storeProviders?: RemoteProvider[]                                 // H (StoreIcon badges)
  connection?: string | null                                        // H (PostgreSQL Stores)
}

// Host events (the existing /api/events stream; the union is renamed HostEvent):
export type HostEvent =
  | RunEvent
  | { type: 'sync'; job: SyncJob }                                  // H: each new sample of a running job, and its end
  | { type: 'storage' }                                             // H: the view changed (a check ended, a job ended); re-read /api/storage
```

### 8.2 Fields grouped by producer

**Host (H), buildable now:**

- StoreInfo: `synchronousCommit`, `created`, `legacy` (pass through), `bytes`
  (alias), `size` for SQLite and `open` (fallback: one `docker exec … stat` of
  `store.sqlite`, `-wal`, `-shm` for all Stores at once, as `storeBytes` does
  today; plain `stat` on Linux), `sync`, `imports`, `job`, `importedFrom`
  (fallback: Connect's own record of the imports it started, in
  `storage.json`).
- CopyInfo: `provider`, `base`, `sync`, `lastKnown`, `reason`, `object`; and
  `local`, `remoteSide` as `unknown` until E2 and E3.
- RemoteInfo: `location`, `stores` (any transfer, not just pushes), `copies`,
  `bytes`, `health` (unknown until E3).
- PostgresqlConnection: `host`, `database`, `latencyMs`, `bytes` (null until E5).
- SyncJob: `from`, `provider`, `force`, `rate`, `eta`, `cancellable`, `error`
  (with code), `result`.
- StorageView: `providers` (fallback constant), `totals`, `supports`,
  `checkedAt`, `checking`.
- ProjectSummary: `storeSync`, `storeProviders`, `connection`.
- Push with `force` (the runtime already takes it), `POST /api/storage/check`,
  and the `sync` and `storage` events.

**Engine (E), asks to LayerFS:** `heads` (E2), copy checks (E3), live phase
progress (E4), PostgreSQL schema size and server status (E5, E7), recorded
import origin (E6), and optionally SQLite sizes in `store.list` (E1),
providers (E8), bucket listing (E9) and cancel (E10).

### 8.3 Engine asks

Each ask is one attempt with no retry, adds no work inside the publication
lane, and reads no whole file. Sizes are stats; sync is digests and HEADs.

| Ask | Runtime call (today → proposed) | Cost | Needed for |
|---|---|---|---|
| **E1** SQLite size and open state | `runtime.store.list()`: each SQLite entry gains `bytes: { file: number, wal: number } \| null` and `open: boolean \| null` | 3 stats per Store (`store.sqlite`, `-wal`, `-shm`) in the process that can see the volume (the worker on macOS and Windows); no open | Size, Pull hint. *Optional*: the host fallback works without it, at one `docker exec` per view |
| **E2** history heads digest | `runtime.store.list()`: each SQLite entry gains `heads: string \| null`. Each copy's `pushed` and `pulled` gain `heads`, recorded in `stores.json` and `HOME/remote-state/<store>`. Push writes object metadata `layerfs-heads` | see below | local side of sync |
| **E3** copy check | new `runtime.store.check(store, { remote, credentials })` → `{ remote, present, bytes, sha256, heads, modified, checkedAt }` | one `Driver::stat` (HEAD; for a pieced file, the manifest's HEAD) | remote side of sync, location health, clone preview |
| **E4** live progress | `runtime.sync.get(id)` gains `phase`, and `bytes`/`total` updated while running (per phase), and optional `pieces: { done, of }` | the native call writes a small progress cell, at most every 250 ms; `sync.get` reads it | progress bars, rate, ETA |
| **E5 + E7** PostgreSQL status | new `runtime.postgresql.status({ url, schemas: string[] })` → `{ serverVersion: string, schemas: { [schema: string]: number } }` | one connection, two catalog queries: `SHOW server_version`, and `SELECT n.nspname, sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('r','m') GROUP BY 1` | schema size, connection health, version |
| **E6** import origin | `start_import_postgresql` records `importedFrom: { store, at, sha256 }` in the new Store's `stores.json` entry; `store.list()` shows it | a few bytes in the registry | From column, "Imported from" |
| **E8** providers *(optional)* | new `runtime.remote.providers()` → `['minio', 'r2', …]`: the providers this build's binding has (features) | none | Coming vs available tiles. Fallback: a host constant |
| **E9** bucket listing *(optional, phase 2)* | new `runtime.remote.list_stores(remote, { credentials })` → `[{ store, bytes, modified }]`; a new `Driver::list(prefix)` (S3 `ListObjectsV2` with delimiter `/`) | one list request per page of 1000 | copies from other machines, Clone picker |
| **E10** cancel *(later)* | new `runtime.sync.cancel(id)` → `{ cancelled: boolean }`, honoured only before the point of no return; a started multipart sends its one abort | none | Cancel button |

**E2 in detail: the heads digest.**

- **Definition:** the lowercase hex sha256 of the sorted lines
  `stack <name> <head_layer_id hex>` (from `layer_stack`) and
  `branch <stack name> <branch name> <base_layer_id hex> <head_commit_id hex or ->`
  (from `branch`). It covers every row a pull changes that history shows:
  projects added or removed, Branches made, moved, merged or deleted. The
  engine owns the exact row set and documents it beside the schema.
- **Cost:** O(projects + Branches), a read-only query outside the lane (a few
  hundred rows for a busy Store).
- **When it is read:** `store.list()` reads `heads` only for Stores whose
  `(file size, file mtime, wal size, wal mtime)` changed since the last read.
  Otherwise it answers the cached value (memory only, per runtime process).
- **Pulls must not be blocked by the read.** A pull refuses an open Store, and
  the worker keeps Stores open a quiet minute. So the read uses the handle the
  process already holds when there is one. Otherwise it opens a short-lived
  read-only connection and closes it at once, never caching it. It is also
  serialized per Store with `start_pull` and `start_clone` in the runtime, and
  skipped (the cached value is answered) while either runs on that Store. A
  status read by this runtime therefore never makes this runtime's own pull
  refuse.
- **At transfers:** push computes `heads` from the *snapshot* (not the live
  Store, which keeps changing). Pull and clone compute it from the downloaded
  file before the rename. Both record it with the transfer.
- **Why not a counter:** a `store_generation` row bumped in each publish
  transaction would also be cheap, but it adds a write to every publish and
  can't say "same history" across machines. If the engine prefers it anyway,
  the contract is unchanged: `heads` becomes an opaque string, and the
  `R.heads == L` shortcut is dropped.

**E4 in detail.** Today a job is one binding call, and `bytes` is filled only
when it ends. The binding call gets a progress sink (a small shared struct per
job). Persistence reports SQLite backup steps (pages copied × page size of
the page count), the remote driver reports bytes sent or received per piece
and part, and the hashing loop reports bytes hashed. `sync.get` copies `{
phase, bytes, total, pieces }` from it. Updates are throttled to 4 per second
on the native side. No new thread, and no change to the one-attempt rule.

**Already in the runtime, used as is:** `start_push(store, { remote,
credentials, force })` (Connect starts passing `force`), and
`sync.get(id).error.code` (Connect stops flattening it to a string).

### 8.4 Routes, events and polling

**Routes (host, `host/server.js`):**

| Route | Change |
|---|---|
| `GET /api/storage` | answers the extended `StorageView`; uses cached checks; never runs a remote HEAD itself |
| `POST /api/storage/check` | **new.** Body `{ store?, remote?, connection? }`; empty means everything. Runs E3 for the matching copies (at most 4 at once, skipping copies with a running job or no keys) and E5/E7 for the matching connections, then answers the view. A second call while checks run joins them |
| `POST /api/stores/:name/push` | body gains `force?: boolean` |
| `GET /api/sync-jobs/:id` | unchanged path; the extended `SyncJob` |
| `GET /api/events` | gains `{ type: 'sync', job }` and `{ type: 'storage' }` |

**What is polled, and how often:**

| What | Who asks | When | Cost |
|---|---|---|---|
| The view (`store.list`, local sizes, heads) | renderer, `GET /api/storage` | on page open; every 15 s while the Storage tab is visible and the window focused; on each `storage` event | stats per Store; a heads read only for Stores whose files changed |
| Copy checks (E3) | renderer, `POST /api/storage/check` | on page open when `checkedAt` is older than 2 min; every 5 min while visible and focused; for one copy right after a job on it ends (the host does this itself); Check now | one HEAD per copy, at most 4 at once |
| PostgreSQL status (E5/E7) | same route | on page open; every 60 s while visible; after an import ends | one connection per connection |
| Running jobs (E4) | host | every 500 ms while any job runs, whether or not a page is open; each sample goes out as a `sync` event | one in-process read |
| Running jobs, fallback | renderer | every 1 s per job, only when the event stream is down | as today |
| Project cards | renderer | on Projects load, from the cached view (`useHostQuery` key `storage`) | none extra |

- The host keeps checks in memory only. After a host restart, copies read
  `checking` until the first check ends.
- Nothing polls while the window is hidden (`document.visibilityState`),
  except the host's job sampling.

---

## 9. File plan

Renderer paths are under `src/renderer/src/components/storage/`. Each builder
lane owns whole files. Shared pieces land first (lane A), and the others build
on them. `chips.tsx`, `meters.tsx`, `notice.tsx`, `unavailable.tsx` and
`storage.css` keep their paths, because Projects, Compute and Runs import them.

```diff
  storage/
    storage-page.tsx                   (rewritten in place: overview shell, view state, hash routing)
    chips.tsx                          (kept; adds tones only if §11 tokens need them)
    icons.tsx                          (kept: Mark, Tile, brandColor, AWS_MARK; DatabaseIcon stays for non-Store uses)
    meters.tsx                         (kept)
    notice.tsx                         (kept)
    unavailable.tsx                    (kept)
    storage.css                        (edited: sc-badge, sc-copy-pill, sc-band, stepper dots)
-   new-store-dialog.tsx               (moved to dialogs/, unchanged)
-   local-detail.tsx                   (removed: machine/ and detail/machine-detail.tsx replace it)
-   store-detail.tsx                   (removed: detail/sqlite-store-detail.tsx, detail/postgresql-store-detail.tsx)
-   remote-detail.tsx                  (removed: detail/location-detail.tsx)
-   postgresql-detail.tsx              (removed: detail/connection-detail.tsx, dialogs/provider-forms.tsx)
-   add-remote-dialog.tsx              (removed: dialogs/add-location-dialog.tsx)
-   sync-job.tsx                       (removed: transfers/)
-   projects-table.tsx                 (removed: projects are on each Store page and the Projects tab)
+   size.tsx                           new   SizeText
+   identity/
+     providers.ts                     new   provider registry (§7.3)
+     store-icon.tsx                   new   StoreIcon with badges (§7.1)
+   sync/
+     sync-state.ts                    new   labels, tones, icons, severity (no logic the host owns)
+     sync-pill.tsx                    new   SyncPill (full, compact), CopyPill
+     health-dot.tsx                   new   HealthDot with words
+   transfers/
+     use-transfers.ts                 new   sync events, fallback poll
+     phases.ts                        new   phases per kind, labels
+     transfer-row.tsx                 new   compact, row and card forms, stepper
+     transfer-tray.tsx                new
+     job-card.tsx                     new
+     refusal.tsx                      new   RefusalCard per error code (§5.5)
+   overview/
+     summary-strip.tsx                new
+     toolbar.tsx                      new
+     sqlite-band.tsx                  new
+     sqlite-store-row.tsx             new
+     copy-locations.tsx               new
+     postgresql-band.tsx              new
+     postgresql-store-row.tsx         new
+   detail/
+     breadcrumb.tsx                   new
+     sqlite-store-detail.tsx          new
+     copies-section.tsx               new   CopyCard, two-sided panel
+     size-card.tsx                    new
+     postgresql-store-detail.tsx      new
+     location-detail.tsx              new
+     connection-detail.tsx            new
+     machine-detail.tsx               new
+   machine/
+     worker.tsx                       new   WorkerSection, workerChip (moved from local-detail.tsx)
+   dialogs/
+     add-location-dialog.tsx          new   picker + step 2
+     provider-forms.tsx               new   MinIO, R2, PostgreSQL forms from the registry
+     clone-dialog.tsx                 new
+     import-dialog.tsx                new
+     pull-dialog.tsx                  new
+     force-push-dialog.tsx            new
+     confirm-by-name.tsx              new
+     add-project-dialog.tsx           new   (lifted out of store-detail.tsx, unchanged)
      new-store-dialog.tsx                   (moved in from storage/, unchanged)
```

Outside `storage/`:

| File | Change | Lane |
|---|---|---|
| `src/shared/host-api.ts` | the types of [§8.1](#81-types) | A |
| `src/renderer/src/host/client.ts` | `checkStorage(body)`, `push(store, remote, { force })`, `onHostEvent` typed as `HostEvent` | A |
| `host/storage.js` | the extended view, job sampling and rate/ETA, `force`, `error.code`, import log, totals, supports | B |
| `host/storage-sync.js` | **new**: the pure state function (§4.3) and aggregation (§4.5) | B |
| `host/storage-checks.js` | **new**: the check cache, concurrency, E3/E5/E7 calls, feature detection | B |
| `host/projects.js` | `storeBytes` gains the `-shm` stat and a batch form for all Stores; the project list joins `storeSync`, `storeProviders`, `connection` | B |
| `host/server.js` | `POST /api/storage/check`; `sync` and `storage` events | B |
| `host/test/storage.test.js`, **new** `host/test/storage-sync.test.js` | the state table of §4.3, one case per row; refusal pass-through; rate/ETA | B |
| `src/renderer/src/components/compute/docker-card.tsx` | import `workerChip` from `storage/machine/worker` | C |
| `src/renderer/src/components/projects/home/project-card.tsx` | Store well: `StoreIcon`, family line, compact `SyncPill` or job | D |
| `src/renderer/src/components/projects/new-project-dialog.tsx` | Store select: `StoreIcon`, size, compact pill | D |
| `src/renderer/src/components/projects/project-storage.tsx` | StoreCard title: family, `StoreIcon`, pill | D |
| `src/renderer/src/App.tsx` | hash forms `#storage/<view>/<id>` | C |
| `docs/ui/layerfs-storage.md` | replaced by this spec, rewritten as-built; `docs/ui/README.md` table unchanged | last |

Lanes: **A** contract (types, client), then in parallel **B** host, **C**
renderer storage (overview, details, dialogs, transfers), **D** project
surfaces. C can split further by folder (`overview/`, `detail/`, `dialogs/`,
`transfers/`) once `identity/`, `sync/` and `size.tsx` exist. The engine asks
(E1–E9) go to LayerFS #506 as one issue comment; every renderer part works
without them ([§10](#10-states)).

---

## 10. States

### 10.1 Loading

- First load: the summary strip shows four `Skeleton` cells. Each band shows
  its header with "Reading…" and three skeleton rows. Copy locations show one
  skeleton group.
- Later reloads keep the last view on screen (`useHostQuery` with key
  `storage`) with no spinners. Only Check now shows a spinner.
- Store, location and connection pages open on the cached view at once.

### 10.2 Empty

| Case | What shows |
|---|---|
| No Stores at all | The two bands are replaced by one empty card: SQLite mark, "No Stores yet", "A Store holds your projects' history. Make one, or clone one from a copy location.", then "+ New Store" and "Clone…" (Clone only when a location exists). |
| SQLite Stores, no copy locations | The Copy locations block shows a `sc-soon` card: "No copy locations yet. Add a bucket to keep a copy of a Store elsewhere." and "+ Add location". Copies cells read "—", and statuses read Local only. The summary's Sync cell reads "No copies yet". |
| No PostgreSQL connections | The PostgreSQL band collapses to one line: pg mark, "PostgreSQL: Stores that live in a database, for Sandboxes anywhere. Import a SQLite Store into one." and "+ Add connection". |
| A connection with no Stores | its muted row ([§3.1](#31-storage-overview) region 7) |
| A location with no copies | "No copies yet. Push a Store here from its row or page." |
| A Store with no projects | its Projects section empty state; Push disabled |

### 10.3 Errors

- **View read failed** (`/api/storage`): `LoadError` ("the storage") with
  Retry, in place of the bands. The summary strip keeps the last values,
  dimmed.
- **One part failed** (`stores.reason` or `remotes.reason` set): that band
  shows the reason as a danger line under its header. The other band renders
  normally.
- **Docker not answering**: SQLite sizes read "size unknown (Docker is not
  answering)". The This machine link reads "Docker is not answering".
- **Worker down/unhealthy**: the SQLite band header's worker dot reads it. A
  warning `Notice` under the toolbar: "The LayerFS box is down. SQLite Stores
  can't be read or moved until it runs."
- **Low disk**: the SQLite header's free space turns warning, and the
  overview shows the existing "Disk space is low" `Notice`.
- **Action failed before a job started** (a refused request): the error shows
  inline beside the control that sent it, with `role="alert"`, as today.

### 10.4 A LayerFS build without these fields

The page works with every combination. `supports` says which fields are real:

| Missing | Fallback |
|---|---|
| E1 (`bytes` in list) | the host's own stat via the worker; "size unknown" only if that fails |
| E2 (`heads`) | `local` is `unknown`, so only `behind`, `missing`, `checking` and `unknown` can occur (never `in_sync`, `ahead` or `diverged`). With remote `same`, the pill reads **Sync unknown**, tooltip "This LayerFS build can't tell whether work changed since your push 3 h ago", and the Status cell adds "pushed 3 h ago" under it |
| E3 (check) | `remote` is `unknown`; with E2 present and local `changed`, the state is `ahead` (reason "remote not checked"); otherwise **Sync unknown**. Location health reads "status unknown"; Check now is hidden |
| E2 and E3 | every copy is **Sync unknown** with its last push/pull time; Store rows read "Pushed 3 h ago" in the Status cell under the pill, so the page is still useful |
| E4 (progress) | the bar is indeterminate, labelled with the verb ("Pushing…"); the elapsed time replaces the ETA; at the end, bytes from `result` |
| E5/E7 | PostgreSQL sizes read "size unknown", health "status unknown", no version |
| E6 | From reads "—"; Connect's own import log fills it for imports Connect started |
| E8 | MinIO and R2 available, the rest Coming |
| E9 | location pages list only Stores linked from this machine, with the footnote |
| no #506 at all (`stores.available: false`) | one quiet card: "This LayerFS build keeps one Store per project. Stores, copies and PostgreSQL need layerfs#506." The SQLite band lists each project's own Store from `/api/projects` with its size (the host's stat), no Copies column, and the This machine link. Add location and New Store are disabled inside `Unavailable` |
| a host from before `/api/storage` | as the row above |

### 10.5 Narrow window

The layout uses container queries on the page body (`@container/storage`):

| Width of the body | Changes |
|---|---|
| ≥ 1040 px | as drawn |
| 760–1039 px | Summary strip 2 × 2. SQLite table drops the Projects column (the count moves under the name). The Copies cell shows marks with state icons only, no remote names. PostgreSQL rows drop Created. Location rows hide the location line |
| < 760 px | Rows become two-line cards: line 1 is `StoreIcon`, name and pill; line 2 is size, projects and copy marks, with the action at the right. Summary strip becomes one row of four compact numbers that scrolls horizontally. Band header actions move under the title. Dialogs go full width (`sm:` breakpoints already do). Store page sections stack; the two-sided panel stacks vertically, with the arrow turned down |

There is no horizontal page scroll at any width. Long names, paths and URLs
truncate in the middle, with the full value in `title`.

### 10.6 Dark mode

Every colour is a token from `styles.css` (and the new ones in
[§11](#11-tokens-accessibility-and-motion)), defined for both `:root` and
`.dark`. Brand marks go through `brandColor`, so SQLite's near-black mark
follows the theme in dark mode and pale marks deepen in light. The badge ring
uses `var(--card)`, so it cuts out cleanly on both. `sc-soon` tiles and dashed
rings use `color-mix` on `--foreground` and work in both, as today.

---

## 11. Tokens, accessibility and motion

### 11.1 New tokens (in `styles.css`, `:root` and `.dark`)

```css
:root {
  /* Sync states (§4.4): aliases, so the meaning has one name. */
  --sync-ok: var(--success);
  --sync-ahead: var(--primary);
  --sync-behind: var(--warning);
  --sync-diverged: var(--destructive);
  --sync-unknown: var(--faint);
  /* A provider badge's cut-out ring and size. */
  --badge-ring: var(--card);
}
.dark { /* the aliases follow the dark values of their sources; nothing to redefine */ }
```

Register them under `@theme inline` as `--color-sync-*`. `Chip` gains no new
tones: `success`, `info`, `warning`, `danger` and `neutral` map onto the
states. `unknown` adds a dashed ring through a `dashed` prop on `Chip`
(`ring-0 border border-dashed border-foreground/20`).

### 11.2 Accessibility

- **Not colour-only:** every state has an icon and words. Copy pills, which
  show only an icon in narrow layouts, carry `aria-label` "r2-team: Changes to
  push" and a tooltip.
- **Tables:** the shadcn `Table` gives table semantics. Sortable headers are
  buttons with `aria-sort`. The row's name button is the row's link. Action
  buttons have labels that name the Store ("Push work to r2-team").
- **Keyboard:** `/` focuses search; Tab moves name → action → `…` per row. In
  the provider picker, arrow keys move between tiles (`role="radiogroup"`
  semantics are not needed: tiles are buttons in a grid with roving focus).
  Every dialog traps focus and returns it to the control that opened it.
- **Progress:** `role="progressbar"` with `aria-valuenow`/`aria-valuemax`
  when the total is known, and `aria-valuetext` "Upload, 412 MB of 1.0 GB,
  about 47 seconds left". Live announcements are only for phase changes and
  ends (§5.3).
- **Focus rings:** `focus-visible:ring-2 ring-ring` on every interactive
  element, as elsewhere.
- **Destructive actions** need a typed name where data is lost (§3.12). The
  confirm button uses the destructive variant and is never the default for
  Enter until the name matches.

### 11.3 Motion

- Bands and rows rise in with `reveal`, staggered (`revealStyle`), on first
  load only.
- A pill that changes state cross-fades over `--dur-base`. A Store whose job
  ends flashes its row once (`live-flash`).
- Bars ease with `--ease-out-expo`. Running rows keep the `sc-live-row` edge.
- The global reduced-motion rule settles everything; the stepper's pulse and
  spinners stop, and progress still updates.

---

## 12. Open questions

1. **Engine choice for E2.** A heads digest (preferred) or a publish counter.
   The contract stays the same either way ([§8.3](#83-engine-asks)).
2. **Where the R2 badge sits when a Store's linked remote is not its most
   urgent copy.** This spec orders badges by link, then recency (identity),
   and leaves urgency to the pill. Confirm with the owner.
3. **`synchronous_commit` edits** on an existing connection: not in v1 (forget
   and add again). Should the connection page offer it?
4. **Bucket listing (E9)** decides whether a location page can show copies
   other machines pushed. Without it, cloning another machine's Store needs
   its name.
5. **Sandboxes on PostgreSQL Stores.** PostgreSQL Stores now run Sandboxes,
   sessions and scenarios. A "In use: 2 Sandboxes" column would need a join
   with Compute's data. It is left out of v1 to keep the band about storage.

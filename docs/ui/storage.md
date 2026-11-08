# Storage

## Desktop Storage: Store cards and project carousels

Source: `desktop/src/renderer/src/pages/storage/{StoragePage,StoreSection}.tsx`
and `storage.css`. Existing Store and project routes are preserved.

```text
Storage                 [Search Stores and projects] [Backup buckets] [+ New Store]
10 Stores - 22 projects - actual SQLite bytes

+-[1] Store -------------------------+  +-[1] Store -------------------------+
| <store> studio         SQLite [...]|  | <store> build-cache     SQLite [...]|
| [2] LayerFS Home    [3] 213 KB      |  | [2] build - Lima       [3] 213 KB     |
|                                   |  |                                     |
|                                   |  |                                     |
|                                   |  |                                     |
| [4] Projects - 3           [<] [>]  |  | [4] Projects - 3             [<] [>]  |
| +----------------+ +--------------|  | +----------------+ +----------------|
| | <LayerFS> design| | <LayerFS> docs|  | | <LayerFS> cli   | | <LayerFS> comp|
| +----------------+ +--------------|  | +----------------+ +----------------|
| [5] No backup yet    [+ Add project]| | [5] No backup yet      [+ Add project]|
+-----------------------------------+  +-------------------------------------+
```

1. Responsive grid: minimum track 360px, cards capped at 480px; near-square
   proportions with a minimum height, and extra height for errors or jobs.
2. SQLite is either LayerFS Home or one assigned machine (linked). PostgreSQL
   shows its database target and Shared across machines. When available, Used by
   links list distinct machines with recorded Sandboxes across all its projects,
   including projects hidden by search. These are placements, not live database
   connections. No single machine binding is implied for PostgreSQL.
3. Physical SQLite size sits at the right of the location line, with no separate
   size row or divider. PostgreSQL uses its database location. Store cards omit
   routine Store, machine and PostgreSQL server status badges.
4. Project tiles show the LayerFS icon and name on one left-aligned row,
   a quiet storage line immediately underneath, then branch and Sandbox/Workspace
   counts as a compact block. PostgreSQL
   projects also list their own Sandbox machine names (truncated with tooltip).
   Tiles are 180px wide and at least 144px tall.
   The carousel fills the card's remaining height instead of leaving an auto
   spacer above it. Location-to-project spacing is 20px; tile gaps are 12px.
   Horizontal
   native scrolling, snap alignment, keyboard focus and previous/next controls;
   arrows appear only with overflow and disable at either end. Reduced motion
   disables smooth scrolling. Project click opens the existing Files route.
   Search filters projects before the carousel; a changed set resets its scroll.
5. Existing backup controls, Add project and Store menu actions remain.
   Busy jobs, refusals and doctor findings stay visible. Empty Stores show
   No projects yet; Add project keeps its existing availability rules.

The shared Store section also uses the carousel on a machine's Stores view.
Project summaries load when a tile nears the viewport. Branch counts include
main. The storage line uses the project's compressed content size, never the
parent Store's bytes. Partial statistics say "in saved history" and their tooltip
explains excluded Init, main layers, earlier history and Store overhead. Missing
footprints show Storage followed by an em dash. There is a 5px name-to-storage
gap and 10px between groups; counts no longer have an auto spacer above them.
Unavailable counts use an em dash. Sandbox and Workspace counts reuse the shared machine inventory;
unknown Workspace counts stay unknown, while known empty projects show zero.
No compression or deduplication diagrams appear in these cards.

## Desktop Store workspace

Source: `desktop/src/renderer/src/pages/storage/StorePage.tsx`, shared
`StoreSection.tsx` ProjectTile, `StorageRoute.tsx`, `NewProjectDialog.tsx`, `storage.css`.
Route: `#/storage/:store`. Replaces the desktop Projects/Activity/Backups/Settings tabs.

```text
[1] Storage / shop                                               [Actions ...]

[2] <store> shop  SQLite                              221 KB   [+ Add project]
            LayerFS Home - store/shop

+-[3] Store storage breakdown -----------------------------------------------+
| Placeholder on real hosts; labeled sample scenario in the web preview      |
+----------------------------------------------------------------------------+

[4] Projects - 2                                          [Search projects...]
+-----------------------+ +-----------------------+
| <LayerFS> api         | | <LayerFS> web          |
| project storage line  | | project storage line   |
| Branch / Sandbox /    | | Branch / Sandbox /     |
| Workspace counts      | | Workspace counts       |
+-----------------------+ +-----------------------+

[5] Backups - 1                                                 [Back up...]
backups / shop - last saved 8h ago                         [Back up now]

[6] > Recent operations - This session
[7] > Store details
```

1. Breadcrumb returns to Storage. Menu preserves Store-wide transfer, backup,
   removal and PostgreSQL disconnection actions and their existing refusals.
2. SQLite is in Home or on one machine; PostgreSQL uses a database target and
   Shared across machines. Routine status badges are omitted. Errors, stopped
   machines and active jobs remain visible with manual Start / retry controls.
3. Real hosts keep the static placeholder. Development web previews show a
   labeled simulated scenario with Hide sample / Show sample. Sample values are
   independent of actual Store sizes. Reported physical SQLite bytes remain
   beside the location. No project history graph appears.
4. Responsive project grid, reusing the board's ProjectTile; no carousel here.
   Search is scoped to this Store, with Clear search and empty Store states.
   Clicking a tile opens its existing project Files route. Add project creates
   an empty project via the existing Init job; the form waits for completion,
   reports errors, and refreshes the catalog. No automatic machine start.
5. SQLite only: linked backup destinations, saved time and size, backup controls,
   and Restore when a backup file is listed. All projects travel with the Store.
   PostgreSQL instead shows distinct machines with recorded Sandboxes using any
   of its projects, with links to machine pages; this is not a connection registry.
6. Native disclosure with session-only push/pull/move/backup jobs; clear empty text.
7. Native disclosure with creation/location/file facts and removal/disconnection
   controls. Existing confirmation dialogs remain. No project graphs in details.

### Store storage diagram simulation

Source: `StoreBreakdown.tsx`. Based on `layerfs_v2_0_0` physical-storage docs:
canonical content identity reuse, full/delta encoding, Zstandard compression
where useful, and immutable payload/metadata packs.

```text
Full snapshots       Distinct objects       Encoded packs        SQLite file
    12 GiB                3 GiB               1.125 GiB             1.5 GiB
       =======> narrow ========> narrower ==========> slight increase
              4.0x dedup       2.7x encoding        +384 MiB file space

> File composition - sample 1.5 GiB
  [Payload 1 GiB | Metadata 128 MiB | Tables/indexes 256 MiB | Free 128 MiB]
```

The compact ribbon follows the project-storage flow's visual structure. Its
thickness uses one linear scale; badges explain each transition. Detailed file
composition is collapsed by default in a native disclosure.
Encoded packs include metadata packs; composition
does not add those twice. WAL is separate from the SQLite file. PostgreSQL shows
only payload/metadata pack composition (1.125 GiB), with database overhead
explicitly unmodeled. It never shows SQLite free-page stats.
Store headers use 20px titles with a 4px location gap; section spacing is 18px,
with 168px minimum project tiles. Flow labels use responsive grid columns.

## Desktop project files

In `desktop/`, opening a project row on Storage or a Store's Projects tab
navigates to `#/storage/:store/:project/files`. The page's Back link returns to
the Store. It uses the same `components/files/ProjectFiles.tsx` and `FilesTab.tsx`
as chat's Files tab: branch picker, expandable directory tree, search over
opened folders, closeable file tabs, and read-only code with syntax highlighting.
Reads use the selected LayerFS project and branch; opening the page does not
mount a Workspace or start a Sandbox. The browser shows loading, retryable
errors, empty folders and binary/oversize-file states.

Source: `src/renderer/src/components/storage/*`, `src/renderer/src/data/job-progress.ts`,
`src/renderer/src/host/storage-jobs.ts`     Opens from: sidebar Storage; a Store link
(`go.store`, focus `store:<name>`) opens the Store page in place of the board.

Paths below are relative to `src/renderer/src/components/storage/` unless they start with `data/`,
`host/` or `components/`.

## Storage board: Stores tab

```text
+-[1] PageHeader (sticky) -----------------------------------------------------------------------+
| Storage  [2]( |Stores 3| Backups 1 )  [3](* 1 running - 1 failed)                              |
|                                [4][<flask> Live host v]   [5][+ New Store]*   [6][<rotate>]    |
+------------------------------------------------------------------------------------------------+
+-[7] Refused -----------------------------------------------------------------------------------+
| <!>  Refused                                                                       [Dismiss]   |
|      <code>: <message>                                                                         |
+------------------------------------------------------------------------------------------------+
                                [8] 438 KB in 2 sqlite Stores   [9] <ok> Doctor: nothing found
+-[10] Needs attention (only while [9] is open) -------------------------------------------------+
| Needs attention (layerfs doctor) - 2 findings (1 refusing calls) - checked just now            |
|------------------------------------------------------------------------------------------------|
| (error) store lab                                                                              |
| <message>                                                                                      |
| fix: <call>                                                                                    |
| ...                                                                                            |
+------------------------------------------------------------------------------------------------+
+-[11] Stores grid: home, then machines (by machine, name), then PostgreSQL ----------------------+
| +-[12] shop ----------------+   +-[12] lab -----------------+   +-[12] team ----------------+  |
| | [sqlite] shop       [...] |   | [sqlite] lab        [...] |   | [pg] team           [...] |  |
| | (* In use)  221 KB        |   | (Idle)  217 KB            |   | (Idle)                    |  |
| | Location  LayerFS Home .. |   | Location  lima1 (Running) |   | Location  app@db.intern.. |  |
| | Backup    backups/shop    |   | Backup    No backup loc.. |   | Server    (Connected)     |  |
| | api   runs on native      |   | notes                     |   | crm                       |  |
| | web                       |   |                           |   |                           |  |
| |---------------------------|   |---------------------------|   |---------------------------|  |
| | [Push to...][Back up now] |   | [Pull to home][Back up..] |   | [Add project]             |  |
| +---------------------------+   +---------------------------+   +---------------------------+  |
+------------------------------------------------------------------------------------------------+
  [13] <clock> Store totals (dedupe, compression, what Init stored) comes with a later LayerFS.
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | PageHeader | storage-page.tsx:265 | sticky; "Storage"; badges once the view is read |
| 2 | Segmented | storage-page.tsx:273 | tabs with counts: Stores (all Stores), Backups (buckets) |
| 3 | JobsChip | job-progress.tsx:323 | hidden at 0; click: Stores tab, flash the card |
| 4 | SimulationPicker | components/simulation.tsx:78 | dev builds only: Live host or a sample |
| 5 | New Store | storage-page.tsx:303 | Stores tab only; opens New Store on Empty Store |
| 6 | Refresh | storage-page.tsx:333 | rereads storage, machines and doctor |
| 7 | Notice | storage-page.tsx:344 | a refused action (or simulated refusal); Dismiss clears it |
| 8 | summary | storage-page.tsx:352 | Stores tab, sqlite only: "{size} in {n} sqlite Stores" |
| 9 | DoctorBadge | needs-attention.tsx:23 | `layerfs doctor`; opens [10]; hidden when simulated |
| 10 | DoctorFindings | needs-attention.tsx:46 | severity chip, entity, message, `fix:` call |
| 11 | cards grid | storage-page.tsx:145 | auto-fill, min 17.5rem; home, machines, PostgreSQL |
| 12 | StoreCard | store-card.tsx:137 | click opens the Store page (Cmd/middle: new tab) |
| 13 | GapLine | storage-page.tsx:376 | shown when any Store exists |

## Storage board: Backups tab

```text
+-[1] PageHeader --------------------------------------------------------------------------------+
| Storage  ( Stores 3 |Backups 1| )                                                              |
|     [4][<flask> Live host v] [2][<archive> Back up a Store... v] [3][+ New bucket]* [<rotate>] |
+------------------------------------------------------------------------------------------------+
                                                                [9] <ok> Doctor: nothing found
+-[5] bucket card (one per bucket) --------------------------------------------------------------+
| <archive> backups  MinIO  - listed just now                [<list> List files] [Disconnect...] |
|------------------------------------------------------------------------------------------------|
| FILE      STORE         STATE              SIZE        WRITTEN                                 |
| shop      <db> shop     (Store changed)    221 KB    6 hours ago               [Restore...]    |
+------------------------------------------------------------------------------------------------+
  [6] A restore always saves the Store in the home; push it to a machine afterwards.
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | PageHeader | storage-page.tsx:265 | Backups actions replace New Store; no summary text |
| 2 | Back up a Store... | storage-page.tsx:309 | sqlite Stores; disabled with none or no bucket |
| 3 | New bucket | storage-page.tsx:327 | opens the New bucket sheet |
| 5 | BucketCard | bucket-card.tsx:36 | header, error notice, file table |
| 6 | footer note | storage-page.tsx:396 | always shown, also under the empty state |

```text
Back up a Store... menu  (storage-page.tsx:317)
+-------------------------------+
| <house> shop            Home  |
| <hd>    lab            lima1  |   item disabled while the Store is down or busy
+-------------------------------+
```

## Store card zoom-ins

```text
+-[1] sqlite in the home ------------------------------------+
| [2][sqlite] [3]shop                                [4][...]|
|             [5](* In use)  221 KB                          |
| [6]Location  <house> LayerFS Home  store/shop              |
| [7]Backup    <archive> backups/shop                        |
|              (Store changed)  6 hours ago                  |
| [8] <folder> api                         runs on native    |
|     <folder> web                                           |
|------------------------------------------------------------|
| [9] [<up> Push to...]          [<sync> Sync backup]        |
+------------------------------------------------------------+

+-[1] sqlite on a machine -----------------------------------+
| [sqlite] lab                                         [...] |
|          (Idle)  217 KB                                    |
| Location  <hd> lima1  lima  (Running)                      |
| Backup    <archive> No backup location                     |
| <folder> notes                                             |
|------------------------------------------------------------|
| [<down> Pull to home]          [<archive> Back up...]      |
+------------------------------------------------------------+

+-[1] PostgreSQL --------------------------------------------+
| [pg] team                                            [...] |
|      (Idle)                                                |
| Location  <db> app@db.internal:5432/layerfs                |
| [10]Server  (Connected)  PostgreSQL 16.4 - 3 ms            |
| <folder> crm                                               |
|------------------------------------------------------------|
| [<folder+> Add project]                                    |
+------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | StoreCard | store-card.tsx:147 | ring amber/red: attentionOf (:74) or a failed job |
| 2 | StoreIcon | identity/store-icon.tsx:22 | family mark only (SQLite / PostgreSQL), never state |
| 3 | name | store-card.tsx:160 | button stretched over the card: opens the Store page |
| 4 | StoreMenu | store-card.tsx:324 | the card's `...` menu (see Menus) |
| 5 | StateChip, size | store-card.tsx:166 | chip + op words; size or "size unknown" (sqlite) |
| 6 | Location | store-card.tsx:265 | home file; machine link + platform + chip; pg target |
| 7 | Backups | store-card.tsx:402 | per link: `bucket/file`, chip or "not listed", when |
| 8 | projects | store-card.tsx:205 | 3, then "{n} more" / "Show fewer"; "runs on ..." |
| 9 | footer moves | store-card.tsx:248 | movesOf (:107): at most two; first outline, second ghost |
| 10 | PgState | store-card.tsx:298 | Connected + version/latency; Not reachable + error; Unknown |

```text
Card body variants
  no projects:   No projects yet                         [<folder+> Add project]  (sqlite only)
  pg unknown:    Server  (Unknown)  usable from every machine           dashed chip
  pg down:       Server  (Not reachable)
                         connection refused                             red text
  backup row:    <archive> backups/shop
                 not listed  6 hours ago                                before the bucket is listed
```

```text
Footer moves (movesOf, store-card.tsx:107); at most two buttons
  first:   machine stopped -> [Start lima2]   title "lima2 is stopped: nothing starts it for you."
           in the home     -> [Push to...]          disabled unless idle
           on a machine    -> [Pull to home]        disabled while busy; none while down
  second:  (none while down or the machine is stopped)
           a link Store changed   -> [Sync backup]   backs up to that link at once
           a link Bucket changed  -> [Restore...]    opens Restore on that file
           has links, none Both   -> [Back up now]   to the first link at once
           else                   -> [Back up...]    opens Back up
  PostgreSQL: [Add project] only
```

### Card footer: jobs and other states

```text
+-[1] job running ----------------------------------------------+
| Pushing to lima1                                      sending |
| ##-##-####======........-..-..-..                             |
| 96.0 KB / 221 KB                     48 KB/s - under a minute |
+---------------------------------------------------------------+
+-[1] move running ---------------------------------------------+
| Moving to lima2                                        1 of 2 |
| Pull to Home  >  Push to lima2                                |
| ##-##-###=.....-..-..-..   ..-..-........-..-..-..            |
| step 2 of 7                                                   |
+---------------------------------------------------------------+
+-[2] job done (one minute) ------------------------------------+
| <ok> Pushed to lima1 - just now                      221 KB   |
|      took 4 s                                                 |
+---------------------------------------------------------------+
+-[3] job failed (until dismissed) -----------------------------+
| <x> Push to lima1 failed in verify                        [x] |
|     <code>: <message>                                         |
|     [Try again]  [Details]                                    |
+---------------------------------------------------------------+
+-[3] move whose push half failed ------------------------------+
| <ok> Pulled to Home                                           |
| <x> Push to lima2 failed in send                          [x] |
|     <code>: <message>                                         |
|     [Push to lima2 again]  [Details]                          |
+---------------------------------------------------------------+
+-[4] another client's operation (busy + op) -------------------+
| Being pushed by another client                        sending |
| ~~~~~~~~~~~~~~~~~~~~~~~~~ pulsing bar ~~~~~~~~~~~~~~~~~~~~~~~ |
| started 2 minutes ago                                         |
+---------------------------------------------------------------+
+-[5] down / unresolved + moves --------------------------------+
| machine lima1 is stopped                                      |   s.down, red
| [<power> Start lima1]                                         |
+---------------------------------------------------------------+
| see layerfs store status lab - clear: layerfs store push lab  |   unresolved, mono, red
|   <machine> (or store pull lab)                               |
| [<down> Pull to home]          [<archive> Back up...]         |
+---------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | JobPanel running | job-progress.tsx:104 | words, step (move: "{n} of 2"), JobBar, Measures |
| 2 | JobPanel done | job-progress.tsx:116 | for 60 s (SHOW_DONE_MS, data/job-progress.ts:166) |
| 3 | JobPanel failed | job-progress.tsx:128 | x dismisses; Details opens the Store page |
| 4 | OpPanel | job-progress.tsx:164 | push / pull / backup by another client, else "Busy: {op}" |
| 5 | down / unresolved | store-card.tsx:241 | the reason line, then the moves of movesOf |

Bar: one segment per step; byte steps (send, upload, download) 8x wide and fill by bytes; others
fill when done; failed step red; a step with no byte total pulses. Measures show bytes / total,
speed and time left while bytes come, else "step {at} of {of}".

## Bucket card

```text
+-[1] header ------------------------------------------------------------------------------------+
| <archive> backups  MinIO  - listed just now                [<list> List files] [Disconnect...] |
+------------------------------------------------------------------------------------------------+
+-[2] The bucket did not list -------------------------------------------------------------------+
| <!> The bucket did not list                                                                    |
|     <code>: <message>                                                                          |
+------------------------------------------------------------------------------------------------+
  [3] FILE   STORE        STATE              SIZE       WRITTEN
      shop   <db> shop    (Store changed)    221 KB   6 hours ago                  [Restore...]
      ...
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | header | bucket-card.tsx:40 | MinIO / Cloudflare R2; "listed {when}" / "not listed yet" |
| 2 | Notice | bucket-card.tsx:56 | the last listing's error |
| 3 | file table | bucket-card.tsx:68 | Store link opens its page; Restore... hidden for Missing |

```text
Not listed:  List the bucket to see its files and their states (it is asked on each listing).
Empty:       No backups in this bucket.
Listing:     [<list spinning> List files] disabled
```

BACKUP states (bucket-card.tsx:15), also used on the Store card and Store page:

| state | chip | tone |
|---|---|---|
| current | Backed up | success |
| store_changed | Store changed | warning |
| bucket_changed | Bucket changed | warning |
| both_changed | Both changed | danger |
| unknown | Unknown | neutral, dashed |
| unlinked | Not linked | neutral |
| missing | Missing | danger |

## Store page

```text
[1] Storage / shop
+-[2] header ------------------------------------------------------------------------------------+
| [sqlite]  shop  SQLite Store  (* In use)                        [3][<up> Push to...]  [4][...] |
|           file on <hd> native - 221 KB - created 20 days ago                                   |
+------------------------------------------------------------------------------------------------+
+-[5] attention (down, unresolved or machine stopped) -------------------------------------------+
| lima2 is stopped: nothing starts it for you.                             [<power> Start lima2] |
+------------------------------------------------------------------------------------------------+
+-[6] job steps (or another client's op panel) --------------------------------------------------+
| Pushing to lima1   for 12 s                                         48 KB/s - under a minute   |
| <ok>   check                                                             0 s                   |
| <ok>   snapshot                                                          1 s                   |
| <spin> send     ######.........                              96.0 KB / 221 KB                  |
| <ring> verify                                                                                  |
| <ring> install, record, retire: one row each                                                   |
+------------------------------------------------------------------------------------------------+
[7] Projects 2  A push, pull or move carries them all                    [<folder+> Add project]
+------------------------------------------------------------------------------------------------+
| Project      Runs on               Chats            Last activity                              |
| api          (native)              -                3 days ago                              >  |
| web          not running           -                3 days ago                              >  |
+------------------------------------------------------------------------------------------------+
[8] Activity  this session
+------------------------------------------------------------------------------------------------+
| <ok> Backup   -> backups/shop             221 KB  took 3 s                 14:02               |
| <x>  Push     Home -> lima1               failed in verify                   13:58  v          |
|      <code>: <message>                                                                         |
+------------------------------------------------------------------------------------------------+
[9] Backups                                                                [<archive> Back up to...]
+------------------------------------------------------------------------------------------------+
| <archive> backups  shop                        221 KB   6 hours ago   (Store changed)          |
+------------------------------------------------------------------------------------------------+
[10] Details
+------------------------------------------------------------------------------------------------+
| FAMILY        FILE ON       FILE          WAL                                                  |
| SQLite        native        221 KB      0 B                                                    |
| CREATED                     OPEN NOW                                                           |
| <date time>                 1 process has it open                                              |
|------------------------------------------------------------------------------------------------|
| [11] Danger zone  [<trash> Remove shop...]  The Store and every project in it go; backups in   |
|      buckets stay.                                                                             |
+------------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | Crumbs | store-page.tsx:74 | `Storage / <name>`; back button when opened elsewhere |
| 2 | header | store-page.tsx:99 | family, chip; line: file on + size, or pg target |
| 3 | main move | store-page.tsx:136 | home: Push to... (idle); machine: Pull to home |
| 4 | StoreMenu | store-card.tsx:324 | the same menu as the card |
| 5 | attention box | store-page.tsx:149 | down / unresolved / stopped + Start; red on danger |
| 6 | JobSteps / OpPanel | job-progress.tsx:182 | per step: mark, name, bar, time; failure |
| 7 | Projects table | store-page.tsx:176 | rows open the project; aside: sqlite, 2+ projects |
| 8 | JobActivity | job-progress.tsx:268 | this window's jobs, newest first; hidden if none |
| 9 | Backups | store-page.tsx:258 | sqlite only; per link: bucket, file, size, written, chip |
| 10 | Details | store-page.tsx:301 | facts; pg has no File / WAL |
| 11 | Danger zone | store-page.tsx:316 | pg: [Disconnect team...] + its own line |

```text
Job steps, ended badly (job-progress.tsx:230)
| Push to lima1 failed in verify   took 9 s                                                      |
| <ok> check, snapshot, send   <x> verify   <ring> install, record, retire   (one row each)      |
|------------------------------------------------------------------------------------------------|
| <code>: <message>                                                                              |
| [Try again]  [Dismiss]                         (move after its pull: [Push to lima2 again])    |

Refused notice [7] of the board also shows above the crumbs (storage-page.tsx:240).
Move steps: two columns "1 of 2: pull to Home" | "2 of 2: push to lima2", 7 steps each.
Chats cell: "-", or "{count}  * {n} working". Runs on: machine chips, "not running", or "-"
when machines were not read. Backups empty: "Not backed up. Back it up to a bucket from here or
from its menu."  Not found: Empty "No Store named {name}" / "It was removed or disconnected, or
this home never had it."
```

## States

```text
Loading:        Loading "Reading the Stores"                               (storage-page.tsx:341)
Error:          LoadError "Could not read the storage" + message, [<rotate> Try again]
Empty Stores:   +-----------------------------------------------------------+
                | <hd>  No Stores yet                                       |
                | Create a Store in the home, restore one from a backup, or |
                | connect a PostgreSQL database.          [+ New Store]     |
                +-----------------------------------------------------------+
Empty Backups:  +-----------------------------------------------------------+
                | <archive>  No bucket connected                            |
                | No bucket connected. Connect an r2 or MinIO bucket to     |
                | back Stores up.                         [+ New bucket]    |
                +-----------------------------------------------------------+
```

Store states (StateChip, data/states.ts:35), with what the card does:

| state | chip | card |
|---|---|---|
| idle | (Idle) success | all moves enabled |
| in_use | (* In use) info, live | Push to... disabled (needs idle) |
| busy | (* Busy - store.push - send) warning, live | op panel; moves, menu disabled |
| down | (Down) danger | red ring, reason line; Pull/backup moves gone; Back up to... disabled |
| unresolved | (Unresolved) danger | red ring, `see ... - clear: ...` line |
| unknown | (Unknown) neutral, dashed | Push to... disabled (needs idle) |

Job kinds (data/job-progress.ts:16 steps, :92 running, :101 ended; job-progress.tsx:259 route):

```text
kind     steps                          running / done / failed words           Activity route
push     check snapshot send verify     Pushing to lima1 / Pushed to lima1 /     Home -> lima1
         install record retire          Push to lima1 failed in {phase}
pull     same 7                         Pulling from lima1 / Pulled from lima1   lima1 -> Home
move     7 for the pull, 7 for the push Moving to lima2 / Moved to lima2         lima1 -> lima2
backup   snapshot send upload           Backing up to backups / Backed up to ... -> backups/shop
restore  download install               Restoring from backups/shop /            backups/shop->Home
                                        Restored from backups
```

A move whose push half failed (`error.note === 'pulled'`): the Store is back in the home; the card
shows "Pulled to Home" + "Push to {place} failed in {phase}", and retry runs that push only
(storage-page.tsx:135).

```text
JobsChip:     (* 2 running)   (* 1 running - 1 failed)   (x 1 failed)    each Store's latest job
Doctor badge: <spin> Doctor: checking...        disabled, grey
              <ok>   Doctor: nothing found      disabled, grey
              <steth> Doctor: 3 findings  >     amber; red when any finding is an error
              <steth> Doctor did not answer >   red; opens the refusal text instead of the card
Simulated:    the sample host's Stores and buckets are drawn; doctor badge and findings hidden;
              every action (and opening a project) shows [7] Refused:
              "Simulated: This is sample data: nothing is sent to the host. Pick Live host to act."
```

## Menus and dialogs

```text
Store menu [...] (store-card.tsx:324)
 sqlite in the home              sqlite on a machine                   PostgreSQL
+----------------------------+  +----------------------------------+  +-------------------+
| <up> Push to...            |  | <down> Pull to home              |  | <folder+> Add     |
|      Moves api, web        |  |        Moves notes               |  |   project         |
| <archive> Back up to...    |  | <swap> Move to another machine...|  |-------------------|
| <folder+> Add project      |  |        Moves notes               |  | <unplug>          |
|----------------------------|  | <archive> Back up to...          |  |   Disconnect...   |
| <trash> Remove...    (red) |  | <folder+> Add project            |  +-------------------+
+----------------------------+  |----------------------------------|
 Push: idle only                | <trash> Remove...          (red) |
 Back up: not down/busy         +----------------------------------+
 Add project: not down/busy      Pull, Move: not busy
 no projects: "Moves the Store (no projects yet)"
```

```text
+-[1] New Store (wide sheet) --------------------------------------------------+
| [+] New Store                                                            x  |
| A new SQLite Store saved under the home, with no projects yet. Add projects |
| to it, then push it to any machine.                                         |
| [2] +---------------------------+  +---------------------------+            |
|     | [sqlite] SQLite      (lit)|  | [pg] PostgreSQL           |            |
|     +---------------------------+  +---------------------------+            |
| [3] ( |<+> Empty Store| <dl> Restore from a backup )                        |
| --------------------------------------------------------------------------- |
| STORE                                                                       |
| Name                                                                        |
| ~~~ work ~~~______________________________________________________________  |
| [4] Still needed: name                                                      |
|                                              [Cancel]  [<+> Create Store]*  |
+-----------------------------------------------------------------------------+

Restore from a backup                       (no bucket: dashed box "No bucket connected yet.
| SOURCE                                     Backups live in buckets; connect one on the Backups
| Bucket                                     tab."  [<unplug> New bucket...] -> Backups tab +
| [v backups - MinIO]  [<sync> List files]       New bucket sheet)
|                                  * listed  (dot: green listed, red refused, grey not listed yet)
| +-------------------------------------------------------------------+
| | (o) shop                                  from shop     221 KB    |
| +-------------------------------------------------------------------+
|   ~~~ List the bucket's files to choose one. ~~~ / No Store files in this bucket.
| STORE
| New Store's name
| shop-restored______________________     (picking a file fills it; "-restored" if the name exists)
|                                              [Cancel]  [<dl> Restore Store]*

PostgreSQL
| STORE                                                   description: "A database as a Store.
| Name                         synchronous_commit           It is never pushed or pulled; ..."
| ~~~ team ~~~__________       [v Choose          ]
|                              Left out: the database's own setting.
| DATABASE
| URL, without the password                Password
| ~~~ postgresql://user@host:5432/db ~~~   ~~~ file:/Users/me/.config/layerfs/team.password ~~~
| A URL that holds a password is refused.  A reference: file:/absolute/path (readable by you
|                                          only) or env:LAYERFS_<NAME>.
| Still needed: name, URL, password reference
|                                              [Cancel]  [<db> Connect]*
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | NewDialog | new-dialog.tsx:42 | in FormSheet (storage-dialogs.tsx:35); refusal above hint |
| 2 | TileChoice | new-dialog.tsx:97 | SQLite (Empty Store pane) or PostgreSQL |
| 3 | Segmented | new-dialog.tsx:108 | SQLite only: Empty Store / Restore from a backup |
| 4 | hint | new-dialog.tsx:95 | "Still needed: ..." while fields are missing; submit disabled |

```text
+-[1] Push shop to... ---------------------------------------------------+
| <up> Push shop to...                                                x |
| The whole Store goes, every project in it (2); its Sandboxes then run |
| on that machine. Pull brings it back to native.                       |
| Machine                                                               |
| [v lima1 (lima) - running ]   docker (docker) - running / lima2 ...   |
| [2] 38.5 GB free on lima1; the Store is 221 KB.                       |
| [3] (lima2 chosen) lima2's free disk is not known until it runs.      |
|     lima2 is stopped: nothing starts it for you.  [<power> Start lima2] |
| +-[4] Held now: the push is refused while these remain ------------+  |
| | <!> 1 process has it open - Sandbox api-dev (shop/api)           |  |
| +------------------------------------------------------------------+  |
|                                               [Cancel]  [<up> Push]*  |
+-----------------------------------------------------------------------+
Move lab to another machine: <swap> icon, "A pull to the home, then a push to the machine: two
operations. If the push fails, the Store stays in the home and you can push it again.", [Move].
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | PlaceSheet | storage-dialogs.tsx:180 | targets: not native, not its machine, supports sqlite |
| 2 | free disk line | storage-dialogs.tsx:216 | free disk vs size; no target: a hint says so |
| 3 | Start | storage-dialogs.tsx:222 | only when the chosen machine is stopped |
| 4 | held Notice | storage-dialogs.tsx:228 | open processes and the Store's Sandboxes |

```text
+-[1] Back up shop to... ---------------------------------+
| <archive> Back up shop to...                          x |
| A snapshot of the whole Store, taken on its machine and |
| sent through Connect to the bucket.                     |
| Bucket                                                  |
| [v Choose            ]  (none: Connect a bucket first.) |
| File name                                               |
| ~~~ shop ~~~____________________________________        |
| Leave empty for the Store's link, else its name.        |
|                        [Cancel]  [<archive> Back up]*   |
+---------------------------------------------------------+
+-[2] Restore shop ---------------------------------------+
| <dl> Restore shop                                     x |
| Saves the copy in the home as a new Store, with its     |
| projects. The Store the copy came from is not changed.  |
| New Store's name                                        |
| ~~~ shop-restored ~~~___________________________        |
|                           [Cancel]  [<dl> Restore]*     |
+---------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | backup sheet | storage-dialogs.tsx:143 | menus, Back up... move, Store page |
| 2 | restore sheet | storage-dialogs.tsx:163 | bucket row or card Restore... |

```text
+-[1] New bucket (wide sheet) -------------------------------------------------------------------+
| <unplug> New bucket                                                                         x |
| A bucket that holds SQLite Store backups. Connecting it links no Store; you can add as many  |
| as you like.                                                                                  |
| [2] +-------------------------------+  +-------------------------------+                      |
|     | [minio] MinIO           (lit) |  | [cf] Cloudflare R2            |                      |
|     +-------------------------------+  +-------------------------------+                      |
| ---------------------------------------------------------------------------------------------|
| WHERE                                                                                         |
| Name               Bucket                     Prefix                                          |
| ~~~ backups ~~~_   ~~~ your bucket's name ~~~ layerfs_____                                    |
| Endpoint                                                                                      |
| http://localhost:9000______________________________________                                   |
| Each Store backup is layerfs/<file>/store.sqlite.                                            |
| ---------------------------------------------------------------------------------------------|
| KEYS                                                                                          |
| Access key                       Secret key                                                   |
| ______________________           ****************                                             |
| Connect keeps the keys in a file only you can read and gives LayerFS its reference, never    |
| the keys.                                                                                     |
| Still needed: name, bucket, access key, secret key                                            |
|                                                           [Cancel]  [<unplug> Connect bucket]* |
+-----------------------------------------------------------------------------------------------+
Cloudflare R2, WHERE 2nd row:  Account ID ~~~ from the R2 overview page ~~~  Jurisdiction [v None]
                                  (None / EU / FedRAMP)
  https://<account>.r2.cloudflarestorage.com                                     (mono, live)
  Each Store backup is layerfs/<file>/store.sqlite. Use an R2 API token's S3 access key and
  secret, with Object Read & Write on this bucket.
  Account ID check: "The 32-character account ID from the Cloudflare dashboard."
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | BucketSheet | storage-dialogs.tsx:268 | providers with a `request` only (READY, :257) |
| 2 | TileChoice | storage-dialogs.tsx:281 | switching keeps typed values, fills defaults |

```text
+-[1] Remove shop? ---------------------------------------+
| <trash> Remove shop?                                  x |
| The Store and every project in it (2) are deleted with  |
| all their history. Backups in buckets stay.             |
| Type shop to confirm                                    |
| ________________________________________________        |
| <!> <refusal message>                                   |
|                    [Cancel]  [<trash> Remove]*  (red)   |
+---------------------------------------------------------+
+-[2] Disconnect the PostgreSQL Store team? --------------+
| <unplug> Disconnect the PostgreSQL Store team?        x |
| This home forgets the Store and its projects. The       |
| database and its data stay; connect it again to use     |
| them.                                                   |
|                [Cancel]  [<unplug> Disconnect]*  (red)  |
+---------------------------------------------------------+
 Remove wakes only when the typed name matches; busy: "Remove..." with a spinner.
 Bucket: "Disconnect the bucket backups?" / "Every Store's link to this bucket goes too: their
 backup chips and states are lost. The files stay in the bucket."  [Disconnect], no typing.
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | ConfirmByName | storage-page.tsx:204 | dialogs/confirm-by-name.tsx:32; name must match |
| 2 | ConfirmByName | storage-page.tsx:216 | PostgreSQL Store or bucket; one click, no name |

## Notes

- `operations.tsx` (Operations, trayJobs, jobShare, KIND, jobRoute) is imported nowhere.
- `StorageDialog` kinds `new-store` and `postgresql` (storage-dialogs.tsx:24,28) are never opened;
  New Store goes through `NewDialog`, which the board only opens on `empty`.
- `identity/providers.ts`: Amazon S3, Google Cloud Storage, Google Drive and Folder have no
  `request` and are filtered out of New bucket; the `about` field is never read.
- Other unused exports: `DiskGauge`, `LOW_DISK` (meters.tsx), `Dot` (chips.tsx), `BackLink`, `INSET`
  (dialogs/fields.tsx), `placeWords` (store-card.tsx), the `BACKUP` re-export in storage-page.tsx.
  `JobChip` is used only by Machines (compute/machine-data.tsx).
- Dismissed job ids are kept in localStorage `layerfs-connect.storage.dismissed-jobs` (last 100).

## Desktop project routes

Project rows open `/storage/:store/:project/files`. The project header provides Files, History,
Sandboxes and Storage; see [project.md](project.md). Store links remain on `/storage/:store`.

## Available backup providers

The Add bucket provider picker shows only entries with a supported connection
request. Disabled Later LayerFS provider tiles are hidden. StoreBreakdown and
Project statistics previews remain planned UI and are preserved by this cleanup.

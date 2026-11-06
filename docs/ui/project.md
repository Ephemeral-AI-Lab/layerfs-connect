# Project page

Source: `components/projects/` project-view, store-banner, project-sessions, files-tab, code-view,
project-storage, sandbox-tiles, use-sandboxes, store-visuals, states (all under `src/renderer/src/`)
Opens from: a Projects row, a project link anywhere (`go`), `#projects/<key>[/<tab>][/<branch>]`
(a key with its Store encoded: `shop%2Fapi`)

## Page frame

```text
+-[1] PageHeader (size sm) ----------------------------------------------------------------+
| [<] Storage / <sqlite> shop / <proj> api                          <rotate> [+ New chat]* |
|  ^2  ^3                       ^4                                  ^6       ^7            |
| Runs on ( native ) - Last Commit 3 hours ago - 96.0 KB                                   |
|  ^5                                                                                      |
|------------------------------------------------------------------------------------------|
| [8]  * Live 1   |* Chats 1|   Files   History   :   Sandboxes   Storage                  |
+------------------------------------------------------------------------------------------+
  [9]  <LoadError, when the project read failed>
  [10] <StoreBanner, when the Store is busy / unresolved / down, or a read was refused>
  [11] <the selected tab's body>
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | PageHeader | project-view.tsx:204 | One thin row; under 46rem the facts line drops to its own row (drawn so here) |
| 2 | Back | project-view.tsx:208 | Tooltip names the previous page, else `Projects` |
| 3 | Crumbs | project-view.tsx:210 | `Storage` opens Storage; the Store crumb (family icon) opens the Store |
| 4 | title | project-view.tsx:222 | Project icon and name |
| 5 | facts | project-view.tsx:134 | `Runs on` opens Sandboxes; machine chips; `Last Commit ...` / `No Commits yet`; size |
| 6 | Refresh | project-view.tsx:228 | Icon button with tooltip; rereads the project |
| 7 | New chat | project-view.tsx:233 | Off until the project is read |
| 8 | TabBar | project-view.tsx:238 | Divider before Sandboxes; dot + count on Live (pulsing) and Chats |
| 9 | LoadError | project-view.tsx:260 | Shown once the project was read, or on Chats / Live |
| 10 | StoreBanner | store-banner.tsx:17 | See below |
| 11 | body | project-view.tsx:149 | Tabs other than Live / Chats show `Reading api - shop` until read |

Tab bar details:

- Order: Live, Chats, Files, History | Sandboxes, Storage (`PROJECT_TABS`, `project-view.tsx:38`).
- Chats: dot while a chat works; count of open (not archived) chats. Live: pulsing dot and count
  of live runs, both only while one is live.
- Default tab: Chats. With no tab in the hash, the page switches once to Live when the chats first
  show a live run; any tab click ends that (`project-view.tsx:105`).
- Hash aliases (`askedTab`, `project-view.tsx:48`): `work`, `worktree`, `worktrees` -> Sandboxes;
  `sessions`, `runs` -> Chats; `blame` -> Files.

### StoreBanner variants

```text
+-[busy, amber] ----------------------------------------------------------------------------+
| <clock> Store shop is busy: store.push - copy                                             |
|         Writes and new Sandboxes are refused until it ends; this page updates when it     |
|         does.                                                                             |
+-------------------------------------------------------------------------------------------+
+-[unresolved, red] ------------------------------------------------------------------------+
| <!> Store shop is unresolved: store.push                                                  |
|     Its outcome was lost; Store calls are refused until the clearing call runs.           |
|     see layerfs store status shop - clear: layerfs store push shop <machine> (or ...)     |
+-------------------------------------------------------------------------------------------+
+-[down, red] ------------------------------------------------------------------------------+
| <power> Store lab is down: lima1 is not running                         [Start lima1]     |
|         <storeDown text, else: Its machine does not answer.>                              |
+-------------------------------------------------------------------------------------------+
+-[refusal, amber] -------------------------------------------------------------------------+
| <!> Some of this project could not be read                                                |
|     Busy: <LayerFS message>                                                               |
+-------------------------------------------------------------------------------------------+
```

| Variant | file:line | one line |
|---|---|---|
| busy | store-banner.tsx:25 | Op words from `opWords`, else `an operation`; plus any refusal |
| unresolved | store-banner.tsx:33 | Clearing call from `clearingCall`; plus any refusal |
| down | store-banner.tsx:43 | `Start {machine}` (`Starting...`) runs machine.start, then refreshes |
| refusal | store-banner.tsx:64 | Only a refusal, with the Store otherwise usable |

## Embedded in Chat

The chat page's own tab bar (Chat, Trace, Files, Sandboxes, History) shows Files, Sandboxes or
History through `ProjectView embedded` (`chat-home.tsx:734`): no header, no tab bar.

```text
+-[chat page header with its own TabBar: Chat  Trace  |Files|  Sandboxes  History] --------+
+------------------------------------------------------------------------------------------+
  <LoadError, only when the project was read and a reread failed>   project-view.tsx:194
  <StoreBanner>                                                       project-view.tsx:195
  <Files / Sandboxes / History body, same as below>
```

A Workspace's Browse files there switches the chat page to its Files view (`onEmbeddedView`).

## Chats tab

```text
+-[1] ProjectSessionsContent ---------------------------------------------------------------+
| [2] Working - 1                                              <archive> Show archived 2    |
|-------------------------------------------------------------------------------------------|
| Chat                       Branch            Runs in              State      Updated      | [3]
|-------------------------------------------------------------------------------------------|
| * Add a login route      <br> feature-login ( native - api-dev ) (* Working) just now   > | [4]
| o Answer orders with ... <br> fix-orders    -- closed            ( Idle )   yesterday  >  |
| <stack> Checkout shop-1 3/5  <br> shop-1.*  ( native - api-dev ) (* Running) [Stop] >     |
+-------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | ProjectSessionsContent | project-sessions.tsx:50 | Project's chats, newest first; a row opens it on the Chat page |
| 2 | header strip | project-sessions.tsx:65 | Only with working or archived chats; archive toggle `Show/Hide archived N` |
| 3 | header row | project-sessions.tsx:96 | Shown at 48rem container width and up |
| 4 | ChatRow | project-sessions.tsx:130 | See row parts |

Row parts:

```text
 * Add a login route  <br> feature-login  ( native - api-dev )  (* Working)  just now    [Stop] >
 ^5                    ^6                 ^7                     ^8           ^9           ^10
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 5 | title cell | project-sessions.tsx:174 | State dot, or a stack icon for a scenario (+ folder, `done/of`); error line below |
| 6 | Branch | project-sessions.tsx:189 | Button opens History on that Branch; scenario folder shows as `<folder>.*` |
| 7 | Runs in | project-sessions.tsx:201 | MachineChip `machine - sandbox`; `-- closed`; `--` |
| 8 | state Chip | project-sessions.tsx:211 | Archived, scenario state, Error, Working, Preparing, Saving, Idle (`chatLook` :117) |
| 9 | Updated | project-sessions.tsx:208 | Relative time; title has the full date |
| 10 | Stop + chevron | project-sessions.tsx:214 | Stop only for a live scenario chat |

Narrow (under 48rem): line 1 is title, state chip, actions; line 2 is Branch, Runs in, Updated.
Archived rows are dimmed.

States: `Reading the chats...` (spinner); LoadError `Could not read Chats` with [Try again];
empty:

```text
+------------------------------------------+
|               No chats yet               |
|              [+ New chat]*               |
+------------------------------------------+
```

## Files tab

```text
+-[1] FilesTab -----------------------------------------------------------------------------+
| [2] [v main          ]   | [6] |<i> README.md x|  <npm> package.json                      |
| [3] <search> ~~~ Find    |----------------------------------------------------------------|
|     in opened folders    | [7] README.md                        8 lines - 58 B - at main  |
|--------------------------|----------------------------------------------------------------|
| [4] > <dir> src          |  1  # api                                                      |
|     > <dir> test         |  2                                                             |
|       <i>   README.md    |  3  The shop's HTTP API.                                       |
|       <npm> package.json |  4                                                             |
|                          |  5  ```                                                        |
|                          |  6  npm install                                                |
|                          |  ...                                            [8] CodeView   |
+-------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | FilesTab | files-tab.tsx:202 | Side column 10-13rem (15rem at 64rem), then the file pane |
| 2 | Branch Select | files-tab.tsx:277 | Groups `Published` (main + short head) and `Branches` (`+N` Commits, or state) |
| 3 | SearchField | files-tab.tsx:308 | Matches file paths in folders already read (max 200) |
| 4 | Tree | files-tab.tsx:77 | Folders first; type badges (npm, TS, JS, {}, i, $, git, py, lock) |
| 5 | (tree states) | files-tab.tsx:81 | `Reading...`, `Could not read this folder`, `Empty folder` |
| 6 | open-file tabs | files-tab.tsx:343 | x closes; with none: `Read-only files` |
| 7 | FileBody header | files-tab.tsx:150 | Path crumbs; `N lines - size - at <branch>` |
| 8 | CodeView | code-view.tsx:55 | Read-only CodeMirror with line numbers and highlighting |

Branch Select open:

```text
+-------------------------------+
| Published                     |
|   main            3f9a2c1e    |
| Branches                      |
|   feature-login   +3          |
|   fix-orders      +1          |
+-------------------------------+
```

States:

- The root's README opens by itself the first time it is read (`files-tab.tsx:238`).
- No file open: `<file> Open a file from the tree`. Search with no hit: `No file in the opened
  folders matches.`
- A binary file: `A binary file` / `<size>; only text files open here.` Over 1 MiB: `Too large to
  show` / `<size>; files over 1 MiB open only their size.` (`files-tab.tsx:178`)
- File read: `Reading the file` while pending, LoadError on failure.
- Store down: the tab body is one sentence instead of the frame: `lima1 is stopped. Start it to
  browse this Store's files.` (`project-view.tsx:178`)

## Sandboxes tab

```text
  [1] <red row: sandboxes read error>                                            [Retry]
+-[2] SandboxesCard ------------------------------------------------------------------------+
| Sandboxes                                   1 recorded - 1 mounted   [+ New Sandbox]      |
|                                              ^3                       ^4                  |
|-------------------------------------------------------------------------------------------|
| [5] <box> api-dev                               native  (* Running)  [x Close]            |
|                                                 ^6      ^7           ^8                   |
|  +-[9]---------------------------------------------------------------------------------+  |
|  | <ws> feature-login /workspaces/feature-login  <br> feature-login  [Browse files]    |  |
|  +-------------------------------------------------------------------------------------+  |
|   [+ Mount Workspace]                                                         [10]        |
|   Details v                                                                   [11]        |
|-------------------------------------------------------------------------------------------|
| [12] Closed 2                                                                      v      |
+-------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | error row | project-storage.tsx:346 | Message and Retry; tiles fall back to the project read's list |
| 2 | SandboxesCard | project-storage.tsx:322 | Polls `host.projectSandboxes` every 5 s (`use-sandboxes.ts:13`) |
| 3 | counts | project-storage.tsx:331 | `N recorded - M mounted`, or `N recorded Sandboxes` when mounts are unknown |
| 4 | NewSandbox | project-storage.tsx:263 | Opens the inline form below |
| 5 | SandboxTile | sandbox-tiles.tsx:105 | One per Sandbox not `gone` |
| 6 | machine link | sandbox-tiles.tsx:113 | Opens the machine on Machines |
| 7 | StateChip | sandbox-tiles.tsx:119 | Sandbox state, or the op in flight |
| 8 | CloseSandbox | sandbox-tiles.tsx:14 | `Close`; after a refusal `Force close` + the refusal; names unknown Workspaces |
| 9 | Workspace row | sandbox-tiles.tsx:131 | Name, path, Branch; Browse files opens Files on that Branch |
| 10 | MountWorkspace | sandbox-tiles.tsx:48 | Only on a running Sandbox without a refusal |
| 11 | details | sandbox-tiles.tsx:146 | Name, Runtime, image, Backend, Route |
| 12 | Closed | sandbox-tiles.tsx:169 | Disclosure listing `gone` Sandboxes by name |

New Sandbox form (inside the card header):

```text
| Name                    Image                         Machine                              |
| api-1__________________ ~~~ the machine's image ~~~__ [ native ]   [Create]*  [Cancel]     |
| <refusal, red>                                                                             |
```

- Name is prefilled `<project>-<n>`, unique in the home. sqlite project: Machine is fixed to the
  Store's machine. PostgreSQL project: a select of machines; those without PostgreSQL Sandboxes are
  disabled as `name -- reason` (`project-storage.tsx:307`).

Mount Workspace form:

```text
+-------------------------------------------------------------------------------------------+
| Branch                 New Branch name          Workspace name (optional)                 |
| [v New Branch from main...] task-42_________  ~~~ build ~~~________  [Mount]* [Cancel]    |
| Only side Branches are mounted; main is the published line. A new Branch is forked from   |
| main first.                                                                               |
| <refusal, red>                                                                            |
+-------------------------------------------------------------------------------------------+
```

- Branch lists the side Branches (`feature-login`, `fix-orders`) then `New Branch from main...`;
  New Branch name shows only for that last choice.

Details open:

```text
  Details ^
  Name      api-dev
  image     --
  Backend   native
  Route     nfs
```

Tile list states (`sandbox-tiles.tsx:123`): unresolved -> `see layerfs sandbox get api-dev - clear:
layerfs sandbox close api-dev`; a refusal -> `<code>: <message>`; `Reading its Workspaces...`;
`Workspace status unavailable.`; `No Workspace mounted`. No open Sandbox: `No active Sandboxes`
(`Reading Sandboxes...` while read).

## Storage tab

```text
+-[1] StoreCard ----------------------------------------------------------------------------+
| <sqlite> SQLite Store shop  ( on native )                                                 |
|          Every Commit, Branch and Layer of api lives in this Store's one SQLite file, on  |
|          native.                                                                          |
|          Shared with 1 other project: a push, pull or backup carries it too.              |
|-------------------------------------------------------------------------------------------|
| [2] ON DISK                                                                    .--.       |
|     96.0 KB  for 412 KB of history  ( 4.3x smaller )  ( +1.2 KB Test the login route )    |
|     4 Commits - 3 Branches - 1 Layer                                          ( 77% )     |
|     <i> History, unique and compressed bytes are summed over ... (partial only)  saved    |
|                                                                                '--'  [3]  |
|-------------------------------------------------------------------------------------------|
| [4] (1) From history to disk                                                              |
|         Deduplicated and compressed storage flow                                          |
|-------------------------------------------------------------------------------------------|
| [5] (2) History against disk               | [6] (3) Each Commit                          |
|         Cumulative snapshot vs packed size |         1.1 KB avg - 2.0 KB Maximum          |
|-------------------------------------------------------------------------------------------|
| [7] CREATED              MACHINE                                                          |
|     Nov 3, 2026, 9:12    native                                                           |
+-------------------------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | StoreCard header | project-storage.tsx:197 | `{family} Store <name>`, `on <machine>` (sqlite), story line, shared line |
| 2 | headline | project-storage.tsx:104 | On disk; logical bytes; `Nx smaller` (>= 1.1x); newest Commit chip; counts |
| 3 | SavedRing | store-visuals.tsx:66 | Share of raw history saved; only when disk < history |
| 4 | Section 1 | project-storage.tsx:138 | DiskFlow and its pills |
| 5 | Section 2 | project-storage.tsx:159 | GrowthChart |
| 6 | Section 3 | project-storage.tsx:162 | CommitBars + CommitKinds; `No Commits yet.` / dashed placeholder |
| 7 | facts footer | project-storage.tsx:234 | Created; Machine (link to Machines), or Store (link to Storage) for PostgreSQL |

Section 1, DiskFlow (`store-visuals.tsx:134`): four stages, bands narrowing left to right.

```text
 * Every snapshot      * Unique            * Compressed          * On disk
   412 KB                118 KB              62.0 KB               96.0 KB
   raw history           after dedupe - 29%  pack bytes - 15%      the SQLite file - 23%
 ##                  ##                  ##                    ##
 ########============####======(3.5x dedupe)====##==(1.9x compression)==##=(+ 34 KB metadata)=##
 ##                  ##                  ##                    ##
 ( main, latest, raw 9.1 KB ) ( from Init 1.4 KB - 7 files ) ( SQLite pages 96.0 KB )
 ( free 4.1 KB )
```

Section 2, GrowthChart (`store-visuals.tsx:253`) and Section 3, CommitBars + CommitKinds
(`store-visuals.tsx:393`, `:471`):

```text
 -- raw history 412 KB  -- compressed content 62 KB      |      .                      .
                            Init -> newest Commit        |      #         #            #
 412 KB                                   ..../          |  #   #    #    #   #    #   #
                                 ......../               |  #   #    #    #   #    #   #
              ..........--------'                        |  ---------------------------------
 ----------------''''---------------------------         |  oldest left - hover a bar for its Commit
 hover: a tip with the Commit and both totals            |  [####fs####|##ws##|m]
                                                         |  # fs write          4.0 KB  3 Commits
                                                         |  # Workspace commit  0.4 KB  1 Commit
```

- Unique's sub reads `new in these Commits` when the stats are partial. The GrowthChart legend end
  reads `first Commit read -> newest`, `Init -> newest Commit` or `only Init so far`.
- CommitBars shows the newest bars only (`Newest N, ` prefix when cut); a bar's tip shows kind,
  short id, Branch, message, added / new unique / tree.

Fallback (no Store stats) replaces [2]-[6]:

```text
| Store file with its WAL: 96.0 KB                                                          |
| <clock> Store totals (dedupe, compression, what each Commit stored) comes with a later    |
| LayerFS.                                                                                  |
```

PostgreSQL (team/crm): header `PostgreSQL Store team`, no `on <machine>` chip, story line `Every
Commit, Branch and Layer of crm lives in the PostgreSQL Store team; each Commit goes straight
there.`, footer `STORE team`.

## Live and History tabs

- Live: see [project-live.md](project-live.md).
- History (Lineage, Map): see [project-history.md](project-history.md).

## Notes

- `#projects/<key>/map` opens Chats (or Live by the auto-switch), not History: `map` is not a tab
  id; it only sets History's initial view to Map for when History is opened
  (`project-view.tsx:92`).
- `HistoryTab` props `runId`, `tick` and `initialItem` are never passed: its one caller
  (`project-view.tsx:185`) passes only `project`, `state`, `initialBranch`, `initialView`.
- Exported but unused outside their file: `CloseSandbox` (`sandbox-tiles.tsx:14`); `StoreBadge`
  (`store-facts.tsx:144`) is not used anywhere.

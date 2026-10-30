# Storage: one link per Store (design and implementation spec)

> **Status:** Owner-approved direction (2026-10-30), not built. It
> supersedes the **copies** parts of [storage-redesign.md](storage-redesign.md):
> §1 Concept (copies), §2.2 copy locations, §3.4 Copy location page, §3.7 Add
> location dialog's first check per Store, §3.8 Clone dialog, §4.1–§4.5,
> and the copy fields of §8.1. Everything else there stands: the two family
> bands, progress (§5), size (§6), provider identity (§7), states (§10),
> tokens and accessibility (§11). The LayerFS contract is
> `layerfs/core/docs/issues/506/links.md` (`runtime.store.*` calls cited
> as L§n below).

## 1. The model in one screen

Three things, one rule.

- **Connection:** one bucket on one provider (MinIO, Cloudflare R2; S3 and
  GCS later). A home may have many of each: `minio-lab`, `minio-backup`,
  `r2-team`, `r2-personal`. Adding one binds nothing.
- **Remote file:** a SQLite Store file in a connection's bucket. It is
  **linked** to one local Store, or **not loaded**.
- **Local Store:** a SQLite file on this machine. It is **linked** to one
  remote file, or **local only**.

**The rule:** a Store links to at most one remote file, and a remote file is
linked by at most one Store of this machine.

PostgreSQL Stores keep their own family: each lives in one connection and
one schema, is never linked, and reads **Live**.

## 2. Actions

| Action | From | Result | Engine call |
| --- | --- | --- | --- |
| Publish… | a local-only Store | a new remote file on the chosen connection, linked | `start_publish` (L§4.1) |
| Push | a linked Store | uploads to its link; no target to choose | `start_push` |
| Pull | a linked Store | replaces the Store from its link | `start_pull` |
| Send a copy… | any SQLite Store | a new, unlinked remote file on any connection; the Store keeps its link | `start_send` |
| Load… | a not-loaded remote file | a new local Store linked to it | `start_load` |
| Unlink | a linked Store | the Store becomes local only; the file stays, now loadable | `unlink` |

- **Moving** a Store to another connection is Unlink, then Publish. There is
  no Move action.
- **Load on a linked file** is refused before the call: "Already linked as
  `team-examples`", with an Open link to that Store.
- **Publish or Send onto an existing file** is refused by the engine
  (`Exists`); the dialog shows it under the file name field.
- **Clone** is gone. Load does what it did, from the connection's file list.

## 3. Screens

### 3.1 Storage overview

> **Superseded (2026-10-31):** the overview is now one card per Store with its
> projects, under one line of facts; bands, the summary strip and the
> connections grid are gone. As built: [layerfs-storage.md](layerfs-storage.md)
> regions 1–4. The text below is the earlier design.

Top to bottom, one column:

1. **Summary strip:** Stores, Linked (`3 of 11 SQLite`), Needs attention
   (count of behind, diverged, missing, unreachable; clickable filter),
   Connections.
2. **SQLite Stores band.** One row per Store:
   `Store (name, projects, size) | Linked to | Sync | actions`.
   - **Linked:** provider mark, connection name, file in mono
     (`minio-lab / team-examples`); Push and Pull.
   - **Local only:** "Local only" in muted text, a neutral pill, and
     **Publish…**.
   - **Transferring:** the Linked-to cell becomes the job: phase, bar, bytes
     of total, time left (storage-redesign §5). The pill reads Pushing or
     Pulling.
   - Rows sort by severity, then name. Local-only Stores beyond five fold
     into "+ N more local-only Stores".
3. **PostgreSQL Stores band.** Same row shape: the connection and schema in
   the Linked-to column, a **Live** pill, and "from `<SQLite Store>`" when it
   was imported.
4. **Connections.** A grid of cards, one per connection, all providers
   together, PostgreSQL servers included: mark, name, endpoint and bucket (or
   host and database), health (Reachable / Unreachable / version and
   latency), and `N files · size` for a bucket. **Add connection** sits on
   the section header.

Removed from the overview: copy columns, copy-location groups, per-copy
pills, "A of B in sync".

### 3.2 SQLite Store page

- **Header:** Store icon (§3.6), name, size, projects.
- **Link card** (the page's main card):
  - Linked: connection (mark, name), file, linked since, last push or pull
    (direction, time, bytes), the sync pill with its reason in full, and
    the two sides as two lines ("This machine: changed since last push" /
    "minio-lab: same as last push"). Actions: Push, Pull, Check now, and a
    menu with Send a copy… and Unlink….
  - Local only: one sentence ("Not linked to any remote file") and
    **Publish…**, plus Send a copy… in the menu.
- **Sent copies:** after a Send, an inline notice "Sent to
  `r2-team / team-examples-snapshot`" with **Load**. Not persisted beyond
  the job's life; the connection's file list is the lasting record.
- Size card, projects, and PostgreSQL imports: unchanged.

### 3.3 Connection page (S3 providers)

- **Header:** mark, name, provider, endpoint, bucket, prefix, health, and
  the Store count it links. Actions: Check, Edit keys, Remove (refused while
  any Store links to it, naming them; L§4.1 `InUse`).
- **Files in this bucket:** `File | Size | Modified | On this machine | action`
  from `remote.list_stores` (with `linkedBy`).
  - Linked: "Linked to `team-examples`" and **Open**.
  - Not loaded: "Not loaded" and **Load…**.
  - Empty bucket: "No LayerFS Stores here yet. Publish a Store to this
    connection from its page."

### 3.4 PostgreSQL connection page

Unchanged from storage-redesign §3.5.

### 3.5 Dialogs (four, plus the push conflict)

| Dialog | Fields | Notes |
| --- | --- | --- |
| Publish | connection (S3 connections only, each with health), file name (default: the Store's name) | Refusals inline: file exists, connection unreachable |
| Send a copy | connection, file name (default `<store>-copy`) | Says the Store's link does not change |
| Load | local Store name (default: the file name) | Shows the file's size and modified time; refuses a taken name |
| Pull | type the Store's name | Only when Pull would discard local changes (state ahead or diverged); otherwise Pull runs at once |
| Push conflict | none | Shown when Push returns `Conflict`: "minio-lab changed since your last push." Buttons: Pull first, Overwrite (force) |

Add connection asks for provider, then endpoint or account, bucket, prefix
and keys. It never names a Store. After saving it runs one check and lists
the bucket's files with Load.

### 3.6 Store icon (owner, 2026-10-30)

The Store's icon says where it syncs, with one mark and no badge:

| Store | Icon |
| --- | --- |
| SQLite, local only | SQLite mark (`siSqlite`) |
| SQLite, linked to a MinIO connection | MinIO mark (`siMinio`) |
| SQLite, linked to an R2 connection | Cloudflare mark (`siCloudflare`) |
| PostgreSQL | PostgreSQL mark (`siPostgresql`) |

It is the same icon everywhere a Store appears: overview rows, the Store
page header, project cards, the project Storage tab and the New project
Store picker. Unlink or Publish changes it at once. The mark is drawn in
the brand's colour on a neutral tile in both themes, with the label
(`Local only`, `MinIO`, `Cloudflare R2`, `PostgreSQL`) as its accessible
name and tooltip.

## 4. Sync state (replaces storage-redesign §4.1–§4.5)

One link, one comparison:

- **Base:** `link.last` (direction, sha256, heads).
- **Local now:** the Store's `heads`.
- **Remote now:** `store.check` of the link (sha256, heads, present).

```text
syncState(store, job):
  no link                                          -> local_only
  job running on the Store                         -> transferring
  remote missing                                   -> missing     (the linked file was deleted)
  remote heads and local heads known and equal     -> in_sync
  first check in flight                            -> checking
  local same,    remote same                       -> in_sync
  local changed, remote same                       -> ahead       ("Changes to push")
  local same,    remote changed                    -> behind      ("Remote newer")
  local changed, remote changed                    -> diverged
  check failed (unreachable, denied)               -> unreachable
  otherwise                                        -> unknown     (reason names the unknown side)
```

States: in sync, changes to push, remote newer, diverged, missing,
transferring, checking, unreachable, unknown, local only; PostgreSQL: live.
There is no aggregate: the Store's state is its link's state. Icons, tones
and tokens follow storage-redesign §4.4.

## 5. Data contract (replaces the copy fields of storage-redesign §8.1)

```ts
interface StoreLink {
  remote: string              // connection name
  provider: ProviderId        // from the connection, for the mark
  file: string
  object: string              // endpoint/bucket/prefix/file/store.sqlite, for display
  linked: number              // ms
  last: { direction: 'push' | 'pull'; at: number; bytes: number; sha256: string; heads: string | null } | null
  check: CopyCheck | null     // as today
  local: 'same' | 'changed' | 'unknown'
  remoteSide: 'same' | 'changed' | 'missing' | 'unknown'
  reason: string | null
}

interface SqliteStoreInfo { /* as today, minus copies */ link: StoreLink | null; sync: { state: SyncState } }

interface RemoteFile { file: string; bytes: number | null; modified: number | null; linkedBy: string | null }
interface ConnectionInfo { name; provider; endpoint; bucket; prefix; health; files: RemoteFile[] | null; bytes: number | null; stores: string[] }
```

Routes (host/server.js):

| Route | Calls |
| --- | --- |
| `GET /api/storage` | the view: Stores with `link`, connections with health; files only when listed |
| `GET /api/remotes/:name/files` | `remote.list_stores` |
| `POST /api/stores/:name/publish` `{ remote, file }` | `start_publish` |
| `POST /api/stores/:name/push` `{ force }` | `start_push` |
| `POST /api/stores/:name/pull` `{ confirm }` | `start_pull` |
| `POST /api/stores/:name/send` `{ remote, file }` | `start_send` |
| `POST /api/stores/:name/unlink` `{ confirm }` | `unlink` |
| `POST /api/remotes/:name/load` `{ file, store }` | `start_load` |
| `POST /api/storage/check` `{ store? }` | `store.check` per linked Store |

Removed: `POST /api/remotes/:name/clone`, the `remote` body field of push
and pull.

## 6. Implementation plan (Connect)

Host:

- `host/storage.js`: build `link` from `store.list`; drop `copies`,
  `orderCopies`, copy-location grouping; new routes of §5; credentials per
  call as today.
- `host/storage-sync.js` and `host/storage-checks.js`: the §4 function on
  one link; checks keyed by Store; `timeOf` stays (old native records are in
  seconds).
- `host/projects.js`: `storeSync`/`storeProviders` from the link (one
  provider at most).

Renderer (`src/renderer/src/components/storage/`):

- Remove: `overview/copy-locations.tsx`, `detail/copies-section.tsx`,
  `detail/location-detail.tsx`, `dialogs/clone-dialog.tsx`, per-copy pills
  in `overview/sqlite-store-row.tsx`.
- Add: `detail/link-card.tsx`, `overview/connections.tsx`,
  `detail/connection-detail.tsx` (S3 files list; the PostgreSQL page stays),
  `dialogs/publish-dialog.tsx`, `dialogs/send-dialog.tsx`,
  `dialogs/load-dialog.tsx`, `dialogs/push-conflict-dialog.tsx`.
- Change: `overview/sqlite-store-row.tsx` (one Linked-to cell),
  `sync/sync-state.ts` (states of §4), `identity/store-icon.tsx` (one badge),
  `dialogs/add-location-dialog.tsx` → add connection only,
  `src/shared/host-api.ts` and `host/client.ts` (types and routes of §5).
- Project card and project Storage tab: one link chip.
- `docs/ui/layerfs-storage.md`: rewrite to the built page.

Tests: host unit tests for the §4 function and the routes; the real E2E
(`host/test/verify/storage_real.mjs`) for publish, push, pull, send, load,
unlink against MinIO and R2; `pnpm -s typecheck`. Every test command ≤120 s
with unfiltered output.

## 7. After the build: settle today's data

Follows L§7, on the owner's home, after the engine and Connect parts work.
The end state is visible on the Storage page: every SQLite Store linked and
in sync, or local only; every file in each connection linked or not loaded;
nothing unknown or missing. Includes fixing the running host's empty
`heads` (L§7 step 5).

## 8. Browse a remote file (removed)

Owner, 2026-10-30: removed. Browse read a remote Store file in place,
read-only (layerfs#510). It was built and measured, then removed because
folder and revision reads stayed too slow on R2. To look at a remote file,
**Load…** it (§3.3). The engine record is
`layerfs/core/docs/issues/506/live-view.md`.

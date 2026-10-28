# LayerFS: Storage

Where projects' history lives: the storage choices on the left, the chosen one's detail on the right.
Opens from: the Storage tab on the LayerFS page.
Source: `src/renderer/src/components/storage/storage-page.tsx` (main file; others named in Regions).

## Skeleton

```text
+-[1] PageHeader ------------------------------------------------------------------------------+
| LayerFS                                                                    [ + Add storage ] |
| Where projects' history lives. Each LayerFS project is one SQLite Store, in its own Docke... |
|  Projects   Storage   Compute                                                                |
|             =======                                                                          |
+----------------------------------------------------------------------------------------------+
+-[2] Storage list ----------------+  +-[3] LocalDetail ---------------------------------------+
| Local storage                    |  | LOCAL STORAGE                                          |
| /Users/yifanxu/.layerfs-conne... |  | Local SQLite   * Worker running                        |
| > Local SQLite                   |  | SQLite - 2 projects - 2 Store volumes                  |
|   2 projects - worker running    |  | /Users/yifanxu/.layerfs-connect/home                   |
|                                  |  +--------------------------------------------------------+
| Remote storage Not available yet |  +-[4] Stat ------+  +----------------+  +----------------+
|   PostgreSQL                     |  | Projects       |  | Store volumes  |  | Volume prefix  |
|   Live over HTTP                 |  | 2              |  | 2              |  | lfc-           |
|                                  |  | all initial... |  | one Docker ... |  | names every... |
| Sync locations Not available yet |  +----------------+  +----------------+  +----------------+
|   Google Drive                   |  +-[5] DiskGauge -----------------------------------------+
|   Whole-file copies              |  | Disk  free space where the Stores are written          |
|   Amazon S3                      |  | Beside the home             For Docker volumes         |
|   Whole-file copies              |  | 345 GB                      111 GB                     |
|   ... (R2, MinIO, Folder)        |  | [=====|==================]  [=====|==================] |
+----------------------------------+  | 0  20 GB low       100 GB+  0  20 GB low       100 GB+ |
                                      +--------------------------------------------------------+
                                      +-[6] WorkerSection -------------------------------------+
                                      | LayerFS box   * Worker running                         |
                                      | A Linux container that opens each Store file directly  |
                                      | and answers Connect's Store calls on loopback.         |
                                      | ------------------------------------------------------ |
                                      | Container         State         Build                  |
                                      | lfc-worker        * running     build-linux-36b152f... |
                                      +--------------------------------------------------------+
                                      +-[7] Local only ----------------------------------------+
                                      | Local only                            [ Sync with... ] |
                                      | These Stores have no copy anywhere else. Sync          |
                                      | locations are not available yet.                       |
                                      +--------------------------------------------------------+
                                      +-[8] ProjectsTable -------------------------------------+
                                      | Projects  2                                            |
                                      | Project       Store volume    Made by          Created |
                                      | ------------------------------------------------------ |
                                      | heavy-check   lfc-heavy-ch... crew demo - r... 2 h ago |
                                      | playground    lfc-playgrou... Init from emp... 3 h ago |
                                      +--------------------------------------------------------+
```

## Regions

1. **Page header** (`PageHeader` in `StoragePage`, `storage/storage-page.tsx`): "LayerFS", a one-line description and the tab row (`LayerFSTabs`, see [layerfs-projects.md](layerfs-projects.md)). "+ Add storage" is disabled; its tooltip (`Unavailable`, `storage/unavailable.tsx`) says LayerFS has no remotes yet (#446).
2. **Storage list** (`StoragePage` nav, `storage/storage-page.tsx`): three groups.
   - Local storage, with the home path, holds Local SQLite with its project count and worker state.
   - Remote storage holds PostgreSQL.
   - Sync locations holds Google Drive, Amazon S3, Cloudflare R2, MinIO and Folder.

   The last two groups carry a "Not available yet" pill, and their rows are greyed with a clock on hover. A lit card glides behind the chosen row, and the detail cross-fades when the choice changes.
3. **Local SQLite header** (`LocalDetail`, `storage/local-detail.tsx`): "LOCAL STORAGE", "Local SQLite" with the worker chip, the project and Store-volume counts, and the home path.
4. **Stat tiles** (`Stat`, `storage/meters.tsx`): Projects ("all initialized" or "N initialized"), Store volumes, and the Volume prefix that names every container and volume.
5. **Disk** (`DiskGauge`, `storage/meters.tsx`): free space beside the home and for Docker volumes. Each gauge reads full from 100 GB and marks the 20 GB low line. "For Docker volumes" reads "Docker is not answering" when Docker is not answering.
6. **LayerFS box** (`WorkerSection`, `storage/local-detail.tsx`): the worker container that opens every Store on macOS and Windows: its chip, then Container, State and Build.
7. **Local only** (`LocalDetail`, `storage/local-detail.tsx`): a dashed card saying the Stores have no copy elsewhere, with "Sync with..." disabled (`Unavailable`).
8. **Projects table** (`ProjectsTable`, `storage/projects-table.tsx`): Projects and its count, then one row per project with its Store volume, Made by and Created. Made by is "<demo> demo - run <id>", which opens that run, or "Init from <folder>", or "outside Connect".

## States

- **Loading**: "Reading the LayerFS home..." (`Loading`) in the detail; the Local SQLite row reads "Reading...".
- **Error**: `LoadError` ("the local storage") with Retry in the detail.
- **Low disk**: a warning `Notice` (`storage/notice.tsx`), "Disk space is low", under the header. The gauge turns warning-coloured with "Low".
- **Worker**:
  - On Linux there is no worker. The chip reads "In process", and the section is titled "Store access" with no facts.
  - The chip can also read Worker starting, Worker down or Worker unhealthy. An error line shows under the facts.
- **Not initialized**: a warning chip beside the project's name in the table. With no projects, the table reads "No projects yet".
- **A not-yet choice** (`SoonDetail`, `storage/storage-page.tsx`): picking PostgreSQL or a sync location shows its kind and title with a "Not available yet" chip and what it would do. "How it would work" draws a path: Connect, "live over HTTP", PostgreSQL, "opens projects", Cloud Sandboxes; or Local SQLite, "push and pull", the provider. A disabled "+ Connect <name>" button follows, with a note that remote storage waits on LayerFS remotes (#446).

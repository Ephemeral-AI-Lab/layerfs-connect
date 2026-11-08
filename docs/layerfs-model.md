# LayerFS model

How Connect sees a LayerFS 2.0 home: where history is kept (Stores), where it runs (machines),
what runs (Sandboxes, one project each) and what a Sandbox works on (Workspaces, one Branch
each). SSH hosts and Firecracker are turned off in Connect and are not drawn. Names are examples.

## The flow

```text
 STORAGE                                         MACHINE

 sqlite Stores (files on a machine's disk)
 +------------------+
 | shop.sqlite      |-----------+  lives on
 +------------------+           |                +----------------------+
 +------------------+           +--------------->|                      |
 | lab.sqlite       |--------------------------->|    machine lima1     |
 +------------------+   1 machine : N files      |                      |
                                                 |                      |
 PostgreSQL Stores (servers, on no machine)      |                      |
 +------------------+                            |                      |
 | team             |<- - - - - reached - - - - -|                      |
 | db.internal:5432 |                            |                      |
 +------------------+                            |                      |
 +------------------+                            |                      |
 | crm              |<- - - - - no route - -x- - |                      |
 | 127.0.0.1:55442  |                            |                      |
 +------------------+                            +----------+-----------+
   N machines : N servers, if reachable                     |
   (discovery map, planned)                                 | runs   1 machine : N Sandboxes
                                                            |
                +-------------------------------------------+------------------+
                |                                           |                  |
                v                                           v                  v
 SANDBOX  +------------------+                     +------------------+  +------------------+
          | api-dev          |                     | api-ci           |  | crm-1            |
          | project shop/api |                     | project shop/api |  | project team/crm |
          +--------+---------+                     +--------+---------+  +--------+---------+
                   |      N Sandboxes : 1 project           |                     |
                   | mounts   1 Sandbox : N Workspaces      |                     |
        +----------+-----------+                            |                     |
        |          |           |                            |                     |
        v          v           v                            v                     v
 WORK-  login      review      orders                       ci                    hotfix
 SPACE  |          |           |                            |                     |
        +----+-----+           |                            |                     |
             |                 |                            |                     |
             v                 v                            v                     v
 BRANCH   feature-login     fix-orders                   fix-orders            hotfix
          (shared by login   (a Branch may be mounted in more than one Sandbox too)
           and review)
```

| Step | Rule |
|---|---|
| Store -> machine | A sqlite Store is a file on exactly one machine; one machine holds many. Push / pull moves it |
| machine -> PostgreSQL | A PostgreSQL Store is on no machine. Many machines may reach one, one machine many |
| machine -> Sandbox | A Sandbox runs on one machine; a machine runs many |
| Sandbox -> project | Bound at `sandbox.create`, never changed; a project may have many Sandboxes |
| Sandbox -> Workspace | `workspace.mount`; a Sandbox mounts many, each under its own name |
| Workspace -> Branch | A side Branch of the Sandbox's project (main is never mounted); Workspaces may share one |

Where a Sandbox may run:

```text
sqlite project       on the machine that holds its Store file (push the Store to run elsewhere)
PostgreSQL project   on any machine that reaches its Store (today: supports.postgresql_sandbox)
```

## Discovery map (planned, not built)

Today Connect reads one flag per machine, `supports.postgresql_sandbox`, and treats a machine
that has it as reaching every PostgreSQL Store (`MachinesView.postgresql`). It does not check
the network path. A discovery map would probe each machine and PostgreSQL Store pair:

```text
                  team             warehouse        crm
  native          reached          reached          reached
  docker          reached          no route         reached (loopback rewrite)
  lima1           reached          reached          no route
  lima2           -- stopped: not probed (a probe never starts a machine) --
  msb1            -- no PostgreSQL Sandboxes here (supports.postgresql_sandbox false) --
```

A cell would hold: reached / no route / auth refused / not probed, and when it was last probed.
New Sandbox for a PostgreSQL project would offer only the machines whose cell says reached.

## How many

```text
machine     1 --- *  sqlite Store       a Store file is on one machine
machine     * --- *  PostgreSQL Store   when the machine reaches it (discovery map, planned)
machine     1 --- *  Sandbox
Sandbox     * --- 1  project
Sandbox     1 --- *  Workspace
Workspace   * --- 1  Branch             Workspaces may share a Branch, in one Sandbox or several
Store       1 --- *  project
project     1 --- *  Branch             main (published Layers) plus side Branches (Commits)
```

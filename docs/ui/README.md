# UI specs

One file per surface. Each is ASCII diagrams with numbered regions, a legend per diagram, and as
little prose as possible. Update a page's file in the same change as its code.

## Index

| File | Surface |
|---|---|
| [shell.md](shell.md) | Window layout, sidebar, window bar, sim strip, mode chip, global overlays |
| [chat.md](chat.md) | New chat, open chat (header, transcript, composer), Trace, subagent view, chat dialogs |
| [projects.md](projects.md) | Projects list, New project dialog, Delete project dialog |
| [project.md](project.md) | Project page: header, Store banner, Chats, Files, Sandboxes, Storage tabs |
| [project-live.md](project-live.md) | Project page: Live tab |
| [project-history.md](project-history.md) | Project page: History tab (Lineage, Map) |
| [machines.md](machines.md) | Machines board, machine card, machine page, Add machine |
| [storage.md](storage.md) | Storage board (Stores, Backups), Store card, bucket card, Store page, dialogs |
| [settings.md](settings.md) | Settings dialog and every section |

## Conventions

Plain ASCII only. Diagram lines at most 100 characters (legend tables may run longer). Diagrams
sit in ```` ```text ```` blocks.

```text
+-[1] Region name -------------------+   a numbered region; the legend under the diagram names it
| ...                                |
+------------------------------------+

[Button]        a button             [Primary]*    the primary button
[v Label]       a select / dropdown  [...]         a "more" menu
( Chip )        a chip / pill        (* Running)   a state chip; * = live / pulsing dot
(o) / ( )       radio on / off       [x] / [ ]     checkbox on / off
____________    a text input         [<]  [>]      back / chevron
###.......      a bar or meter       |Tab| Tab     tabs; |Tab| is the selected one
<icon>          an icon              x             a close / delete control
~~~ text ~~~    placeholder text     ...           more rows of the same kind
```

UI text keeps its words; its typography is written in ASCII: ` - ` for the middle dot `·`, `...` for
`…`, `--` for `—`, straight quotes for curly ones, `Cmd`/`Opt`/`Ctrl` for `⌘`/`⌥`/`^`, `->` for `→`.
Names, sizes and times that the sample world does not seed are illustrative.

Each file follows this order:

```text
# <Surface>
Source: <files>     Opens from: <how the user gets here>

## <View>                 one diagram per view, sample data from the `mac` simulated world
legend table:   [n] | Component | file:line | one line
## States                 loading / empty / error / busy ... as mini diagrams or one line each
## Menus and dialogs      a diagram per menu or dialog
## Notes                  at most a few lines: hidden flags, dev-only parts, known gaps
```

Sample data: the simulated `mac` world (`host/sim/seed.js`): machines `native`, `docker`, `lima1`
(running), `lima2` (stopped); Stores `shop` (native: `api`, `web`), `lab` (lima1: `notes`), `team`
(PostgreSQL: `crm`); bucket `backups`; Sandbox `api-dev` with Workspace `feature-login`.

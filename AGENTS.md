# Agent notes

- Typecheck: `pnpm -s typecheck`
- Tests: `node --test test/*.test.mjs` (a bare `node --test test/` fails on Node 24)
- Build: `pnpm -s build`
- Simulated LayerFS: `pnpm dev:sim` (or the LayerFS menu / sidebar mode chip) runs the host on `host/sim`, state in
  `~/.layerfs-connect-sim`; `node tools/sim-table.mjs` after upgrading LayerFS (host/README.md).
- Headless screenshots: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --window-size=1280,760 --virtual-time-budget=8000 --screenshot=/tmp/x.png "<url>"`. There is one light theme; no dark mode.
- UI specs live in `docs/ui/*.md`: ASCII layout diagrams with numbered regions and little prose (conventions in
  `docs/ui/README.md`); update the page's spec with its code.
- Real Live fixtures on the running app: `node tools/live-fixtures.mjs setup | play [<project>…] | status | teardown`
  (`live-*` SQLite Stores on native/docker/lima1/lima2; PostgreSQL Stores in a Docker `live-pg` container on
  127.0.0.1:55442 whose Sandboxes run in lima1/lima2/docker, reached through LayerFS's loopback rewrite).
  Only `shop` and `conflicts` play as chats on 2.0, and Live shows only chats, not `/api/demos` runs.
  `node tools/live-fixtures.mjs matrix [shop|conflicts]` plays both on lima1/lima2 with a SQLite Store there and
  with a PostgreSQL Store, waits for every verdict and exits 1 on a failure (after `setup`, with the app running).
  PostgreSQL Stores need the linked addon built with the feature, then an app restart (in ../layerfs-v2-merge:
  `cargo +1.85.1 build --offline --locked --release -p layerfs-node --features layerfs-node/postgresql`, copy
  `target/release/liblayerfs_node.dylib` over `api/crates/layerfs-node/layerfs.node` by a rename; the CLI likewise
  with `-p layerfs-cli --features layerfs-cli/postgresql --bin layerfs`). The Linux bundle already has it.

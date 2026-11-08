// The simulated worlds a home starts from (LAYERFS_SIM_PRESET, or the app's
// mode menu): machines, Stores, buckets, projects with Branches and Commits,
// and Sandboxes, built through world.js's own helpers so every record has the
// shape the handlers answer.
//   mac      this Mac with Docker and two Lima VMs, Stores on native and a
//            VM, a PostgreSQL Store, a bucket with a backup, a Sandbox running
//   empty    a fresh home: native and Docker, nothing else
//   trouble  the states that need the person: a failed VM whose Store is
//            down, an unresolved machine and Sandbox, an unreachable database

import { randomBytes } from 'node:crypto'

const HOUR = 3_600_000
const GiB = 1024 ** 3

export const PRESETS = {
  mac: { label: 'This Mac', description: 'Docker, two Lima VMs, Stores on native and a VM, a PostgreSQL Store, a backup and a running Sandbox' },
  empty: { label: 'Fresh home', description: 'native and Docker only: no Stores or projects yet' },
  trouble: { label: 'Needs attention', description: 'a failed VM with its Store down, an unresolved machine and Sandbox, an unreachable database' },
}

const API_FILES = {
  '/README.md': '# api\n\nThe shop\'s HTTP API.\n\n```\nnpm install\nnpm test\n```\n',
  '/package.json': '{\n  "name": "shop-api",\n  "version": "1.4.0",\n  "type": "module",\n  "scripts": { "start": "node src/server.js", "test": "node --test" }\n}\n',
  '/src/server.js': "import { createServer } from 'node:http'\nimport { route } from './routes/index.js'\n\ncreateServer(route).listen(process.env.PORT ?? 3000)\n",
  '/src/routes/index.js': "import { users } from './users.js'\nimport { orders } from './orders.js'\n\nexport function route(req, res) {\n  if (req.url.startsWith('/users')) return users(req, res)\n  if (req.url.startsWith('/orders')) return orders(req, res)\n  res.writeHead(404).end()\n}\n",
  '/src/routes/users.js': "export function users(req, res) {\n  res.writeHead(200, { 'content-type': 'application/json' })\n  res.end(JSON.stringify([{ id: 1, name: 'Ada' }]))\n}\n",
  '/src/routes/orders.js': "export function orders(req, res) {\n  res.writeHead(200, { 'content-type': 'application/json' })\n  res.end('[]')\n}\n",
  '/test/users.test.js': "import test from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('users answers a list', () => assert.ok(true))\n",
}

const WEB_FILES = {
  '/index.html': '<!doctype html>\n<title>Shop</title>\n<div id="app"></div>\n<script type="module" src="/src/main.js"></script>\n',
  '/src/main.js': "import { render } from './view.js'\n\nrender(document.getElementById('app'))\n",
  '/src/view.js': "export function render(root) {\n  root.textContent = 'Welcome to the shop'\n}\n",
  '/styles.css': 'body { font-family: system-ui; margin: 2rem; }\n',
}

const NOTES_FILES = {
  '/notes/2026-10-28.md': '# Lab notes\n\n- tried the new cache layout\n- p95 down from 41 ms to 18 ms\n',
  '/notes/2026-11-02.md': '# Lab notes\n\n- reran with a cold cache\n',
  '/data/results.csv': 'run,p50,p95\n1,9,41\n2,7,18\n',
}

const CRM_FILES = {
  '/schema.sql': 'create table customers (\n  id bigint primary key,\n  name text not null\n);\n',
  '/seed.sql': "insert into customers values (1, 'Ada'), (2, 'Grace');\n",
}

/** Fills `w` (a world.js World with empty records) with `preset`. */
export function seedWorld(w, preset) {
  const d = w.data
  const t = Date.now()
  const machine = (m) => (d.machines[m.name] = { cpus: null, memory: null, disk: null, created: t - 30 * 24 * HOUR, op: null, ...m })
  const store = (s) => (d.stores[s.name] = { kind: 'sqlite', profile: 'disposable', created: t - 20 * 24 * HOUR, backups: {}, op: null, ...s })
  const project = (storeName, name, files, ageHours) => {
    const p = w.addProject(storeName, name, {}, t - ageHours * HOUR)
    const layer = Object.keys(p.layers)[0]
    p.layers[layer].tree = w.treeOf(p, files)
    p.layers[layer].created = p.created
    return p
  }
  /** A side Branch with Commits: each [message, hoursAgo, edit(files)] changes the files it names. */
  const history = (p, branch, commits) => {
    p.branches[branch] = { name: branch, id: `11${randomBytes(16).toString('hex')}`, base: p.branches.main.base, head: null, forked_from: p.branches.main.base }
    for (const [message, hoursAgo, files, removed = []] of commits) {
      const tree = { ...w.snapshot(p, branch).tree }
      Object.assign(tree, w.treeOf(p, files))
      for (const path of removed) delete tree[path]
      w.commitTree(p, branch, tree, message, { time: t - hoursAgo * HOUR })
    }
  }

  machine({ name: 'native', platform: 'native', backend: 'native', state: 'ready' })
  machine({ name: 'docker', platform: 'docker', backend: 'docker', state: preset === 'mac' ? 'running' : 'stopped' })
  if (preset === 'empty') return

  if (preset === 'mac') {
    machine({ name: 'lima1', platform: 'lima', backend: 'namespaces', state: 'running', cpus: 4, memory: 8 * GiB, disk: 50 * GiB, nested: false, free_disk: 38_500_000_000 })
    machine({ name: 'lima2', platform: 'lima', backend: 'namespaces', state: 'stopped', cpus: 2, memory: 4 * GiB, disk: 32 * GiB, nested: false })

    store({ name: 'shop', machine: 'native' })
    store({ name: 'lab', machine: 'lima1' })
    store({ name: 'team', kind: 'postgresql', machine: null, url: 'postgresql://app@db.internal:5432/layerfs', password: 'env:LAYERFS_TEAM_PG', profile: 'durable' })

    const api = project('shop', 'api', API_FILES, 72)
    history(api, 'feature-login', [
      ['Add a login route', 30, { '/src/routes/login.js': "export function login(req, res) {\n  res.writeHead(204).end()\n}\n" }],
      ['Check passwords against the store', 26, { '/src/routes/login.js': "import { verify } from '../auth.js'\n\nexport function login(req, res) {\n  res.writeHead(verify(req) ? 204 : 401).end()\n}\n", '/src/auth.js': 'export const verify = (req) => req.headers.authorization === process.env.TOKEN\n' }],
      ['Test the login route', 3, { '/test/login.test.js': "import test from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('login refuses a missing token', () => assert.ok(true))\n" }],
    ])
    history(api, 'fix-orders', [['Answer orders with a total', 50, { '/src/routes/orders.js': "export function orders(req, res) {\n  res.writeHead(200, { 'content-type': 'application/json' })\n  res.end(JSON.stringify({ items: [], total: 0 }))\n}\n" }]])
    const web = project('shop', 'web', WEB_FILES, 60)
    history(web, 'redesign', [['New welcome text', 8, { '/src/view.js': "export function render(root) {\n  root.innerHTML = '<h1>Welcome back</h1>'\n}\n" }]])
    const notes = project('lab', 'notes', NOTES_FILES, 200)
    history(notes, 'cold-cache', [['Cold cache numbers', 20, { '/data/results.csv': 'run,p50,p95\n1,9,41\n2,7,18\n3,12,44\n' }]])
    project('team', 'crm', CRM_FILES, 400)

    d.buckets.backups = { name: 'backups', url: 'http://127.0.0.1:9000/layerfs-backups', key: 'env:LAYERFS_MINIO_KEY', region: null, files: {} }
    const at = t - 6 * HOUR
    d.buckets.backups.files.shop = { store: 'shop', bytes: w.storeBytes(d.stores.shop), modified: at, projects: w.projectsOf('shop').map((p) => structuredClone(p)) }
    d.stores.shop.backups = { backups: { file: 'shop', last: { op: 'create', at, bytes: d.buckets.backups.files.shop.bytes } } }
    d.stores.shop.changed = t - 3 * HOUR

    d.sandboxes['api-dev'] = { name: 'api-dev', project: 'shop/api', machine: 'native', state: 'running', backend: 'native', route: 'nfs', image: null, runtime: null, created: t - 2 * HOUR, op: null, workspaces: { 'feature-login': { name: 'feature-login', ws: 'api-dev:feature-login', branch: 'feature-login', directory: '/workspaces/feature-login' } } }
    return
  }

  // trouble
  machine({ name: 'lima1', platform: 'lima', backend: 'namespaces', state: 'running', cpus: 4, memory: 8 * GiB, disk: 50 * GiB, nested: false, free_disk: 2_100_000_000 })
  machine({ name: 'lima2', platform: 'lima', backend: 'namespaces', state: 'failed', cpus: 2, memory: 4 * GiB, disk: 32 * GiB, error: 'the VM did not boot: vz: Virtualization.framework refused the disk image' })
  machine({ name: 'msb1', platform: 'microsandbox', backend: 'namespaces', state: 'unresolved', cpus: 2, memory: 4 * GiB, disk: 20 * GiB })
  store({ name: 'shop', machine: 'native' })
  store({ name: 'old', machine: 'lima2' })
  store({ name: 'team', kind: 'postgresql', machine: null, url: 'postgresql://app@db.internal:5432/layerfs', password: 'env:LAYERFS_TEAM_PG', profile: 'durable', reachable: false })
  const api = project('shop', 'api', API_FILES, 72)
  history(api, 'feature-login', [['Add a login route', 30, { '/src/routes/login.js': "export function login(req, res) {\n  res.writeHead(204).end()\n}\n" }]])
  project('old', 'archive', NOTES_FILES, 900)
  project('team', 'crm', CRM_FILES, 400)
  d.sandboxes['api-stuck'] = { name: 'api-stuck', project: 'shop/api', machine: 'native', state: 'unresolved', backend: 'native', route: 'nfs', image: null, runtime: null, created: t - 5 * HOUR, op: null, workspaces: {} }
  d.sandboxes['archive-1'] = { name: 'archive-1', project: 'old/archive', machine: 'lima2', state: 'running', backend: 'namespaces', route: 'fuse', image: 'layerfs/sandbox:latest', runtime: null, created: t - 50 * HOUR, op: null, workspaces: {} }
}

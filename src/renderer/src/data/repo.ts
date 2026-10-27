// A project's committed files and history, as the fs and branch calls
// report them (fs.list/read/blame, branch.list_commits/diff_commits).
// Sample data until the host process serves the real ones. LayerFS has no
// agent attribution; `by` is Connect's own record of which session
// committed, absent for Commits made elsewhere.

import type { Agent, Project } from '@/data/sample'

export interface TreeNode {
  name: string
  path: string
  kind: 'dir' | 'file'
  children?: TreeNode[]
}

export interface Author {
  session: string
  agent: Agent
}

export interface FileChange {
  path: string
  added: number
  removed: number
  /** A few diff lines for the sample: ' ' context, '+' added, '-' removed. */
  hunk?: string[]
}

export interface Commit {
  id: string
  message: string
  ago: string
  by?: Author
  changes: FileChange[]
}

function dir(path: string, children: TreeNode[]): TreeNode {
  return { name: path.split('/').pop() ?? path, path, kind: 'dir', children }
}
function file(path: string): TreeNode {
  return { name: path.split('/').pop() ?? path, path, kind: 'file' }
}

export function treeFor(_project: Project): TreeNode[] {
  return [
    dir('/.next', [dir('/.next/cache', [file('/.next/cache/dev.json')])]),
    dir('/app', [
      dir('/app/cart', [file('/app/cart/page.tsx'), file('/app/cart/totals.ts')]),
      dir('/app/checkout', [file('/app/checkout/page.tsx')]),
      file('/app/layout.tsx'),
      file('/app/page.tsx'),
    ]),
    dir('/node_modules', [dir('/node_modules/next', []), dir('/node_modules/react', [])]),
    file('/.gitignore'),
    file('/README.md'),
    file('/build.sh'),
    file('/install.sh'),
    file('/package-lock.json'),
    file('/package.json'),
    file('/serve.sh'),
    file('/test.sh'),
  ]
}

const title = (key: string) => key.replace(/(^|-)(\w)/g, (_, dash: string, c: string) => (dash ? ' ' : '') + c.toUpperCase())

export function fileText(project: Project, path: string): string | undefined {
  const key = project.key
  switch (path) {
    case '/serve.sh':
      return `# Serves each page's heading on localhost:3000 until stopped, standing in
# for \`next start\`. When the port is taken (Workspaces share the host's
# localhost in this sample), it keeps running without serving.
mkdir -p .next/cache
echo '{}' > .next/cache/dev.json
echo "ready on http://localhost:3000"
exec python3 -c '
import http.server, os, re, time

class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        page = "app" + self.path.split("?")[0].rstrip("/") + "/page.tsx"
        found = os.path.isfile(page) and re.search(r"<h1>(.*?)</h1>", open(page).read())
        self.send_response(200 if found else 404)
        self.end_headers()
        body = found.group(1) if found else "404: This page could not be found."
        self.wfile.write(("<h1>%s</h1>\\n" % body).encode())

    def log_message(self, *args):
        pass

try:
    server = http.server.HTTPServer(("127.0.0.1", 3000), Page)
except OSError:
    print("localhost:3000 is taken; running without serving", flush=True)
    while True:
        time.sleep(3600)
server.serve_forever()
'
`
    case '/package.json':
      return `{
  "name": "${key}",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "./build.sh",
    "start": "./serve.sh",
    "test": "./test.sh"
  },
  "dependencies": {
    "next": "16.2.0",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  }
}
`
    case '/README.md':
      return `# ${title(key)}

A small Next.js app that LayerFS Connect's sample sessions work on.

## Scripts

- \`./install.sh\` installs dependencies into \`node_modules\`.
- \`./build.sh\` checks every page has a heading.
- \`./serve.sh\` serves the pages on localhost:3000.
- \`./test.sh\` requests each page and checks the heading.
`
    case '/app/page.tsx':
      return `export default function Home() {
  return (
    <main>
      <h1>${title(key)}</h1>
      <p>Everything you need, delivered.</p>
      <a href="/cart">Your cart</a>
    </main>
  )
}
`
    case '/app/layout.tsx':
      return `export const metadata = { title: '${title(key)}' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`
    case '/app/cart/page.tsx':
      return `import { totals } from './totals'

export default function Cart() {
  const { items, sum } = totals()
  return (
    <main>
      <h1>Your cart</h1>
      <p>{items} items · {sum}</p>
      <a href="/checkout">Check out</a>
    </main>
  )
}
`
    case '/app/cart/totals.ts':
      return `import { cookies } from 'next/headers'

export interface Line {
  sku: string
  price: number
  quantity: number
}

/** Reads the cart from its cookie, so a removed item is never counted. */
export function totals() {
  const raw = cookies().get('cart')?.value ?? '[]'
  const lines: Line[] = JSON.parse(raw)
  const items = lines.reduce((n, l) => n + l.quantity, 0)
  const cents = lines.reduce((n, l) => n + l.price * l.quantity, 0)
  return { items, sum: \`$\${(cents / 100).toFixed(2)}\` }
}
`
    case '/app/checkout/page.tsx':
      return `export default function Checkout() {
  return (
    <main>
      <h1>Checkout</h1>
      <form action="/api/pay" method="post">
        <button type="submit">Pay now</button>
      </form>
    </main>
  )
}
`
    case '/build.sh':
      return `#!/bin/sh
# Fails when a page has no <h1>, standing in for \`next build\`.
set -e
for page in $(find app -name page.tsx); do
  grep -q '<h1>' "$page" || { echo "no heading: $page"; exit 1; }
done
echo "built $(find app -name page.tsx | wc -l) pages"
`
    case '/install.sh':
      return `#!/bin/sh
set -e
npm ci --no-audit --no-fund
`
    case '/test.sh':
      return `#!/bin/sh
# Requests each page from serve.sh and checks its heading.
set -e
./serve.sh & server=$!
trap 'kill $server' EXIT
sleep 1
for path in / /cart /checkout; do
  curl -fsS "http://localhost:3000$path" | grep -q '<h1>' || { echo "FAIL $path"; exit 1; }
  echo "ok $path"
done
`
    case '/.gitignore':
      return `node_modules
.next
`
    case '/.next/cache/dev.json':
      return `{}
`
    case '/package-lock.json':
      return `{
  "name": "${key}",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "${key}", "dependencies": { "next": "16.2.0", "react": "19.3.1" } }
  }
}
`
    default:
      return undefined
  }
}

const headNumber = (project: Project) => Number(project.lastCommit.id.replace(/\D/g, '')) || 1

export const MESSAGES = [
  'Fix the cart total when an item is removed',
  'Add a heading to the checkout page',
  'Run the page tests in test.sh',
  'Serve pages from app/ in serve.sh',
  'Document the scripts in the README',
  'Pin next and react',
  'Check every page has a heading in build.sh',
  'Add the cart page',
  'Lay out the root page',
  'Ignore build output',
  'Install dependencies with npm ci',
  'Init',
]

export const CHANGES: FileChange[][] = [
  [
    {
      path: '/app/cart/page.tsx',
      added: 3,
      removed: 1,
      hunk: [
        " import { totals } from './totals'",
        ' ',
        ' export default function Cart() {',
        '-  const { items, sum } = totals(cart)',
        '+  const { items, sum } = totals()',
        '+  // totals() reads the cart itself, so a removed item drops out.',
        '   return (',
      ],
    },
    { path: '/app/cart/totals.ts', added: 12, removed: 4 },
  ],
  [
    {
      path: '/app/checkout/page.tsx',
      added: 1,
      removed: 0,
      hunk: [' export default function Checkout() {', '   return (', '     <main>', '+      <h1>Checkout</h1>'],
    },
  ],
  [{ path: '/test.sh', added: 11, removed: 0 }],
  [{ path: '/serve.sh', added: 25, removed: 3 }],
  [{ path: '/README.md', added: 9, removed: 1 }],
  [{ path: '/package.json', added: 3, removed: 3 }, { path: '/package-lock.json', added: 40, removed: 38 }],
  [{ path: '/build.sh', added: 7, removed: 0 }],
  [{ path: '/app/cart/page.tsx', added: 11, removed: 0 }],
  [{ path: '/app/page.tsx', added: 9, removed: 0 }, { path: '/app/layout.tsx', added: 10, removed: 0 }],
  [{ path: '/.gitignore', added: 2, removed: 0 }],
  [{ path: '/install.sh', added: 3, removed: 0 }],
  [{ path: '/', added: 120, removed: 0 }],
]

const AGO = ['4 min ago', '22 min ago', '1 h ago', '2 h ago', '3 h ago', 'yesterday', 'yesterday', '2 days ago', '2 days ago', '3 days ago', '4 days ago', '5 days ago']

/** Commits main's Layers were published from, newest first; Blame names these. */
export function commitsFor(project: Project): Commit[] {
  const head = headNumber(project)
  const count = Math.min(MESSAGES.length, head)
  return Array.from({ length: count }, (_, i) => {
    const session = project.sessions[i % project.sessions.length]
    // Every third Commit came from outside Connect.
    const by = i % 3 === 2 ? undefined : { session: session.id, agent: session.agent }
    return {
      id: `c${head - i}`,
      message: MESSAGES[i] ?? 'Update files',
      ago: AGO[i] ?? `${i} days ago`,
      by,
      changes: CHANGES[i] ?? [{ path: '/README.md', added: 1, removed: 1 }],
    }
  })
}

/** One blame entry per line: which Commit last changed it. */
export function blameFor(project: Project, path: string, lineCount: number): Commit[] {
  const history = commitsFor(project)
  const touching = history.filter((c) => c.changes.some((ch) => ch.path === path || ch.path === '/'))
  const sources = touching.length > 0 ? touching : history.slice(-1)
  // Older Commits own the top of the file, newer ones the lines they edited.
  return Array.from({ length: lineCount }, (_, i) => {
    const slot = Math.floor((i / Math.max(lineCount, 1)) * sources.length)
    return sources[sources.length - 1 - slot] ?? sources[0]
  })
}

import type { SandboxSnapshot } from '@/components/sandbox/model'
import { DURATION, scene } from './sandbox-scenarios'

/** Illustrative runtime files, never read from the host or written into a workspace. */
export function detailSnapshot(name: string, project: string, data: ReturnType<typeof scene>, actorLinks: Record<string, string> = {}): SandboxSnapshot {
  const checks = name === 'checks'
  const command = checks ? 'test' : 'review'
  const workspace = checks ? 'checks:tests' : data.actors.find(a => a.id === 'reviewer')?.workspace ?? 'dev:review'
  const actor = checks ? 'tester' : 'reviewer'
  const availableAt = checks ? 14 : 12
  return {
    name, project, runtimeId: `example-${name}-01`, image: 'layerfs-sandbox:example', backend: 'Docker container',
    machine: { name: 'docker', state: 'Running', platform: 'Linux', architecture: 'arm64', description: 'Local Docker Engine', href: '/machines/docker' },
    ...data, links: actorLinks, duration: DURATION,
    scratch: { path: '/tmp', files: [
      { path: '.npm/_logs/install.log', content: 'Sample package cache log.\nCache is shared within this sandbox.\nNo package installation was performed.\n', type: 'Log', mode: 'rw-r--r--', availableAt: 0 },
      { path: 'logs/session.log', content: `Sandbox ${name}\nRuntime initialized (simulated).\nCommand HOME=/tmp\nWorkspace files use separate mounts.\n`, type: 'Log', mode: 'rw-r--r--', availableAt: 0 },
      { path: 'reports/coverage.json', content: JSON.stringify({ simulation: true, files: ['test/filter.test.ts'], passed: checks ? 4 : 2, failed: 0 }, null, 2) + '\n', type: 'JSON', mode: 'rw-r--r--', availableAt, actor, command, workspace },
      { path: 'reports/test-results.xml', content: `<testsuite name="filter" tests="${checks ? 4 : 2}" failures="0">\n  <testcase name="empty query" />\n  <testcase name="mixed-case query" />\n${checks ? '  <testcase name="whitespace query" />\n  <testcase name="unmatched query" />\n' : ''}</testsuite>\n`, type: 'XML', mode: 'rw-r--r--', availableAt, actor, command, workspace },
      { path: 'downloads/README.txt', content: 'Sample downloads directory.\nThese files belong to sandbox scratch, outside branch history.\n', type: 'Text', mode: 'rw-r--r--', availableAt: 0 },
    ] },
    workspaceFiles: [
      { path: 'README.md', content: '# Project search\n\nSearch projects by name.\nAn empty query matches all projects.\n', type: 'Markdown', mode: 'rw-r--r--', availableAt: 0 },
      { path: 'src/filter.ts', content: 'export const matches = (name: string, query: string) =>\n  name.toLowerCase().includes(query.trim().toLowerCase())\n', type: 'TypeScript', mode: 'rw-r--r--', availableAt: 0 },
      { path: 'test/filter.test.ts', content: 'test("empty query", () => assert.ok(matches("Connect", "")))\ntest("mixed-case query", () => assert.ok(matches("Connect", "connect")))\n', type: 'TypeScript', mode: 'rw-r--r--', availableAt: 0 },
    ],
  }
}

/** The same canonical examples opened by the conversation map and by a standalone URL. */
export function exampleSandbox(machine: string, name: string): SandboxSnapshot | null {
  if (machine !== 'docker' || !['dev','checks'].includes(name)) return null
  return detailSnapshot(name, 'ui-example/search', scene('parallel','Add project search'), {
    main: '/chat/ui-example-chat', reviewer: '/chat/ui-example-chat/subagents/example-review%3A0',
  })
}

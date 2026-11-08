// Regenerate simulated discovery from an explicitly configured pinned CLI.
import { writeFileSync } from 'node:fs'
import { discover } from '../host/cli/capabilities.js'
const { identity, ...help } = await discover({ cli: process.env.LAYERFS_CONNECT_CLI })
for (const [name, data] of [['table', help.calls], ['discovery', help]]) writeFileSync(new URL(`../host/sim/${name}.json`, import.meta.url), `${JSON.stringify(data, null, 1)}\n`)
console.log(`wrote ${help.calls.length} calls from ${identity.commit} (dirty:${identity.dirty})`)

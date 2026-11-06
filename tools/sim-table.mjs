// Writes host/sim/table.json again from the linked LayerFS package's call
// table, so the simulator takes every call exactly as the real library does.
// Run it after relinking or upgrading LayerFS:
//   node tools/sim-table.mjs
// host/test/sim.test.js fails when the saved table and the library's differ.
import { writeFileSync } from 'node:fs'
import { table } from 'layerfs'

const file = new URL('../host/sim/table.json', import.meta.url)
writeFileSync(file, `${JSON.stringify(table, null, 1)}\n`)
console.log(`wrote ${table.length} calls to host/sim/table.json`)

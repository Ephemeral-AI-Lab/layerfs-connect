// Saved discovery is generated from the pinned CLI, usable by offline parsers.
// A configured real binary supplies its own table; never load the Node binding.
import { readFileSync } from 'node:fs'
import { discover } from './capabilities.js'
export const table = process.env.LAYERFS_CONNECT_CLI
  ? (await discover({ cli: process.env.LAYERFS_CONNECT_CLI })).calls
  : JSON.parse(readFileSync(new URL('../sim/table.json', import.meta.url), 'utf8'))

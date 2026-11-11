// Parse commands against discovery from the configured, pinned real CLI.
import { join } from 'node:path'
import { APP, requireRealBackend } from '../config.js'
import { discover } from './capabilities.js'
requireRealBackend()
export const table = (await discover({ cli: process.env.LAYERFS_CONNECT_CLI || join(APP, 'runtime/bin/layerfs') })).calls

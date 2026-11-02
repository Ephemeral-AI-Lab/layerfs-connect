// @layerfs/agent's platform.js (layerfs#529) as a scenario run's scripts load
// it (resolve-layerfs.js points the SDK's imports of platform.js here when
// LAYERFS_CONNECT_SCOPE is set): the same module, except that a
// sandbox.create naming no platform gets the run's (scope.json `platform`,
// from `/scenario <name> -platform <name>`) instead of the home's default.
// A platform the script names is kept, and LayerFS still refuses one this
// home does not allow. Only sandbox.create calls checkedPlatform.
import * as real from 'layerfs-connect:real-platform'
import { Scope, SCOPE_ENV } from './scope.js'

export * from 'layerfs-connect:real-platform'

const chosen = Scope.open(process.env[SCOPE_ENV]).platform

/** The platform a scenario run's sandbox.create asks for: the script's, else the run's. */
export const runPlatform = (named, run) => (named === undefined && run ? run : named)

export function checkedPlatform(client, platform, os) {
  return real.checkedPlatform(client, runPlatform(platform, chosen), os)
}

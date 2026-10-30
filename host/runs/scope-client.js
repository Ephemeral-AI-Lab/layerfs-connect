// @layerfs/agent's client.js as a scenario run's scripts load it
// (resolve-layerfs.js points the SDK's imports of client.js here when
// LAYERFS_CONNECT_SCOPE is set): the same module, with each call first put in
// the run's scope (scope.js), then traced and sent as usual. Everything else
// is the real module's.
import * as real from 'layerfs-connect:real-client'
import { Scope, SCOPE_ENV } from './scope.js'

export * from 'layerfs-connect:real-client'

const scope = Scope.open(process.env[SCOPE_ENV])

export function invoke(op, args, options, transport) {
  return scope.call(op, args, (o, a) => real.invoke(o, a, options, transport))
}

export function invokeBackend(op, args, options, transport) {
  return scope.call(op, args, (o, a) => real.invokeBackend(o, a, options, transport))
}

export function invokeClient(client, op, args) {
  real.live(client)
  return invoke(op, { ...real.projectArgs(client), ...real.storeArgs(client), ...args }, client.options, real.transportOf(client))
}

export function invokeClientBackend(client, op, args) {
  real.live(client)
  return invokeBackend(op, { ...real.projectArgs(client), ...real.storeArgs(client), ...args }, client.options, real.transportOf(client))
}

// A scenario chat on a project of a PostgreSQL Store (layerfs#506 d): its
// bash calls carry the connection's URL, noted in this process only.
//   node --test host/test/scenario-postgresql.test.js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentScenarios } from '../agents/scenarios.js'

test("a scenario chat on a PostgreSQL Store's project has the connection's URL in its bash calls", async () => {
  const asked = []
  const spec = { home: '/h', docker: 'docker', prefix: 'p', postgresqlUrl: async (store) => { asked.push(store); return `postgresql://u@h/${store}` } }
  const scenarios = await new AgentScenarios({ spec, dir: '/nowhere' }).ready()
  const record = { scenario: { project: 'team-pg/todo', dir: '/tmp/s', scopeDir: '/tmp/s/scope', volume: null, image: null } }
  const env = await scenarios.env(record)
  assert.equal(env.LAYERFS_STORE_PATH, 'postgresql:team-pg')
  assert.equal(env.LAYERFS_STORE, 'team-pg')
  assert.deepEqual(JSON.parse(env.LAYERFS_STORE_POSTGRESQL), { url: 'postgresql://u@h/team-pg' })
  // noted once, then read from this process
  await scenarios.env(record)
  assert.deepEqual(asked, ['team-pg'])
})

test("a scenario chat on a volume's project asks for no connection", async () => {
  const spec = { home: '/h', docker: 'docker', prefix: 'p', postgresqlUrl: async () => assert.fail('asked') }
  const scenarios = await new AgentScenarios({ spec, dir: '/nowhere' }).ready()
  const env = await scenarios.env({ scenario: { project: 'shop', dir: '/tmp/s', scopeDir: '/tmp/s/scope', volume: 'v-shop', image: null } })
  assert.equal(env.LAYERFS_VOLUME, 'v-shop')
  assert.equal(env.LAYERFS_STORE_POSTGRESQL, undefined)
})

// Fresh owner-only PostgreSQL/MinIO proof; secrets remain inherited env references.
import { spawnSync } from 'node:child_process'
import { randomBytes, createHash, createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { execute } from '../../host/cli/spawn.js'
const root = mkdtempSync(join(tmpdir(), 'connect-phase2-services-'))
const spec = { cli: process.env.LAYERFS_CONNECT_CLI, home: join(root, 'home') }
const credentials = { POSTGRES_USER: 'proof', POSTGRES_DB: 'proof', POSTGRES_PASSWORD: randomBytes(24).toString('hex'), MINIO_ROOT_USER: 'proofaccess', MINIO_ROOT_PASSWORD: randomBytes(24).toString('hex') }
const env = { ...process.env, ...credentials, PROOF_PG_PASSWORD: credentials.POSTGRES_PASSWORD, LAYERFS_BUCKET_PROOF_ACCESS_KEY: credentials.MINIO_ROOT_USER, LAYERFS_BUCKET_PROOF_SECRET_KEY: credentials.MINIO_ROOT_PASSWORD }
const receipt = { identity: await execute(spec, ['--version', '--json'], { discovery: true }), started: new Date().toISOString(), calls: [], containers: [], cleanup: [] }
let expired = false
const wall = setTimeout(() => { expired = true; cleanup(); console.error('Explicit120s verification deadline'); process.exit(1) }, 120000)
function docker(args) { const result = spawnSync('docker', args, { encoding: 'utf8', env, timeout: 15000 }); if (result.status !== 0) throw new Error(`Docker ${args[0]} failed (${result.status})`); return result.stdout.trim() }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function ready(probe) { for (let i = 0; i < 100; i++) { try { if (await probe()) return } catch {} await sleep(100) } throw new Error('Owned service readiness deadline') }
const call = async argv => {
 try { const result = await execute(spec, argv, { env, timeout: 15000 }); receipt.calls.push({ argv, result }); return result }
 catch (e) { receipt.calls.push({ argv, refusal: { code: e.code, message: e.message, transport: e.transport } }); throw e }
}
function cleanup() {
 for (const id of receipt.containers) try { docker(['rm', '-f', id]); receipt.cleanup.push(`container removed:${id}`) } catch(e) { receipt.cleanup.push(e.message) }
 if (receipt.containers.length === receipt.cleanup.filter(s => s.startsWith('container removed:')).length) { rmSync(root, { recursive: true, force: true }); receipt.cleanup.push('owned home removed') }
}
try {
 const pg = docker(['run', '-d', '--name', `connect137-pg-${randomBytes(5).toString('hex')}`, '-e', 'POSTGRES_USER', '-e', 'POSTGRES_DB', '-e', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432', 'postgres:17-bookworm']); receipt.containers.push(pg)
 const minio = docker(['run', '-d', '--name', `connect137-minio-${randomBytes(5).toString('hex')}`, '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', '-p', '127.0.0.1::9000', 'cgr.dev/chainguard/minio:latest', 'server', '/data']); receipt.containers.push(minio)
 const pgPort = docker(['port', pg, '5432/tcp']).split(':').at(-1)
 const minioPort = docker(['port', minio, '9000/tcp']).split(':').at(-1)
 await ready(() => spawnSync('docker', ['exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'proof'], { timeout: 2000 }).status === 0)
 await ready(async () => (await fetch(`http://127.0.0.1:${minioPort}/minio/health/ready`)).ok)
 const endpoint = `http://127.0.0.1:${minioPort}`
 const hash = value => createHash('sha256').update(value).digest('hex')
 const hmac = (key, value) => createHmac('sha256', key).update(value).digest()
 async function signed(method, path, query = '', body = '') {
  const at = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), date = at.slice(0, 8)
  const host = new URL(endpoint).host, payload = hash(body), headers = `host:${host}\nx-amz-content-sha256:${payload}\nx-amz-date:${at}\n`, names = 'host;x-amz-content-sha256;x-amz-date'
  const canonical = `${method}\n${path}\n${query}\n${headers}\n${names}\n${payload}`
  const scope = `${date}/us-east-1/s3/aws4_request`, toSign = `AWS4-HMAC-SHA256\n${at}\n${scope}\n${hash(canonical)}`
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.MINIO_ROOT_PASSWORD}`, date), 'us-east-1'), 's3'), 'aws4_request')
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  const response = await fetch(`${endpoint}${path}${query ? `?${query}` : ''}`, { method, headers: { 'x-amz-content-sha256': payload, 'x-amz-date': at, authorization: `AWS4-HMAC-SHA256 Credential=${credentials.MINIO_ROOT_USER}/${scope}, SignedHeaders=${names}, Signature=${signature}` }, body: body || undefined })
  if (!response.ok) throw new Error(`S3 fixture preparation failed (${response.status})`)
 }
 await signed('PUT', '/proof-bucket')
 await signed('PUT', '/proof-bucket', 'versioning=', '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>')
 await call(['machine', 'list'])
 await call(['store', 'connect', 'pg-proof', `postgresql://proof@127.0.0.1:${pgPort}/proof`, '--password', 'env:PROOF_PG_PASSWORD', '--synchronous-commit', 'off'])
 mkdirSync(join(root, 'input')); writeFileSync(join(root, 'input', 'readme'), 'PostgreSQL and MinIO proof\n')
 await call(['project', 'init', 'pg-proof/p', join(root, 'input')])
 const pgStats = await call(['store', 'stats', 'pg-proof']); assert.equal(pgStats.free, null)
 const stats = await call(['project', 'stats', 'pg-proof/p']); assert.equal(stats.complete, true)
 await call(['doctor', 'store', 'connection', 'pg-proof', '--timeout', '10s'])
 const integrity = await call(['doctor', 'store', 'integrity', 'pg-proof', '--timeout', '10s']); assert.equal(integrity.ok, true); assert.equal(integrity.complete, false); assert.ok(integrity.checks.some(check => check.outcome === 'unknown' && check.message.includes('amcheck')))
 await call(['store', 'create', 'sqlite-proof'])
 await call(['project', 'init', 'sqlite-proof/p', join(root, 'input')])
 await call(['backup', 'connect', 'bucket-proof', `${endpoint}/proof-bucket/connect`, '--key', 'env:LAYERFS_BUCKET_PROOF'])
 const observed = await call(['doctor', 'backup', 'connection', 'bucket-proof', '--timeout', '10s']); assert.equal(observed.mode, 'observation'); assert.equal(observed.ok, true)
 const write = await call(['doctor', 'backup', 'connection', 'bucket-proof', '--write-test', '--timeout', '10s']); assert.equal(write.mode, 'write-test'); assert.equal(write.ok, true)
 await call(['backup', 'create', 'sqlite-proof', 'bucket-proof'])
 await call(['backup', 'list', 'bucket-proof'])
 await call(['backup', 'restore', 'restored-proof', 'bucket-proof', 'sqlite-proof'])
 const restored = await call(['project', 'stats', 'restored-proof/p']); assert.equal(restored.logical, stats.logical)
 receipt.verdict = 'PASS'
} catch(e) { receipt.verdict = 'FAIL'; receipt.error = e.message; process.exitCode = 1 }
finally {
 clearTimeout(wall)
 if (!expired) cleanup()
 receipt.ended = new Date().toISOString()
 writeFileSync(new URL('../../docs/evidence/phase-2/services-native-third.json', import.meta.url), JSON.stringify(receipt, null, 2)+'\n')
 console.log(JSON.stringify({ verdict: receipt.verdict, error: receipt.error, cleanup: receipt.cleanup }))
}

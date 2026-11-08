#!/usr/bin/env node
// Simulated CLI: actual adapter/process boundary; no native or remote execution.
import { readFileSync } from 'node:fs'
import { World } from '../world.js'
import { doctorReport } from '../doctor.js'
const help = JSON.parse(readFileSync(new URL('../discovery.json', import.meta.url), 'utf8'))
const words = process.argv.slice(2)
const eventOutput = words.includes('--events')
const send = (value, fd = process.stdout) => fd.write(`${JSON.stringify(value)}\n`)
if (words.join(' ') === '--version --json') {
  send({ version: '2.0.0 (simulated)', commit: '833d04cf44e8e747929d50ab1170a48260d9381c', dirty: false, features: ['machine', 'postgresql'], simulated: true })
} else if (words.join(' ') === 'help --json') send(help)
else {
  let world
  try {
    if (!process.env.LAYERFS_HOME) throw Object.assign(new Error('Explicit home required'), { code: 'InvalidInput' })
    const [family, rawCall, ...rest] = words
    world = World.open(process.env.LAYERFS_HOME)
    if (family === 'doctor') send(rawCall ? doctorReport(words.slice(1), world) : world.doctor())
    else {
      const entry = help.calls.find((c) => c.family === family && c.call === rawCall?.replaceAll('-', '_'))
      if (!entry) throw Object.assign(new Error('Unknown command'), { usage: true })
      const args = {}, positions = []
      let progress = false, events = false, literal = false
      for (let i = 0; i < rest.length; i++) {
        let word = rest[i]
        if (word === '--' && !literal) { literal = true; continue }
        if (literal || !word.startsWith('--')) { positions.push(word); continue }
        if (word === '--events') { events = true; continue }
        if (word === '--progress') { progress = true; continue }
        const [flag, inline] = word.slice(2).split(/=(.*)/s, 2)
        const name = flag.replaceAll('-', '_')
        const option = entry.options.find((o) => o.name === name)
        if (!option || option.kind === 'function') throw Object.assign(new Error('Unknown option'), { usage: true })
        const value = inline ?? (option.kind === 'bool' ? 'true' : rest[++i])
        if (option.kind === 'bool' && !['true','false'].includes(value)) throw Object.assign(new Error('Invalid Bool'), { usage: true })
        args[name] = option.kind === 'bool' ? value === 'true' : ['int','size'].includes(option.kind) && /^-?\d+$/.test(value) ? Number(value) : option.kind === 'json' ? JSON.parse(value) : value
      }
      let k = 0
      for (const arg of entry.args) {
        if (arg.kind === 'json' || arg.kind === 'content') { const data = readFileSync(0); args[arg.name] = arg.kind === 'json' ? JSON.parse(data.toString()) : data.toString() }
        else if (positions[k] !== undefined) args[arg.name] = positions[k++]
        else if (!arg.optional) throw Object.assign(new Error('Missing argument'), { usage: true })
      }
      if (k !== positions.length) throw Object.assign(new Error('Extra argument'), { usage: true })
      const on = { on_progress: (value) => { if (events || progress) send({ progress: value }, events ? process.stdout : process.stderr) } }
      const result = await world.call(`${family}.${entry.call}`, args, on)
      if (['project.list','sandbox.list','sandbox.get'].includes(`${family}.${entry.call}`)) delete result.has_more
      if (events) {
        for (const stream of ['stdout','stderr']) if (result[stream] != null) send({ stream, bytes: result[stream] })
        send({ result })
      } else send(result)
    }
    world.flush()
  } catch (error) {
    if (error.usage) { process.stderr.write('layerfs: invalid simulated CLI usage\n'); process.exitCode = 2 }
    else { send(eventOutput ? { refusal: { code: error.code ?? 'Failed', message: error.message, detail: error.detail ?? null } } : { code: error.code ?? 'Failed', message: error.message, detail: error.detail ?? null }, eventOutput ? process.stdout : process.stderr); process.exitCode = 125 }
  }
}

#!/usr/bin/env node
// The LayerFS outcome codes the scenarios' `expect` checks, as
// method:outcome, one per line, sorted. Alternatives (`a:X|Y`) count as both.
//   node tools/replay/coverage.mjs <rev|-> <name>... [--repo <git checkout>] [--path <folder in it>]
// Rev "-" reads Connect's scenarios/. Another rev reads <path>/<name>/scenario.json
// from that commit of --repo (default Connect itself, path scenarios); to
// compare with dsh-layerfs's history, name its checkout:
//   node tools/replay/coverage.mjs 087cbc4 tour --repo ../dsh-layerfs
// Compare two revisions with comm, e.g. the codes a change lost:
//   comm -23 <(node tools/replay/coverage.mjs <rev> tour) <(node tools/replay/coverage.mjs - tour)
// Before version 3 an expect entry could be a bare outcome (`Mounted`), which
// matched any method; it shows here without a method. Ported from dsh-layerfs.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** The codes of scenario objects' expects. */
export function codesOf(scenarios) {
  const codes = new Set()
  for (const scenario of scenarios) {
    for (const steps of Object.values(scenario.agents)) {
      for (const step of steps) {
        for (const code of step.expect ?? []) {
          const [first, ...alts] = code.split('|')
          const head = first.slice(0, first.lastIndexOf(':') + 1)
          for (const one of [first, ...alts.map((alt) => head + alt)]) codes.add(one)
        }
      }
    }
  }
  return [...codes].sort()
}

function main() {
  const argv = process.argv.slice(2)
  const opt = (flag, fallback) => {
    const i = argv.indexOf(flag)
    return i < 0 ? fallback : argv.splice(i, 2)[1]
  }
  const repo = resolve(opt('--repo', ROOT))
  const path = opt('--path', 'scenarios')
  const [rev, ...names] = argv
  if (!rev || !names.length) {
    console.error('usage: coverage.mjs <rev|-> <scenario>... [--repo <git checkout>] [--path <folder in it>]')
    process.exit(2)
  }
  const read = (name) =>
    JSON.parse(
      rev === '-'
        ? readFileSync(join(ROOT, 'scenarios', name, 'scenario.json'), 'utf8')
        : execFileSync('git', ['-C', repo, 'show', `${rev}:${path}/${name}/scenario.json`], { encoding: 'utf8' }),
    )
  console.log(codesOf(names.map(read)).join('\n'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

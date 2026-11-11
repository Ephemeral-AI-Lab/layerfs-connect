/** Deterministic, bounded-file release histories. These are authored fixture revisions. */
export const DENSE_TIERS = Object.freeze({
  design: { tier: 1, cycles: 9, topics: ['tokens', 'components', 'accessibility'] },
  billing: { tier: 2, cycles: 10, topics: ['invoices', 'pricing', 'rounding'] },
  sdk: { tier: 3, cycles: 12, topics: ['requests', 'pagination', 'validation'] },
  evaluation: { tier: 4, cycles: 15, topics: ['queries', 'rubrics', 'judgments'] },
  embeddings: { tier: 5, cycles: 19, topics: ['corpus', 'chunking', 'provenance'] },
  compiler: { tier: 6, cycles: 24, topics: ['grammar', 'diagnostics', 'arithmetic'] },
  gateway: { tier: 7, cycles: 30, topics: ['routes', 'policies', 'limits'] },
  website: { tier: 8, cycles: 38, topics: ['catalog', 'delivery', 'care'] },
})

const padded = n => String(n).padStart(3, '0')
export function denseCycleBranches(name, cycle) {
  const { topics } = DENSE_TIERS[name], suffix = padded(cycle)
  return { a: `${topics[0]}-${suffix}`, b: `${topics[1]}-${suffix}`, maintenance: `${topics[2]}-${suffix}`, integration: `integration-${suffix}`, release: `release-${suffix}` }
}

function revision(definition, name, cycle, lane, index) {
  const topic = DENSE_TIERS[name].topics[{ a: 0, b: 1, maintenance: 2 }[lane]]
  const artifact = ['specification', 'examples', 'policy', 'review'][(index - 1) % 4]
  // Every imported project already has docs/. file.write does not create parents.
  const path = `docs/revision-${topic}-${artifact}.${artifact === 'review' ? 'md' : 'json'}`
  const revision = (cycle - 1) * ({ a: 80, b: 80, maintenance: 49 }[lane]) + index
  const content = artifact === 'review'
    ? `# ${definition.title}: ${topic} review\n\nRelease cycle ${cycle}; authored revision ${revision}.\n\nReview ${topic} against its specification, examples and boundary policy. Preserve source identifiers, reject invalid values and explain ambiguous cases before publishing. These are fixture review instructions; no application test or evaluation was executed.\n`
    : JSON.stringify({ project: name, topic, artifact, releaseCycle: cycle, revision, fixture: true, execution: 'not-run', cases: Array.from({ length: 4 }, (_, i) => ({ id: `${topic}-${i + 1}`, order: i + 1, enabled: (revision + i) % 3 !== 0, boundary: (revision * (i + 1)) % 97, policy: ['accept-valid', 'reject-invalid', 'request-clarification'][(revision + i) % 3] })) }, null, 2) + '\n'
  return { path, content, message: `Revise ${topic} ${artifact}: cycle ${cycle}, revision ${revision}` }
}

function releaseRevision(definition, cycle, lane, index) {
  return { path: `docs/history-${lane}.md`, content: `# ${definition.title}: ${lane}\n\nRelease cycle ${cycle}; publication revision ${index}.\n\n${lane === 'integration' ? 'Integrates the two feature streams while preserving both histories.' : 'Integrates the published features and the maintenance stream from its earlier main base.'}\n\nThis authored fixture release records source changes. It does not claim an application build, test or evaluation was executed.\n`, message: `Prepare ${lane} publication ${cycle}.${index}` }
}

export function denseHistoryExtension(name, definition, { cycles } = {}) {
  const original = DENSE_TIERS[name]
  const profile = original && { ...original, cycles: cycles ?? original.cycles }
  if (!profile) throw new Error(`No dense history tier for ${name}`)
  if (!Number.isInteger(profile.cycles) || profile.cycles < 1 || profile.cycles > original.cycles) throw new Error(`Invalid cycle limit ${profile.cycles} for ${name}`)
  const branches = [], expectedMain = {}
  for (let cycle = 1; cycle <= profile.cycles; cycle++) branches.push(...Object.values(denseCycleBranches(name, cycle)))
  // Every cycle rewrites the same bounded paths, so only the last cycle determines main.
  for (const [lane, count] of [['a', 80], ['b', 80], ['maintenance', 49]]) for (let index = 1; index <= count; index++) {
    const change = revision(definition, name, profile.cycles, lane, index)
    expectedMain[change.path] = change.content
  }
  for (const [lane, count] of [['integration', 26], ['release', 27]]) {
    const change = releaseRevision(definition, profile.cycles, lane, count)
    expectedMain[change.path] = change.content
  }
  return { tier: profile.tier, cycles: profile.cycles, branches, expectedMain }
}

export function denseHistorySteps(store, name, definition, { cycles = DENSE_TIERS[name].cycles } = {}) {
  const steps = [], project = `${store}/${name}`
  const fork = (key, branch) => steps.push({ key, argv: ['branch', 'fork', project, branch, 'main'], expect: { kind: 'Forked' } })
  const write = (key, branch, change) => steps.push({ key, argv: ['file', 'write', project, branch, `/${change.path}`, '--message', change.message], input: change.content, expect: { kind: 'Committed' } })
  const merge = (key, branch, left, right) => steps.push({ key, argv: ['branch', 'merge', project, branch, left, right, '--message', `Integrate ${left} and ${right}`], expect: { kind: 'Merged', divergent: true } })
  const publish = (key, branch) => steps.push({ key, argv: ['branch', 'publish', project, branch], expect: { kind: 'Added', overwroteCount: 0 } })
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const key = `dense.${padded(cycle)}`, branch = denseCycleBranches(name, cycle)
    for (const lane of ['a', 'b', 'maintenance']) fork(`${key}.${lane}.fork`, branch[lane])
    for (const lane of ['a', 'b']) for (let index = 1; index <= 80; index++) write(`${key}.${lane}.write.${index}`, branch[lane], revision(definition, name, cycle, lane, index))
    merge(`${key}.integration.merge`, branch.integration, branch.a, branch.b)
    publish(`${key}.integration.publish.0`, branch.integration)
    for (let index = 1; index <= 26; index++) {
      write(`${key}.integration.write.${index}`, branch.integration, releaseRevision(definition, cycle, 'integration', index))
      publish(`${key}.integration.publish.${index}`, branch.integration)
    }
    for (let index = 1; index <= 49; index++) write(`${key}.maintenance.write.${index}`, branch.maintenance, revision(definition, name, cycle, 'maintenance', index))
    merge(`${key}.release.merge`, branch.release, 'main', branch.maintenance)
    publish(`${key}.release.publish.0`, branch.release)
    for (let index = 1; index <= 27; index++) {
      write(`${key}.release.write.${index}`, branch.release, releaseRevision(definition, cycle, 'release', index))
      publish(`${key}.release.publish.${index}`, branch.release)
    }
  }
  // The flat order remains a valid serial plan; dependencies expose only safe overlap.
  for (const step of steps) {
    const [, cycleText, lane, operation, indexText] = step.key.split('.')
    const cycle = Number(cycleText), key = `dense.${cycleText}`, index = Number(indexText)
    const forks = ['a', 'b', 'maintenance'].map(value => `${key}.${value}.fork`)
    step.lane = lane
    if (operation === 'fork') step.dependsOn = cycle === 1 ? [] : [`dense.${padded(cycle - 1)}.release.publish.27`]
    else if (['a', 'b', 'maintenance'].includes(lane)) step.dependsOn = index === 1 ? forks : [`${key}.${lane}.write.${index - 1}`]
    else if (operation === 'merge') step.dependsOn = lane === 'integration'
      ? [`${key}.a.write.80`, `${key}.b.write.80`]
      : [`${key}.integration.publish.26`, `${key}.maintenance.write.49`]
    else if (operation === 'write') {
      // The pinned persistence API requires request.commit to still be the
      // branch head at publication. Do not advance that head until it settles.
      step.dependsOn = [`${key}.${lane}.publish.${index - 1}`]
    } else if (operation === 'publish') {
      step.commitFrom = index === 0 ? `${key}.${lane}.merge` : `${key}.${lane}.write.${index}`
      step.dependsOn = [step.commitFrom, ...(index > 0 ? [`${key}.${lane}.publish.${index - 1}`] : [])]
      step.argv.push(`<commit:${step.commitFrom}>`)
    }
  }
  return steps
}

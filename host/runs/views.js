// The demo views: DemoSummary and DemoDetail from a loaded scenario and the
// call parser. The script shows each agent's steps as scenario.json writes
// them ({{scenario}} and {{image}} unfilled), plus the "Done." reply the
// loader adds after a last call, so indexes match the run's steps. A
// scenario of several sessions lists every session's agents (their names are
// unique) and its sessions.
import { stepView } from '../parse/index.js'

/** { summary (without latest and runs), script } of a demo: { id, folder, scenario, raw }. */
export function demoViews({ id, scenario, raw }) {
  const script = {}
  const kinds = {}
  const parts = scenario.sessions
    ? scenario.sessions.map((s) => ({ root: s.name, compiled: s.scenario.agents, raw: raw.sessions[s.name].agents }))
    : [{ root: scenario.root ?? 'root', compiled: scenario.agents, raw: raw.agents }]
  for (const part of parts)
    for (const [name, compiled] of Object.entries(part.compiled)) {
      const steps = [...part.raw[name]]
      while (steps.length < compiled.length) steps.push({ reply: compiled[steps.length].text })
      script[name] = steps.map((step, index) => stepView(step, index, name, part.root))
      for (const view of script[name]) for (const seg of view.segments) kinds[seg.kind] = (kinds[seg.kind] ?? 0) + 1
    }
  const agents = Object.entries(scenario.agents).map(([name, steps]) => ({ name, prompt: scenario.prompts.get(name) ?? null, steps: steps.length }))
  return {
    summary: {
      id,
      title: scenario.title,
      blurb: scenario.blurb || null,
      prompt: scenario.prompt || null,
      order: scenario.order ?? 1000,
      tags: scenario.tags,
      agents,
      sessions: scenario.sessions?.map((s) => ({ name: s.name, prompt: s.prompt, agents: Object.keys(s.scenario.agents) })) ?? null,
      steps: agents.reduce((n, a) => n + a.steps, 0),
      kinds,
      fixture: scenario.seed ?? scenario.fixture ?? '',
    },
    script,
  }
}

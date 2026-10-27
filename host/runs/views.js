// The demo views: DemoSummary and DemoDetail from a loaded scenario and the
// call parser. The script shows each agent's steps as scenario.json writes
// them ({{scenario}} and {{image}} unfilled), plus the "Done." reply the
// loader adds after a last call, so indexes match the run's steps.
import { stepView } from '../parse/index.js'

/** { summary (without latest and runs), script } of a demo: { id, folder, scenario, raw }. */
export function demoViews({ id, scenario, raw }) {
  const script = {}
  const kinds = {}
  for (const [name, compiled] of Object.entries(scenario.agents)) {
    const steps = [...raw.agents[name]]
    while (steps.length < compiled.length) steps.push({ reply: compiled[steps.length].text })
    script[name] = steps.map((step, index) => stepView(step, index, name))
    for (const view of script[name]) for (const seg of view.segments) kinds[seg.kind] = (kinds[seg.kind] ?? 0) + 1
  }
  const agents = Object.entries(scenario.agents).map(([name, steps]) => ({ name, prompt: scenario.prompts.get(name) ?? null, steps: steps.length }))
  return {
    summary: {
      id,
      title: scenario.title,
      blurb: scenario.blurb || null,
      order: scenario.order ?? 1000,
      tags: scenario.tags,
      agents,
      steps: agents.reduce((n, a) => n + a.steps, 0),
      kinds,
      fixture: scenario.seed ?? scenario.fixture ?? '',
    },
    script,
  }
}

// The "scenario" provider: one model per scenario a chat can play. It is not
// a language model. Each answer is the script's next step (scenario-plan.js),
// and the chat's own agent loop runs every call, so a scenario chat stops,
// continues and forks like any other chat. The script's last reply also runs
// the scenario's final checks and lands its folder on main (scenarios.js).
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { nextReply } from './scenario-plan.js'

export const SCENARIO_PROVIDER = 'scenario'
const API = 'layerfs-scenario'

const usage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })

const modelOf = (s) => ({
  id: s.id,
  name: `Scenario · ${s.title}`,
  api: API,
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 100_000,
})

/**
 * @param {object} runtime Pi's ModelRuntime
 * @param {object} o
 * @param {() => { id, title, scenario }[]} o.scenarios the scenarios chats play
 * @param {(piSessionId: string) => { scenarioId: string, traceOf(callId: string): object[], progress(reply: object): void, finish(): Promise<string>, failed(why: string): Promise<void> } | null} o.session
 *   the scenario chat a request comes from
 */
export function registerScenarioProvider(runtime, { scenarios, session }) {
  const list = scenarios()
  if (!list.length) return
  runtime.registerProvider(SCENARIO_PROVIDER, {
    name: 'LayerFS scenarios',
    baseUrl: 'http://scenario.invalid',
    apiKey: 'scripted',
    api: API,
    models: list.map(modelOf),
    streamSimple: (model, context, options = {}) => {
      const stream = createAssistantMessageEventStream()
      const message = { role: 'assistant', content: [], api: API, provider: SCENARIO_PROVIDER, model: model.id, usage: usage(), stopReason: 'stop', timestamp: Date.now() }
      const fail = (text, reason = 'error') => {
        message.stopReason = reason
        message.errorMessage = text
        stream.push({ type: 'error', reason, error: message })
      }
      setImmediate(async () => {
        try {
          const chat = session(options.sessionId)
          const found = scenarios().find((s) => s.id === model.id)
          if (!found) return fail(`No scenario named ${model.id}.`)
          if (!chat || chat.scenarioId !== model.id) return fail(`${model.name} plays only in its own chat: type /scenario ${model.id} to start one.`)
          const reply = nextReply(found.scenario, context.messages ?? [], (callId) => chat.traceOf(callId))
          if (options.signal?.aborted) return fail('Stopped.', 'aborted')
          if (reply.kind === 'error') {
            await chat.failed(reply.message)
            return fail(`Scenario ${found.title} stopped: ${reply.message}`)
          }
          stream.push({ type: 'start', partial: message })
          if (reply.kind === 'text') {
            const text = reply.last ? `${reply.text}\n\n${await chat.finish()}` : reply.text
            if (options.signal?.aborted) return fail('Stopped.', 'aborted')
            say(stream, message, text)
            stream.push({ type: 'done', reason: 'stop', message })
            return
          }
          chat.progress(reply)
          if (reply.say) say(stream, message, reply.say)
          const toolCall = { type: 'toolCall', id: `scenario_${reply.done + 1}_${Date.now().toString(36)}`, name: reply.call.name, arguments: reply.call.args }
          message.content.push(toolCall)
          const contentIndex = message.content.length - 1
          stream.push({ type: 'toolcall_start', contentIndex, partial: message })
          stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: message })
          message.stopReason = 'toolUse'
          stream.push({ type: 'done', reason: 'toolUse', message })
        } catch (error) {
          fail(error?.message ?? String(error))
        }
      })
      return stream
    },
  })
}

/** One whole text block. */
function say(stream, message, text) {
  const block = { type: 'text', text: '' }
  message.content.push(block)
  const contentIndex = message.content.length - 1
  stream.push({ type: 'text_start', contentIndex, partial: message })
  block.text = text
  stream.push({ type: 'text_delta', contentIndex, delta: text, partial: message })
  stream.push({ type: 'text_end', contentIndex, content: text, partial: message })
}

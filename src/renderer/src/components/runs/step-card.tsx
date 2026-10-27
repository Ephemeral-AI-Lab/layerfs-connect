import type { RunDetail, StepResult, StepView } from '@shared/host-api'
import { Ban, Bot, Check, CornerDownRight, MessageSquareReply, MoveRight, SquareTerminal, Wrench, X } from 'lucide-react'
import { memo, useState } from 'react'

import { KindChip, Spinner } from '@/components/runs/run-badges'
import { type AgentColor, duration, stepNo } from '@/components/runs/run-format'
import { SegmentList } from '@/components/runs/segments'
import { CallStrip, CheckChips, OutputBlock } from '@/components/runs/step-parts'
import { cn } from '@/lib/utils'

export type Message = RunDetail['messages'][number]

/** An agent's initial in its colour. */
export function AgentAvatar({ name, color, className }: { name: string; color: AgentColor; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase ring-1 ring-inset',
        color.soft,
        color.text,
        color.ring,
        className,
      )}
    >
      {name === 'root' ? <Bot className="size-3.5" /> : name.slice(0, 1)}
    </span>
  )
}

/** ok/failed with the duration, or a spinner while running. */
export function StepState({ result }: { result: StepResult }) {
  const took = result.ended ? duration(result.ended - result.started) : null
  if (result.state === 'running')
    return (
      <span className="flex items-center gap-1.5 text-xs text-primary">
        <Spinner /> running
      </span>
    )
  const Icon = result.state === 'ok' ? Check : result.state === 'failed' ? X : Ban
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs tabular-nums',
        result.state === 'ok' ? 'text-success' : result.state === 'failed' ? 'text-destructive' : 'text-warning',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      {result.state === 'ok' ? '' : `${result.state} · `}
      <span className={cn(result.state === 'ok' && 'text-muted-foreground')}>{took}</span>
    </span>
  )
}

interface CardProps {
  result: StepResult
  view?: StepView
  color: AgentColor
  /** The agents the step talks to (send_message, subagent), coloured. */
  colorOf: (name: string) => AgentColor
}

function Who({ name, color, step, children }: { name: string; color: AgentColor; step?: number; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AgentAvatar name={name} color={color} />
      <span className={cn('text-[13px] font-semibold', color.text)}>{name}</span>
      {step !== undefined && <span className="text-[11px] text-faint tabular-nums">step {stepNo(step)}</span>}
      {children}
    </div>
  )
}

function Say({ text }: { text?: string }) {
  if (!text) return null
  return <p className="pl-8 text-sm leading-relaxed text-foreground/90">{text}</p>
}

/** A bash step: the command split into segments, its calls, checks and output. */
function BashCard({ result, view, color }: CardProps) {
  const failed = result.state === 'failed'
  return (
    <div className="flex flex-col gap-2">
      <Who name={result.agent} color={color} step={result.index} />
      <Say text={view?.say} />
      <div className={cn('ml-8 flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-xs', failed && 'border-destructive/40')}>
        <div className="flex min-w-0 items-center gap-2">
          <SquareTerminal aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={view?.description}>
            {view?.description ?? 'bash'}
          </span>
          {view && <KindChip kind={view.kind} />}
          <StepState result={result} />
        </div>
        {view?.note && <p className="text-xs text-muted-foreground italic">{view.note}</p>}
        {view ? (
          <SegmentList segments={view.segments} />
        ) : (
          <p className="text-xs text-faint">The script for this step is not loaded.</p>
        )}
        <CallStrip calls={result.calls} />
        <CheckChips view={view} result={result} />
        <OutputBlock result={result} />
      </div>
    </div>
  )
}

const target = (view?: StepView) => view?.segments.find((s) => s.detail)?.detail

/** A subagent call: a small "spawned Ava" card with the prompt. */
function SpawnCard({ result, view, color, colorOf }: CardProps) {
  const child = target(view) ?? 'a subagent'
  const childColor = colorOf(child)
  const [open, setOpen] = useState(false)
  const prompt = view?.text ?? ''
  const long = prompt.length > 220
  return (
    <div className="flex flex-col gap-2">
      <Who name={result.agent} color={color} step={result.index} />
      <Say text={view?.say} />
      <div className="ml-8 flex flex-col gap-2 rounded-xl border border-dashed bg-card/60 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[13px]">
          <CornerDownRight aria-hidden="true" className="size-4 text-faint" />
          <span className="text-muted-foreground">spawned</span>
          <AgentAvatar name={child} color={childColor} className="size-5 text-[10px]" />
          <span className={cn('font-semibold', childColor.text)}>{child}</span>
          <span className="ml-auto">
            <StepState result={result} />
          </span>
        </div>
        {prompt && (
          <div className="pl-6 text-[13px] leading-relaxed text-muted-foreground">
            <p className={cn('whitespace-pre-wrap', !open && long && 'line-clamp-3')}>{prompt}</p>
            {long && (
              <button type="button" onClick={() => setOpen((o) => !o)} className="mt-0.5 text-[11px] font-medium text-primary hover:underline">
                {open ? 'Show less' : 'Show the whole prompt'}
              </button>
            )}
          </div>
        )}
        <OutputBlock result={result} defaultOpen={false} />
      </div>
    </div>
  )
}

/** A message bubble between agents. */
export function MessageBubble({
  from,
  to,
  text,
  colorOf,
  reply,
  trailing,
}: {
  from: string
  to: string | null
  text: string
  colorOf: (name: string) => AgentColor
  reply?: boolean
  trailing?: React.ReactNode
}) {
  const fromColor = colorOf(from)
  const Icon = reply ? MessageSquareReply : MoveRight
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <AgentAvatar name={from} color={fromColor} />
        <span className={cn('font-semibold', fromColor.text)}>{from}</span>
        {to ? (
          <>
            <Icon aria-hidden="true" className="size-3.5 text-faint" />
            <span className={cn('font-medium', colorOf(to).text)}>{to}</span>
          </>
        ) : (
          !reply && <span className="text-faint">to everyone</span>
        )}
        {reply && <span className="rounded bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground">reply</span>}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
      <div className={cn('ml-8 w-fit max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ring-1 ring-inset', fromColor.soft, fromColor.ring)}>
        {text}
      </div>
    </div>
  )
}

/** Any other tool (interrupt_agent, list_agents, job_*, working_directory). */
function ToolCard({ result, view, color }: CardProps) {
  return (
    <div className="flex flex-col gap-2">
      <Who name={result.agent} color={color} step={result.index} />
      <Say text={view?.say} />
      <div className="ml-8 flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Wrench aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-xs font-medium">{view?.tool ?? 'tool'}</span>
          {view?.description && <span className="truncate text-[13px] text-muted-foreground">{view.description}</span>}
          <span className="ml-auto flex items-center gap-2">
            {view && <KindChip kind={view.kind} />}
            <StepState result={result} />
          </span>
        </div>
        {view && view.segments.length > 0 && <SegmentList segments={view.segments} />}
        <CallStrip calls={result.calls} />
        <OutputBlock result={result} defaultOpen={result.state === 'failed'} />
      </div>
    </div>
  )
}

/** One transcript card for one step, by its tool. */
export const StepCard = memo(function StepCard(props: CardProps & { parent?: string | null }) {
  const { result, view, colorOf, parent } = props
  switch (view?.tool) {
    case 'subagent':
      return <SpawnCard {...props} />
    case 'send_message':
      return (
        <div className="flex flex-col gap-2">
          <Say text={view.say} />
          <MessageBubble from={result.agent} to={target(view) ?? null} text={view.text} colorOf={colorOf} trailing={<StepState result={result} />} />
        </div>
      )
    case 'reply':
      return (
        <div className="flex flex-col gap-2">
          <MessageBubble
            from={result.agent}
            to={parent ?? null}
            text={view.text || view.say || ''}
            colorOf={colorOf}
            reply
            trailing={
              view.until?.length ? (
                <span className="text-[11px] text-faint">waited for {view.until.join(', ')}</span>
              ) : (
                <StepState result={result} />
              )
            }
          />
        </div>
      )
    case 'bash':
    case undefined:
      return <BashCard {...props} />
    default:
      return <ToolCard {...props} />
  }
})

import { useI18n, localeTag } from '@/i18n'
import { useId } from 'react'
import { Popover } from 'radix-ui'
import type { AgentContextUsage, AgentExecution, AgentUsage } from '@shared/agent-api'

import { cn } from '@/lib/utils'

const radius = 7
const circumference = 2 * Math.PI * radius

export function ContextMeter({ usage, recorded, execution }: { usage: AgentContextUsage | null | undefined; recorded?: AgentUsage; execution?: AgentExecution }) {
  const { t } = useI18n()
  const titleId = useId()
  const percent = usage?.tokens != null ? usage.percent : null
  const known = percent != null
  const label = known ? percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%` : '—'
  const remaining = usage?.tokens != null ? Math.max(0, usage.contextWindow - usage.tokens) : null
  const color = !known ? 'text-muted-foreground' : percent >= 90 ? 'text-destructive' : percent >= 70 ? 'text-warning' : 'text-success'

  return <Popover.Root>
    <Popover.Trigger
      type="button"
      aria-label={known ? t("Context usage: {usage}", { usage: label }) : t("Context usage unknown")}
      title={t("Context usage")}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className={cn('size-3.5 -rotate-90', color)}>
        <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        {known && <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)} className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none" />}
      </svg>
      <span className="tabular-nums">{label}</span>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        aria-labelledby={titleId}
        align="end"
        side="top"
        sideOffset={8}
        className="chat-popover glass-strong z-50 max-h-[calc(100svh-3rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-3.5 font-sans text-popover-foreground shadow-xl outline-none"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-xs font-semibold">{t("Context usage")}</h3>
          <span className={cn('text-xs tabular-nums', color)}>{known ? label : t("Unknown")}</span>
        </div>
        <dl className="space-y-1.5 text-[11px]">
          <UsageRow label={t("Used")} value={usage?.tokens} />
          <UsageRow label={t("Context window")} value={usage?.contextWindow} />
          <UsageRow label={t("Remaining")} value={remaining} />
        </dl>
        <p className="mt-3 border-t border-foreground/[0.07] pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          {known
            ? t("Estimated from the current conversation context. Updates as the agent records responses and tool results.")
            : usage
              ? t("Waiting for the next model response to measure the compacted context.")
              : t("Context usage is unavailable until this session is active and its model has a known context window.")}
        </p>
        {execution && <div className="mt-3 border-t border-foreground/[0.07] pt-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">{t("Run · {phase}", { phase: t(execution.phase) })}</p>
          <p className="mt-1 tabular-nums">{t("{turns} turns · {tools} tools · {retries} retries", { turns: execution.turns, tools: execution.toolCalls, retries: execution.retryAttempt })}</p>
          {execution.startedAt && <p className="mt-1 tabular-nums">{t("Started {time}", { time: new Date(execution.startedAt).toLocaleTimeString(localeTag()) })}</p>}
          {execution.reason && <p className="mt-1 leading-relaxed">{t(execution.reason)}</p>}
        </div>}
        {recorded && <div className="mt-3 border-t border-foreground/[0.07] pt-3">
          <h4 className="mb-2 text-[11px] font-medium">{t("Recorded usage")}</h4>
          <dl className="space-y-1.5 text-[11px]"><UsageRow label={t("Input")} value={recorded.input} /><UsageRow label={t("Output")} value={recorded.output} /><UsageRow label={t("Cache read")} value={recorded.cacheRead} /><UsageRow label={t("Cache write")} value={recorded.cacheWrite} /><div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Recorded cost")}</dt><dd className="tabular-nums">${recorded.cost.toFixed(4)}</dd></div></dl>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{t("Saved agent history totals include copied and branched history. Subagent charges may not be included.")}</p>
        </div>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

function UsageRow({ label, value }: { label: string; value: number | null | undefined }) {
  const { t } = useI18n()
  return <div className="flex items-center justify-between gap-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-foreground tabular-nums">{value == null ? t("Unknown") : t("{count} tokens", { count: Math.round(value).toLocaleString(localeTag()) })}</dd>
  </div>
}

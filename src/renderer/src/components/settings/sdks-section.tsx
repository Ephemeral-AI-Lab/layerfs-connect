import { useCallback, useEffect, useState } from 'react'
import type { AgentKind, AgentSdkCall, AgentSdkInfo, AgentSdks } from '@shared/agent-api'

import { CapabilityRow, Facts } from '@/components/settings/capability-parts'
import { agentHost } from '@/host/agent-client'
import { useI18n } from '@/i18n'

const AGENTS: Record<AgentKind, string> = { main: 'Main agent', worker: 'Worker', lead: 'Lead' }

/**
 * Settings → SDKs: the SDKs in sdks.json, what the host found of each on
 * disk, and the calls each offers. Each SDK that is on adds its entry to the
 * prompt of the agents it lists. The file is the source; the switch here is
 * the only thing this page writes to it, and it waits while a chat works.
 */
export function SdksSection() {
  const { t } = useI18n()
  const [data, setData] = useState<AgentSdks>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [changeError, setChangeError] = useState('')
  const [saved, setSaved] = useState(false)
  const load = useCallback(async () => {
    setError('')
    try { setData(await agentHost.sdks()) }
    catch (cause) { setError((cause as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  const busy = data?.busy ?? []

  async function change(sdk: AgentSdkInfo, enabled: boolean) {
    setPending(sdk.id)
    setChangeError('')
    setSaved(false)
    try {
      setData(await agentHost.setSdk(sdk.id, enabled))
      setSaved(true)
    } catch (cause) {
      setChangeError((cause as Error).message)
      void load()
    } finally {
      setPending(null)
    }
  }

  return <div className="st-section" data-testid="sdks-section">
    <p className="st-intro">{t('Libraries the agents can work with. Each one that is on goes into the instructions of the agents it lists, with its calls. They are kept in sdks.json; edit it to add an SDK or change one.')}</p>
    {error ? <>
      <p className="st-error" role="alert">{t('Could not load the SDKs')}: {error}</p>
      <div><button type="button" className="st-btn st-sm" onClick={() => void load()}>{t('Retry')}</button></div>
    </> : !data ? <p className="st-hint" role="status">{t('Loading…')}</p> : <>
      {data.error && <p className="st-error" role="alert">{data.error}</p>}
      {busy.length > 0 && <p className="st-notice" role="status">
        {busy.length === 1
          ? t('“{chat}” is working. Switches wait until it finishes or you stop it.', { chat: busy[0] })
          : t('{count} chats are working. Switches wait until they finish or you stop them.', { count: busy.length })}
      </p>}
      {changeError && <p className="st-error" role="alert">{changeError}</p>}
      {saved && !changeError && <p className="st-saved" role="status" aria-live="polite">{t('Saved. Each chat uses the new setup from its next message.')}</p>}
      {!data.error && !data.sdks.length && <p className="st-empty-line">{t('No SDKs in sdks.json.')}</p>}
      <ul className="st-rows">
        {data.sdks.map((sdk) => <CapabilityRow
          key={sdk.id}
          id={sdk.id}
          name={sdk.title}
          tags={<>
            {sdk.version && <span className="st-tag st-mono">{sdk.version}</span>}
            <span className={sdk.found ? 'st-tag st-tag-found' : 'st-tag st-tag-missing'}>{t(sdk.found ? 'Found' : 'Missing')}</span>
          </>}
          description={t(sdk.description)}
          enabled={sdk.enabled}
          disabled={!!pending || busy.length > 0}
          busy={pending === sdk.id}
          onChange={(enabled) => void change(sdk, enabled)}
        >
          <Facts label="Packages" items={sdk.packages.map((pkg) => pkg.name)} empty="None" />
          {sdk.command && <Facts label="Command" items={[sdk.command]} />}
          <Facts label="Docs" items={sdk.docs.map((doc) => doc.path)} />
          <Facts label="Missing" items={[...sdk.packages.filter((pkg) => !pkg.found).map((pkg) => pkg.name), ...sdk.docs.filter((doc) => !doc.found).map((doc) => doc.path)]} />
          <Facts label="Agents" items={sdk.agents.map((agent) => t(AGENTS[agent]))} plain />
          <Facts label="Source" items={[sdk.rootPath ?? sdk.root]} empty="Not set" plain />
          <SdkCalls calls={sdk.calls} />
        </CapabilityRow>)}
      </ul>
      {!data.custom && !data.error && <p className="st-hint">{t('This is Connect’s built-in list. Open sdks.json to keep your own copy.')}</p>}
    </>}
  </div>
}

/** An SDK's calls, one fold per group (`branch` for `branch.fork`), each call's signature and what it does. */
function SdkCalls({ calls }: { calls: AgentSdkCall[] }) {
  const { t } = useI18n()
  if (!calls.length) return null
  const groups = new Map<string, AgentSdkCall[]>()
  for (const call of calls) {
    const dot = call.name.lastIndexOf('.')
    const group = dot > 0 ? call.name.slice(0, dot) : call.name
    groups.set(group, [...(groups.get(group) ?? []), call])
  }
  return <div className="st-facts">
    <span className="st-facts-label">{t('Calls')} <span className="st-group-count">{calls.length}</span></span>
    <div className="st-calls">
      {[...groups].map(([group, list]) => <details key={group} className="st-call-group" data-group={group}>
        <summary className="st-summary"><span className="st-mono">{group}</span><span className="st-group-count">{list.length}</span></summary>
        <ul className="st-call-list">
          {list.map((call) => <li key={call.name} className="st-call" data-call={call.name}>
            <code className="st-call-sig">{call.signature}</code>
            {call.description && <span className="st-call-desc">{t(call.description)}</span>}
          </li>)}
        </ul>
      </details>)}
    </div>
  </div>
}

/** Opens sdks.json in the system's text editor. */
export function OpenSdkConfigAction() {
  const { t } = useI18n()
  const [error, setError] = useState('')
  return <>
    {error && <span className="st-error" title={error} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('Could not open sdks.json')}</span>}
    <button type="button" className="st-btn st-sm" onClick={() => {
      setError('')
      agentHost.openSdkConfig().catch((cause: Error) => setError(cause.message))
    }}>{t('Open sdks.json')}</button>
  </>
}

// The sync state of a SQLite Store's link (docs/ui/storage-links.md §4,
// layerfs#509): pure functions, no I/O. A Store links to at most one remote
// file; its state compares three facts:
//   base (B)    the link's last push or pull, recorded in this home
//   local (L)   the Store's history heads digest now (store.list, E2)
//   remote (R)  the last HEAD of the linked file (store.check, E3)
// No file is hashed here: local is a digest LayerFS reads, remote is the
// sha256 the pusher stored as metadata. A missing fact is `unknown`, with a
// reason a person can read, never a guess.

/** Link states (§4), most urgent first; then the Store-only states. */
export const SEVERITY = ['diverged', 'behind', 'missing', 'ahead', 'unreachable', 'unknown', 'checking', 'transferring', 'in_sync', 'local_only']

/**
 * The local side: `same` when the Store's heads now equal the base's,
 * `changed` when both are known and differ, else `unknown` with why.
 * @param {object} o
 * @param {string} o.store the Store's name
 * @param {string | null} o.heads L: the Store's heads digest now
 * @param {object | null} o.base B (TransferInfo)
 * @param {boolean} o.supported the LayerFS build reports heads (E2)
 */
export function localSide({ store, heads, base, supported }) {
  if (!supported) return { side: 'unknown', reason: `This LayerFS build can't tell whether ${store} changed` }
  if (!heads) return { side: 'unknown', reason: `${store}'s history could not be read now` }
  if (!base) return { side: 'unknown', reason: `${store} has no recorded push or pull through its link yet` }
  if (!base.heads) return { side: 'unknown', reason: `The last transfer of ${store} was recorded without its history, so Connect can't tell whether it changed` }
  return heads === base.heads ? { side: 'same', reason: null } : { side: 'changed', reason: null }
}

/**
 * The remote side, from the last successful check and the latest check
 * when it failed. `where` names the linked file (connection / file).
 */
export function remoteSide({ where, check, failedCheck, base, supported, hasKeys }) {
  if (!supported) return { side: 'unknown', reason: `This LayerFS build can't check ${where}` }
  if (!hasKeys) return { side: 'unknown', reason: `Connect has no keys for ${where.split(' / ')[0]}` }
  if (failedCheck) return { side: 'unreachable', reason: `${where} didn't answer: ${failedCheck.error?.message ?? 'the check failed'}` }
  if (!check) return { side: 'unknown', reason: `${where} not checked yet` }
  if (!check.present) return { side: 'missing', reason: null }
  if (!base?.sha256) return { side: 'unknown', reason: `The last transfer with ${where} was recorded without its sha256` }
  return check.sha256 && check.sha256 === base.sha256 ? { side: 'same', reason: null } : { side: 'changed', reason: null }
}

/**
 * The link's state (§4), in the spec's order. Answers { sync, reason }.
 * @param {object} o
 * @param {string} o.store
 * @param {string} o.where connection / file
 * @param {{ side: string, reason: string | null }} o.local localSide's answer
 * @param {{ side: string, reason: string | null }} o.remoteSide remoteSide's answer
 * @param {string | null} o.localHeads L
 * @param {string | null} o.remoteHeads R.heads (from the last successful check, when it is the latest)
 * @param {boolean} o.transferring a job runs on the Store
 * @param {string | null} [o.jobKind] the running job's kind
 * @param {boolean} o.checking a check is in flight, or due and never run
 * @param {boolean} o.checked an earlier check exists (successful or failed)
 */
export function syncState({ store, where, local, remoteSide: rs, localHeads, remoteHeads, transferring, jobKind = null, checking, checked }) {
  const l = local.side
  const r = rs.side
  if (transferring) return { sync: 'transferring', reason: `${jobKind === 'pull' ? 'A pull from' : 'A push to'} ${where} is running` }
  if (r === 'missing') return { sync: 'missing', reason: `${where} is gone: the linked file was deleted` }
  if (remoteHeads && localHeads && remoteHeads === localHeads) return { sync: 'in_sync', reason: `${store} and ${where} have the same history` }
  if (checking && !checked) return { sync: 'checking', reason: `Checking ${where}…` }
  if (l === 'same' && r === 'same') return { sync: 'in_sync', reason: 'Neither side changed since the last push or pull' }
  if (l === 'changed' && r === 'same') return { sync: 'ahead', reason: `${store} changed since the last push or pull; ${where} didn't` }
  if (l === 'same' && r === 'changed') return { sync: 'behind', reason: `${where} changed since the last push or pull; ${store} didn't` }
  if (l === 'changed' && r === 'changed') return { sync: 'diverged', reason: `Both ${store} and ${where} changed since the last push or pull` }
  if (r === 'unreachable') return { sync: 'unreachable', reason: rs.reason }
  return { sync: 'unknown', reason: [l === 'unknown' ? local.reason : null, r === 'unknown' ? rs.reason : null].filter(Boolean).join('. ') || 'Sync unknown' }
}

/**
 * A linked Store's whole StoreLink (§5) from what the host has.
 * @param {object} o
 * @param {string} o.store the Store's name
 * @param {string | null} o.heads the Store's heads digest now (E2), null when unknown
 * @param {boolean} o.headsSupported E2 present
 * @param {object} o.link the runtime's link { remote, file, linked, last } with `last` a TransferInfo (plus direction)
 * @param {string | null} o.provider the connection's provider, null when the connection is unknown
 * @param {string} o.object the object path, for display
 * @param {{ check: object | null, failedCheck: object | null, inFlight: boolean }} o.checks the host's check cache for this link
 * @param {boolean} o.checkSupported E3 present
 * @param {boolean} o.hasKeys Connect has keys for the connection
 * @param {{ kind: string } | null} o.job the running job on the Store, if any
 */
export function linkInfo({ store, heads, headsSupported, link, provider, object, checks, checkSupported, hasKeys, job }) {
  const base = link.last ?? null
  const where = `${link.remote} / ${link.file}`
  const check = checks?.check ?? null
  const failedCheck = checks?.failedCheck ?? null
  const local = localSide({ store, heads, base, supported: headsSupported })
  const facts = { store, where, local, localHeads: headsSupported ? heads : null, checked: !!(check || failedCheck) }
  const rs = remoteSide({ where, check, failedCheck, base, supported: checkSupported, hasKeys })
  const checking = !!checks?.inFlight || (checkSupported && hasKeys && !facts.checked)
  const now = syncState({ ...facts, remoteSide: rs, remoteHeads: failedCheck ? null : (check?.heads ?? null), transferring: !!job, jobKind: job?.kind ?? null, checking })
  // the latest check failed; the state the last successful one gave stays readable
  let lastKnown = null
  if (failedCheck && check) {
    const before = remoteSide({ where, check, failedCheck: null, base, supported: checkSupported, hasKeys })
    lastKnown = syncState({ ...facts, remoteSide: before, remoteHeads: check.heads ?? null, transferring: false, checking: false }).sync
  }
  return {
    remote: link.remote,
    provider: provider ?? null,
    file: link.file,
    object,
    linked: link.linked ?? null,
    last: base,
    check,
    failedCheck,
    local: local.side,
    remoteSide: rs.side === 'unreachable' ? 'unknown' : rs.side,
    sync: now.sync,
    lastKnown,
    reason: now.reason,
  }
}

/** A Store's state (§4): its link's; `transferring` while a job runs on it; `local_only` with no link; `live` for PostgreSQL. */
export function storeSync({ kind, link, running }) {
  if (kind === 'postgresql') return { state: 'live' }
  if (running) return { state: 'transferring' }
  if (!link) return { state: 'local_only' }
  return { state: link.sync }
}

// ---------- transfer rate and ETA (§5.2) ----------

/** The weight of the newest sample in the rate's moving mean. */
export const RATE_ALPHA = 0.3
/** A phase's rate is withheld this long after it starts. */
export const RATE_SETTLE_MS = 2_000
/** Below this rate (bytes per second) no ETA is given. */
export const ETA_MIN_RATE = 1_000

/**
 * The next rate state from one job sample. `state` is the previous answer's
 * `state` (or null); `sample` is { phase, bytes, total, running }. Answers
 * { state, rate, eta }: rate in bytes per second, eta in seconds, both null
 * in a phase without bytes, for its first 2 s, and once the job ends.
 */
export function nextRate(state, sample, now) {
  const phase = sample.phase ?? ''
  const bytes = typeof sample.bytes === 'number' ? sample.bytes : null
  const samePhase = !!state && state.phase === phase
  let s = samePhase ? { ...state } : { phase, start: now, bytes, at: now, mean: null }
  if (samePhase && bytes !== null) {
    if (s.bytes === null) Object.assign(s, { bytes, at: now })
    else if (now > s.at && bytes >= s.bytes) {
      const instant = (bytes - s.bytes) / ((now - s.at) / 1000)
      s.mean = s.mean === null ? instant : RATE_ALPHA * instant + (1 - RATE_ALPHA) * s.mean
      Object.assign(s, { bytes, at: now })
    } else if (bytes < s.bytes) {
      // bytes went back within one phase: start the phase's mean again
      s = { phase, start: now, bytes, at: now, mean: null }
    }
  }
  if (!sample.running || bytes === null || s.mean === null || now - s.start < RATE_SETTLE_MS) return { state: s, rate: null, eta: null }
  const rate = Math.round(s.mean)
  const total = typeof sample.total === 'number' ? sample.total : null
  const eta = total !== null && rate >= ETA_MIN_RATE ? Math.max(0, Math.ceil((total - bytes) / rate)) : null
  return { state: s, rate, eta }
}

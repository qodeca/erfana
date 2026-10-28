// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One view's ledger of what has been reported blocked, and at whose expense, and
 * the sink that feeds it (issue #124, WI-2).
 *
 * Moved out of `PreviewViewService` with no change in behaviour. Every refusal
 * goes to the failure log; only a refusal that changes the ledger reaches the
 * renderer's host list, as a `hostBlocked` event.
 *
 * The ledger keeps what each blocked ORIGIN has been refused FOR, because one
 * origin is commonly refused for several things, and reporting only the first
 * would label an origin that will run scripts as "font".
 *
 * TWO MAPS, ONE OBJECT, deliberately: the entries and each hostname's spend
 * must start over together, or a hostname that had spent its sub-budget before
 * a reload could report nothing after it. They do, because a new page gets a
 * new ledger from its page scope (`previewPageScope.ts`, issue #124, WI-29).
 */
import { ErrorCode } from '../../../shared/errors'
import { PREVIEW } from '../../../shared/constants'
import type {
  PreviewEmitters,
  PreviewFailureInput,
  PreviewFailureType
} from '../../../shared/ipc/preview-types'
import { mergeBlockedKinds, type PreviewBlockedKind } from '../../../shared/ipc/previewBlockedKind'

/** What to tell the renderer about a refusal that changed the ledger. */
export interface PreviewBlockedReport {
  /** Every kind the identity has been refused for so far, in a stable order. */
  readonly kinds: readonly PreviewBlockedKind[]
  /** `true` once the ledger holds as many entries as one view may list. */
  readonly truncated: boolean
}

/** One view's blocked-host ledger. */
export interface IPreviewBlockedLedger {
  /**
   * Record one refusal of `originOrHost` as `kind`.
   *
   * @returns What to tell the renderer, or `null` when there is nothing new to
   * say: the kinds are unchanged, the per-view cap is reached, or the hostname
   * has spent its share.
   */
  record(originOrHost: string, kind: PreviewBlockedKind): PreviewBlockedReport | null
}

/** Where one view's refusals are recorded and reported. */
export interface PreviewBlockedSinkDeps {
  readonly panelId: string
  readonly ledger: IPreviewBlockedLedger
  /** The view's failure log; every refusal is recorded there, repeats included. */
  readonly recordFailure: (input: PreviewFailureInput) => void
  readonly emit: Pick<PreviewEmitters, 'hostBlocked'>
}

/**
 * The sink the session factory and the CSP bridge report refusals to.
 *
 * `originOrHost` is an ORIGIN from both feeds now — `previewFilterDecision`
 * returns one as its blocked identity and the CSP bridge reports the same shape
 * — except on the `insecure-scheme` and timeout paths, which still carry a bare
 * hostname. Named for what it can be rather than for the common case.
 */
export type PreviewBlockedSink = (
  kind: PreviewFailureType,
  originOrHost: string,
  url: string,
  approvable: boolean,
  resourceKind?: PreviewBlockedKind
) => void

/**
 * The hostname inside a reported blocked identity.
 *
 * The identity is normally an origin (`https://cdn.example.com:8443`), but not
 * always: `previewFilterDecision` still reports a bare hostname for an
 * `insecure-scheme` refusal, the filter's timeout sweep reports whatever
 * `hostOf` salvaged from the URL, and either can be the empty string. So this
 * has to accept both shapes rather than assume the origin form.
 *
 * `new URL` rather than string surgery on the last colon: an IPv6 authority is
 * `https://[::1]:8443`, and `lastIndexOf(':')` on that returns a host of
 * `[::1]` on a good day and `[:` on a bad one. Anything that does not parse is
 * already a bare hostname and is used as-is.
 */
function hostOfBlockedIdentity(identity: string): string {
  try {
    const { hostname } = new URL(identity)
    return hostname === '' ? identity : hostname
  } catch {
    return identity
  }
}

/** Build an empty ledger for one view. */
export function createPreviewBlockedLedger(): IPreviewBlockedLedger {
  /** Blocked ORIGIN -> the kinds it has been refused for. */
  const kindsByOrigin = new Map<string, PreviewBlockedKind[]>()
  /** Hostname -> how many of its origins are already in `kindsByOrigin`. */
  const originsPerHost = new Map<string, number>()

  /** Whether a NEW entry fits; spends its hostname's share when it does. */
  function admitNewEntry(originOrHost: string): boolean {
    // THE BOUND. Distinct entries per view, capped. The three-toast budget
    // that used to sit here bounded TOASTS, not this list, so once the emit
    // became unconditional there was no bound at all. An entry past the cap
    // is not listed and therefore not approvable — which is the same one-way
    // door the old cap had, except this one is stated, matches the CSP
    // path's own MAX_ORIGINS_PER_VIEW, and the renderer is told the list is
    // truncated instead of silently showing a short one.
    if (kindsByOrigin.size >= PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW) {
      return false
    }

    // THE SUB-BOUND, and the reason the bound above is still worth having.
    // The entry is an ORIGIN now, so `http://localhost:1` … `:50` are fifty
    // of them and would fill the per-view budget before the page's real
    // blocked CDN is ever seen — dropped, never emitted, never approvable.
    // Capping what one hostname may spend keeps room for the hosts a reader
    // can actually act on. It has to be here, where the entry is RECORDED:
    // trimming rows in the renderer is far too late for an event that was
    // never sent.
    const hostname = hostOfBlockedIdentity(originOrHost)
    const spentForHost = originsPerHost.get(hostname) ?? 0
    if (spentForHost >= PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST) {
      return false
    }
    originsPerHost.set(hostname, spentForHost + 1)
    return true
  }

  return {
    record(originOrHost: string, kind: PreviewBlockedKind): PreviewBlockedReport | null {
      // `mergeBlockedKinds` returns null only when the set is UNCHANGED, and
      // adding a kind to an empty set always changes it — so there is no
      // "first sighting" branch to write here. One used to exist and was
      // unreachable.
      const merged = mergeBlockedKinds(kindsByOrigin.get(originOrHost) ?? [], kind)

      // NOTHING NEW TO SAY. The sink has already recorded the event in the
      // failure log, so this is only about the renderer's host list, and that
      // list has not changed. Without this return a page pulling forty assets
      // from one host sent forty identical messages — `PreviewRequestFilter`
      // calls back per blocked REQUEST and de-duplicates nothing — which is the
      // flood the design's coalescing rule exists to prevent. `failuresChanged`
      // obeyed that rule; this channel never did.
      if (merged === null) return null

      if (!kindsByOrigin.has(originOrHost) && !admitNewEntry(originOrHost)) {
        return null
      }

      kindsByOrigin.set(originOrHost, merged)
      return {
        kinds: merged,
        truncated: kindsByOrigin.size >= PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW
      }
    }
  }
}

/** Build the refusal sink for one view. */
export function createPreviewBlockedSink(deps: PreviewBlockedSinkDeps): PreviewBlockedSink {
  const { panelId, ledger, recordFailure, emit } = deps
  return (kind, originOrHost, _url, approvable, resourceKind = 'other') => {
    recordFailure({
      type: kind,
      resourceUrlOrHost: originOrHost,
      reasonCode: ErrorCode.UNKNOWN_ERROR
    })
    const report = ledger.record(originOrHost, resourceKind)
    if (report === null) return
    emit.hostBlocked(panelId, originOrHost, approvable, report.kinds, report.truncated)
  }
}

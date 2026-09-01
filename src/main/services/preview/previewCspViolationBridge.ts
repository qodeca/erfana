// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page→main CSP-violation channel for one live preview (issue #74 follow-up).
 *
 * THE GAP THIS CLOSES. Erfana gates a preview's remote subresources twice, by
 * design: the CSP built from the project allowlist, and an independent
 * `onBeforeRequest` filter. Only the second one raises the "Approve this host?"
 * prompt (`PreviewRequestFilter.ts` → `PreviewViewService`'s `onBlocked`).
 *
 * But Chromium enforces a CSP in the RENDERER, before the request reaches the
 * network stack, so for a host that is NOT on the allowlist the filter is never
 * consulted — the CSP already refused it. The prompt therefore could not appear
 * for exactly the hosts it exists to ask about, and since the prompt was the
 * only way to add a host, a project with an empty allowlist had no route to
 * approving anything at all. `.erfana/settings.json` had to be hand-edited.
 *
 * The repo had already recorded the ordering as an e2e testing detail
 * (`e2e/html-preview-corpus.e2e.ts`, "the CSP blocks the request at the renderer
 * BEFORE the network filter sees it") without noticing what it cost.
 *
 * WHAT THIS DOES NOT DO. It does not widen the CSP, and it does not let a
 * refused request through. Both gates stay exactly as they were; this only adds
 * the missing REPORT, so a refusal the reader could act on becomes visible.
 *
 * Verified empirically against Electron 39 before it was written: a sandboxed,
 * context-isolated preload does receive `securitypolicyviolation` for the page's
 * own refusals, with the full `blockedURI` and `isTrusted === true`, while
 * `onBeforeRequest` sees nothing for the same resources.
 *
 * Mirrors `previewLinkBridge.ts` — same trust posture, same reasons, and
 * likewise a separate module because `PreviewLiveView` is at the file-size cap.
 *
 * @see previewLinkBridge.ts - the other page→main channel
 * @see PreviewRequestFilter.ts - the network-layer half of the same signal
 */
import { z } from 'zod'

import { PREVIEW } from '../../../shared/constants'
import { parsePreviewOrigin } from '../../../shared/ipc/preview-settings-schema'
import {
  kindFromDirective,
  mergeBlockedKinds,
  type PreviewBlockedKind
} from '../../../shared/ipc/previewBlockedKind'

/** Channel name; must match the inlined constant in `src/preload/previewPage.ts`. */
export const PREVIEW_PAGE_CSP_VIOLATION_CHANNEL = 'preview-page:cspViolation'

/**
 * At most this many violations are PARSED per second, per view.
 *
 * Unlike a click, a violation is NOT a human action: a hostile page can emit
 * thousands by referencing thousands of hosts, and every one costs a URL parse.
 * This is the ceiling on that work, so a fan-out cannot occupy the main process.
 *
 * Deliberately far above anything a real page reaches. It is a floor under
 * pathology, not a shaping budget — that is `MAX_REPORTS_PER_SECOND`.
 */
const MAX_PARSES_PER_SECOND = 500

/**
 * At most this many DISTINCT reports are forwarded per second, per view.
 *
 * Charged only for a report that actually reaches the reader — a new host, or a
 * new kind for a known host. It used to be charged on ARRIVAL instead, which
 * meant repeats paid for themselves: one image host firing forty violations
 * spent the whole allowance on thirty-nine reports the dedupe was about to
 * discard, and a later refusal from a genuinely different host was turned away
 * at the door. That host was then never recorded, never offered for approval,
 * and never retried, because a reload replays the same ordering.
 */
const MAX_REPORTS_PER_SECOND = 30

/**
 * At most this many DISTINCT origins are ever reported by one view.
 *
 * Past this the page is not telling the reader anything they can act on; it is
 * filling the failure badge. The cap is per view and resets when the view is
 * rebuilt, so a legitimate page that genuinely grew past it recovers on reload.
 *
 * Kept equal to `PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW`, which bounds the other of
 * the two paths that feed the same list — a page must not be able to report more
 * through one path than the other.
 */
const MAX_ORIGINS_PER_VIEW = PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW

/**
 * At most this many DISTINCT origins of ONE hostname are ever reported.
 *
 * THE HOLE THIS PLUGS. The cap above used to be keyed on a hostname, which made
 * it self-limiting: a page referencing one host on fifty ports collapsed into a
 * single entry. Now that the unit of a grant — and therefore of a report — is an
 * ORIGIN, it does not. `http://localhost:1` … `http://localhost:50` is fifty
 * distinct entries and fills the whole per-view budget on its own, so the
 * genuinely blocked CDN that the page loads afterwards is not merely buried in a
 * long list: it is never recorded and never emitted, and the reader has no way
 * to approve the one host they needed. The renderer cannot repair that later —
 * by the time it sorts and trims rows, the event does not exist.
 *
 * Rationale for the number, and for applying it here rather than in the
 * renderer, lives on `PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST`.
 *
 * The check runs BEFORE the report budget is charged, so a per-host fan-out
 * costs nothing from the per-second allowance either — the same reasoning that
 * moved that charge off the arrival path.
 */
const MAX_ORIGINS_PER_HOST = PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST

/**
 * What the preload sends.
 *
 * Strict and bounded. This arrives from the preview's renderer, which runs
 * attacker-supplied JavaScript: a compromise there could send any shape at all,
 * so nothing is read before it parses. An over-long URI is REFUSED rather than
 * truncated — a truncated URL can parse to a different host than the original.
 */
const CspViolationPayloadSchema = z
  .object({
    blockedURI: z.string().min(1).max(2048),
    effectiveDirective: z.string().max(64).default('')
  })
  .strict()

/** The bridge a live view holds. */
export interface PreviewCspViolationBridge {
  /** Handle a payload from the preview page's preload. */
  handleViolation(payload: unknown): void
  /**
   * Forget everything reported so far, because the page is about to be replaced.
   *
   * Called when an approval reloads the view. The dedupe below is scoped to a
   * PAGE LOAD, not to the view: a reload re-runs the document, so every host it
   * still cannot reach is refused again and is news to the reader all over
   * again. Without this the approve-one-host cascade silently ate the rest —
   * `applyApprovedHosts` clears the failure log, the reload re-refused the
   * remaining hosts, and this map swallowed every one of them, so they vanished
   * from the badge AND became unapprovable until the panel was reopened.
   *
   * The rate-limit window is reset with it: a burst spent on the previous
   * document must not silence the first reports of the new one.
   */
  reset(): void
  /** Stop reporting; called on teardown. */
  dispose(): void
}

/** What the bridge needs from its owner. */
export interface PreviewCspViolationBridgeDeps {
  /**
   * Report an ORIGIN the CSP refused.
   *
   * Deliberately the SAME sink the network filter uses, so a CSP refusal and a
   * filter refusal produce one failure type, one toast budget and one dedupe
   * rule rather than two half-consistent paths. That sink now carries an origin
   * from the filter side (`previewFilterDecision` returns one as its blocked
   * identity), so this side hands it the same vocabulary — two paths feeding one
   * list with two different notions of identity would show the reader `localhost`
   * beside `https://cdn.example.com` and dedupe neither against the other.
   *
   * The parameter keeps its name because the sink's signature is shared with the
   * filter path.
   */
  readonly onBlockedHost: (
    origin: string,
    url: string,
    approvable: boolean,
    kind: PreviewBlockedKind
  ) => void
  /** Injectable clock for the rate-limit window. */
  readonly now?: () => number
}

/**
 * The origin of a remote URI, plus its hostname, or `null` when there is nothing
 * to report.
 *
 * Only `http(s)` carries anything a reader could act on. Everything else — the
 * `inline` and `eval` keywords CSP reports instead of a URL, `data:`, `blob:`,
 * and the preview's own `erfana-preview:` scheme — is dropped here.
 *
 * RE-SERIALISED from the parsed parts, never `parsed.origin`, for the reason
 * `parsePreviewOrigin` spells out: `new URL('blob:https://evil.com/1').origin`
 * is the clean-looking `https://evil.com` while its hostname is empty, and
 * `.origin` silently discards userinfo. The blob branch above already returned,
 * but this is the second line of defence and reads the three fields itself.
 *
 * The HOSTNAME is returned alongside because the per-host sub-cap needs it and
 * splitting it back out of the origin string afterwards is a parse we already
 * did — and one that gets IPv6 wrong if it is done with `lastIndexOf(':')`.
 */
function remoteOriginOf(
  blockedURI: string
): { origin: string; hostname: string; approvable: boolean } | null {
  let parsed: URL
  try {
    parsed = new URL(blockedURI)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  // The WHATWG parser already lower-cases an ASCII hostname and punycodes a
  // Unicode one; the explicit lower-case is belt and braces so one host can
  // never occupy two entries. It does NOT strip IPv6 brackets —
  // `parsePreviewOrigin` is what refuses those for approval.
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === '') return null
  const origin = `${parsed.protocol}//${hostname}${parsed.port === '' ? '' : `:${parsed.port}`}`

  // APPROVABILITY IS THE ALLOWLIST'S OWN QUESTION, asked of the exact string a
  // grant would be written for. Asking a hostname predicate instead — as this
  // did — answers about a different value than the one that would be stored, and
  // an Approve button the boundary then refuses is worse than no button.
  //
  // Whatever `parsePreviewOrigin` accepts is offerable, and that set now
  // includes `http://`, IP literals, `localhost` and single-label names (#108).
  // This comment used to say the opposite — that `PREVIEW_ORIGIN_SCHEMES` is
  // https-only, so plain http "is recorded and never offered" — which is exactly
  // the wrong thing to leave sitting above the line that decides it: a reader
  // trusting it would take the tests asserting the opposite for the bug.
  return { origin, hostname, approvable: parsePreviewOrigin(origin) !== null }
}

/** A fixed one-second window that admits at most `limit` takes. */
function createRateWindow(
  limit: number,
  now: () => number
): { take(): boolean; reset(): void } {
  let startedAt = now()
  let used = 0
  return {
    take(): boolean {
      const timestamp = now()
      if (timestamp - startedAt >= 1000) {
        startedAt = timestamp
        used = 0
      }
      used += 1
      return used <= limit
    },
    reset(): void {
      startedAt = now()
      used = 0
    }
  }
}

/** Build the bridge for one live view. */
export function createPreviewCspViolationBridge(
  deps: PreviewCspViolationBridgeDeps
): PreviewCspViolationBridge {
  const now = deps.now ?? Date.now
  // Origin -> the kinds already reported for it. Not a bare Set of origins any
  // more: an origin refused first for a font and later for a script must report
  // the script too, or the row keeps saying "font" for something that will
  // execute.
  const reportedOrigins = new Map<string, PreviewBlockedKind[]>()
  // Hostname -> how many of its origins have been reported. The sub-cap's whole
  // ledger. Kept beside the map above rather than derived from it: deriving it
  // would mean re-parsing every recorded origin on every violation, which is
  // exactly the per-event cost a hostile fan-out is trying to buy.
  const originsPerHost = new Map<string, number>()
  let disposed = false

  const parseBudget = createRateWindow(MAX_PARSES_PER_SECOND, now)
  const reportBudget = createRateWindow(MAX_REPORTS_PER_SECOND, now)

  return {
    handleViolation(payload: unknown): void {
      if (disposed) return
      if (!parseBudget.take()) return

      const parsed = CspViolationPayloadSchema.safeParse(payload)
      if (!parsed.success) return

      const remote = remoteOriginOf(parsed.data.blockedURI)
      if (remote === null) return
      const { origin, hostname } = remote

      // One report per origin per KIND. The network-filter path records per
      // REQUEST, which is right there because each is a distinct attempt the
      // reader may care about; here a single stylesheet can fire twenty
      // violations for one font origin, and twenty identical badge rows would
      // bury the signal the badge exists to carry.
      //
      // But a NEW kind for a known origin is new information the reader is
      // entitled to, so it is not deduped away.
      const kind = kindFromDirective(parsed.data.effectiveDirective)
      const known = reportedOrigins.get(origin)

      // THE TWO CAPS, both charged only for a NEW origin. Order matters only in
      // that both must be asked before anything is written: the global one keeps
      // the list finite, the per-host one keeps a single noisy hostname from
      // being the reason the list is full.
      const spentForHost = originsPerHost.get(hostname) ?? 0
      if (known === undefined) {
        if (reportedOrigins.size >= MAX_ORIGINS_PER_VIEW) return
        if (spentForHost >= MAX_ORIGINS_PER_HOST) return
      }

      const merged = mergeBlockedKinds(known ?? [], kind)
      if (merged === null) return

      // Charged HERE, on a report that is actually going out, and BEFORE the
      // origin is written into the dedupe map. Recording it first would swallow
      // a rate-refused origin permanently; leaving it unrecorded means the next
      // violation for it can still arrive, which is the milder failure.
      if (!reportBudget.take()) return

      // Same reasoning for the sub-cap ledger: a rate-refused origin was never
      // shown to anyone, so it must not spend its hostname's budget either.
      if (known === undefined) {
        originsPerHost.set(hostname, spentForHost + 1)
      }
      reportedOrigins.set(origin, merged)

      // A non-approvable origin is still recorded as a failure and still never
      // offered for approval — the same split the filter path makes. Since #108
      // that set is much smaller than the examples this comment used to list:
      // http, IP literals, `localhost` and single-label names are all approvable
      // now. What remains is what the CSP grammar cannot express (IPv6) or what
      // is not a canonical origin at all.
      deps.onBlockedHost(origin, parsed.data.blockedURI, remote.approvable, kind)
    },

    reset(): void {
      reportedOrigins.clear()
      // Cleared WITH the dedupe map, never independently. A page load that is
      // news to the reader all over again must also be news to the sub-cap, or
      // one noisy hostname on the first load would keep its successor's origins
      // out of the list for the life of the view.
      originsPerHost.clear()
      parseBudget.reset()
      reportBudget.reset()
    },

    dispose(): void {
      disposed = true
      reportedOrigins.clear()
      originsPerHost.clear()
    }
  }
}

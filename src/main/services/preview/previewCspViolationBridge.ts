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

import { isApprovableHost } from '../../../shared/ipc/preview-settings-schema'
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
 * At most this many DISTINCT hosts are ever reported by one view.
 *
 * Past this the page is not telling the reader anything they can act on; it is
 * filling the failure badge. The cap is per view and resets when the view is
 * rebuilt, so a legitimate page that genuinely grew past it recovers on reload.
 */
const MAX_HOSTS_PER_VIEW = 50

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
   * Report a host the CSP refused.
   *
   * Deliberately the SAME sink the network filter uses, so a CSP refusal and a
   * filter refusal produce one failure type, one toast budget and one dedupe
   * rule rather than two half-consistent paths.
   */
  readonly onBlockedHost: (
    host: string,
    url: string,
    approvable: boolean,
    kind: PreviewBlockedKind
  ) => void
  /** Injectable clock for the rate-limit window. */
  readonly now?: () => number
}

/**
 * The host of a remote URI, or `null` when there is nothing to approve.
 *
 * Only `http(s)` carries an approvable host. Everything else — the `inline` and
 * `eval` keywords CSP reports instead of a URL, `data:`, `blob:`, and the
 * preview's own `erfana-preview:` scheme — is dropped here.
 */
function remoteHostOf(blockedURI: string): { host: string; secure: boolean } | null {
  let parsed: URL
  try {
    parsed = new URL(blockedURI)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  // `hostname`, not `host`: a port is not part of the allowlist's unit. Note it
  // does NOT strip IPv6 brackets — `isApprovableHost` is what refuses those.
  const hostname = parsed.hostname
  if (hostname === '') return null
  // An allowlist entry is only ever rendered as an `https://` CSP host-source,
  // so a host observed over plain http is not eligible for approval — which is
  // what the network-filter path already decides for the same URL.
  return { host: hostname.toLowerCase(), secure: parsed.protocol === 'https:' }
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
  // Host -> the kinds already reported for it. Not a bare Set of hosts any more:
  // a host refused first for a font and later for a script must report the
  // script too, or the row keeps saying "font" for something that will execute.
  const reportedHosts = new Map<string, PreviewBlockedKind[]>()
  let disposed = false

  const parseBudget = createRateWindow(MAX_PARSES_PER_SECOND, now)
  const reportBudget = createRateWindow(MAX_REPORTS_PER_SECOND, now)

  return {
    handleViolation(payload: unknown): void {
      if (disposed) return
      if (!parseBudget.take()) return

      const parsed = CspViolationPayloadSchema.safeParse(payload)
      if (!parsed.success) return

      const remote = remoteHostOf(parsed.data.blockedURI)
      if (remote === null) return
      const { host } = remote

      // One report per host per KIND. The network-filter path records per
      // REQUEST, which is right there because each is a distinct attempt the
      // reader may care about; here a single stylesheet can fire twenty
      // violations for one font host, and twenty identical badge rows would bury
      // the signal the badge exists to carry.
      //
      // But a NEW kind for a known host is new information the reader is
      // entitled to, so it is not deduped away.
      const kind = kindFromDirective(parsed.data.effectiveDirective)
      const known = reportedHosts.get(host)
      if (known === undefined && reportedHosts.size >= MAX_HOSTS_PER_VIEW) return
      const merged = mergeBlockedKinds(known ?? [], kind)
      if (merged === null) return

      // Charged HERE, on a report that is actually going out, and BEFORE the
      // host is written into the dedupe map. Recording it first would swallow a
      // rate-refused host permanently; leaving it unrecorded means the next
      // violation for it can still arrive, which is the milder failure.
      if (!reportBudget.take()) return
      reportedHosts.set(host, merged)

      // A non-approvable host (an IP literal, `localhost`, a bare single-label
      // name) is still recorded as a failure and still never offered for
      // approval — the same split the filter path makes.
      deps.onBlockedHost(
        host,
        parsed.data.blockedURI,
        remote.secure && isApprovableHost(host),
        kind
      )
    },

    reset(): void {
      reportedHosts.clear()
      parseBudget.reset()
      reportBudget.reset()
    },

    dispose(): void {
      disposed = true
      reportedHosts.clear()
    }
  }
}

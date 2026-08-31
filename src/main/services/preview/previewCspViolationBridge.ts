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

/** Channel name; must match the inlined constant in `src/preload/previewPage.ts`. */
export const PREVIEW_PAGE_CSP_VIOLATION_CHANNEL = 'preview-page:cspViolation'

/**
 * At most this many violation reports are read per second, per view.
 *
 * Unlike a click, a violation is NOT a human action: a hostile page can emit
 * thousands by referencing thousands of hosts, and every one costs a URL parse.
 * The budget is generous enough for a real page — a documentation site pulling a
 * font, a CDN and an analytics script trips three — and hard enough that a
 * fan-out cannot occupy the main process.
 */
const MAX_VIOLATIONS_PER_SECOND = 30

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
  readonly onBlockedHost: (host: string, url: string, approvable: boolean) => void
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
function remoteHostOf(blockedURI: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(blockedURI)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  // `hostname`, not `host`: a port is not part of the allowlist's unit, and
  // `hostname` also strips the IPv6 brackets `isApprovableHost` refuses anyway.
  const hostname = parsed.hostname
  return hostname === '' ? null : hostname.toLowerCase()
}

/** Build the bridge for one live view. */
export function createPreviewCspViolationBridge(
  deps: PreviewCspViolationBridgeDeps
): PreviewCspViolationBridge {
  const now = deps.now ?? Date.now
  const reportedHosts = new Set<string>()
  let windowStartedAt = now()
  let windowUsed = 0
  let disposed = false

  /** `false` when this report exceeds the per-second allowance. */
  const withinRateLimit = (): boolean => {
    const timestamp = now()
    if (timestamp - windowStartedAt >= 1000) {
      windowStartedAt = timestamp
      windowUsed = 0
    }
    windowUsed += 1
    return windowUsed <= MAX_VIOLATIONS_PER_SECOND
  }

  return {
    handleViolation(payload: unknown): void {
      if (disposed) return
      if (!withinRateLimit()) return

      const parsed = CspViolationPayloadSchema.safeParse(payload)
      if (!parsed.success) return

      const host = remoteHostOf(parsed.data.blockedURI)
      if (host === null) return

      // One report per host per view. The network-filter path records per
      // REQUEST, which is right there because each is a distinct attempt the
      // reader may care about; here a single stylesheet can fire twenty
      // violations for one font host, and twenty identical badge rows would bury
      // the signal the badge exists to carry.
      if (reportedHosts.has(host)) return
      if (reportedHosts.size >= MAX_HOSTS_PER_VIEW) return
      reportedHosts.add(host)

      // A non-approvable host (an IP literal, `localhost`, a bare single-label
      // name) is still recorded as a failure and still never offered for
      // approval — the same split the filter path makes.
      deps.onBlockedHost(host, parsed.data.blockedURI, isApprovableHost(host))
    },

    dispose(): void {
      disposed = true
      reportedHosts.clear()
    }
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page→main link channel for one live preview (sd-074b §5.1–5.3).
 *
 * Sits between the two entry points and {@link routeLinkActivation}, and owns
 * the three things neither of them should:
 *
 *  - **Validation.** The payload arrives from the preview's renderer process,
 *    which runs attacker-supplied JavaScript; a compromise there could send any
 *    shape at all. It is parsed strictly and bounded before anything reads it.
 *  - **Rate limiting.** A click is a human action, so more than a handful per
 *    second is not one. Belt-and-braces on top of the preload's `isTrusted`
 *    check.
 *  - **De-duplication.** The preload does not cancel the click, so the browser
 *    also attempts the navigation and `will-navigate` fires for the SAME click.
 *    Without this, one click would open two tabs.
 *
 * Extracted from `PreviewLiveView`, which is already at the file-size cap.
 */
import { z } from 'zod'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import {
  routeLinkActivation,
  type PreviewLinkContext,
  type PreviewLinkNavigationDeps
} from './previewLinkNavigation'

/** Channel name; must match the inlined constant in `src/preload/previewPage.ts`. */
export const PREVIEW_PAGE_LINK_CHANNEL = 'preview-page:linkActivated'

/** At most this many link activations are honoured per second, per view. */
const MAX_ACTIVATIONS_PER_SECOND = 10

/** A repeat of the same href inside this window is the same click. */
const DEDUPE_WINDOW_MS = 1000

/**
 * What the preload sends. Strict and bounded: an over-long href is refused
 * outright rather than truncated into something that might parse differently.
 */
const LinkActivationPayloadSchema = z
  .object({
    href: z.string().min(1).max(2048),
    target: z.string().max(64).default(''),
    download: z.boolean().default(false),
    modifiers: z
      .object({
        meta: z.boolean(),
        ctrl: z.boolean(),
        shift: z.boolean(),
        alt: z.boolean()
      })
      .optional()
  })
  .strict()

/** The bridge a live view holds. */
export interface PreviewLinkBridge {
  /** Handle a payload from the preview page's preload. */
  handleActivation(payload: unknown): void
  /**
   * Handle a same-tab navigation the page attempted.
   *
   * Kept wired even with the preload present, so a missing or broken preload
   * bundle degrades to "plain links still work" rather than to silence.
   */
  handleWillNavigate(url: string): void
  /** Stop routing; called on teardown. */
  dispose(): void
}

/** Build the bridge for one live view. */
export function createPreviewLinkBridge(
  context: PreviewLinkContext,
  deps: PreviewLinkNavigationDeps & { now?: () => number }
): PreviewLinkBridge {
  const now = deps.now ?? Date.now
  const recentHrefs = new Map<string, number>()
  let windowStartedAt = now()
  let inWindow = 0
  let disposed = false

  /** `false` when this activation exceeds the per-second allowance. */
  const withinRateLimit = (): boolean => {
    const timestamp = now()
    if (timestamp - windowStartedAt >= 1000) {
      windowStartedAt = timestamp
      inWindow = 0
    }
    inWindow += 1
    return inWindow <= MAX_ACTIVATIONS_PER_SECOND
  }

  /** `true` when this href was already routed for what is plainly the same click. */
  const isDuplicate = (href: string): boolean => {
    const timestamp = now()
    for (const [seen, at] of recentHrefs) {
      if (timestamp - at >= DEDUPE_WINDOW_MS) recentHrefs.delete(seen)
    }
    const previous = recentHrefs.get(href)
    recentHrefs.set(href, timestamp)
    return previous !== undefined && timestamp - previous < DEDUPE_WINDOW_MS
  }

  const route = (activation: { href: string; target?: string; download?: boolean }): void => {
    if (disposed) return
    if (!withinRateLimit()) return
    if (isDuplicate(activation.href)) return
    void routeLinkActivation(activation, context, deps)
  }

  return {
    handleActivation(payload: unknown): void {
      const parsed = LinkActivationPayloadSchema.safeParse(payload)
      if (!parsed.success) {
        // A malformed payload can only come from a compromised preview
        // renderer, so it is a finding, not a routing decision.
        deps.recordFailure(malformedPayloadFailure())
        return
      }
      route(parsed.data)
    },

    handleWillNavigate(url: string): void {
      route({ href: url })
    },

    dispose(): void {
      disposed = true
      recentHrefs.clear()
    }
  }
}

/** The failure entry recorded when the channel receives something unparseable. */
function malformedPayloadFailure(): PreviewFailureInput {
  return {
    type: 'blocked-link',
    resourceUrlOrHost: '(malformed link message)',
    reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
  }
}

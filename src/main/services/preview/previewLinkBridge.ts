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
  type LinkProvenance,
  type PreviewLinkContext,
  type PreviewLinkNavigationDeps
} from './previewLinkNavigation'

/** Channel name; must match the inlined constant in `src/preload/previewPage.ts`. */
export const PREVIEW_PAGE_LINK_CHANNEL = 'preview-page:linkActivated'

/**
 * At most this many link activations are honoured per second, per view, per
 * provenance. The two budgets are separate on purpose.
 *
 * `gesture` is generous because a human clicking fast is still a human.
 * `navigation` is deliberately tiny: a page can drive `will-navigate` from
 * `location.href` with no user involvement at all, so this is the ceiling on
 * what an untrusted page can make Erfana do by itself. It must never be able to
 * spend the human's allowance (lens review F1).
 */
const MAX_ACTIVATIONS_PER_SECOND: Record<LinkProvenance, number> = {
  gesture: 10,
  navigation: 2
}

/** A repeat of the same href inside this window is the same click. */
const DEDUPE_WINDOW_MS = 1000

/**
 * How long a `will-navigate` report waits for the preload's report of the same
 * click before it is routed on its own.
 *
 * One click reaches main twice: the preload's `ipcRenderer.send` and Chromium's
 * `will-navigate`, over two different pipes that nothing orders. Measured on
 * Windows the navigation half lands ~10 ms after the gesture half, but nothing
 * guarantees it, and when it won the race the bridge routed the click as
 * `navigation` — refused for an external link, with a badge — and then dropped
 * the genuine gesture as its duplicate. Holding the navigation half for a
 * moment lets the gesture claim the href first whichever order they arrive in;
 * a page that navigates itself (no preload, no click) is merely 50 ms slower.
 */
const NAVIGATION_GRACE_MS = 50

/**
 * What the preload sends. Strict and bounded: an over-long href is refused
 * outright rather than truncated into something that might parse differently.
 */
const LinkActivationPayloadSchema = z
  .object({
    href: z.string().min(1).max(2048),
    /**
     * The `href` ATTRIBUTE as the page wrote it, before Chromium resolved it.
     * Refusal-only input: it never selects a file, it only lets a link that
     * climbed out of the project be labelled "escaped" rather than "missing"
     * (Chromium collapses `../` past the root before main ever sees `href`).
     * Optional because `will-navigate` has no attribute to report.
     */
    // Refusal-only label data (never selects a file): an over-long value
    // costs the label, never the activation — `.catch` drops just this field.
    rawHref: z.string().max(2048).optional().catch(undefined),
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
  const windows: Record<LinkProvenance, { startedAt: number; used: number }> = {
    gesture: { startedAt: now(), used: 0 },
    navigation: { startedAt: now(), used: 0 }
  }
  let disposed = false
  const pendingNavigations = new Set<ReturnType<typeof setTimeout>>()

  /** `false` when this activation exceeds its provenance's per-second allowance. */
  const withinRateLimit = (provenance: LinkProvenance): boolean => {
    const timestamp = now()
    const window = windows[provenance]
    if (timestamp - window.startedAt >= 1000) {
      window.startedAt = timestamp
      window.used = 0
    }
    window.used += 1
    return window.used <= MAX_ACTIVATIONS_PER_SECOND[provenance]
  }

  /**
   * `true` when this href was already routed for what is plainly the same click.
   *
   * The stamp is recorded only for activations that are actually ROUTED. Writing
   * it on every attempt made the window slide, so holding a link down — or a
   * page re-navigating to it — suppressed it indefinitely rather than for one
   * second (lens review F25).
   */
  const isDuplicate = (href: string): boolean => {
    const timestamp = now()
    for (const [seen, at] of recentHrefs) {
      if (timestamp - at >= DEDUPE_WINDOW_MS) recentHrefs.delete(seen)
    }
    const previous = recentHrefs.get(href)
    if (previous !== undefined && timestamp - previous < DEDUPE_WINDOW_MS) {
      return true
    }
    recentHrefs.set(href, timestamp)
    return false
  }

  /**
   * Validate, budget, de-duplicate, then route.
   *
   * BOTH entry points come through here, so the bound in
   * {@link LinkActivationPayloadSchema} applies to `will-navigate` too. It did
   * not before, which left the OS hand-off reachable with a multi-megabyte URL
   * (lens review F1).
   */
  const route = (payload: unknown, provenance: LinkProvenance): void => {
    if (disposed) return

    const parsed = LinkActivationPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      // From the preload this can only be a compromised preview renderer; from
      // `will-navigate` it is an href the page made too long or too strange to
      // be worth acting on. Either way it is a finding, not a routing decision.
      deps.recordFailure(malformedPayloadFailure())
      return
    }

    if (!withinRateLimit(provenance)) {
      // Never silent: a click that goes nowhere with no trace is the failure
      // mode this whole feature exists to remove.
      deps.recordFailure(rateLimitedFailure())
      return
    }
    const dispatch = (): void => {
      if (disposed) return
      if (isDuplicate(parsed.data.href)) return
      void routeLinkActivation({ ...parsed.data, provenance }, context, deps)
    }
    if (provenance === 'gesture') {
      dispatch()
      return
    }
    const timer = setTimeout(() => {
      pendingNavigations.delete(timer)
      dispatch()
    }, NAVIGATION_GRACE_MS)
    pendingNavigations.add(timer)
  }

  return {
    handleActivation(payload: unknown): void {
      route(payload, 'gesture')
    },

    handleWillNavigate(url: string): void {
      route({ href: url }, 'navigation')
    },

    dispose(): void {
      disposed = true
      for (const timer of pendingNavigations) clearTimeout(timer)
      pendingNavigations.clear()
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

/** The failure entry recorded when a link is dropped for exceeding its budget. */
function rateLimitedFailure(): PreviewFailureInput {
  return {
    type: 'blocked-link',
    resourceUrlOrHost: '(too many links at once)',
    reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
  }
}

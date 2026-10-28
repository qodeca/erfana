// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pin visibility reports (docs/designs/comments/html-preview-comments.md §6 status,
 * §8 `preview-page:commentAnchors`, decision 30; test J-006).
 *
 * After each render the controller hands over, per pin key, whether its
 * element is rendered right now. A report goes to main only when the split
 * changed, at most once per {@link ANCHOR_CHECK_MIN_MS} (a trailing report
 * carries the latest split), and each list is capped at
 * {@link ANCHOR_KEYS_MAX} keys. Main turns "hidden" into "Not visible now";
 * a key whose element is not in the file at all is main's call (orphaned).
 *
 * When the overlay gave up (the page kept removing it, or rewrote itself with
 * `document.open()`, §9.1 S25), the report says so with `overlay:
 * 'unavailable'` and the `reason`, and main shows "Comments are unavailable
 * for this page" with that reason.
 */
import { ANCHOR_CHECK_MIN_MS, ANCHOR_KEYS_MAX, COMMENT_ANCHORS_CHANNEL } from './constants'

/** One pin's visibility. */
export interface AnchorEntry {
  readonly key: string
  readonly visible: boolean
}

/** Why the overlay gave up for this document (main's "Comments unavailable" reason). */
export type OverlayLoss = 'document-replaced' | 'overlay-removed'

/** The `commentAnchors` payload. */
export interface AnchorsPayload {
  readonly visible: readonly string[]
  readonly hidden: readonly string[]
  readonly overlay?: 'unavailable'
  /** Set with `overlay`: the page rewrote itself, or kept removing the overlay. */
  readonly reason?: OverlayLoss
}

/** The reporter's dependencies. */
export interface AnchorReporterDeps {
  readonly send: (channel: string, payload: AnchorsPayload) => void
  readonly now: () => number
}

const NOTHING = JSON.stringify({ visible: [], hidden: [] })

/** Sends `commentAnchors` when the visible / hidden split changes. */
export class AnchorReporter {
  private lastText = NOTHING
  private lastSentAt = Number.NEGATIVE_INFINITY
  private pending: AnchorsPayload | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private entries: readonly AnchorEntry[] = []
  private lost: OverlayLoss | null = null

  constructor(private readonly deps: AnchorReporterDeps) {}

  /** The latest split, after a render. */
  update(entries: readonly AnchorEntry[]): void {
    this.entries = entries
    const payload: AnchorsPayload = {
      visible: entries.filter(e => e.visible).map(e => e.key).slice(0, ANCHOR_KEYS_MAX),
      hidden: entries.filter(e => !e.visible).map(e => e.key).slice(0, ANCHOR_KEYS_MAX),
      ...(this.lost === null ? {} : { overlay: 'unavailable' as const, reason: this.lost })
    }
    if (JSON.stringify(payload) === this.lastText) {
      this.pending = null
      return
    }
    this.pending = payload
    const wait = this.lastSentAt + ANCHOR_CHECK_MIN_MS - this.deps.now()
    if (wait <= 0) {
      this.flush()
      return
    }
    this.timer ??= setTimeout(() => this.flush(), wait)
  }

  /** The overlay is gone for this document: say so once, with the last split. The first reason stays. */
  markUnavailable(reason: OverlayLoss): void {
    if (this.lost !== null) return
    this.lost = reason
    this.lastSentAt = Number.NEGATIVE_INFINITY
    this.update(this.entries)
  }

  /** Drop a pending report (tests, teardown). */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  private flush(): void {
    this.timer = null
    if (this.pending === null) return
    this.lastText = JSON.stringify(this.pending)
    this.lastSentAt = this.deps.now()
    this.deps.send(COMMENT_ANCHORS_CHANNEL, this.pending)
    this.pending = null
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The still-frame cache's capture order (docs/designs/comments/html-preview-comments.md
 * §19 "Rev 3 notes – P7 bug round", test E-011).
 *
 * One counter orders every capture start and every load mark – no clock to
 * disagree with. The post-load `ready` step runs asynchronously and
 * rate-limited, so a still captured for a comment popup can land between the
 * load and that step; `ready` therefore invalidates with `keepSinceLoad`, and
 * only what was captured BEFORE the load finished is dropped.
 */

/** Options of `IPreviewStillFrameCache.invalidate`. */
export interface PreviewInvalidateOptions {
  /** Keep a frame – and a capture in flight – started after the last `markLoaded`: it shows the loaded document. */
  keepSinceLoad?: boolean
}

/** What one invalidate drops. */
export interface StillFrameDrop {
  /** The stored frame goes. */
  readonly frame: boolean
  /** Whether a capture started at `order` goes. */
  readonly run: (order: number) => boolean
}

/** Capture starts, stored frames and load marks, per panel, in one order. */
export class StillFrameOrder {
  private last = 0
  /** When each stored frame's capture started. */
  private readonly frames = new Map<string, number>()
  /** Each panel's last load mark. */
  private readonly loads = new Map<string, number>()

  /** The next capture's place in the order. */
  next(): number {
    this.last += 1
    return this.last
  }

  /** `panelId`'s frame, from a capture started at `order`, was stored. */
  stored(panelId: string, order: number): void {
    this.frames.set(panelId, order)
  }

  /** A load of `panelId`'s page finished: a capture started from now shows it. */
  loaded(panelId: string): void {
    this.loads.set(panelId, this.next())
  }

  /**
   * Invalidate `panelId`. A full invalidate – or one with no load mark to
   * keep from – drops everything and forgets the mark; `keepSinceLoad` drops
   * only what started before the mark.
   */
  invalidate(panelId: string, keepSinceLoad: boolean): StillFrameDrop {
    const since = keepSinceLoad ? this.loads.get(panelId) : undefined
    if (since === undefined) this.loads.delete(panelId)
    const gone = (order: number | undefined): boolean => since === undefined || order === undefined || order < since
    const frame = gone(this.frames.get(panelId))
    if (frame) this.frames.delete(panelId)
    return { frame, run: gone }
  }
}

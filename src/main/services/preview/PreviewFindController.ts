// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview find controller (Issue #74, work item 35).
 *
 * Wraps Chromium's `webContents.findInPage` / `stopFindInPage` for one preview
 * page. Chromium emits `found-in-page` MANY times per search as it scans, with
 * intermediate counts that jump around; only the event carrying
 * `finalUpdate: true` holds the settled match total. This controller therefore
 * **forwards a count only on `finalUpdate: true`** — forwarding intermediate
 * updates makes the match counter flicker (design §1.4 / §1.9).
 *
 * `clearHighlights` pushes a zero count to listeners BEFORE calling
 * `stopFindInPage('clearSelection')`: the count must reach zero as the
 * highlights clear, and `stopFindInPage` emits no terminating `found-in-page`
 * of its own, so the zero has to be pushed explicitly and first.
 *
 * @see specs/designs/sd-074-html-preview.md §1.4
 */

/** A settled/interim Chromium `found-in-page` payload (structural subset). */
export interface FoundInPageResult {
  requestId: number
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

/** The `WebContents` find surface this controller uses. Structural for tests. */
export interface PreviewFindContents {
  findInPage(
    text: string,
    options: { forward: boolean; findNext: boolean; matchCase: boolean }
  ): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  on(
    event: 'found-in-page',
    listener: (event: unknown, result: FoundInPageResult) => void
  ): void
  off(
    event: 'found-in-page',
    listener: (event: unknown, result: FoundInPageResult) => void
  ): void
}

/** Options accepted by {@link IPreviewFindController.find}. */
export interface PreviewFindOptions {
  forward: boolean
  findNext: boolean
  matchCase: boolean
}

/** The normalised count forwarded to the renderer. */
export interface PreviewFindCount {
  total: number
  activeOrdinal: number
}

export interface IPreviewFindController {
  /** Start / advance a search. Empty text clears highlights instead. */
  find(text: string, options: PreviewFindOptions): void
  /** Push a zero count then clear the page selection. */
  clearHighlights(): void
  /** Detach the `found-in-page` listener (called on panel close). */
  dispose(): void
}

export class PreviewFindController implements IPreviewFindController {
  private readonly wc: PreviewFindContents
  private readonly onCount: (count: PreviewFindCount) => void
  private readonly listener: (event: unknown, result: FoundInPageResult) => void
  private disposed = false

  constructor(wc: PreviewFindContents, onCount: (count: PreviewFindCount) => void) {
    this.wc = wc
    this.onCount = onCount
    this.listener = (_event, result) => {
      // Only the settled update carries the true total; interim ones flicker.
      if (result.finalUpdate) {
        this.onCount({ total: result.matches, activeOrdinal: result.activeMatchOrdinal })
      }
    }
    this.wc.on('found-in-page', this.listener)
  }

  find(text: string, options: PreviewFindOptions): void {
    if (this.disposed) {
      return
    }
    // Chromium's findInPage throws on an empty string; treat it as a clear.
    if (text.length === 0) {
      this.clearHighlights()
      return
    }
    this.wc.findInPage(text, {
      forward: options.forward,
      findNext: options.findNext,
      matchCase: options.matchCase
    })
  }

  clearHighlights(): void {
    if (this.disposed) {
      return
    }
    // Push zero FIRST — stopFindInPage emits no terminating found-in-page.
    this.onCount({ total: 0, activeOrdinal: 0 })
    this.wc.stopFindInPage('clearSelection')
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.wc.off('found-in-page', this.listener)
  }
}

/** Factory mirroring the codebase interface + class + factory convention. */
export function createPreviewFindController(
  wc: PreviewFindContents,
  onCount: (count: PreviewFindCount) => void
): IPreviewFindController {
  return new PreviewFindController(wc, onCount)
}

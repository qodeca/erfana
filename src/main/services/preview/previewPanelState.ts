// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the preview service keeps about a panel beyond its live view (issue #124,
 * WI-2).
 *
 * Moved out of `PreviewViewService` with no change in behaviour. The records are
 * the zoom level and, from WI-17b, the tab's own Back and Forward list
 * (`previewTabHistory.ts`, part 3 §3.5). Both live as long as the tab. A
 * preview evicted by the live-view budget is torn down and rebuilt when its tab
 * returns, so anything held on the view would reset every time the reader
 * looked away. Held here, both survive suspend/resume and a same-panel reopen,
 * which is what a reader who zoomed in, or moved through a few pages, expects.
 *
 * They die with the panel in `forget()`. They are not large, but the zoom used
 * to be a map that only ever grew, across every file previewed in a session and
 * every project switch. The blocked-host ledger that was also kept here now
 * belongs to each page (`previewPageScope.ts`, issue #124, WI-29).
 */
import { PREVIEW } from '../../../shared/constants'
import type { PreviewTabHistory } from './previewTabHistory'

/** Per-panel state that outlives a single live view. */
export interface IPreviewPanelState {
  /** The zoom level to re-apply; `0` (100 %) when the panel was never zoomed. */
  zoomLevel(panelId: string): number
  /**
   * Move the panel's zoom by `step` levels, clamped to the preview's range, or
   * back to `0` with a `step` of `0`.
   *
   * @returns The new level, already remembered for the panel.
   */
  stepZoom(panelId: string, step: number): number
  /** The panel's own Back and Forward list, or `null` before its first open. */
  history(panelId: string): PreviewTabHistory | null
  /** Remember the panel's history; a resume reads it back (part 3 §3.4). */
  setHistory(panelId: string, history: PreviewTabHistory): void
  /** Forget everything about a panel: its tab is gone. */
  forget(panelId: string): void
}

/** Build an empty per-panel store; each service owns one. */
export function createPreviewPanelState(): IPreviewPanelState {
  const zoomLevels = new Map<string, number>()
  const histories = new Map<string, PreviewTabHistory>()

  return {
    zoomLevel(panelId: string): number {
      return zoomLevels.get(panelId) ?? 0
    },
    stepZoom(panelId: string, step: number): number {
      const current = zoomLevels.get(panelId) ?? 0
      const next =
        step === 0
          ? 0
          : Math.min(PREVIEW.MAX_ZOOM_LEVEL, Math.max(PREVIEW.MIN_ZOOM_LEVEL, current + step))
      zoomLevels.set(panelId, next)
      return next
    },
    history(panelId: string): PreviewTabHistory | null {
      return histories.get(panelId) ?? null
    },
    setHistory(panelId: string, history: PreviewTabHistory): void {
      histories.set(panelId, history)
    },
    forget(panelId: string): void {
      zoomLevels.delete(panelId)
      histories.delete(panelId)
    }
  }
}

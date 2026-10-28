// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The live-view budget: suspend the least recently active previews (issue #124,
 * WI-2; sd-074b §4.2).
 *
 * Moved out of `PreviewViewService` with no change in behaviour. At most
 * `PREVIEW.MAX_LIVE_VIEWS` previews run at once. Opening one more tears the least
 * recently active view down but leaves its panel open, showing the still frame it
 * had; the renderer re-opens it when its tab is activated again, which is the
 * exit state the original single-view design lacked (sd-074 §10).
 */
import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { withTimeout } from '../../utils/withTimeout'
import type { PreviewViewRegistry } from './PreviewViewRegistry'

/**
 * An error as a log line carries it: its name, plus `code` when it has one.
 * Never the message, which can quote a path or a preview URL (QG-7 S3).
 */
function errorFieldsOf(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) {
    return { error: typeof error }
  }
  const { code } = error as NodeJS.ErrnoException
  return typeof code === 'string' ? { error: error.name, code } : { error: error.name }
}

/** The service's own collaborators that eviction acts on. */
export interface PreviewViewEvictionDeps {
  readonly registry: Pick<PreviewViewRegistry, 'evictionCandidates' | 'invalidateOpen' | 'remove'>
  /** Tell the renderer the panel is suspended; runs even when the teardown throws. */
  readonly onSuspended: (panelId: string) => void
}

/** The live-view budget over one service's registry. */
export interface IPreviewViewEviction {
  /**
   * Suspend the least recently active previews until at most
   * `PREVIEW.MAX_LIVE_VIEWS` remain live. The panel just opened or activated is
   * never a candidate.
   *
   * Never rejects: a failure is logged, because it must not become the answer of
   * the open that asked for it.
   */
  enforceBudget(keepPanelId: string): Promise<void>
}

/** Build the budget enforcer for one service. */
export function createPreviewViewEviction(deps: PreviewViewEvictionDeps): IPreviewViewEviction {
  const { registry, onSuspended } = deps

  /** Tear a live view down but leave its panel open, showing its still frame. */
  async function suspend(panelId: string): Promise<void> {
    // Invalidate the panel's open claim, exactly as `close()` does. Without it,
    // an `open` for this panel parked on `await live.load()` resumes, finds
    // `isStale` false — neither the generation nor this panel's sequence moved —
    // and reports `{ ok: true }` for a panel that no longer has a view (lens
    // review F8).
    registry.invalidateOpen(panelId)

    const view = registry.remove(panelId)
    if (view === null) {
      return
    }
    // Hiding EMITS the still frame — it does not start one. Captures happen at
    // `'ready'`, while the view is drawn; the first clause of this sentence used
    // to say "starts the still-frame capture", which sent a reader looking for a
    // capture on this line and away from the one actually in flight.
    //
    // The entry is already out of the registry at this point, so anything that
    // threw past the teardown below would leave a live renderer process with no
    // owner, unreachable by `close()`, and the renderer would never see
    // `suspended` — leaving that tab permanently dead (lens review F8).
    view.setVisibility(false)
    // The ONE place that waits for a capture, and what it waits for is whatever
    // `'ready'` started and has not finished. `setVisibility` deliberately waits
    // for nothing: a hide must never sit behind I/O, because the native view eats
    // clicks meant for whatever overlay just opened. Here there is no overlay and
    // no pointer to steal, and `teardown` destroys the `webContents` on the next
    // line — so without this the capture would race its own subject and a
    // suspended panel would wake with no picture.
    //
    // Cannot reject: `whenCaptureSettled` absorbs a failed capture, because the
    // only question it answers is whether Chromium is still reading this page.
    // Bounded all the same: a capture that never settles must cost this tab its
    // picture, not its suspension.
    try {
      await withTimeout(
        view.whenCaptureSettled(),
        PREVIEW.CAPTURE_SETTLE_TIMEOUT_MS,
        'Preview eviction capture wait'
      )
    } catch (error) {
      logger.warn('Preview eviction: capture did not settle; suspending anyway', {
        panelId: stablePathDigest(panelId),
        ...errorFieldsOf(error)
      })
    }

    /*
     * `finally`, because the comment above is only half-true otherwise.
     *
     * It says anything that threw past the teardown would leave a live renderer
     * with no owner and a tab that never sees `suspended` — and then guards only
     * the wait. `teardown` can reject too: `teardownCollaborators` is fully
     * guarded, but the `.finally` callback that calls `wc.destroy()` is not.
     *
     * A throw there was the worse half of the same fault. The registry entry is
     * already gone, so `close()` cannot reach the view; `'suspended'` never
     * arrives, so the renderer's `loadState` stays `'ready'` and its resume
     * effect never fires; the overlay guard keeps sending `setVisibility` for a
     * panel main now drops silently, and therefore sends no `visibilityApplied`
     * for the reconciler to correct against. Nothing recovers until unmount.
     *
     * Emitting `'suspended'` regardless is the honest report: the view IS gone
     * from the registry either way, and the renderer's resume path is the only
     * thing that can put it back.
     */
    try {
      await view.teardown('immediate')
    } finally {
      onSuspended(panelId)
    }
  }

  return {
    async enforceBudget(keepPanelId: string): Promise<void> {
      /*
       * Housekeeping for OTHER panels must never change the answer of the open
       * that asked for it.
       *
       * This runs after the opening panel's `registry.install` and after its
       * `live.load()` — so that panel is already open and painting. Letting a
       * failure while tidying up someone else's view propagate turned it into
       * `{ ok: false, UNKNOWN_ERROR }`, the renderer took its `openFailed` branch
       * and showed the failed banner, and because that branch does not send
       * `preview:close`, a fully live, visible `WebContentsView` went on painting
       * over a panel whose renderer believed the open had failed.
       *
       * The cost of swallowing it is one preview over budget until the next open.
       */
      try {
        const candidates = registry.evictionCandidates(PREVIEW.MAX_LIVE_VIEWS, keepPanelId)
        for (const panelId of candidates) {
          await suspend(panelId)
        }
      } catch (error) {
        logger.warn('Preview live-view budget enforcement failed', {
          panelId: stablePathDigest(keepPanelId),
          ...errorFieldsOf(error)
        })
      }
    }
  }
}

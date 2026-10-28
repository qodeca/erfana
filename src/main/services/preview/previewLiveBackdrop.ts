// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The colour one live preview view shows behind its page (Issue #124, WI-1;
 * design §3). Moved out of `PreviewLiveView.ts` unchanged.
 *
 * Owns which backdrop the view is showing and the page's own resolved paper,
 * and is the only caller of `view.setBackgroundColor` and the only sender of
 * `backdropChanged`. The pure state machine and colour rules stay in
 * `previewBackdrop.ts`; this module applies them to one view.
 */

import type { PreviewEmitters } from '../../../shared/ipc/preview-types'
import type { PreviewViewHandle, PreviewWebContentsHandle } from './PreviewSessionFactory'
import {
  INITIAL_BACKDROP_STATE,
  READ_PAGE_BACKDROP_SCRIPT,
  argbToCss,
  backdropColor,
  nextBackdropState,
  toArgb,
  type BackdropEvent,
  type BackdropState
} from './previewBackdrop'

/**
 * Isolated world for reading the page's own paper. Distinct from the CSS-swap
 * world so a hung swap script cannot block the backdrop read.
 */
const BACKDROP_WORLD_ID = 998

/** What the backdrop module needs from the view that owns it. */
export interface PreviewLiveBackdropDeps {
  readonly panelId: string
  readonly view: Pick<PreviewViewHandle, 'setBackgroundColor'>
  /** The page, asked in an isolated world for its own paper. */
  readonly contents: Pick<PreviewWebContentsHandle, 'executeJavaScriptInIsolatedWorld'>
  readonly emit: Pick<PreviewEmitters, 'backdropChanged'>
  /** True once the view is torn down, closing, or its webContents is gone. */
  readonly isDefunct: () => boolean
}

/** The backdrop of one live view. */
export interface PreviewLiveBackdrop {
  /** A lifecycle edge: advance the state machine, and repaint if the colour moved. */
  move(event: BackdropEvent): void
  /** Paint the current backdrop and tell the renderer. */
  apply(): void
  /** A load terminated: read the page's own paper, then move and repaint. */
  settle(event?: BackdropEvent): Promise<void>
}

/** Create the backdrop owner for one live view. */
export function createPreviewLiveBackdrop(deps: PreviewLiveBackdropDeps): PreviewLiveBackdrop {
  /** Which backdrop the view is showing, and whether its first load is still ahead. */
  let backdrop: BackdropState = INITIAL_BACKDROP_STATE
  /** The page's own resolved paper, once read; `null` until then. */
  let pageBackdrop: string | null = null

  /**
   * Paint the current backdrop on the native view and tell the renderer, so the
   * DOM placeholder behind the view carries the identical value.
   */
  function apply(): void {
    if (deps.isDefunct()) {
      return
    }
    const argb = backdropColor(backdrop, pageBackdrop)
    deps.view.setBackgroundColor(argb)
    const css = argbToCss(argb)
    if (css !== null) {
      deps.emit.backdropChanged(deps.panelId, css)
    }
  }

  /**
   * Advance the backdrop state machine and repaint if the colour moved.
   *
   * @param event - The lifecycle edge that fired.
   */
  function move(event: BackdropEvent): void {
    const next = nextBackdropState(backdrop, event)
    if (next === backdrop) {
      return
    }
    backdrop = next
    apply()
  }

  /**
   * A load terminated — by success, by failure, or by the page calling
   * `window.stop()`. Read the page's own paper, then hand it the backdrop.
   *
   * The read runs in its own isolated world, so the page cannot shadow
   * `getComputedStyle`, and its result is parsed strictly by `toArgb`: the value
   * crosses a trust boundary and is interpolated into a colour, so anything
   * unrecognised falls back rather than being passed through.
   */
  async function settle(event: BackdropEvent = 'stop-loading'): Promise<void> {
    if (deps.isDefunct()) {
      return
    }
    try {
      const raw = await deps.contents.executeJavaScriptInIsolatedWorld(BACKDROP_WORLD_ID, [
        { code: READ_PAGE_BACKDROP_SCRIPT }
      ])
      pageBackdrop = toArgb(raw)
    } catch {
      // A page that refuses to be measured gets the browser default.
      pageBackdrop = null
    }
    if (deps.isDefunct()) {
      return
    }
    // Move AFTER the read so the repaint carries the resolved paper rather than
    // flashing the fallback white and correcting a frame later.
    backdrop = nextBackdropState(backdrop, event)
    apply()
  }

  return { move, apply, settle }
}

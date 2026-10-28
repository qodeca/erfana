// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewFallback (Issue #74, work item 71; issue #124, part 1 §1.5).
 *
 * The layer painted *behind* the native `WebContentsView`. While the view is
 * visible it paints over this; while it is hidden (inactive tab or an overlay)
 * this is what the user sees — a still frame captured on hide, or nothing (the
 * placeholder container's backdrop shows through), never a blank rectangle
 * (design §1.4). That backdrop matches the native view's own: brand black
 * before the page has painted, the page's paper colour afterwards.
 *
 * The still is drawn at the CSS size the view had when it was captured
 * (`cssWidth` × `cssHeight`), anchored top-left and never scaled: a narrower
 * panel crops it (the placeholder clips), a wider one shows the backdrop beside
 * it. Scaled to fill, it looked like the page zooming during a drag (UX §4). A
 * frame captured before that size was recorded has none, and fills as before.
 *
 * During a splitter or window-edge drag the choice is latched (answer 6): a
 * stale picture – real input reached the page after it was taken – gives way to
 * the backdrop, a fresh one stays, and either stays until main confirms the
 * page is back on screen. So neither release sequence flashes the old picture
 * or blinks an empty backdrop before the page returns.
 *
 * @module HtmlPreviewPanel/components/PreviewFallback
 */

import type { PreviewStillFrame } from '../../../../../../shared/ipc/preview-types'
import type { PreviewFallbackKind } from '../htmlPreview.logic'

/** Props for {@link PreviewFallback}. */
export interface PreviewFallbackProps {
  /** Whether to show the cached frame or fall through to the placeholder colour. */
  kind: PreviewFallbackKind
  /** The cached still frame, or `null` when none is available. */
  stillFrame: PreviewStillFrame | null
  /**
   * A drag or resize hold hid the page and main has not yet confirmed it is
   * back (`dragHideLatched` in the preview store). Overrides {@link kind}: the
   * picture shows only when it is fresh, the backdrop when it is stale.
   * Default `false`.
   */
  dragLatched?: boolean
}

/**
 * The CSS size a frame was captured at, when it carries a usable one.
 *
 * @param frame - The cached still frame
 * @returns `{ width, height }` in CSS pixels, or `null` for a frame from before
 *   the size was recorded (or a degenerate one), which fills instead
 */
function capturedCssSize(frame: PreviewStillFrame): { width: number; height: number } | null {
  const { cssWidth, cssHeight } = frame
  if (cssWidth === undefined || cssHeight === undefined) return null
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) {
    return null
  }
  return { width: cssWidth, height: cssHeight }
}

/**
 * Renders the cached still frame when {@link PreviewFallbackProps.kind} is
 * `'frame'` – or, while a drag latch holds, when the frame is fresh – otherwise
 * nothing (the placeholder colour is the container's own background).
 *
 * @param props - The fallback kind, the cached frame and the drag latch.
 * @returns The still-frame `<img>`, or `null` for the placeholder colour.
 *
 * @example
 * ```tsx
 * <PreviewFallback kind={fallbackKind} stillFrame={stillFrame} dragLatched={dragHideLatched} />
 * ```
 */
export function PreviewFallback({
  kind,
  stillFrame,
  dragLatched = false
}: PreviewFallbackProps): JSX.Element | null {
  if (!stillFrame) return null
  const showFrame = dragLatched ? stillFrame.stale !== true : kind === 'frame'
  if (!showFrame) return null

  const size = capturedCssSize(stillFrame)
  const sizing = size ? 'html-preview-still-frame--sized' : 'html-preview-still-frame--fill'

  return (
    <img
      className={`html-preview-still-frame ${sizing}`}
      src={stillFrame.dataUrl}
      // Inline because the size is per-capture data, not styling.
      style={size ?? undefined}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

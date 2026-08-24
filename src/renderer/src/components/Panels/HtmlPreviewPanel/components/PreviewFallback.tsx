// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewFallback (Issue #74, work item 71).
 *
 * The layer painted *behind* the native `WebContentsView`. While the view is
 * visible it paints over this; while it is hidden (inactive tab or an overlay)
 * this is what the user sees — a still frame captured on hide, or nothing (the
 * placeholder container's `var(--color-brand-black)` background shows through),
 * never a blank white rectangle (design §1.4).
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
}

/**
 * Renders the cached still frame when {@link PreviewFallbackProps.kind} is
 * `'frame'`, otherwise nothing (the placeholder colour is the container's own
 * background).
 *
 * @param props - The fallback kind and the cached frame.
 * @returns The still-frame `<img>`, or `null` for the placeholder colour.
 */
export function PreviewFallback({ kind, stillFrame }: PreviewFallbackProps): JSX.Element | null {
  if (kind !== 'frame' || !stillFrame) return null

  return (
    <img
      className="html-preview-still-frame"
      src={stillFrame.dataUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

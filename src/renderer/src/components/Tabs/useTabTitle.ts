// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Live tab title for a dockview tab component.
 *
 * Both tab components used to derive their label from `getBasename(filePath)`
 * and never read `api.title`, so `api.setTitle('icon.png (deleted)')` – which
 * the image viewer and the Markdown editor both call – rendered nowhere at all.
 * A deleted file in a BACKGROUND tab had no indication anywhere, because the
 * banner that reports it lives in the hidden panel body (QG-11a H5).
 *
 * @module useTabTitle
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useEffect, useState } from 'react'

import { parseTabTitle } from '../../utils/tabTitle'

/**
 * The part of dockview's panel API this hook needs.
 *
 * Structural, not `DockviewPanelApi`, so a test can pass a two-property stub -
 * and so a tab whose api predates `onDidTitleChange` degrades to the fallback
 * instead of throwing.
 */
export interface TabTitleSource {
  /** Current title, or `undefined` before the panel sets one. */
  readonly title?: string
  /** Fires whenever the panel calls `setTitle`. */
  readonly onDidTitleChange?: (listener: (event: { title: string }) => void) => {
    dispose: () => void
  }
}

/** What {@link useTabTitle} gives a tab component to render. */
export interface TabTitleState {
  /** File name to display, with the bullet and `(deleted)` markers removed. */
  label: string
  /** The panel is reporting that the file is gone from disk. */
  isDeleted: boolean
}

/**
 * Subscribes to a panel's title and splits it into label + deleted marker.
 *
 * The unsaved-changes bullet is deliberately NOT returned: the editor tab draws
 * its own indicator from the store, and rendering the bullet from the title as
 * well would show it twice.
 *
 * @param api - The panel api from `IDockviewPanelHeaderProps`
 * @param fallbackName - Shown until the panel sets a title (or if it never does)
 * @returns The label to render and whether to mark the tab as deleted
 *
 * @example
 * ```tsx
 * const { label, isDeleted } = useTabTitle(api, getBasename(filePath) || 'Image')
 *
 * return (
 *   <span>
 *     {label}
 *     {isDeleted && <span className="tab-deleted"> (deleted)</span>}
 *   </span>
 * )
 * ```
 */
export function useTabTitle(api: TabTitleSource | undefined, fallbackName: string): TabTitleState {
  const [title, setTitle] = useState<string>(api?.title ?? '')

  useEffect(() => {
    // Re-seeded on every api change: a panel that set its title before this tab
    // mounted would otherwise never fire the event we are waiting for.
    setTitle(api?.title ?? '')

    if (!api?.onDidTitleChange) return
    const disposable = api.onDidTitleChange((event) => setTitle(event.title))
    return () => disposable.dispose()
  }, [api])

  const parsed = parseTabTitle(title)

  return {
    label: parsed.name || fallbackName,
    isDeleted: parsed.deleted
  }
}

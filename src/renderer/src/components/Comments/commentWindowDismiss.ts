// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One Esc path for the comment window (plan step 6; K-9). The Markdown window
 * is not modal, so Esc can arrive with focus in the preview or on the toolbar.
 * It takes the window's own dismiss there too, so an open edit or delete step
 * backs out first, as it does with focus inside the window.
 *
 * @module components/Comments/commentWindowDismiss
 */
import { useEffect } from 'react'

const dismissals = new Map<string, () => void>()

/**
 * Dismiss the panel's open window, as Esc inside it does.
 *
 * @param panelKey - The panel's key: its drawer `id`, which the window is given too.
 * @returns `true` when a window took it.
 */
export function dismissOpenWindow(panelKey: string): boolean {
  const dismiss = dismissals.get(panelKey)
  dismiss?.()
  return dismiss !== undefined
}

/**
 * The comment window's side of {@link dismissOpenWindow}.
 *
 * @param panelKey - The window's panel.
 * @param dismiss - The window's dismiss.
 */
export function useWindowDismiss(panelKey: string, dismiss: () => void): void {
  useEffect(() => {
    dismissals.set(panelKey, dismiss)
    return () => {
      if (dismissals.get(panelKey) === dismiss) dismissals.delete(panelKey)
    }
  }, [panelKey, dismiss])
}

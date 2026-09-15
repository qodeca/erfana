// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewPageEntry hook (issue #124, QG-8 U1).
 *
 * The keyboard's way INTO the previewed page. The page renders in a native
 * `WebContentsView` that the renderer's tab order cannot reach, so a
 * keyboard-only reader could not follow a link in it – the headline capability
 * of #124 – and none of the accelerators main forwards back out of it could
 * ever fire, because each needs focus to be inside the page already (WCAG SC
 * 2.1.1). Escape is the way back: main hands native focus to the host window
 * (`previewHostFocus.ts`), then {@link usePreviewFindShortcuts}'s `focusChrome`
 * focuses the band chip – and the way back is stated in the chip's accessible
 * name.
 *
 * The hook owns two things: WHETHER the placeholder is a keyboard target right
 * now, and what Enter or Space on it does.
 *
 * **The active-tab gate is not decoration.** Dockview keeps every opened panel
 * mounted (`renderer: 'always'`), so an inactive tab's placeholder would
 * otherwise sit in the tab order with a live handler behind it, and a reader
 * tabbing through the window would be offered a page they cannot see. The panel
 * follows `api.isActive` through `onDidActiveChange` for exactly the reason
 * `useKeyboardShortcuts` takes an `enabled` flag (CLAUDE.md, panel-scoped
 * globals).
 *
 * Focus moves on a key press and on nothing else: this hook never calls the
 * bridge on mount, on a load or on a repaint. Focus that moves by itself is
 * focus the reader has lost.
 *
 * @module usePreviewPageEntry
 * @see src/main/ipc/preview/focus-handlers.ts - the channel it calls
 */

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import type { DockviewPanelApi } from 'dockview'

/** Options for {@link usePreviewPageEntry}. */
export interface UsePreviewPageEntryOptions {
  /** The preview panel whose page focus goes into. */
  panelId: string
  /**
   * The panel's dockview api. The affordance is live only on the ACTIVE tab;
   * without an api the panel is treated as active, as the visibility term is.
   */
  api?: Pick<DockviewPanelApi, 'isActive' | 'onDidActiveChange'>
  /**
   * There is a running, drawn page to enter: the panel's normal view, a load
   * state past `idle` and not `suspended`, and nothing hiding the native view.
   * Main re-checks all of it – this only keeps the offer honest.
   */
  pageLive: boolean
}

/** What the panel spreads onto its placeholder. */
export interface PreviewPageEntry {
  /** Whether the placeholder is a keyboard target right now. */
  enabled: boolean
  /** Enter / Space on the placeholder: hand keyboard focus to the page. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

/**
 * Wires the placeholder's keyboard route into the previewed page.
 *
 * @param options - The panel id, its dockview api and whether a page is live.
 * @returns Whether the placeholder is a target, and its key handler.
 *
 * @example
 * ```tsx
 * const pageEntry = usePreviewPageEntry({ panelId, api, pageLive })
 * <div tabIndex={pageEntry.enabled ? 0 : -1} onKeyDown={pageEntry.onKeyDown} />
 * ```
 */
export function usePreviewPageEntry(options: UsePreviewPageEntryOptions): PreviewPageEntry {
  const { panelId, api, pageLive } = options

  const [isActive, setIsActive] = useState<boolean>(api?.isActive ?? true)
  useEffect(() => {
    if (!api?.onDidActiveChange) return
    setIsActive(api.isActive ?? true)
    const disposable = api.onDidActiveChange((event) => setIsActive(event.isActive))
    return () => disposable.dispose()
  }, [api])

  const enabled = isActive && pageLive

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (!enabled || (event.key !== 'Enter' && event.key !== ' ')) {
        return
      }
      // Space would scroll the panel and Enter can carry on to a parent: this
      // press means "enter the page" and nothing else.
      event.preventDefault()
      // Fire-and-forget: a refusal means the page is not there to enter, and
      // the answer to that is to leave focus exactly where the reader put it.
      // A rejected invoke (the registry's sender gate, no handler) is the same
      // refusal, caught so it is not an unhandled rejection.
      window.api.preview.focusPage(panelId).catch(() => {})
    },
    [enabled, panelId]
  )

  return { enabled, onKeyDown }
}

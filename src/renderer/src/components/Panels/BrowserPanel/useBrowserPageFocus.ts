// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Moves keyboard focus from the tab's toolbar into its page (spec 025,
 * 025-FR-002, 025-FR-051; ADR 0011 decision 16).
 *
 * Main is told where focus comes from **before** it is asked to focus the
 * page – `focusOrigin(tabId, 'toolbar')`, then `focusPage` – so the first-click
 * rule applies only to focus from outside the tab.
 *
 * Only a shown page can take focus (main ignores `focusPage` for a detached
 * view). A request made while the page is not shown yet – Enter in the
 * address bar of an empty tab, whose view the guard shows only once the
 * load leaves the empty page – waits for main's report that the page is
 * shown, and is dropped if an Erfana page (a load error) takes the area
 * instead or the panel unmounts.
 */
import { useCallback, useEffect, useRef } from 'react'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { browserViewBounds } from '../../../services/browser/browserViewBounds'
import { getOverlayGuard } from '../../../services/preview/OverlayGuardService'
import { logger } from '../../../utils/logger'

/** Options for {@link useBrowserPageFocus}. */
export interface UseBrowserPageFocusOptions {
  readonly panelId: string
  readonly tabId: string | null
  /** The Erfana page in the page area (`state.erfanaPage`); any but `empty` drops a waiting request. */
  readonly erfanaPage: string | null
}

async function focusFromToolbar(tabId: string): Promise<void> {
  try {
    await browserTabGateway.focusOrigin(tabId, 'toolbar')
    await browserTabGateway.focusPage(tabId)
  } catch (error) {
    logger.warn('Browser tab page could not take focus', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * The panel's "focus the page" action.
 *
 * @param options - {@link UseBrowserPageFocusOptions}
 * @returns `focusPage(waitForShow)`: with `waitForShow`, a page not yet shown takes focus once it is
 *
 * @example
 * ```ts
 * const focusPage = useBrowserPageFocus({ panelId, tabId, erfanaPage })
 * focusPage(true) // after Enter in the address bar
 * ```
 */
export function useBrowserPageFocus(
  options: UseBrowserPageFocusOptions
): (waitForShow?: boolean) => void {
  const { panelId, tabId, erfanaPage } = options
  const waitingRef = useRef(false)

  useEffect(() => {
    if (tabId === null) return
    return browserViewBounds.onVisibilityApplied((shownTab, visible) => {
      if (shownTab !== tabId || !visible || !waitingRef.current) return
      waitingRef.current = false
      void focusFromToolbar(tabId)
    })
  }, [tabId])

  // An Erfana page took the area that a waiting request was for.
  useEffect(() => {
    if (erfanaPage !== null && erfanaPage !== 'empty') waitingRef.current = false
  }, [erfanaPage])

  return useCallback(
    (waitForShow = false) => {
      if (tabId === null) return
      if (getOverlayGuard().visiblePanelId() === panelId && erfanaPage === null) {
        waitingRef.current = false
        void focusFromToolbar(tabId)
        return
      }
      waitingRef.current = waitForShow
    },
    [panelId, tabId, erfanaPage]
  )
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page right-click menu (spec 025, 025-FR-057; design § Page right-click
 * menu; deck *Page right-click menu*; Menu card, decided). Main decides what
 * is in it (`browser-tab:contextMenu`) and does what an item names
 * (`contextAction`, checked against the live menu); this draws it with the
 * shared {@link ContextMenu}, named "Page actions", at the point the page was
 * clicked, with the link's host as a header line on a link menu (OD-12).
 *
 * The menu cannot draw over a live page (ADR 0011 decision 3): the window's
 * event wiring (`browserTabEvents`) puts the page's still image up before the
 * menu opens, and the menu registers as an occluder, so the native-view guard
 * takes the page off screen while it is open and the page area shows its
 * picture (commit 19). Closing lets the picture go and returns focus to the
 * page.
 */
import { useCallback } from 'react'
import { useBrowserChromeStore } from '../../../stores/useBrowserChromeStore'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { browserStill, CONTEXT_MENU_STILL_HOLDER } from '../../../services/browser/browserStill'
import { isMacOS } from '../../../utils/platform'
import { logger } from '../../../utils/logger'
import { ContextMenu, type ContextMenuItem } from '../../ContextMenu/ContextMenu'
import { CONTEXT_ACTION_LABELS, contextActionShortcut, linkHeader, pageMenuEntries } from './browserMenus.logic'

/** Props for {@link PageContextMenu}. */
export interface PageContextMenuProps {
  readonly tabId: string | null
  /** Where the page view sits in the window: the menu's point is relative to it. */
  readonly pageOrigin: () => { readonly left: number; readonly top: number } | null
  /** Return focus to the page once the menu is gone. */
  readonly onClosed: () => void
}

/**
 * Renders this tab's open page menu, or nothing.
 *
 * @param props - {@link PageContextMenuProps}
 * @returns The menu
 */
export function PageContextMenu({ tabId, pageOrigin, onClosed }: PageContextMenuProps): JSX.Element | null {
  const menu = useBrowserChromeStore(s => (tabId !== null && s.menu?.tabId === tabId ? s.menu : null))
  const close = useCallback(() => {
    useBrowserChromeStore.getState().closeMenu()
    if (tabId !== null) browserStill.release(tabId, CONTEXT_MENU_STILL_HOLDER)
    onClosed()
  }, [tabId, onClosed])
  if (menu === null || tabId === null) return null
  const mac = isMacOS()
  const items: ContextMenuItem[] = pageMenuEntries(menu.items).map(entry =>
    entry.separator
      ? { label: '', action: () => undefined, separator: true }
      : {
          label: CONTEXT_ACTION_LABELS[entry.action],
          shortcut: contextActionShortcut(entry.action, mac),
          action: () => {
            browserTabGateway.contextAction({ tabId, menuId: menu.menuId, action: entry.action }).catch((error: unknown) => {
              logger.warn('Browser page menu action failed', { error: error instanceof Error ? error.message : String(error) })
            })
          }
        }
  )
  const rect = pageOrigin()
  // ContextMenu opens 8px right of and below its anchor: the anchor is the clicked point.
  const x = (rect?.left ?? 0) + menu.at.x - 8
  const y = (rect?.top ?? 0) + menu.at.y - 8
  return (
    <ContextMenu
      key={menu.menuId}
      x={x}
      y={y}
      items={items}
      ariaLabel="Page actions"
      header={linkHeader(menu.linkOrigin)}
      onClose={close}
    />
  )
}

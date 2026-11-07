// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which items the page right-click menu shows (spec 025, 025-FR-057).
 *
 * In this order, from Electron's `context-menu` parameters:
 *
 * | Group | Items | Shown when |
 * |---|---|---|
 * | History | **Back**, **Forward**, **Reload** | Back and Forward only when the history has a step that way |
 * | Edit | **Copy**, **Paste**, **Select all** | Copy with a text selection; Paste in an editable field; Select all always |
 * | Link | **Open link in new tab**, **Open link in system browser**, **Copy link address** | On a link; the first only for an `http`/`https` link (the `contextMenuLink` source) |
 * | Image | **Copy image**, **Open image in new tab** | On an image; the second only for an `http`/`https` image |
 * | Pick | **Pick this element** | Browser tabs with pick wired (never in a popup) |
 * | DevTools | **Inspect** | Always |
 *
 * Pure: the caller passes the parameters it read.
 */
import type { ContextActionSchema } from '../../../../shared/ipc/browser-tab-schema'
import type { z } from 'zod'

export type ContextAction = z.infer<typeof ContextActionSchema>

/** The fields of Electron's `ContextMenuParams` the menu reads. */
export interface MenuParams {
  readonly linkURL: string
  readonly srcURL: string
  readonly mediaType: string
  readonly selectionText: string
  readonly isEditable: boolean
}

export interface MenuContext {
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  /** Whether **Pick this element** is offered (a browser tab with pick wired). */
  readonly canPick: boolean
}

/** True for an `http:` or `https:` address – the schemes a link or image may open in a new tab. */
export function isWebAddress(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** The menu's items for `params`, in display order. */
export function contextMenuItems(params: MenuParams, context: MenuContext): ContextAction[] {
  const items: ContextAction[] = []
  if (context.canGoBack) items.push('back')
  if (context.canGoForward) items.push('forward')
  items.push('reload')
  if (params.selectionText.trim() !== '') items.push('copy')
  if (params.isEditable) items.push('paste')
  items.push('selectAll')
  if (params.linkURL !== '') {
    if (isWebAddress(params.linkURL)) items.push('openLinkInNewTab')
    items.push('openLinkInSystemBrowser', 'copyLinkAddress')
  }
  if (params.mediaType === 'image' && params.srcURL !== '') {
    items.push('copyImage')
    if (isWebAddress(params.srcURL)) items.push('openImageInNewTab')
  }
  if (context.canPick) items.push('pickThisElement')
  items.push('inspect')
  return items
}

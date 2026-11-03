// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page right-click menu of one browser tab, main side (spec 025,
 * 025-FR-057; solution design § 3.5 `browserContextMenu`, § 8).
 *
 * Erfana draws the menu (commit 18); main decides what is in it and does
 * what it names:
 *
 * - The page's `context-menu` event (a pointer right-click, Shift+F10 or the
 *   context-menu key) becomes a `browser-tab:contextMenu` event to the owning
 *   window, with a fresh menu id, the items (`contextMenuItems.ts`), the
 *   link's origin for the menu's header and the point in the page view.
 *   Nothing is sent in pick mode, where the right-click never reaches the
 *   page either (025-FR-025, `input/browserMouseRouter.ts`).
 * - `browser-tab:contextAction` names the menu id and one of its items. Only
 *   the newest menu of the tab is live, it takes one action, and a new
 *   document in the tab ends it, so an action can never land on a page it
 *   was not chosen on. The link and image addresses come from main's copy
 *   of the event, never from the renderer.
 * - **Open link in new tab** and **Open image in new tab** open a tab under
 *   the `contextMenuLink` source (`http`/`https` only); **Open link in system
 *   browser** goes through the checked external-open path; **Copy link
 *   address** writes the address to the clipboard; **Copy image** copies the
 *   image at the point; **Inspect** opens DevTools at the element.
 */
import { randomUUID } from 'node:crypto'
import { originParts, type RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import type { ContextMenuEventSchema } from '../../../../shared/ipc/browser-tab-schema'
import type { z } from 'zod'
import { logger } from '../../LoggingService'
import { contextMenuItems, isWebAddress, type ContextAction, type MenuParams } from './contextMenuItems'

export type ContextMenuEvent = z.infer<typeof ContextMenuEventSchema>

/** What {@link TabContextMenu.act} did. */
export type ContextActionResult = 'accepted' | 'unknown' | 'invalid'

type Listener = (...args: unknown[]) => void

/** Electron's `ContextMenuParams`, as far as the menu reads them. */
export interface ContextMenuParams extends MenuParams {
  readonly x: number
  readonly y: number
}

/** The page `webContents` surface the menu uses. */
export interface MenuContents {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  isDestroyed(): boolean
  copy(): void
  paste(): void
  selectAll(): void
  copyImageAt(x: number, y: number): void
  readonly navigationHistory: { canGoBack(): boolean; canGoForward(): boolean }
}

/** What the menu's actions do outside the page. */
export interface MenuActions {
  history(step: 'back' | 'forward' | 'reload'): void
  /** DevTools at the element at the point (page view px). */
  inspect(at: { x: number; y: number }): void
  /** A new tab with `url`, under the `contextMenuLink` source. */
  openInNewTab(url: string): void
  /** The checked external-open path. */
  openInSystemBrowser(url: string): void
  writeClipboardText(text: string): void
  /**
   * **Copy** is about to run in the page: what it puts on the clipboard is page-written (S-17,
   * `site/pageClipboardMarks.ts`). A returned promise holds the copy until the clipboard's
   * before-state is read.
   */
  copied?(): Promise<void> | void
  /** **Pick this element** at the point; without it the item is not offered. */
  pickAt?(at: { x: number; y: number }): void
}

export interface TabContextMenuDeps {
  readonly tabId: string
  readonly contents: MenuContents
  readonly actions: MenuActions
  readonly resolveDomain: RegistrableDomainResolver
  /** Pick mode, an open pick menu or dialog: no page menu then. */
  readonly blocked: () => boolean
  readonly emit: (event: ContextMenuEvent) => void
  readonly newId?: () => string
}

interface LiveMenu {
  readonly id: string
  readonly params: ContextMenuParams
  readonly items: readonly ContextAction[]
}

export class TabContextMenu {
  private menu: LiveMenu | null = null
  private readonly listeners: Array<[string, Listener]> = []

  constructor(private readonly deps: TabContextMenuDeps) {
    this.listen('context-menu', (_event, params) => this.open(params as ContextMenuParams))
    this.listen('did-navigate', () => {
      this.menu = null
    })
  }

  /** Perform `action` of the live menu `menuId`; the menu ends either way when the id matched. */
  act(menuId: string, action: ContextAction): ContextActionResult {
    const menu = this.menu
    if (menu === null || menu.id !== menuId) return 'unknown'
    this.menu = null
    if (!menu.items.includes(action)) return 'invalid'
    this.perform(action, menu.params)
    return 'accepted'
  }

  /** The tab closed. */
  detach(): void {
    this.menu = null
    if (this.deps.contents.isDestroyed()) return
    for (const [event, listener] of this.listeners) this.deps.contents.removeListener(event, listener)
  }

  private open(params: ContextMenuParams): void {
    if (this.deps.blocked()) return
    const history = this.deps.contents.navigationHistory
    const items = contextMenuItems(params, {
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      canPick: this.deps.actions.pickAt !== undefined
    })
    const id = (this.deps.newId ?? (() => randomUUID().replaceAll('-', '')))()
    this.menu = { id, params, items }
    const link = params.linkURL === '' ? null : originParts(params.linkURL, this.deps.resolveDomain)
    try {
      this.deps.emit({ tabId: this.deps.tabId, menuId: id, items, linkOrigin: link, at: { x: params.x, y: params.y } })
    } catch (error) {
      logger.warn('A browser context menu could not be sent', { error: String(error) })
    }
  }

  private perform(action: ContextAction, params: ContextMenuParams): void {
    const { contents, actions } = this.deps
    const at = { x: params.x, y: params.y }
    switch (action) {
      case 'back':
      case 'forward':
      case 'reload':
        return actions.history(action)
      case 'copy': {
        const before = actions.copied?.()
        if (before === undefined) return contents.copy()
        void before.catch(() => undefined).then(() => contents.copy())
        return
      }
      case 'paste':
        return contents.paste()
      case 'selectAll':
        return contents.selectAll()
      case 'openLinkInNewTab':
        if (isWebAddress(params.linkURL)) actions.openInNewTab(params.linkURL)
        return
      case 'openLinkInSystemBrowser':
        return actions.openInSystemBrowser(params.linkURL)
      case 'copyLinkAddress':
        return actions.writeClipboardText(params.linkURL)
      case 'copyImage':
        return contents.copyImageAt(Math.round(at.x), Math.round(at.y))
      case 'openImageInNewTab':
        if (isWebAddress(params.srcURL)) actions.openInNewTab(params.srcURL)
        return
      case 'pickThisElement':
        return actions.pickAt?.(at)
      case 'inspect':
        return actions.inspect(at)
    }
  }

  private listen(event: string, listener: Listener): void {
    this.deps.contents.on(event, listener)
    this.listeners.push([event, listener])
  }
}

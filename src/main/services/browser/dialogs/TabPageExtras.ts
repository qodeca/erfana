// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Window open, the leave-page prompt and the page right-click menu of one
 * browser tab (spec 025, 025-FR-011, 025-FR-057, 025-FR-058; commits 12e–g),
 * attached together by `BrowserTabService` so the service holds one link.
 *
 * - **Window open** (`popups/BrowserPopups.ts`): the tab's handler replaces
 *   the deny-all one `BrowserTab` sets, in the same tick, before the first
 *   load; its activation tracker starts after the tab's input routers, so a
 *   press they drop never counts as a user action. Without the popups part
 *   every window open stays denied.
 * - **Leave-page prompt** (`leavePage.ts`): armed by the tab before every
 *   load the user starts, and asked when the user closes the tab.
 * - **Right-click menu** (`contextMenu/TabContextMenu.ts`).
 *
 * Strip answers go to the "Pop-up blocked" row first, then the leave-page
 * prompt; `null` when neither owns the row.
 */
import type { WebContents } from 'electron'
import type { Clock } from '../../../../shared/clock'
import { originParts, type RegistrableDomainResolver } from '../../../../shared/browser/originFormat'
import type { StripAnswer, StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { siteOrigin } from '../permissions/sitePermissions'
import type { AnswerResult } from '../permissions/tabStrip'
import type { BrowserPopups, TabPopupLink } from '../popups/BrowserPopups'
import { TabContextMenu, type ContextActionResult, type ContextMenuEvent, type MenuActions } from '../contextMenu/TabContextMenu'
import type { ContextAction } from '../contextMenu/contextMenuItems'
import { LeavePageGuard } from './leavePage'

/** What the extras need of a `BrowserTab`. */
export interface ExtrasTab {
  readonly id: string
  readonly projectRoot: string
  readonly contents: WebContents
  history(step: 'back' | 'forward' | 'reload'): void
  devTools(inspectAt?: { x: number; y: number }): void
}

/** Where a tab's extras reach the rest of the service. */
export interface ExtrasOutlet {
  strip(event: StripEvent): void
  contextMenu(event: ContextMenuEvent): void
  /** A page-opened tab (`createFromPage`); returns whether it opened. */
  openTab(url: string, background: boolean, adopt: WebContents | null): boolean
  /** **Open link in new tab**: a tab under the `contextMenuLink` source. */
  openLink(url: string): void
  /** Close the tab without asking (Erfana's close). */
  forceClose(): void
  /** Pick mode, or a pick menu or dialog open: no page menu. */
  blocked(): boolean
}

export interface TabPageExtrasSetup {
  readonly clock: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'>
  readonly resolveDomain: RegistrableDomainResolver
  /** Page-opened tabs, popups and the blocker; without it every window open is denied. */
  readonly popups?: Pick<BrowserPopups, 'attachTab'>
  /**
   * The menu actions that reach outside the tab: the external-open path, the
   * clipboard, and pick – which names the tab, because one setup serves every tab.
   */
  readonly menuActions: Pick<MenuActions, 'openInSystemBrowser' | 'writeClipboardText' | 'copied'> & {
    readonly pickAt?: (tabId: string, at: { x: number; y: number }) => void
  }
  readonly newRowId?: () => string
}

export class TabPageExtras {
  private readonly popups: TabPopupLink | null
  private readonly leave: LeavePageGuard
  private readonly menu: TabContextMenu
  private readonly contents: WebContents
  private readonly onNewDocument = (): void => this.popups?.newDocument()

  constructor(tab: ExtrasTab, outlet: ExtrasOutlet, setup: TabPageExtrasSetup) {
    const contents = tab.contents
    this.contents = contents
    this.popups = setup.popups?.attachTab(tab, { strip: (e) => outlet.strip(e), openTab: outlet.openTab }) ?? null
    if (this.popups !== null) {
      const { handler, startTracking } = this.popups.handlerFor(contents)
      contents.setWindowOpenHandler(handler)
      startTracking()
      contents.on('did-navigate', this.onNewDocument)
    }
    this.leave = new LeavePageGuard({
      tabId: tab.id,
      contents,
      clock: setup.clock,
      emit: (e) => outlet.strip(e),
      requester: () => requesterOf(contents.getURL(), setup.resolveDomain),
      forceClose: () => outlet.forceClose(),
      newId: setup.newRowId
    })
    this.menu = new TabContextMenu({
      tabId: tab.id,
      contents,
      resolveDomain: setup.resolveDomain,
      blocked: () => outlet.blocked(),
      emit: (e) => outlet.contextMenu(e),
      newId: setup.newRowId,
      actions: {
        openInSystemBrowser: (url) => setup.menuActions.openInSystemBrowser(url),
        writeClipboardText: (text) => setup.menuActions.writeClipboardText(text),
        copied: () => setup.menuActions.copied?.(),
        ...(setup.menuActions.pickAt === undefined ? {} : { pickAt: (at) => setup.menuActions.pickAt?.(tab.id, at) }),
        history: (step) => tab.history(step),
        inspect: (at) => tab.devTools(at),
        openInNewTab: (url) => outlet.openLink(url)
      }
    })
  }

  /** Arm the leave-page prompt before a load the user started. */
  arm(repeat: () => void): void {
    this.leave.arm(repeat)
  }

  /** The user closes the tab: the page may ask to stay. */
  closeByUser(): void {
    this.leave.closeByUser()
  }

  /** A strip answer; `null` when neither row is `requestId`. */
  answerStrip(requestId: string, answer: StripAnswer): AnswerResult | null {
    return this.popups?.answerStrip(requestId, answer) ?? this.leave.answer(requestId, answer)
  }

  /** `browser-tab:contextAction` on this tab. */
  contextAction(menuId: string, action: ContextAction): ContextActionResult {
    return this.menu.act(menuId, action)
  }

  /** The tab closed: popups close, rows go, listeners go. */
  detach(): void {
    this.popups?.detach()
    this.leave.detach()
    this.menu.detach()
    if (!this.contents.isDestroyed()) this.contents.removeListener('did-navigate', this.onNewDocument)
  }
}

function requesterOf(url: string, resolve: RegistrableDomainResolver): StripRow['requester'] {
  const origin = siteOrigin(url)
  const parts = origin === null ? null : originParts(origin, resolve)
  return parts === null ? undefined : { origin: parts, inside: null }
}

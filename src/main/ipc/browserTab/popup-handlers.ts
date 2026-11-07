// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's popup and right-click menu channels (spec 025,
 * solution design § 8, commits 12e and 12g).
 *
 * - **`browser-tab:contextAction`** (025-FR-057), from Erfana's main window:
 *   as in `browser-tab-handlers.ts` – registered through `registry.ts`, then
 *   the identity gate (`tabRequestGate.ts`); the service checks that the
 *   window owns the tab, and the action against the live menu main sent
 *   (`contextMenu/TabContextMenu.ts`).
 * - **`browser-tab:popupStrip`, `popupAnswer`, `popupClose`** (025-FR-011,
 *   ADR 0011 decision 9), from a popup window's own renderer. The registry
 *   admits them only from a registered window of kind `browserPopup`
 *   (`channelAllowList.ts`); the popup is then the one whose host renderer
 *   sent the request – never a payload field. They skip the gate's exact-URL
 *   check on purpose: the popup host loads the renderer with a route hash,
 *   which that check refuses. Popups carry no prompt rows of their own yet,
 *   so `popupAnswer` finds none.
 *
 * Never a throw: a refusal is a `null` answer or nothing.
 */
import type { IpcMainInvokeEvent } from 'electron'
import { originParts, popupOpenerName, withoutUserInfo, type RegistrableDomainResolver } from '../../../shared/browser/originFormat'
import { BROWSER_TAB_CHANNELS, BROWSER_TAB_POPUP_CHANNELS } from '../../../shared/ipc/browser-tab-channels'
import { PopupStripResponseSchema, type PopupStripResponse } from '../../../shared/ipc/browser-tab-popup-schema'
import {
  ContextActionRequestSchema,
  PopupAnswerRequestSchema,
  PopupCloseRequestSchema,
  PopupStripRequestSchema
} from '../../../shared/ipc/browser-tab-schema'
import type { BrowserTabService } from '../../services/browser/BrowserTabService'
import { securityStateOf } from '../../services/browser/browserNavigationPolicy'
import type { BrowserPopups } from '../../services/browser/popups/BrowserPopups'
import { logger } from '../../services/LoggingService'
import { registerHandle, unregisterHandle } from '../registry'
import { isTrustedSender as defaultIsTrustedSender } from '../senderValidation'
import { createTabGate, guarded, resolveWindowId as defaultResolveWindowId } from './tabRequestGate'

export interface BrowserTabPopupHandlerDeps {
  readonly tabs: Pick<BrowserTabService, 'contextAction'>
  readonly popups: Pick<BrowserPopups, 'popupByHost'>
  readonly resolveDomain: RegistrableDomainResolver
  readonly isTrustedSender?: (event: IpcMainInvokeEvent) => boolean
  /** The sender's window id; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindowId?: (event: IpcMainInvokeEvent) => number | null
}

const C = BROWSER_TAB_CHANNELS
const P = BROWSER_TAB_POPUP_CHANNELS

/** Every channel this module registers. */
export const BROWSER_TAB_POPUP_HANDLED_CHANNELS = [C.contextAction, P.popupStrip, P.popupAnswer, P.popupClose] as const

/** Register the channels; returns the function that removes them. */
export function registerBrowserTabPopupHandlers(deps: BrowserTabPopupHandlerDeps): () => void {
  // contextAction names a tab the service checks against the window itself, so no tab lookup here.
  const { accept } = createTabGate<IpcMainInvokeEvent, number, never>({
    isTrusted: deps.isTrustedSender ?? defaultIsTrustedSender,
    resolveWindow: deps.resolveWindowId ?? defaultResolveWindowId
  })

  /** The popup whose host sent `event`, when the payload parses. */
  function popupOf(channel: string, event: IpcMainInvokeEvent, schema: { safeParse(v: unknown): { success: boolean } }, arg: unknown) {
    if (!schema.safeParse(arg).success) {
      logger.warn('Rejected a browser popup request with an invalid payload', { channel })
      return null
    }
    const popup = deps.popups.popupByHost(event.sender.id)
    if (popup === null) logger.warn('Rejected a browser popup request from a window that is not a popup', { channel })
    return popup
  }

  registerHandle(C.contextAction, (event, arg: unknown): void => {
    const accepted = accept(C.contextAction, event, ContextActionRequestSchema, arg)
    if (accepted === null) return
    const { tabId, menuId, action } = accepted.data
    guarded(C.contextAction, undefined, () => {
      deps.tabs.contextAction(accepted.window, tabId, { menuId, action })
    })
  })

  registerHandle(P.popupStrip, (event, arg: unknown): PopupStripResponse | null => {
    const popup = popupOf(P.popupStrip, event, PopupStripRequestSchema, arg)
    if (popup === null) return null
    const committedUrl = popup.committed === null ? null : withoutUserInfo(popup.committed)
    const answer = {
      committedUrl,
      origin: committedUrl === null ? null : originParts(committedUrl, deps.resolveDomain),
      security: securityStateOf(committedUrl),
      openedBy: popupOpenerName(popup.openerUrl, deps.resolveDomain)
    }
    return PopupStripResponseSchema.safeParse(answer).success ? answer : null
  })

  // No popup carries a prompt row of its own: the answer is checked and dropped.
  registerHandle(P.popupAnswer, (event, arg: unknown): void => {
    popupOf(P.popupAnswer, event, PopupAnswerRequestSchema, arg)
  })

  registerHandle(P.popupClose, (event, arg: unknown): void => {
    popupOf(P.popupClose, event, PopupCloseRequestSchema, arg)?.close()
  })

  return () => {
    for (const channel of BROWSER_TAB_POPUP_HANDLED_CHANNELS) unregisterHandle(channel)
  }
}

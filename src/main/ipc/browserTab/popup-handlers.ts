// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's popup and right-click menu channels (spec 025,
 * solution design § 8, commits 12e and 12g).
 *
 * - **`browser-tab:contextAction`** (025-FR-057), from Erfana's main window:
 *   as in `browser-tab-handlers.ts` – registered through `registry.ts`, the
 *   exact-URL {@link isTrustedSender} checked again, the strict schema, the
 *   window from the sender, the tab owned by that window. The action is
 *   checked against the live menu main sent (`contextMenu/TabContextMenu.ts`).
 * - **`browser-tab:popupStrip`, `popupAnswer`, `popupClose`** (025-FR-011,
 *   ADR 0011 decision 9), from a popup window's own renderer. The registry
 *   admits them only from a registered window of kind `browserPopup`
 *   (`channelAllowList.ts`); the popup is then the one whose host renderer
 *   sent the request – never a payload field. The popup's renderer arrives
 *   with the browser UI (commit 18), so until then nothing sends these.
 *   Popups carry no prompt rows of their own yet, so `popupAnswer` finds
 *   none.
 *
 * Never a throw: a refusal is a `null` answer or nothing.
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { originParts, type RegistrableDomainResolver } from '../../../shared/browser/originFormat'
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
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'
import { isTrustedSender as defaultIsTrustedSender } from '../senderValidation'

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
  const isTrusted = deps.isTrustedSender ?? defaultIsTrustedSender
  const resolveWindowId =
    deps.resolveWindowId ??
    ((event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      return window === null || window.isDestroyed() ? null : window.id
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
    if (!isTrusted(event)) {
      logger.warn('Rejected a browser tab request from an untrusted sender', { channel: C.contextAction })
      return
    }
    const parsed = ContextActionRequestSchema.safeParse(arg)
    const windowId = parsed.success ? resolveWindowId(event) : null
    if (!parsed.success || windowId === null) return
    const { tabId, menuId, action } = parsed.data
    try {
      deps.tabs.contextAction(windowId, tabId, { menuId, action })
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.contextAction })
    }
  })

  registerHandle(P.popupStrip, (event, arg: unknown): PopupStripResponse | null => {
    const popup = popupOf(P.popupStrip, event, PopupStripRequestSchema, arg)
    if (popup === null) return null
    const committedUrl = popup.committed
    const answer = {
      committedUrl,
      origin: committedUrl === null ? null : originParts(committedUrl, deps.resolveDomain),
      security: securityStateOf(committedUrl)
    }
    return PopupStripResponseSchema.safeParse(answer).success ? answer : null
  })

  // No popup carries a prompt row yet (its site rows arrive with its strip, commit 18).
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

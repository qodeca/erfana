// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's tab channels (spec 025, solution design § 8,
 * commit 7): `browser-tab:create`, `close`, `navigate`, `history` (Back,
 * Forward, Reload, Stop), `bounds` (send; carries visibility), `focusPage` and
 * `devTools`. The tab state goes back as the `browser-tab:state` event, to the
 * owning window only (`BrowserTabService`).
 *
 * Every handler is registered through `registry.ts` (identity, top-level
 * frame, renderer URL and the window kind's channel allow-list), checks the
 * exact-URL {@link isTrustedSender} again, parses its payload with the strict
 * zod schema, resolves the window from the sender – never from the payload –
 * and never throws: a refusal is an `{ error }` answer, or nothing for a
 * request with no answer.
 */
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { classifyAddressInput } from '../../shared/browser/addressInput'
import { BROWSER_TAB_CHANNELS } from '../../shared/ipc/browser-tab-channels'
import {
  BoundsRequestSchema,
  CloseRequestSchema,
  CreateRequestSchema,
  DevToolsRequestSchema,
  FocusPageRequestSchema,
  HistoryRequestSchema,
  NavigateRequestSchema,
  type CreateResponse,
  type NavigateResponse
} from '../../shared/ipc/browser-tab-schema'
import type { BrowserTab, TabHost } from '../services/browser/BrowserTab'
import type { BrowserTabService } from '../services/browser/BrowserTabService'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { registerHandle, registerOn, unregisterHandle, unregisterOn } from './registry'
import { isTrustedSender as defaultIsTrustedSender } from './senderValidation'

type TabServiceSurface = Pick<BrowserTabService, 'create' | 'close' | 'tabOf'>

export interface BrowserTabHandlerDeps {
  readonly service: TabServiceSurface
  readonly isTrustedSender?: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean
  /** The sender's window; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindow?: (event: IpcMainInvokeEvent | IpcMainEvent) => TabHost | null
}

const C = BROWSER_TAB_CHANNELS

/** A zod schema's `safeParse`, as far as these handlers use it. */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } }
}

/** Every channel this module registers, for tests and the unregister function. */
export const BROWSER_TAB_HANDLED_CHANNELS = [C.create, C.close, C.navigate, C.history, C.bounds, C.focusPage, C.devTools] as const

/** Register the tab channels; returns the function that removes them. */
export function registerBrowserTabHandlers(deps: BrowserTabHandlerDeps): () => void {
  const isTrusted = deps.isTrustedSender ?? defaultIsTrustedSender
  const resolveWindow =
    deps.resolveWindow ?? ((event) => BrowserWindow.fromWebContents(event.sender) as TabHost | null)
  const { service } = deps

  /** The sender's window when the sender is trusted and the payload parses. */
  function accept<T>(
    channel: string,
    event: IpcMainInvokeEvent | IpcMainEvent,
    schema: Parser<T>,
    arg: unknown
  ): { host: TabHost; data: T } | null {
    if (!isTrusted(event)) {
      logger.warn('Rejected a browser tab request from an untrusted sender', { channel })
      return null
    }
    const parsed = schema.safeParse(arg)
    if (!parsed.success) {
      logger.warn('Rejected a browser tab request with an invalid payload', { channel, error: parsed.error.message })
      return null
    }
    const host = resolveWindow(event)
    return host === null || host.isDestroyed() ? null : { host, data: parsed.data }
  }

  /** The named tab when the request is acceptable and the window owns the tab. */
  function acceptTab<T extends { tabId: string }>(
    channel: string,
    event: IpcMainInvokeEvent | IpcMainEvent,
    schema: Parser<T>,
    arg: unknown
  ): { tab: BrowserTab; data: T } | null {
    const accepted = accept(channel, event, schema, arg)
    if (accepted === null) return null
    const tab = service.tabOf(accepted.host.id, accepted.data.tabId)
    return tab === null ? null : { tab, data: accepted.data }
  }

  /** Run `act`, logging instead of throwing. */
  function guarded<R>(channel: string, fallback: R, act: () => R): R {
    try {
      return act()
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel })
      return fallback
    }
  }

  registerHandle(C.create, async (event, arg: unknown): Promise<CreateResponse> => {
    const accepted = accept(C.create, event, CreateRequestSchema, arg)
    if (accepted === null) return { error: 'Request refused' }
    try {
      return await service.create(accepted.host, accepted.data.panelId)
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.create })
      return { error: 'The browser tab could not open' }
    }
  })

  registerHandle(C.close, (event, arg: unknown): void => {
    const accepted = accept(C.close, event, CloseRequestSchema, arg)
    if (accepted !== null) guarded(C.close, undefined, () => service.close(accepted.host.id, accepted.data.tabId))
  })

  registerHandle(C.navigate, (event, arg: unknown): NavigateResponse => {
    const target = acceptTab(C.navigate, event, NavigateRequestSchema, arg)
    if (target === null) return { error: 'Request refused' }
    return guarded<NavigateResponse>(C.navigate, { error: 'The address could not be opened' }, () => {
      const decision = classifyAddressInput(target.data.input)
      if (decision.kind === 'refused') return { refused: decision.reason }
      const result = target.tab.navigate(decision.url, target.data.source)
      return 'refused' in result ? { refused: result.refused } : { ok: true }
    })
  })

  registerHandle(C.history, (event, arg: unknown): void => {
    const target = acceptTab(C.history, event, HistoryRequestSchema, arg)
    if (target !== null) guarded(C.history, undefined, () => target.tab.history(target.data.step))
  })

  const onBounds = (event: IpcMainEvent, arg: unknown): void => {
    const target = acceptTab(C.bounds, event, BoundsRequestSchema, arg)
    if (target === null) return
    const { bounds, seq, visible } = target.data
    guarded(C.bounds, undefined, () => target.tab.applyBounds(bounds, seq, visible))
  }
  registerOn(C.bounds, onBounds)

  registerHandle(C.focusPage, (event, arg: unknown): void => {
    const target = acceptTab(C.focusPage, event, FocusPageRequestSchema, arg)
    if (target !== null) guarded(C.focusPage, undefined, () => target.tab.focusPage())
  })

  registerHandle(C.devTools, (event, arg: unknown): void => {
    const target = acceptTab(C.devTools, event, DevToolsRequestSchema, arg)
    if (target !== null) guarded(C.devTools, undefined, () => target.tab.devTools(target.data.inspectAt))
  })

  return () => {
    for (const channel of BROWSER_TAB_HANDLED_CHANNELS) {
      if (channel === C.bounds) unregisterOn(channel, onBounds)
      else unregisterHandle(channel)
    }
  }
}

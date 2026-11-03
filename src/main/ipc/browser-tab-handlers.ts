// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's tab channels (spec 025, solution design § 8,
 * commit 7): `browser-tab:create`, `close`, `navigate`, `history` (Back,
 * Forward, Reload, Stop), `bounds` (send; carries visibility), `focusPage` and
 * `devTools`; `answerStrip` and `showDownload` (commit 12a–b, 025-FR-019,
 * 025-FR-020), `certificate` (commit 12c, 025-FR-021); `focusOrigin` and `toolbarFocus` (send) for the key and mouse
 * routers (commit 13, ADR 0011 decisions 13 and 16); `openLocalFile` (commit 11, 025-FR-010 – **Open in browser
 * tab**) and the address bar's `file://` input through `navigate`, both loaded from the file's served folder
 * (025-FR-005 rule 1). The tab state goes back as the `browser-tab:state` event, to
 * the owning window only (`BrowserTabService`).
 *
 * Every handler is registered through `registry.ts` (identity, top-level
 * frame, renderer URL and the window kind's channel allow-list), checks the
 * exact-URL {@link isTrustedSender} again, parses its payload with the strict
 * zod schema, resolves the window from the sender – never from the payload –
 * and never throws: a refusal is an `{ error }` answer, or nothing for a
 * request with no answer.
 */
import { fileURLToPath } from 'node:url'
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { classifyAddressInput } from '../../shared/browser/addressInput'
import { BROWSER_TAB_CHANNELS, BROWSER_TAB_EVENTS } from '../../shared/ipc/browser-tab-channels'
import {
  AnswerStripRequestSchema,
  BoundsAppliedEventSchema,
  BoundsRequestSchema,
  CertificateRequestSchema,
  CloseRequestSchema,
  CreateRequestSchema,
  DevToolsRequestSchema,
  FocusOriginRequestSchema,
  FocusPageRequestSchema,
  HistoryRequestSchema,
  NavigateRequestSchema,
  OpenLocalFileRequestSchema,
  ShowDownloadRequestSchema,
  ToolbarFocusRequestSchema,
  type CreateResponse,
  type NavigateResponse
} from '../../shared/ipc/browser-tab-schema'
import type { BrowserTab, TabHost } from '../services/browser/BrowserTab'
import type { BrowserTabService } from '../services/browser/BrowserTabService'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { registerHandle, registerOn, unregisterHandle, unregisterOn } from './registry'
import { isTrustedSender as defaultIsTrustedSender } from './senderValidation'

type TabServiceSurface = Pick<
  BrowserTabService,
  | 'create'
  | 'close'
  | 'tabOf'
  | 'answerStrip'
  | 'answerCertificate'
  | 'showDownload'
  | 'focusOrigin'
  | 'toolbarFocus'
  | 'openLocalFile'
>

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
export const BROWSER_TAB_HANDLED_CHANNELS = [
  C.create,
  C.close,
  C.navigate,
  C.openLocalFile,
  C.history,
  C.bounds,
  C.focusPage,
  C.focusOrigin,
  C.toolbarFocus,
  C.devTools,
  C.answerStrip,
  C.showDownload,
  C.certificate
] as const

/** The path of a `file:` URL with no host, or `null` (a network path, or not a file URL). */
function localFilePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && parsed.host === '' ? fileURLToPath(parsed) : null
  } catch {
    return null
  }
}

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

  registerHandle(C.navigate, (event, arg: unknown): NavigateResponse | Promise<NavigateResponse> => {
    const target = acceptTab(C.navigate, event, NavigateRequestSchema, arg)
    if (target === null) return { error: 'Request refused' }
    const { tab, data } = target
    return guarded<NavigateResponse | Promise<NavigateResponse>>(C.navigate, { error: 'The address could not be opened' }, () => {
      const decision = classifyAddressInput(data.input)
      if (decision.kind === 'refused') return { refused: decision.reason }
      const result = tab.navigate(decision.url, data.source)
      if (!('refused' in result)) return { ok: true }
      // The tab loads no file: URL itself; a local file opens through its served folder.
      const filePath = result.refused === 'local-file' ? localFilePath(decision.url) : null
      if (filePath === null) return { refused: result.refused }
      return service.openLocalFile(tab.windowId, data.tabId, filePath, data.source)
    })
  })

  // **Open in browser tab** from the HTML Preview (025-FR-010): the previewed file, from its served folder.
  registerHandle(C.openLocalFile, async (event, arg: unknown): Promise<NavigateResponse> => {
    const target = acceptTab(C.openLocalFile, event, OpenLocalFileRequestSchema, arg)
    if (target === null) return { error: 'Request refused' }
    return service.openLocalFile(target.tab.windowId, target.data.tabId, target.data.filePath, 'previewOpen')
  })

  registerHandle(C.history, (event, arg: unknown): void => {
    const target = acceptTab(C.history, event, HistoryRequestSchema, arg)
    if (target !== null) guarded(C.history, undefined, () => target.tab.history(target.data.step))
  })

  const onBounds = (event: IpcMainEvent, arg: unknown): void => {
    const target = acceptTab(C.bounds, event, BoundsRequestSchema, arg)
    if (target === null) return
    const { tabId, bounds, seq, visible, ack, clip } = target.data
    const shown = guarded(C.bounds, null, () => target.tab.applyBounds(bounds, seq, visible, clip))
    // The answer goes to the sender, which acceptTab checked owns the tab
    if (ack && shown !== null && !event.sender.isDestroyed()) {
      event.sender.send(BROWSER_TAB_EVENTS.boundsApplied, BoundsAppliedEventSchema.parse({ tabId, seq, visible: shown }))
    }
  }
  registerOn(C.bounds, onBounds)

  registerHandle(C.focusPage, (event, arg: unknown): void => {
    const target = acceptTab(C.focusPage, event, FocusPageRequestSchema, arg)
    if (target !== null) guarded(C.focusPage, undefined, () => target.tab.focusPage())
  })

  registerHandle(C.focusOrigin, (event, arg: unknown): void => {
    const accepted = accept(C.focusOrigin, event, FocusOriginRequestSchema, arg)
    if (accepted === null) return
    const { tabId, from } = accepted.data
    guarded(C.focusOrigin, undefined, () => service.focusOrigin(accepted.host.id, tabId, from))
  })

  const onToolbarFocus = (event: IpcMainEvent, arg: unknown): void => {
    const accepted = accept(C.toolbarFocus, event, ToolbarFocusRequestSchema, arg)
    if (accepted === null) return
    const { tabId, focused } = accepted.data
    guarded(C.toolbarFocus, undefined, () => service.toolbarFocus(accepted.host.id, tabId, focused))
  }
  registerOn(C.toolbarFocus, onToolbarFocus)

  registerHandle(C.devTools, (event, arg: unknown): void => {
    const target = acceptTab(C.devTools, event, DevToolsRequestSchema, arg)
    if (target !== null) guarded(C.devTools, undefined, () => target.tab.devTools(target.data.inspectAt))
  })

  // The owning window answers its own tab's row; main re-checks the input
  // guard and that the answer is one the row offers (`TabStrip.answer`).
  registerHandle(C.answerStrip, (event, arg: unknown): void => {
    const accepted = accept(C.answerStrip, event, AnswerStripRequestSchema, arg)
    if (accepted === null) return
    // `fields` (a sign-in box's user name and password) go to the row's owner only, never to a log.
    const { tabId, requestId, answer, fields } = accepted.data
    guarded(C.answerStrip, undefined, () => {
      service.answerStrip(accepted.host.id, tabId, requestId, answer, fields)
    })
  })

  // **Proceed anyway** or **Back to safety** on the owning window's tab;
  // main re-checks the 500 ms input guard (`site/browserCertificates.ts`).
  registerHandle(C.certificate, (event, arg: unknown): void => {
    const accepted = accept(C.certificate, event, CertificateRequestSchema, arg)
    if (accepted === null) return
    const { tabId, decisionId, proceed } = accepted.data
    guarded(C.certificate, undefined, () => {
      service.answerCertificate(accepted.host.id, tabId, decisionId, proceed)
    })
  })

  registerHandle(C.showDownload, (event, arg: unknown): void => {
    const accepted = accept(C.showDownload, event, ShowDownloadRequestSchema, arg)
    if (accepted !== null) {
      guarded(C.showDownload, undefined, () => {
        service.showDownload(accepted.host.id, accepted.data.downloadId)
      })
    }
  })

  return () => {
    for (const channel of BROWSER_TAB_HANDLED_CHANNELS) {
      if (channel === C.bounds) unregisterOn(channel, onBounds)
      else if (channel === C.toolbarFocus) unregisterOn(channel, onToolbarFocus)
      else unregisterHandle(channel)
    }
  }
}

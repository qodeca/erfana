// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's page-feature channels (spec 025, solution design
 * § 8, commit 12h): `browser-tab:find`, `stopFind`, `zoom` and `widthPreset`
 * on one tab (025-FR-008, 025-FR-012); `clearData` and `forget` for the
 * sender's project (025-FR-023); `suggest` from its address history
 * (025-FR-063); `pageClipboard` for the terminal's paste guard (025-FR-009,
 * S-17). Results go back as `browser-tab:findResult` and
 * `browser-tab:state` events, to the owning window only (`BrowserTabService`).
 *
 * As in `browser-tab-handlers.ts`: registered through `registry.ts`, then
 * the identity gate (`tabRequestGate.ts`), and never a throw: a refusal is an
 * `{ error }` answer, or nothing for a request with no answer. The project
 * of `clearData`, `forget` and `suggest` is the one this process holds open:
 * one project per Erfana window process.
 */
import type { IpcMainInvokeEvent } from 'electron'
import { BROWSER_TAB_CHANNELS } from '../../../shared/ipc/browser-tab-channels'
import {
  PageClipboardRequestSchema,
  type ClearDataCategory,
  type ClearDataResponse,
  type ForgetResponse,
  type PageClipboardResponse
} from '../../../shared/ipc/browser-tab-page-schema'
import {
  ClearDataRequestSchema,
  FindRequestSchema,
  ForgetRequestSchema,
  StopFindRequestSchema,
  SuggestRequestSchema,
  WidthPresetRequestSchema,
  ZoomRequestSchema
} from '../../../shared/ipc/browser-tab-schema'
import type { BrowserTabService } from '../../services/browser/BrowserTabService'
import type { BrowserPages } from '../../services/browser/page/BrowserPages'
import type { BrowserTabPage } from '../../services/browser/page/BrowserTabPage'
import type { PageClipboardMarks } from '../../services/browser/site/pageClipboardMarks'
import type { ProjectSessionSnapshot } from '../../services/session/ProjectSession'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'
import { isTrustedSender as defaultIsTrustedSender } from '../senderValidation'
import { createTabGate, resolveWindowId as defaultResolveWindowId, type Parser } from './tabRequestGate'

export interface BrowserTabPageHandlerDeps {
  readonly tabs: Pick<BrowserTabService, 'pageFor'>
  readonly pages: Pick<BrowserPages, 'clearData' | 'forget' | 'suggest'>
  /** Which clipboard text a browser page wrote; without it every answer is "not page-written". */
  readonly pageClipboard?: Pick<PageClipboardMarks, 'isPageWritten'>
  /** The project this process holds open. */
  readonly currentProject: () => Pick<ProjectSessionSnapshot, 'realRoot' | 'caseSensitive'> | null
  readonly isTrustedSender?: (event: IpcMainInvokeEvent) => boolean
  /** The sender's window id; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindowId?: (event: IpcMainInvokeEvent) => number | null
}

const C = BROWSER_TAB_CHANNELS

/** Every channel this module registers, for tests and the unregister function. */
export const BROWSER_TAB_PAGE_CHANNELS = [
  C.find,
  C.stopFind,
  C.zoom,
  C.widthPreset,
  C.clearData,
  C.forget,
  C.suggest,
  C.pageClipboard
] as const

const REFUSED = 'Request refused'

/** Register the page channels; returns the function that removes them. */
export function registerBrowserTabPageHandlers(deps: BrowserTabPageHandlerDeps): () => void {
  const { accept, acceptTab } = createTabGate<IpcMainInvokeEvent, number, BrowserTabPage>({
    isTrusted: deps.isTrustedSender ?? defaultIsTrustedSender,
    resolveWindow: deps.resolveWindowId ?? defaultResolveWindowId,
    tabOf: (windowId, tabId) => deps.tabs.pageFor(windowId, tabId)
  })

  /** Run `act` on the named tab's page features when the sender's window owns the tab; never throws. */
  function onPage<T extends { tabId: string }>(channel: string, schema: Parser<T>, act: (page: BrowserTabPage, data: T) => void) {
    return (event: IpcMainInvokeEvent, arg: unknown): void => {
      try {
        const accepted = acceptTab(channel, event, schema, arg)
        if (accepted !== null) act(accepted.tab, accepted.data)
      } catch (error) {
        logger.error('Browser tab request failed', redactedLogError(error), { channel })
      }
    }
  }

  registerHandle(C.find, onPage(C.find, FindRequestSchema, (page, d) => page.find(d.text, d.forward, d.findNext)))
  registerHandle(C.stopFind, onPage(C.stopFind, StopFindRequestSchema, (page) => page.stopFind()))
  registerHandle(C.zoom, onPage(C.zoom, ZoomRequestSchema, (page, d) => page.zoom(d.step)))
  registerHandle(C.widthPreset, onPage(C.widthPreset, WidthPresetRequestSchema, (page, d) => page.widthPreset(d.preset)))

  registerHandle(C.clearData, async (event, arg: unknown): Promise<ClearDataResponse> => {
    const accepted = accept(C.clearData, event, ClearDataRequestSchema, arg)
    if (accepted === null) return { error: REFUSED }
    const ticked = Object.entries(accepted.data.categories)
      .filter(([, on]) => on)
      .map(([category]) => category as ClearDataCategory)
    try {
      return await deps.pages.clearData(new Set(ticked))
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.clearData })
      return { error: 'The browsing data could not be cleared' }
    }
  })

  registerHandle(C.forget, async (event, arg: unknown): Promise<ForgetResponse> => {
    if (accept(C.forget, event, ForgetRequestSchema, arg) === null) return { error: REFUSED, path: null }
    try {
      return await deps.pages.forget()
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.forget })
      return { error: "The project's browser data could not be forgotten", path: null }
    }
  })

  registerHandle(C.suggest, async (event, arg: unknown): Promise<{ rows: Array<{ url: string }> }> => {
    const accepted = accept(C.suggest, event, SuggestRequestSchema, arg)
    const project = deps.currentProject()
    if (accepted === null || project === null) return { rows: [] }
    try {
      const urls = await deps.pages.suggest(project.realRoot, project.caseSensitive, accepted.data.prefix)
      return { rows: urls.map((url) => ({ url })) }
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.suggest })
      return { rows: [] }
    }
  })

  // The paste guard asks before typing; a refused or failed check answers "page-written", so the
  // terminal asks rather than types (S-17). Neither the text nor its digest is logged.
  registerHandle(C.pageClipboard, async (event, arg: unknown): Promise<PageClipboardResponse> => {
    if (accept(C.pageClipboard, event, PageClipboardRequestSchema, arg) === null) return { pageWritten: true }
    try {
      return { pageWritten: (await deps.pageClipboard?.isPageWritten()) ?? false }
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.pageClipboard })
      return { pageWritten: true }
    }
  })

  return () => {
    for (const channel of BROWSER_TAB_PAGE_CHANNELS) unregisterHandle(channel)
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's pick-and-send channels (spec 025, solution design
 * § 8, commits 14–15): `browser-tab:pickMode` (the **Pick element** button),
 * `refine` (Up, Down, **Parent element**, **Child element**, a name in the
 * ancestor path), `closePick` (the menu or dialog closed, or a send
 * succeeded), `writeCapture` (the shell guard, then the capture files),
 * `discardCaptureFiles` (the terminal write failed after the files were
 * written) and `targetStatus` (the toolbar's target). Commit 19 adds
 * `pickSurface` (the held capture moved between the panel and the dialog)
 * and `still` (the page as a still image for a surface over the page area,
 * ADR 0011). Pick events go back as `browser-tab:pick`, to the owning window
 * only.
 *
 * As in `browser-tab-handlers.ts`: registered through `registry.ts`
 * (identity, top-level frame, renderer URL and the window kind's channel
 * allow-list), the exact-URL {@link isTrustedSender} checked again, the
 * payload parsed with its strict zod schema, the window resolved from the
 * sender – never from the payload – and never a throw. A terminal is checked
 * against the sender's own `webContents`: a window can only target its own
 * terminals (025-FR-061).
 */
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { BROWSER_TAB_CHANNELS } from '../../../shared/ipc/browser-tab-channels'
import {
  ClosePickRequestSchema,
  DiscardCaptureFilesRequestSchema,
  PickModeRequestSchema,
  RefineRequestSchema,
  TargetStatusRequestSchema,
  WriteCaptureRequestSchema,
  type TargetStatusResponse,
  type WriteCaptureResponse
} from '../../../shared/ipc/browser-tab-schema'
import {
  PickSurfaceRequestSchema,
  StillRequestSchema,
  type PickActionResponse,
  type StillResponse
} from '../../../shared/ipc/browser-tab-pick-schema'
import { takeSurfaceStill } from '../../services/browser/capture/surfaceStill'
import type { BrowserTab } from '../../services/browser/BrowserTab'
import type { BrowserTabService } from '../../services/browser/BrowserTabService'
import type { BrowserPicks } from '../../services/browser/pick/BrowserPicks'
import type { BrowserTabPick } from '../../services/browser/pick/BrowserTabPick'
import { logger } from '../../services/LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { registerHandle, unregisterHandle } from '../registry'
import { isTrustedSender as defaultIsTrustedSender } from '../senderValidation'

export interface BrowserTabPickHandlerDeps {
  readonly tabs: Pick<BrowserTabService, 'tabOf' | 'inputFor'>
  readonly picks: Pick<BrowserPicks, 'forTab' | 'writeCapture' | 'discardCaptureFiles' | 'targetStatus'>
  readonly isTrustedSender?: (event: IpcMainInvokeEvent) => boolean
  /** The sender's window id; defaults to `BrowserWindow.fromWebContents`. */
  readonly resolveWindowId?: (event: IpcMainInvokeEvent) => number | null
}

const C = BROWSER_TAB_CHANNELS

/** Every channel this module registers, for tests and the unregister function. */
export const BROWSER_TAB_PICK_CHANNELS = [
  C.pickMode,
  C.refine,
  C.closePick,
  C.pickSurface,
  C.still,
  C.writeCapture,
  C.discardCaptureFiles,
  C.targetStatus
] as const

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } }
}

const REFUSED = 'Request refused'
const NO: PickActionResponse = { ok: false }

/** Register the pick channels; returns the function that removes them. */
export function registerBrowserTabPickHandlers(deps: BrowserTabPickHandlerDeps): () => void {
  const isTrusted = deps.isTrustedSender ?? defaultIsTrustedSender
  const resolveWindowId =
    deps.resolveWindowId ??
    ((event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      return window === null || window.isDestroyed() ? null : window.id
    })

  function accept<T>(channel: string, event: IpcMainInvokeEvent, schema: Parser<T>, arg: unknown): { windowId: number; data: T } | null {
    if (!isTrusted(event)) {
      logger.warn('Rejected a browser tab request from an untrusted sender', { channel })
      return null
    }
    const parsed = schema.safeParse(arg)
    if (!parsed.success) {
      logger.warn('Rejected a browser tab request with an invalid payload', { channel, error: parsed.error.message })
      return null
    }
    const windowId = resolveWindowId(event)
    return windowId === null ? null : { windowId, data: parsed.data }
  }

  /** The tab and its pick pipeline when the sender's window owns the tab. */
  function acceptPick<T extends { tabId: string }>(
    channel: string,
    event: IpcMainInvokeEvent,
    schema: Parser<T>,
    arg: unknown
  ): { tab: BrowserTab; pick: BrowserTabPick; data: T } | null {
    const accepted = accept(channel, event, schema, arg)
    if (accepted === null) return null
    const tab = deps.tabs.tabOf(accepted.windowId, accepted.data.tabId)
    const pick = tab === null ? null : deps.picks.forTab(tab)
    return tab === null || pick === null ? null : { tab, pick, data: accepted.data }
  }

  function guarded<R>(channel: string, fallback: R, act: () => R): R {
    try {
      return act()
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel })
      return fallback
    }
  }

  registerHandle(C.pickMode, (event, arg: unknown): PickActionResponse => {
    const accepted = acceptPick(C.pickMode, event, PickModeRequestSchema, arg)
    if (accepted === null) return NO
    return guarded(C.pickMode, NO, () => {
      const input = deps.tabs.inputFor(accepted.tab)
      if (input === null) return NO
      // The button toggles; a request for the state already on does nothing.
      if (input.state().pick !== accepted.data.on) input.dispatch({ type: 'pickButton' })
      return { ok: input.state().pick === accepted.data.on }
    })
  })

  registerHandle(C.refine, (event, arg: unknown): PickActionResponse => {
    const accepted = acceptPick(C.refine, event, RefineRequestSchema, arg)
    if (accepted === null || accepted.pick.capture?.id !== accepted.data.captureId) return NO
    return guarded(C.refine, NO, () => {
      accepted.pick.refine(accepted.data.move)
      return { ok: true }
    })
  })

  registerHandle(C.closePick, (event, arg: unknown): PickActionResponse => {
    const accepted = acceptPick(C.closePick, event, ClosePickRequestSchema, arg)
    if (accepted === null) return NO
    return guarded(C.closePick, NO, () => ({ ok: accepted.pick.close(accepted.data.captureId, accepted.data.reason) }))
  })

  registerHandle(C.pickSurface, (event, arg: unknown): PickActionResponse => {
    const accepted = acceptPick(C.pickSurface, event, PickSurfaceRequestSchema, arg)
    if (accepted === null || accepted.pick.capture?.id !== accepted.data.captureId) return NO
    return guarded(C.pickSurface, NO, () => {
      const input = deps.tabs.inputFor(accepted.tab)
      if (input === null) return NO
      input.dispatch({ type: accepted.data.surface === 'dialog' ? 'dialogOpen' : 'dialogBack' })
      return { ok: true }
    })
  })

  registerHandle(C.still, async (event, arg: unknown): Promise<StillResponse> => {
    const accepted = accept(C.still, event, StillRequestSchema, arg)
    const tab = accepted === null ? null : deps.tabs.tabOf(accepted.windowId, accepted.data.tabId)
    if (tab === null) return { error: REFUSED }
    try {
      return await takeSurfaceStill(tab.contents)
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.still })
      return { error: 'The page could not be captured' }
    }
  })

  registerHandle(C.writeCapture, async (event, arg: unknown): Promise<WriteCaptureResponse> => {
    const accepted = acceptPick(C.writeCapture, event, WriteCaptureRequestSchema, arg)
    if (accepted === null) return { error: REFUSED }
    try {
      return await deps.picks.writeCapture(accepted.tab, accepted.pick, event.sender.id, accepted.data)
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.writeCapture })
      return { error: 'The capture could not be saved' }
    }
  })

  registerHandle(C.discardCaptureFiles, async (event, arg: unknown): Promise<PickActionResponse> => {
    const accepted = acceptPick(C.discardCaptureFiles, event, DiscardCaptureFilesRequestSchema, arg)
    if (accepted === null) return NO
    try {
      return { ok: await deps.picks.discardCaptureFiles(accepted.tab, accepted.pick, accepted.data.captureId) }
    } catch (error) {
      logger.error('Browser tab request failed', redactedLogError(error), { channel: C.discardCaptureFiles })
      return NO
    }
  })

  registerHandle(C.targetStatus, (event, arg: unknown): TargetStatusResponse => {
    const fallback: TargetStatusResponse = { kind: 'unknown', process: null, fresh: false }
    const accepted = accept(C.targetStatus, event, TargetStatusRequestSchema, arg)
    if (accepted === null) return fallback
    return guarded(C.targetStatus, fallback, () => deps.picks.targetStatus(event.sender.id, accepted.data.terminalId))
  })

  return () => {
    for (const channel of BROWSER_TAB_PICK_CHANNELS) unregisterHandle(channel)
  }
}

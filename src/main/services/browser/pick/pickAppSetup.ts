// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick and send's process-wide wiring (spec 025, solution design § 13
 * commits 14–15), kept out of `browserAppSetup.ts`.
 *
 * - The tab-kind CDP session of each page is recorded as it attaches
 *   ({@link registerPickSession}), so a tab's pick pipeline can drive it.
 * - Each tab gets its pick pipeline right after its page features, before
 *   its first page loads ({@link BrowserPicksSetup.withPicks} wraps the page
 *   features' `attachTab`): the routers exist by then, and pick events go to
 *   the owning window only, checked against `PickEventSchema`.
 * - The `browser-tab:` pick channels are registered, and capture expiry
 *   follows the open project (025-FR-039).
 * - Pick mode ends and capture writes finish in the teardown's `endPick` and
 *   `abortCaptureWrites` stages, before the views close (ADR 0009 decision 14).
 */
import { BrowserWindow, nativeImage, type WebContents } from 'electron'
import type { Clock } from '../../../../shared/clock'
import { BROWSER_TAB_EVENTS } from '../../../../shared/ipc/browser-tab-channels'
import { PickEventSchema, type PickEvent } from '../../../../shared/ipc/browser-tab-schema'
import { registerBrowserTabPickHandlers } from '../../../ipc/browserTab/pick-handlers'
import { logger } from '../../LoggingService'
import type { ProjectSession } from '../../session/ProjectSession'
import type { BrowserTab } from '../BrowserTab'
import type { BrowserProjectTeardown } from '../browserProjectTeardown'
import type { BrowserTabService } from '../BrowserTabService'
import type { TargetTerminals } from '../capture/BrowserTargetStatus'
import type { Bitmap } from '../capture/captureImage'
import { CaptureExpiry } from '../capture/CaptureStore'
import type { PickCdp } from './pickCdp'
import { BrowserPicks } from './BrowserPicks'

const sessions = new WeakMap<object, PickCdp>()

/** Record the tab-kind CDP session attached to a page `webContents`. */
export function registerPickSession(contents: object, cdp: PickCdp): void {
  sessions.set(contents, cdp)
}

/** A BGRA bitmap as PNG, through Electron's image codec. */
export function encodePng(bitmap: Bitmap): Uint8Array {
  const buffer = Buffer.from(bitmap.data.buffer, bitmap.data.byteOffset, bitmap.data.byteLength)
  return new Uint8Array(nativeImage.createFromBitmap(buffer, { width: bitmap.width, height: bitmap.height }).toPNG())
}

/** What the page features' `attachTab` and `detachTab` look like, as far as the wrapper needs. */
interface TabFeatures<P, E, H> {
  attachTab(tab: BrowserTab, events: E, hang: H): P
  detachTab(page: P): void
}

export interface BrowserPicksSetup {
  readonly picks: BrowserPicks
  readonly expiry: CaptureExpiry
  /** The page features with each tab's pick pipeline attached after them. */
  withPicks<P, E, H>(features: TabFeatures<P, E, H>): TabFeatures<P, E, H>
}

export interface BrowserPicksSetupDeps {
  readonly clock: Clock
  readonly tabs: () => Pick<BrowserTabService, 'inputFor' | 'tabOf'>
  readonly projectSession: Pick<ProjectSession, 'onChange' | 'current'>
  readonly terminals: () => TargetTerminals | null
  /** The project-switch and window-close teardown; the pick stages register on it. */
  readonly teardown: Pick<BrowserProjectTeardown, 'onStage'>
  /** A test seam. */
  readonly registerHandlers?: typeof registerBrowserTabPickHandlers
}

/** Send `event` to the window that owns `tab`, checked against its schema. */
function sendToOwner(tab: BrowserTab, event: PickEvent): void {
  const window = BrowserWindow.fromId(tab.windowId)
  const target: WebContents | undefined = window === null || window.isDestroyed() ? undefined : window.webContents
  if (target === undefined || target.isDestroyed()) return
  if (!PickEventSchema.safeParse(event).success) {
    logger.error('Dropped a browser pick event that does not match its schema', undefined, { kind: event.kind })
    return
  }
  target.send(BROWSER_TAB_EVENTS.pick, event)
}

/** Build the pick service, register its channels and start capture expiry. Run once, after ready. */
export function installBrowserPicks(deps: BrowserPicksSetupDeps): BrowserPicksSetup {
  const picks = new BrowserPicks({
    clock: deps.clock,
    encodePng,
    terminals: deps.terminals,
    sessionOf: (contents) => sessions.get(contents) ?? null
  })
  // The tab service is built after this (it takes `withPicks`), so it is reached lazily.
  const tabs: Pick<BrowserTabService, 'inputFor' | 'tabOf'> = {
    tabOf: (windowId, tabId) => deps.tabs().tabOf(windowId, tabId),
    inputFor: (tab) => deps.tabs().inputFor(tab)
  }
  ;(deps.registerHandlers ?? registerBrowserTabPickHandlers)({ tabs, picks })
  picks.registerTeardown(deps.teardown)
  const expiry = new CaptureExpiry(picks.store, deps.clock)
  expiry.attach(deps.projectSession)
  return {
    picks,
    expiry,
    withPicks: (features) => ({
      attachTab: (tab, events, hang) => {
        const page = features.attachTab(tab, events, hang)
        const window = BrowserWindow.fromId(tab.windowId)
        if (window !== null && !window.isDestroyed()) {
          picks.attach(tab, window, tabs.inputFor(tab), (event) => sendToOwner(tab, event))
        }
        return page
      },
      detachTab: (page) => features.detachTab(page)
    })
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's process-wide wiring (spec 025, solution design § 15
 * rows for `src/main/index.ts`), kept out of `index.ts`, which has no room to
 * grow (`scripts/max-lines-baseline.json`).
 *
 * Before ready: the app's one privileged-scheme registration, the disk-cache
 * cap and the `webContents` baseline with the browser view exemption.
 * After ready: `erfana-local` refused in Erfana's own session, the profile
 * service (which hardens each browser session it creates), the tab service
 * and its `browser-tab:*` handlers, the project-switch teardown (the old
 * project's tabs close in its `closeViews` stage) and the deletes left by the
 * last run. A closing window's tabs close through {@link closeBrowserWindow},
 * called where the window's previews are torn down.
 */
import { homedir } from 'node:os'
import { is } from '@electron-toolkit/utils'
import {
  safeStorage,
  session as electronSession,
  WebContentsView,
  type App,
  type Session,
  type WebContents
} from 'electron'
import { pinnedRegistrableDomain } from '../../../shared/browser/publicSuffixList'
import { registerBrowserTabHandlers } from '../../ipc/browser-tab-handlers'
import { RENDERER_FILE_URL } from '../../ipc/senderValidation'
import { registerAppSchemes } from '../appSchemes'
import { registerWebContentsBaseline } from '../../utils/webContentsBaseline'
import { hasHmacKey, signForPurpose, verifyForPurpose } from '../../utils/lockHmac'
import { mainClock } from '../../utils/mainClock'
import { redactedLogError } from '../../utils/redactUserInput'
import type { IProjectLockService } from '../../interfaces/IProjectLockService'
import type { ProjectSession } from '../session/ProjectSession'
import { logger } from '../LoggingService'
import { browserSessionRegistry } from './browserSessionRegistry'
import { refuseLocalScheme } from './browserLocalScheme'
import { BrowserProfileService, storageBackendFor } from './BrowserProfileService'
import { BrowserProjectTeardown } from './browserProjectTeardown'
import { isBrowserFolderTrackedByGit } from './browserProfileGit'
import { markIgnoredBySync } from './browserSyncIgnore'
import type { PurposeSigner } from './browserProfileMarker'
import { hardenBrowserSession } from './browserSessionPolicy'
import { buildBrowserWebPreferences } from './browserWebPreferences'
import { installAppRequestFilter } from './browserAppRequestFilter'
import type { AppAddresses } from './browserNavigationPolicy'
import { BrowserTabService } from './BrowserTabService'
import type { BrowserTabCdpLink } from './BrowserTab'
import { BrowserCdpSession } from './cdp/BrowserCdpSession'

/**
 * Chromium's per-disk-cache maximum: 512 MB (025-FR-015; ADR 0009 decision 9).
 * There is no per-session setter, and the switch caps each session's disk
 * cache (inferred, spec change S-5), so Erfana's own session gets the same cap.
 */
export const BROWSER_DISK_CACHE_BYTES = 512 * 1024 * 1024

/** `lockHmac`'s purpose-bound functions as a {@link PurposeSigner}. */
export const lockHmacSigner: PurposeSigner = {
  hasKey: hasHmacKey,
  sign: signForPurpose,
  verify: verifyForPurpose
}

/** Must run at module scope of `index.ts`, before `app.whenReady()`. */
export function installBrowserBeforeReady(app: Pick<App, 'on' | 'commandLine'>): void {
  registerAppSchemes()
  app.commandLine.appendSwitch('disk-cache-size', String(BROWSER_DISK_CACHE_BYTES))
  // Deny-by-default window open and navigation for every webContents; only
  // registered browser view ids are exempt, and an unregistered one in a
  // browser session is closed (ADR 0009 decision 5)
  registerWebContentsBaseline<WebContents>(app, browserSessionRegistry)
}

export interface BrowserAfterReadyDeps {
  readonly defaultSession: Pick<Session, 'protocol'>
  readonly projectSession: ProjectSession
  readonly lockService: Pick<IProjectLockService, 'checkLock' | 'acquireLock'>
  /** Registers the `browser-tab:*` handlers; a test seam. */
  readonly registerTabHandlers?: typeof registerBrowserTabHandlers
}

export interface BrowserRuntime {
  readonly profiles: BrowserProfileService
  readonly teardown: BrowserProjectTeardown
  readonly tabs: BrowserTabService
  /** Erfana's own addresses, refused to every tab (025-FR-005 rule 3). */
  readonly appAddresses: AppAddresses
}

/** Erfana's own addresses in this build: the renderer entry, the resources folder, the dev server. */
export function currentAppAddresses(): AppAddresses {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  let devServerOrigin: string | null = null
  if (is.dev && devUrl) {
    try {
      devServerOrigin = new URL(devUrl).origin
    } catch {
      devServerOrigin = null
    }
  }
  return { rendererEntry: RENDERER_FILE_URL, resourcesDir: process.resourcesPath, devServerOrigin }
}

/**
 * Attach a tab-kind CDP session to a new tab's page before its first load. A
 * refused attach (another client holds the debugger) leaves the tab without
 * one rather than without a page.
 */
function attachTabCdp(contents: WebContents): BrowserTabCdpLink | null {
  const cdp = new BrowserCdpSession({ kind: 'tab' })
  try {
    cdp.attach(contents)
  } catch (error) {
    logger.warn('Browser tab opened without a CDP session', { error: redactedLogError(error)?.message ?? String(error) })
    return null
  }
  return { setVisible: (visible) => cdp.hangProbe.setVisible(visible), detach: () => cdp.detach() }
}

/** Build a browser page view in `session`, registered before its constructor returns. */
function createBrowserView(session: Session): WebContentsView {
  return browserSessionRegistry.createView(
    session,
    () => new WebContentsView({ webPreferences: buildBrowserWebPreferences(session, process.platform) }),
    (view) => view.webContents
  )
}

let runtime: BrowserRuntime | null = null

/** The browser runtime, once {@link installBrowserAfterReady} ran. */
export function getBrowserRuntime(): BrowserRuntime | null {
  return runtime
}

/** Run once, after `app.whenReady()`. */
export function installBrowserAfterReady(deps: BrowserAfterReadyDeps): BrowserRuntime {
  refuseLocalScheme(deps.defaultSession)
  const profiles = new BrowserProfileService({
    projectSession: deps.projectSession,
    lockService: deps.lockService,
    fromPath: (path) => electronSession.fromPath(path),
    registerSession: (ses) => browserSessionRegistry.registerSession(ses),
    hardenSession: (ses) =>
      hardenBrowserSession(ses as Session, { platform: process.platform, chromeVersion: process.versions.chrome }),
    signer: lockHmacSigner,
    storageBackend: () => storageBackendFor(process.platform, () => safeStorage.getSelectedStorageBackend()),
    isTrackedByGit: (canonical) => isBrowserFolderTrackedByGit(canonical),
    markIgnoredBySync: (dir) => markIgnoredBySync(dir),
    homeDir: homedir(),
    platform: process.platform,
    clock: mainClock
  })
  const appAddresses = currentAppAddresses()
  const tabs = new BrowserTabService({
    openProfile: () => profiles.openForTab(),
    currentProject: () => deps.projectSession.current(),
    prepareSession: (ses) => installAppRequestFilter(ses, () => appAddresses),
    createView: createBrowserView,
    expectDevTools: (ses) => browserSessionRegistry.expectDevTools(ses),
    appAddresses: () => appAddresses,
    resolveDomain: pinnedRegistrableDomain,
    attachCdp: attachTabCdp
  })
  ;(deps.registerTabHandlers ?? registerBrowserTabHandlers)({ service: tabs })
  const teardown = new BrowserProjectTeardown()
  teardown.onStage('closeViews', (projectRoot) => tabs.closeProject(projectRoot))
  teardown.attach(deps.projectSession)
  profiles.runPendingDeletes().catch((error: unknown) => {
    logger.warn('Browser pending deletes could not run', { error: redactedLogError(error)?.message ?? String(error) })
  })
  runtime = { profiles, teardown, tabs, appAddresses }
  return runtime
}

/**
 * Write every browser profile's cookies and storage to disk. Chromium commits
 * cookies on a timer, and the app ends with `app.exit`, so without this a
 * sign-in shortly before quitting would be lost (025-FR-015). Called from the
 * quit sequence's best-effort disposers; never rejects.
 */
export async function flushBrowserProfiles(): Promise<void> {
  if (runtime === null) return
  const sessions = (await runtime.profiles.openSessions()) as Session[]
  await Promise.allSettled(
    sessions.flatMap((ses) => [ses.cookies.flushStore(), Promise.resolve().then(() => ses.flushStorageData())])
  )
}

/** Close the browser tabs of a window that closed. Never throws (it runs in a window event). */
export function closeBrowserWindow(windowId: number): void {
  try {
    runtime?.tabs.closeWindow(windowId)
  } catch (error) {
    logger.warn('Browser teardown on window close failed', { windowId, error: redactedLogError(error)?.message ?? String(error) })
  }
}

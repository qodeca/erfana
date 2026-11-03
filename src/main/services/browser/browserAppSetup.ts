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
 * called where the window's previews are torn down. Each tab also gets the
 * popup policy, the leave-page prompt and the right-click menu (commits
 * 12e–g); popup windows close with the tab that opened them.
 */
import { homedir, tmpdir } from 'node:os'
import { is } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  safeStorage,
  session as electronSession,
  shell,
  webContents as electronWebContents,
  View,
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
import { BrowserTabService, type TabCdpLink, type TabInputSetup } from './BrowserTabService'
import { BrowserPages } from './page/BrowserPages'
import { registerBrowserTabPageHandlers } from '../../ipc/browserTab/page-handlers'
import { registerBrowserTabPopupHandlers } from '../../ipc/browserTab/popup-handlers'
import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import { NoticeEventSchema } from '../../../shared/ipc/browser-tab-schema'
import { BrowserCdpSession } from './cdp/BrowserCdpSession'
import { BrowserSite } from './permissions/BrowserSite'
import { installSiteRequestHooks } from './site/siteRequestHooks'
import { electronMacAppKeys } from './input/macAppRoles'
import { LocalFileServers } from './local/LocalFileServers'
import { disposeWithin } from '../../utils/disposeWithin'
import { openExternalSafeDetached } from '../../utils/openExternalSafe'
import { BrowserPopups } from './popups/BrowserPopups'
import { electronPopupWindows } from './popups/popupWindowElectron'
import { enablePageDialogEvents } from './dialogs/pageDialogs'
import { browserWebPreferencesFor } from './browserWebPreferences'
import { installBrowserPicks, registerPickSession } from './pick/pickAppSetup'
import type { BrowserPicks } from './pick/BrowserPicks'
import type { TargetTerminals } from './capture/BrowserTargetStatus'

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
  /** Registers the page-feature `browser-tab:*` handlers (commit 12h); a test seam. */
  readonly registerPageHandlers?: typeof registerBrowserTabPageHandlers
  /** Registers `browser-tab:contextAction` and the popup channels (commits 12e, 12g); a test seam. */
  readonly registerPopupHandlers?: typeof registerBrowserTabPopupHandlers
  /**
   * The terminals' output (`TerminalService`'s `data` and `exit` events), for
   * the empty tab's local addresses (025-FR-063); without it none are seen.
   */
  readonly terminalOutput?: TerminalOutputSource & Partial<TargetTerminals>
}

/** The part of `TerminalService` the empty tab's local-address scan listens to. */
export interface TerminalOutputSource {
  on(event: 'data', listener: (event: { terminalId: string; data: string; webContentsId: number }) => void): unknown
  on(event: 'exit', listener: (event: { terminalId: string }) => void): unknown
}

export interface BrowserRuntime {
  readonly profiles: BrowserProfileService
  readonly teardown: BrowserProjectTeardown
  readonly tabs: BrowserTabService
  /** Erfana's own addresses, refused to every tab (025-FR-005 rule 3). */
  readonly appAddresses: AppAddresses
  /** Site requests, certificates and sign-ins of every tab (commits 12a–d). */
  readonly site: BrowserSite
  /** Served local folders (commit 11, ADR 0012 option 4). */
  readonly localFiles: LocalFileServers
  /** Load errors, crash and hang notices, find, zoom, presets, Clear, Forget and history (commit 12h). */
  readonly pages: BrowserPages
  /** Page-opened tabs, popup windows, the popup blocker and pop-up exceptions (commit 12e). */
  readonly popups: BrowserPopups
  /** Pick mode, captures, the shell guard and capture expiry (commits 14–15). */
  readonly picks: BrowserPicks
}

/** How long quitting waits for the served local folders to close. */
const LOCAL_SERVERS_QUIT_MS = 2_000

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
function attachTabCdp(contents: WebContents): TabCdpLink | null {
  const cdp = new BrowserCdpSession({ kind: 'tab' })
  try {
    cdp.attach(contents)
  } catch (error) {
    logger.warn('Browser tab opened without a CDP session', { error: redactedLogError(error)?.message ?? String(error) })
    return null
  }
  // Native page dialogs then pause the hang probe (025-FR-058, Q6).
  void enablePageDialogEvents(cdp)
  registerPickSession(contents, cdp)
  return {
    setVisible: (visible) => cdp.hangProbe.setVisible(visible),
    detach: () => cdp.detach(),
    onHang: (listener) => cdp.on('hang', listener),
    waitHang: () => cdp.hangProbe.wait()
  }
}

/** The terminal service's guard surface (025-FR-061), when the terminals passed in carry it. */
function terminalTargets(terminals: (TerminalOutputSource & Partial<TargetTerminals>) | undefined): TargetTerminals | null {
  const { getOwner, getActivity } = terminals ?? {}
  if (getOwner === undefined || getActivity === undefined) return null
  return { getOwner: (id) => getOwner.call(terminals, id), getActivity: (id) => getActivity.call(terminals, id) }
}

/** A `localAddressSeen` notice to the window whose renderer is `webContentsId` (025-FR-063). */
function noticeLocalAddress(webContentsId: number, address: string): void {
  const target = electronWebContents.fromId(webContentsId)
  if (target === undefined || target.isDestroyed()) return
  const notice = NoticeEventSchema.safeParse({ tabId: null, kind: 'localAddressSeen', text: address })
  if (notice.success) target.send(BROWSER_TAB_EVENTS.notice, notice.data)
}

/**
 * Build a browser page view in `session`, registered before its constructor
 * returns; with `adopt`, around a page-opened `webContents` Chromium created
 * with the frozen settings (registered by `expectPageWindow`).
 */
function createBrowserView(session: Session, adopt?: WebContents): WebContentsView {
  return browserSessionRegistry.createView(
    session,
    () =>
      new WebContentsView(
        adopt === undefined ? { webPreferences: buildBrowserWebPreferences(session, process.platform) } : { webContents: adopt }
      ),
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
  const site = createBrowserSite()
  const profiles = new BrowserProfileService({
    projectSession: deps.projectSession,
    lockService: deps.lockService,
    fromPath: (path) => electronSession.fromPath(path),
    registerSession: (ses) => browserSessionRegistry.registerSession(ses),
    hardenSession: (ses) =>
      hardenBrowserSession(ses as Session, { platform: process.platform, chromeVersion: process.versions.chrome, site }),
    signer: lockHmacSigner,
    keyringCrypto: safeStorage,
    storageBackend: () => storageBackendFor(process.platform, () => safeStorage.getSelectedStorageBackend()),
    isTrackedByGit: (canonical) => isBrowserFolderTrackedByGit(canonical),
    markIgnoredBySync: (dir) => markIgnoredBySync(dir),
    homeDir: homedir(),
    platform: process.platform,
    clock: mainClock
  })
  const appAddresses = currentAppAddresses()
  const localFiles = new LocalFileServers({ now: () => mainClock.now(), appAddresses: () => appAddresses })
  const popups = createBrowserPopups(appAddresses, localFiles, (tabId) => tabs.list().find((t) => t.id === tabId)?.windowId ?? null)
  const pickSetup = installBrowserPicks({
    clock: mainClock,
    tabs: () => tabs,
    projectSession: deps.projectSession,
    terminals: () => terminalTargets(deps.terminalOutput)
  })
  const pages = new BrowserPages({
    clock: mainClock,
    signer: lockHmacSigner,
    homeDir: homedir(),
    site: {
      clearCertificates: (root) => site.clearCertificates(root),
      clearCredentials: (root) => site.clearCredentials(root),
      // **Site permissions, certificate exceptions and pop-up exceptions** (025-FR-023).
      clearPermissions: async (root) => {
        await Promise.all([site.clearPermissions(root), popups.clearExceptions(root)])
      }
    },
    openProfile: () => profiles.openForTab(),
    deleteBrowserData: (rel) => profiles.deleteBrowserData(rel),
    closeProject: (projectRoot) => tabs.closeProject(projectRoot),
    noticeToRenderer: noticeLocalAddress
  })
  const tabs = new BrowserTabService({
    openProfile: () => profiles.openForTab(),
    currentProject: () => deps.projectSession.current(),
    prepareSession: (ses) => {
      installAppRequestFilter(ses, () => appAddresses, localFiles)
      installSiteRequestHooks(ses, site)
    },
    createView: createBrowserView,
    expectDevTools: (ses) => browserSessionRegistry.expectDevTools(ses),
    appAddresses: () => appAddresses,
    resolveDomain: pinnedRegistrableDomain,
    attachCdp: attachTabCdp,
    site,
    input: tabInputSetup(),
    local: localFiles,
    pages: pickSetup.withPicks(pages),
    createClip: () => new View(),
    extras: {
      clock: mainClock,
      resolveDomain: pinnedRegistrableDomain,
      popups,
      menuActions: {
        openInSystemBrowser: (url) => openExternalSafeDetached(url),
        writeClipboardText: (text) => clipboard.writeText(text),
        pickAt: (tabId, at) => pickSetup.picks.pickAt(tabId, at)
      }
    }
  })
  ;(deps.registerTabHandlers ?? registerBrowserTabHandlers)({ service: tabs })
  ;(deps.registerPageHandlers ?? registerBrowserTabPageHandlers)({
    tabs,
    pages,
    currentProject: () => deps.projectSession.current()
  })
  ;(deps.registerPopupHandlers ?? registerBrowserTabPopupHandlers)({ tabs, popups, resolveDomain: pinnedRegistrableDomain })
  deps.terminalOutput?.on('data', (event) => pages.terminalOutput(event.webContentsId, event.terminalId, event.data))
  deps.terminalOutput?.on('exit', (event) => pages.terminalGone(event.terminalId))
  const teardown = new BrowserProjectTeardown()
  teardown.onStage('closeViews', (projectRoot) => tabs.closeProject(projectRoot))
  teardown.onStage('closeViews', (projectRoot) => localFiles.closeProject(projectRoot))
  teardown.onStage('closeViews', () => pages.projectChanged())
  teardown.attach(deps.projectSession)
  profiles.runPendingDeletes().catch((error: unknown) => {
    logger.warn('Browser pending deletes could not run', { error: redactedLogError(error)?.message ?? String(error) })
  })
  runtime = { profiles, teardown, tabs, appAddresses, site, localFiles, pages, popups, picks: pickSetup.picks }
  return runtime
}

/**
 * Page-opened tabs and popup windows (commit 12e): the popup blocker on the
 * app clock, pop-up exceptions signed per project, page-opened `webContents`
 * expected by the session registry and given the frozen settings.
 */
function createBrowserPopups(
  appAddresses: AppAddresses,
  localFiles: LocalFileServers,
  windowIdOf: (tabId: string) => number | null
): BrowserPopups {
  return new BrowserPopups({
    clock: mainClock,
    signer: lockHmacSigner,
    homeDir: homedir(),
    resolveDomain: pinnedRegistrableDomain,
    appAddresses: () => appAddresses,
    isLocalAddress: (url) => localFiles.isLocalAddress(url),
    expectPageWindow: (ses) => browserSessionRegistry.expectPageWindow(ses),
    isRegisteredView: (contents) => browserSessionRegistry.isRegisteredView(contents),
    childPreferences: () => ({ ...browserWebPreferencesFor(process.platform) }),
    windows: electronPopupWindows(windowIdOf)
  })
}

/** Key and mouse routing for every tab (commit 13): the platform, the app clock and the macOS app keys. */
function tabInputSetup(): TabInputSetup {
  return {
    platform: process.platform,
    clock: mainClock,
    macAppKeys: (host) =>
      electronMacAppKeys({
        app,
        sendActionToFirstResponder: (action) => Menu.sendActionToFirstResponder(action),
        window: () => BrowserWindow.fromId(host.id)
      })
  }
}

/**
 * The process-wide site hooks (commits 12a–d): permission prompts, screen
 * sharing, downloads, certificate errors and HTTP sign-in of every browser
 * session, routed to the owning tab. Saved sign-ins are encrypted with
 * `safeStorage`, and kept in memory only on Linux `basic_text`.
 * The screen source chooser joins with the UI (commit 18); until then screen
 * sharing is refused.
 */
function createBrowserSite(): BrowserSite {
  return new BrowserSite({
    clock: mainClock,
    signer: lockHmacSigner,
    homeDir: homedir(),
    credentialCrypto: safeStorage,
    storageBackend: () => storageBackendFor(process.platform, () => safeStorage.getSelectedStorageBackend()),
    resolveDomain: pinnedRegistrableDomain,
    fromFrame: (frame) => electronWebContents.fromFrame(frame),
    downloads: {
      downloadsDir: () => app.getPath('downloads'),
      stagingRoot: () => tmpdir(),
      showSaveDialog: async (parent, defaultPath) => {
        const options = { defaultPath }
        const result =
          parent instanceof BrowserWindow
            ? await dialog.showSaveDialog(parent, options)
            : await dialog.showSaveDialog(options)
        return result.canceled ? null : (result.filePath ?? null)
      },
      showItemInFolder: (path) => shell.showItemInFolder(path)
    }
  })
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

/**
 * The browser's quit step: flush every profile ({@link flushBrowserProfiles})
 * and close the served local folders, the latter bounded by `disposeWithin`
 * so a socket that will not close cannot hold the quit. Never rejects.
 */
export async function disposeBrowserForQuit(): Promise<void> {
  const localFiles = runtime?.localFiles
  await Promise.allSettled([
    flushBrowserProfiles(),
    localFiles === undefined
      ? Promise.resolve()
      : disposeWithin('browser local-file servers', () => localFiles.closeAll(), LOCAL_SERVERS_QUIT_MS)
  ])
}

/** Close the browser tabs of a window that closed. Never throws (it runs in a window event). */
export function closeBrowserWindow(windowId: number): void {
  try {
    runtime?.tabs.closeWindow(windowId)
  } catch (error) {
    logger.warn('Browser teardown on window close failed', { windowId, error: redactedLogError(error)?.message ?? String(error) })
  }
}

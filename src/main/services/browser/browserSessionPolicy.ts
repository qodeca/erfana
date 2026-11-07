// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deny-by-default hardening of a project's browser session (spec 025,
 * 025-FR-019, 025-FR-024, 025-NFR-001; solution design § 3.3 step 3; spec
 * changes S-3, S-4, S-19).
 *
 * {@link hardenBrowserSession} runs once per session, right after
 * `BrowserProfileService.openForTab` created it and before any page loads in
 * it. Electron's own defaults grant every permission request and pick the
 * first device a page asks for; this replaces each of those paths with a
 * refusal:
 *
 * - **Permissions** – one table, {@link BROWSER_PERMISSION_CLASSES}, keyed by
 *   every permission name Electron 44 can pass. The request and the check
 *   handler both answer from it; a name that is not in the table (a newer
 *   Electron) is denied. `allow` is limited to what 025-FR-019 allows without a
 *   prompt and without a notice. `ask` (a prompt in the strip) and
 *   `allowWithNotice` (fullscreen, pointer lock) go to the session's
 *   {@link SessionSiteHooks} – `permissions/BrowserSite.ts`, commit 12a –
 *   and are denied when the session was hardened without them.
 * - **Devices** – the device permission handler refuses every HID, serial and
 *   USB device; the HID, serial and USB choosers are cancelled before Electron
 *   can pick one. Bluetooth is per page (`select-bluetooth-device` is a
 *   `webContents` event): {@link hardenBrowserContents}. Bluetooth pairing needs
 *   no handler: with none set, Electron cancels it.
 * - **Screen sharing** – `getDisplayMedia` goes to the site hooks (a prompt,
 *   then the source chooser); with no hooks it answers with no stream.
 * - **Downloads** – go to the site hooks (`downloads/BrowserDownloads.ts`,
 *   commit 12b): ask first, save where the user chose; with no hooks every
 *   download is cancelled.
 * - **User agent** – a Chrome user agent for the bundled Chromium version, with
 *   no Electron or Erfana token (025-FR-024), for the tabs Erfana loads. The
 *   same identity with its client hints reaches every target – popups and
 *   workers included – through the CDP session (`site/browserUserAgent.ts`).
 * - **Spell check** – off on Linux, where there is no OS checker and Chromium
 *   would download dictionaries (S-4); on elsewhere.
 */
import type { DownloadItem, Session, Streams, WebContents, WebFrameMain } from 'electron'
import { logger } from '../LoggingService'
import { browserUserAgent } from './site/browserUserAgent'

export { browserUserAgent } from './site/browserUserAgent'

type PermissionRequestHandler = Exclude<Parameters<Session['setPermissionRequestHandler']>[0], null>

/** Every permission name Electron passes to a session's permission handlers. */
export type ElectronPermission = Parameters<PermissionRequestHandler>[1]

/**
 * What 025-FR-019 decides for a permission:
 * - `allow` – granted without a prompt or a notice;
 * - `allowWithNotice` – granted to a browser tab with an Erfana notice in the
 *   strip (fullscreen, pointer lock);
 * - `ask` – a prompt naming the origin, answered from saved decisions when
 *   there are any;
 * - `deny` – denied without a prompt.
 */
export type PermissionClass = 'allow' | 'allowWithNotice' | 'ask' | 'deny'

/**
 * Every Electron 44 permission name and its class. Typed as a full `Record`, so
 * an Electron upgrade that adds a name fails the typecheck until the name is
 * classed here; `browserSessionPolicy.test.ts` also reads the names from
 * Electron's own typings and fails when the two drift.
 */
export const BROWSER_PERMISSION_CLASSES: Readonly<Record<ElectronPermission, PermissionClass>> = Object.freeze({
  ar: 'deny',
  'automatic-fullscreen': 'deny',
  'background-fetch': 'deny',
  'background-sync': 'deny',
  'captured-surface-control': 'deny',
  'clipboard-read': 'ask',
  'clipboard-sanitized-write': 'allow',
  'deprecated-sync-clipboard-read': 'deny',
  'display-capture': 'ask',
  fileSystem: 'deny',
  fullscreen: 'allowWithNotice',
  geolocation: 'ask',
  'geolocation-approximate': 'ask',
  'hand-tracking': 'deny',
  hid: 'deny',
  'idle-detection': 'deny',
  // The Keyboard Lock API is denied by 025-FR-019.
  keyboardLock: 'deny',
  'local-fonts': 'deny',
  'local-network': 'deny',
  'local-network-access': 'deny',
  'loopback-network': 'deny',
  media: 'ask',
  mediaKeySystem: 'deny',
  midi: 'deny',
  midiSysex: 'deny',
  nfc: 'deny',
  // Denied in v1 (S-19).
  notifications: 'deny',
  // A page asking the OS to open another app (a custom scheme): never.
  openExternal: 'deny',
  'payment-handler': 'deny',
  'periodic-background-sync': 'deny',
  'persistent-storage': 'allow',
  pointerLock: 'allowWithNotice',
  'screen-wake-lock': 'deny',
  sensors: 'deny',
  serial: 'deny',
  'smart-card': 'deny',
  'speaker-selection': 'deny',
  'storage-access': 'deny',
  'system-wake-lock': 'deny',
  'top-level-storage-access': 'deny',
  usb: 'deny',
  vr: 'deny',
  'web-app-installation': 'deny',
  'web-printing': 'deny',
  'window-management': 'deny',
  unknown: 'deny'
})

/** The class of `permission`; a name the table does not know is `deny` (fail closed). */
export function permissionClass(permission: string): PermissionClass {
  return Object.hasOwn(BROWSER_PERMISSION_CLASSES, permission)
    ? BROWSER_PERMISSION_CLASSES[permission as ElectronPermission]
    : 'deny'
}

/** Whether `permission` is granted with no prompt, no notice and no tab: `allow` only. */
export function isPermissionGranted(permission: string): boolean {
  return permissionClass(permission) === 'allow'
}

/** The part of an Electron `Session` the hardening touches. */
export type HardenableSession = Pick<
  Session,
  | 'setPermissionRequestHandler'
  | 'setPermissionCheckHandler'
  | 'setDevicePermissionHandler'
  | 'setDisplayMediaRequestHandler'
  | 'setUserAgent'
  | 'setSpellCheckerEnabled'
  | 'on'
>

/**
 * Where a session's site requests are decided (`permissions/BrowserSite.ts`).
 * Each handler answers through its callback exactly once.
 */
export interface SessionSiteHooks {
  permissionRequest(
    contents: WebContents,
    permission: string,
    callback: (granted: boolean) => void,
    details: { mediaTypes?: ('video' | 'audio')[]; securityOrigin?: string; requestingUrl?: string }
  ): void
  permissionCheck(
    contents: WebContents | null,
    permission: string,
    requestingOrigin: string,
    details: { embeddingOrigin?: string; mediaType?: 'video' | 'audio' | 'unknown' }
  ): boolean
  displayMediaRequest(
    request: { frame: WebFrameMain | null; securityOrigin: string },
    callback: (streams: Streams | null) => void
  ): void
  willDownload(event: { preventDefault(): void }, item: DownloadItem, contents: WebContents): void
}

export interface HardenOptions {
  readonly platform: NodeJS.Platform
  /** `process.versions.chrome`. */
  readonly chromeVersion: string
  /** The site requests' handler; without it, `ask` and `allowWithNotice` are denied and downloads cancelled. */
  readonly site?: SessionSiteHooks
}

const hardened = new WeakSet<object>()

/** Log a refusal by name only: no origin, no URL (025-FR-042). */
function logDenied(permission: string, path: 'request' | 'check'): void {
  logger.debug('Browser permission denied', { permission, path })
}

function installPermissionHandlers(session: HardenableSession, site: SessionSiteHooks | undefined): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (site !== undefined) {
      site.permissionRequest(contents, permission, callback, details)
      return
    }
    const granted = isPermissionGranted(permission)
    if (!granted) logDenied(permission, 'request')
    callback(granted)
  })
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    site === undefined
      ? isPermissionGranted(permission)
      : site.permissionCheck(contents, permission, requestingOrigin, details)
  )
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler(
    (request, callback) => (site === undefined ? callback(null) : site.displayMediaRequest(request, callback)),
    { useSystemPicker: false }
  )
}

function installChooserRefusals(session: HardenableSession): void {
  // Electron picks the first device when a chooser event is not prevented.
  session.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  session.on('select-serial-port', (event, _ports, _contents, callback) => {
    event.preventDefault()
    callback('')
  })
  session.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
}

/**
 * Harden `session` once; later calls for the same session do nothing. Must run
 * before the session's first page loads.
 */
export function hardenBrowserSession(session: HardenableSession, options: HardenOptions): void {
  if (hardened.has(session)) return
  installPermissionHandlers(session, options.site)
  installChooserRefusals(session)
  const site = options.site
  session.on('will-download', (event, item, contents) => {
    if (site === undefined) event.preventDefault()
    else site.willDownload(event, item, contents)
  })
  session.setUserAgent(browserUserAgent(options.platform, options.chromeVersion))
  session.setSpellCheckerEnabled(options.platform !== 'linux')
  hardened.add(session)
}

/** The per-page part: the Bluetooth chooser is a `webContents` event. */
export function hardenBrowserContents(contents: {
  on(
    event: 'select-bluetooth-device',
    listener: (event: { preventDefault(): void }, devices: unknown[], callback: (deviceId: string) => void) => void
  ): unknown
}): void {
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault()
    callback('')
  })
}

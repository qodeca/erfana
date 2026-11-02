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
 * service, the project-switch teardown and the deletes left by the last run.
 */
import { homedir } from 'node:os'
import { safeStorage, session as electronSession, type App, type Session, type WebContents } from 'electron'
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
}

export interface BrowserRuntime {
  readonly profiles: BrowserProfileService
  readonly teardown: BrowserProjectTeardown
}

let runtime: BrowserRuntime | null = null

/** The browser runtime, once {@link installBrowserAfterReady} ran; for the tab service (commit 7). */
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
    signer: lockHmacSigner,
    storageBackend: () => storageBackendFor(process.platform, () => safeStorage.getSelectedStorageBackend()),
    isTrackedByGit: (canonical) => isBrowserFolderTrackedByGit(canonical),
    markIgnoredBySync: (dir) => markIgnoredBySync(dir),
    homeDir: homedir(),
    platform: process.platform,
    clock: mainClock
  })
  const teardown = new BrowserProjectTeardown()
  teardown.attach(deps.projectSession)
  profiles.runPendingDeletes().catch((error: unknown) => {
    logger.warn('Browser pending deletes could not run', { error: redactedLogError(error)?.message ?? String(error) })
  })
  runtime = { profiles, teardown }
  return runtime
}

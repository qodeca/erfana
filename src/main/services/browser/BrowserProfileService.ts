// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project's browser profile and session (spec 025, 025-FR-015, 025-FR-016,
 * 025-FR-018; ADR 0009; solution design § 3.1 and § 3.3 steps 1–2).
 *
 * {@link BrowserProfileService.openForTab} is what a new browser tab calls
 * first (commit 7). On the project's first tab in this run it:
 *
 * 1. resolves the project's canonical path and checks it is still the open
 *    project's real root;
 * 2. requires this process to hold the project lock – one browser session per
 *    project, in one process (ADR 0009 decision 4, S-24): a lock held by
 *    another Erfana process refuses the tab; a free lock is taken through
 *    `ProjectLockService`'s own rules;
 * 3. guards `.erfana`, `.erfana/browser` and writes `.gitignore` (exactly `*`)
 *    before anything else exists there (025-AC-016);
 * 4. finds or claims the project's folder under
 *    `<sessionData>/browser-profiles/` (`browserProfileFolders.ts`) and
 *    finishes a Forget a running session blocked there (Windows);
 * 5. checks an existing profile's marker and git tracking, and sets a
 *    distrusted profile aside – both halves, the project's `profile/` and
 *    the user-data `chromium/` (S3, S-12);
 * 6. guards `profile`, `profile/Erfana`, `captures`; writes a fresh marker;
 * 7. asks cloud sync to ignore the folder (S30, best effort);
 * 8. creates the session with `session.fromPath(<sessionData>/browser-profiles/<name>/chromium)`
 *    – the only place the macOS network-service sandbox lets Chromium write
 *    its cookie database (ADR 0009 decision 1) – and records it in the
 *    browser session registry;
 * 9. hardens it (`browserSessionPolicy.hardenBrowserSession`): deny-by-default
 *    permission, device, chooser, display-media and download handlers, the
 *    user agent and spell check – before the tab that asked can load a page.
 *
 * Every later tab re-runs steps 3 and 6 only (a deleted `.gitignore` is
 * written again before the page loads). The session is never destroyed while
 * the app runs (Electron cannot), so it is kept per canonical path.
 *
 * 10. checks the keyring (`browserKeyringState`, 025-FR-018): the canary and
 *    the recorded backend decide the notices of the project's first tab.
 *
 * Local files are served by loopback folder servers (ADR 0012 option 4), not
 * by an `erfana-local` handler on the session.
 */
import { join } from 'node:path'
import type { Clock } from '../../../shared/clock'
import type { IProjectLockService } from '../../interfaces/IProjectLockService'
import { isSamePath } from '../../utils/pathCompare'
import { redactPath } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import type { ProjectSession } from '../session/ProjectSession'
import {
  BrowserProfileError,
  canonicalProjectPath,
  checkExistingLevel,
  ensureBrowserFolder,
  ensureProfileTree
} from './browserProfileGuards'
import { verifyProfileMarker, writeProfileMarker, type PurposeSigner } from './browserProfileMarker'
import { deleteUnderBrowser, runPendingDeletes, setAsideStamp, setProfileAside, type DeleteOutcome } from './browserProfileDeletes'
import {
  clearProfileFolder,
  ensureChromiumDir,
  finishAllPendingClears,
  finishPendingClear,
  resolveProfileFolder,
  setChromiumAside,
  type FolderClearOutcome,
  type ProfileFolder
} from './browserProfileFolders'
import { BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME } from './browserProfilePaths'
import {
  NO_KEYRING_NOTICES,
  assessKeyring,
  dismissWeakProtectionNotice,
  type KeyringCrypto,
  type KeyringNotices
} from './browserKeyringState'

/** `safeStorage`'s backend: macOS and Windows have one each; Linux reports its own. */
export type StorageBackend =
  | 'keychain'
  | 'dpapi'
  | 'basic_text'
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'unknown'

/** The backend in use: fixed per platform, read from `safeStorage` on Linux. */
export function storageBackendFor(
  platform: NodeJS.Platform,
  linuxBackend: () => Exclude<StorageBackend, 'keychain' | 'dpapi'>
): StorageBackend {
  if (platform === 'darwin') return 'keychain'
  if (platform === 'win32') return 'dpapi'
  if (platform === 'linux') return linuxBackend()
  return 'unknown'
}

/**
 * Where Erfana's own trust decisions for this profile live (ADR 0009 decisions
 * 6 and 7, S-26): signed files, or – with no signing key (Linux `basic_text`)
 * – memory only, for this run.
 */
export type TrustPersistence = 'signed' | 'memory'

/** The part of an Electron `Session` this service needs. */
export type ProfileSession = object

export interface BrowserProfile {
  /** The project's canonical path (native real path). */
  readonly projectRoot: string
  readonly session: ProfileSession
  readonly backend: StorageBackend
  readonly trust: TrustPersistence
  /** Name of the folder a distrusted profile was moved to this run, for a notice; null otherwise. */
  readonly setAside: string | null
  /** The keyring notices found when this run created the session (025-FR-018). */
  readonly keyring: KeyringNotices
  /** The project's folder under `<sessionData>/browser-profiles/`, which holds the session's files. */
  readonly folder: ProfileFolder
}

export interface BrowserProfileServiceDeps {
  readonly projectSession: Pick<ProjectSession, 'current'>
  readonly lockService: Pick<IProjectLockService, 'checkLock' | 'acquireLock'>
  /** `session.fromPath` in production. */
  readonly fromPath: (path: string) => ProfileSession
  /** Records the session as a browser session (`browserSessionRegistry`). */
  readonly registerSession: (session: ProfileSession) => void
  /** Deny-by-default session policy (`browserSessionPolicy.hardenBrowserSession`); runs before any page loads. */
  readonly hardenSession: (session: ProfileSession) => void
  readonly signer: PurposeSigner
  /** `safeStorage`'s string encryption, for the keyring canary. */
  readonly keyringCrypto: KeyringCrypto
  readonly storageBackend: () => StorageBackend
  readonly isTrackedByGit: (canonical: string) => Promise<boolean>
  readonly markIgnoredBySync: (browserDir: string) => Promise<void>
  readonly homeDir: string
  /** `app.getPath('sessionData')`: the parent of `browser-profiles/`. */
  readonly dataDir: string
  readonly platform: NodeJS.Platform
  readonly clock: Pick<Clock, 'now'>
}

export class BrowserProfileService {
  /** Keyed by canonical path; a rejected open is removed so the next tab retries. */
  private readonly profiles = new Map<string, Promise<BrowserProfile>>()
  /** Canonical paths whose keyring notices a tab has already taken this run. */
  private readonly keyringNoticesTaken = new Set<string>()
  /**
   * Canonical paths whose whole browser folder Forget deleted this run. The
   * session stays (Electron cannot destroy one), so the next tab re-creates
   * the folder and writes a fresh marker – else the next start would find a
   * profile without a marker and set it aside as untrusted.
   */
  private readonly forgotten = new Set<string>()

  constructor(private readonly deps: BrowserProfileServiceDeps) {}

  /**
   * Prepare the open project's profile for a new browser tab and return its
   * session, creating it on the project's first tab.
   *
   * @throws BrowserProfileError – the tab must not open; the toast names
   *   `relPath` and the code says why
   */
  async openForTab(): Promise<BrowserProfile> {
    const canonical = await this.openProjectCanonical()
    const existing = this.profiles.get(canonical)
    if (existing !== undefined) {
      const profile = await existing
      await ensureBrowserFolder(canonical)
      await ensureProfileTree(canonical)
      if (this.forgotten.delete(canonical)) {
        await ensureChromiumDir(profile.folder)
        await writeProfileMarker(canonical, this.deps.homeDir, this.deps.signer, new Date(this.deps.clock.now()).toISOString())
      }
      return profile
    }
    const created = this.createProfile(canonical)
    this.profiles.set(canonical, created)
    try {
      return await created
    } catch (error) {
      this.profiles.delete(canonical)
      throw error
    }
  }

  /**
   * The keyring notices for the open project's first tab of this run, once:
   * every later call returns none (025-FR-018 – the weak-protection notice
   * shows on the first tab after each start until dismissed; the reset notice
   * shows once). Returns none while the project's profile is not open.
   */
  async takeKeyringNotices(): Promise<KeyringNotices> {
    const canonical = await this.openProjectCanonical()
    const profile = this.profiles.get(canonical)
    if (profile === undefined || this.keyringNoticesTaken.has(canonical)) return NO_KEYRING_NOTICES
    this.keyringNoticesTaken.add(canonical)
    return (await profile).keyring
  }

  /**
   * The user dismissed the weak-protection notice: it does not show again in
   * the open project.
   *
   * @throws BrowserProfileError
   */
  async dismissWeakProtectionNotice(): Promise<void> {
    await dismissWeakProtectionNotice(await this.openProjectCanonical())
  }

  /** The sessions of every profile opened in this run (a failed open is left out). */
  async openSessions(): Promise<ProfileSession[]> {
    const settled = await Promise.allSettled(this.profiles.values())
    return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value.session] : []))
  }

  /**
   * Delete `.erfana/browser/<relBelowBrowser>` of the open project after the
   * per-level re-guard; `[]` is Forget: the whole folder, and the Chromium
   * data in the project's user-data folder (all but its `project.json`). On
   * Windows a delete the running session blocks runs at the next start.
   *
   * Forget tries both halves even when one fails, then throws the first error.
   *
   * @throws BrowserProfileError
   */
  async deleteBrowserData(relBelowBrowser: readonly string[]): Promise<DeleteOutcome> {
    const canonical = await this.openProjectCanonical()
    if (relBelowBrowser.length > 0) return deleteUnderBrowser(canonical, relBelowBrowser, this.deleteDeps())
    const halves = await Promise.allSettled([
      deleteUnderBrowser(canonical, [], this.deleteDeps()),
      this.clearUserDataHalf(canonical)
    ])
    const failed = halves.find((half) => half.status === 'rejected')
    if (failed !== undefined) throw failed.reason
    const outcomes = halves.map((half) => (half as PromiseFulfilledResult<DeleteOutcome | FolderClearOutcome>).value)
    const outcome = combineForgetOutcomes(outcomes)
    if (outcome !== 'absent' && this.profiles.has(canonical)) this.forgotten.add(canonical)
    return outcome
  }

  /**
   * The Chromium half of Forget. Forget opens the profile first, so the folder
   * is known; with no profile opened this run there is no session and nothing
   * of this run to clear.
   */
  private async clearUserDataHalf(canonical: string): Promise<FolderClearOutcome> {
    const profile = this.profiles.get(canonical)
    return profile === undefined ? 'absent' : clearProfileFolder((await profile).folder, this.deps.platform)
  }

  /**
   * Run deletes stored by earlier runs – the project folders' signed entries
   * and the user-data folders' `forget-pending` – at start, after the app is
   * ready.
   */
  async runPendingDeletes(): Promise<void> {
    await finishAllPendingClears(this.deps.dataDir, this.deps.platform)
    await runPendingDeletes(this.deleteDeps())
  }

  private deleteDeps(): { homeDir: string; platform: NodeJS.Platform; signer: PurposeSigner } {
    return { homeDir: this.deps.homeDir, platform: this.deps.platform, signer: this.deps.signer }
  }

  private async openProjectCanonical(): Promise<string> {
    const snapshot = this.deps.projectSession.current()
    if (snapshot === null) throw new BrowserProfileError('no-project', '', 'No project is open')
    const canonical = await canonicalProjectPath(snapshot.root)
    if (!isSamePath(canonical, snapshot.realRoot, snapshot.caseSensitive)) {
      throw new BrowserProfileError('no-project', '', 'The project folder moved since it was opened')
    }
    return canonical
  }

  /** One process per project's browser (ADR 0009 decision 4, S-24). */
  private async requireProjectLock(canonical: string): Promise<void> {
    const status = await this.deps.lockService.checkLock(canonical)
    if (status.status === 'locked_by_self') return
    if (status.status === 'locked_by_other') {
      throw new BrowserProfileError(
        'locked-elsewhere',
        '',
        `Another Erfana window (process ${status.holderPid}) has this project open`
      )
    }
    if (status.status === 'unlocked') {
      const acquired = await this.deps.lockService.acquireLock(canonical)
      if (acquired.status === 'acquired') return
      if (acquired.status === 'already_locked') {
        throw new BrowserProfileError(
          'locked-elsewhere',
          '',
          `Another Erfana window (process ${acquired.holderPid}) has this project open`
        )
      }
    }
    throw new BrowserProfileError('locked-elsewhere', '', 'The project lock could not be confirmed')
  }

  private async createProfile(canonical: string): Promise<BrowserProfile> {
    await this.requireProjectLock(canonical)
    await ensureBrowserFolder(canonical)
    const folder = await resolveProfileFolder(this.deps.dataDir, canonical, this.deps.platform)
    await finishPendingClear(folder, this.deps.platform)
    const setAside = await this.setAsideIfDistrusted(canonical, folder)
    const profileExisted = setAside === null && (await this.profileExists(canonical))
    await ensureProfileTree(canonical)
    if (!profileExisted) {
      await writeProfileMarker(canonical, this.deps.homeDir, this.deps.signer, new Date(this.deps.clock.now()).toISOString())
    }
    await this.deps.markIgnoredBySync(join(canonical, ...BROWSER_DIR_SEGMENTS))
    await ensureChromiumDir(folder)
    const session = this.deps.fromPath(folder.chromiumDir)
    this.deps.registerSession(session)
    this.deps.hardenSession(session)
    const backend = this.deps.storageBackend()
    const keyring = await assessKeyring(canonical, backend, this.deps.keyringCrypto)
    const trust: TrustPersistence = this.deps.signer.hasKey() ? 'signed' : 'memory'
    logger.info('Browser profile ready', { project: redactPath(canonical), backend, trust, setAside: setAside !== null })
    return { projectRoot: canonical, session, backend, trust, setAside, keyring, folder }
  }

  private profileExists(canonical: string): Promise<boolean> {
    return checkExistingLevel(canonical, [...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME], 'dir')
  }

  /**
   * S3: move a profile Erfana did not create here, or that git tracks, out of
   * the way – the project half and, under the same time, the Chromium half.
   */
  private async setAsideIfDistrusted(canonical: string, folder: ProfileFolder): Promise<string | null> {
    if (!(await this.profileExists(canonical))) return null
    const tracked = await this.deps.isTrackedByGit(canonical)
    const verdict = tracked
      ? ({ trusted: false, reason: 'git-tracked' } as const)
      : await verifyProfileMarker(canonical, this.deps.homeDir, this.deps.signer)
    if (verdict.trusted) return null
    const now = this.deps.clock.now()
    const name = await setProfileAside(canonical, now)
    await setChromiumAside(folder, setAsideStamp(now))
    logger.warn('Browser profile set aside', { project: redactPath(canonical), reason: verdict.reason })
    return name
  }
}

/** Forget's two halves as one outcome: pending wins, then deleted; absent only when both were. */
export function combineForgetOutcomes(outcomes: readonly (DeleteOutcome | FolderClearOutcome)[]): DeleteOutcome {
  if (outcomes.includes('pending')) return 'pending'
  return outcomes.includes('deleted') ? 'deleted' : 'absent'
}

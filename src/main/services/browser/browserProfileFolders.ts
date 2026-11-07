// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Each project's Chromium profile, under Erfana's own data folder (spec 025,
 * 025-FR-015; ADR 0009 decision 1 as amended 2026-11-03).
 *
 * On macOS Chromium always runs the network service in its sandbox, and
 * Electron lets that sandbox write only below `app.getPath('sessionData')`.
 * A `session.fromPath()` profile anywhere else never gets its cookie
 * database, HTTP cache or network state onto disk, so every sign-in is lost
 * at quit. The Chromium half of a project's profile therefore lives at
 *
 *     <sessionData>/browser-profiles/<name>/
 *       project.json                    which project this folder belongs to
 *       chromium/                       the session.fromPath() folder
 *       chromium.untrusted-<UTC time>/  set aside with the project half (S-12)
 *       forget-pending                  Windows: Forget finishes at the next start
 *
 * Erfana's own signed files stay in `<project>/.erfana/browser/profile/Erfana/`.
 *
 * **Folder name** – the rule of Claude Code's `~/.claude/projects/` folders:
 * the canonical project path with every UTF-16 code unit that is not an ASCII
 * letter or digit replaced by `-` (`/Users/x/.claude` → `-Users-x--claude`,
 * `C:\Users\x\proj` → `C--Users-x-proj`). Past {@link NAME_PREFIX_MAX} the
 * name is cut there and `-<first 8 hex of the path's SHA-256>` is appended.
 *
 * **Collisions** – the rule is lossy (`/a/b-c` and `/a-b/c` share a name), so
 * `project.json` records the canonical path, and a folder is reused only when
 * it names this exact path. Otherwise the next of `<name>-2`, `<name>-3`, …
 * is tried, up to {@link MAX_FOLDER_CANDIDATES}; a folder that names another
 * path, has no readable `project.json`, or is a link or a file is never used.
 * Every candidate is looked at before a new one is claimed, so a project
 * finds its own `<name>-2` even after `<name>` was removed.
 *
 * Every level is checked with the project folder's guards
 * (`browserProfileGuards.ts`: no links, exact real path, one level created at
 * a time, exclusive no-follow file creates), rooted at the canonical
 * `sessionData` folder.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, realpath, rename, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { normaliseResolved } from '../../utils/pathCompare'
import { logger } from '../LoggingService'
import {
  BrowserProfileError,
  checkExistingLevel,
  createFileExclusive,
  ensureFolderLevel,
  readFileNoFollow
} from './browserProfileGuards'

export const PROFILES_DIR_NAME = 'browser-profiles'
export const PROFILE_IDENTITY_FILE = 'project.json'
export const CHROMIUM_DIR_NAME = 'chromium'
/** Prefix of a set-aside Chromium folder: `chromium.untrusted-<UTC time>`. */
export const UNTRUSTED_CHROMIUM_PREFIX = `${CHROMIUM_DIR_NAME}.untrusted-`
/** Present while a Windows Forget waits for the next open of the project. */
export const FORGET_PENDING_FILE = 'forget-pending'

/**
 * Longest readable part of a folder name. Claude Code cuts at 200; Erfana cuts
 * shorter so the full name (plus hash and `-NN`) fits Linux eCryptfs's
 * 143-byte names, and – on Windows – so Chromium's deepest files stay under
 * `MAX_PATH` (260) below `%APPDATA%\erfana\browser-profiles\<name>\chromium\`.
 */
export const NAME_PREFIX_MAX = Object.freeze({ posix: 128, win32: 40 })
/** `<name>`, `<name>-2`, … `<name>-100`. */
export const MAX_FOLDER_CANDIDATES = 100
const HASH_HEX_LENGTH = 8
const IDENTITY_VERSION = 1
const IDENTITY_MAX_BYTES = 16 * 1024
/** Error codes that mean "held open by a running session" on Windows. */
const BUSY_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])
const MAX_SET_ASIDE_ATTEMPTS = 10

const IdentitySchema = z.object({ version: z.literal(IDENTITY_VERSION), projectPath: z.string().min(1) }).strict()

/** One project's folder under `<sessionData>/browser-profiles/`. */
export interface ProfileFolder {
  /** The canonical `sessionData` folder every guard is rooted at. */
  readonly dataRoot: string
  /** The folder's name, `<name>` or `<name>-N`. */
  readonly name: string
  /** `<dataRoot>/browser-profiles/<name>/chromium`: what `session.fromPath` gets. */
  readonly chromiumDir: string
}

export type FolderClearOutcome = 'deleted' | 'absent' | 'pending'

const errnoCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code

/** The folder name of `canonical` before any collision suffix. */
export function profileFolderBaseName(canonical: string, platform: NodeJS.Platform): string {
  const folded = canonical.replace(/[^A-Za-z0-9]/g, '-')
  const max = platform === 'win32' ? NAME_PREFIX_MAX.win32 : NAME_PREFIX_MAX.posix
  if (folded.length <= max) return folded
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, HASH_HEX_LENGTH)
  return `${folded.slice(0, max)}-${hash}`
}

/** The `n`th candidate name (1-based): `<base>`, then `<base>-2`, … */
export function candidateFolderName(base: string, n: number): string {
  return n === 1 ? base : `${base}-${n}`
}

const folderSegments = (name: string, ...below: string[]): string[] => [PROFILES_DIR_NAME, name, ...below]

function folderOf(dataRoot: string, name: string): ProfileFolder {
  return { dataRoot, name, chromiumDir: join(dataRoot, ...folderSegments(name, CHROMIUM_DIR_NAME)) }
}

/** `sessionData`, created if needed and canonical, with `browser-profiles` guarded below it. */
async function profilesRoot(dataDir: string): Promise<string> {
  let dataRoot: string
  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    dataRoot = normaliseResolved(await realpath(dataDir))
  } catch (error) {
    throw new BrowserProfileError('write-failed', PROFILES_DIR_NAME, `Erfana's data folder cannot be used (${errnoCode(error) ?? 'unknown'})`, {
      cause: error
    })
  }
  await ensureFolderLevel(dataRoot, [PROFILES_DIR_NAME])
  return dataRoot
}

type CandidateState = 'ours' | 'absent' | 'taken'

/** Whether candidate `name` belongs to `canonical`; anything unusable counts as taken. */
async function candidateState(dataRoot: string, name: string, canonical: string): Promise<CandidateState> {
  try {
    if (!(await checkExistingLevel(dataRoot, folderSegments(name), 'dir'))) return 'absent'
    const text = await readFileNoFollow(dataRoot, folderSegments(name, PROFILE_IDENTITY_FILE), IDENTITY_MAX_BYTES)
    const parsed = text === null ? null : IdentitySchema.safeParse(JSON.parse(text))
    return parsed?.success === true && parsed.data.projectPath === canonical ? 'ours' : 'taken'
  } catch (error) {
    logger.warn('Browser profile folder: a candidate is not usable and was skipped', {
      reason: error instanceof BrowserProfileError ? error.code : (errnoCode(error) ?? 'unreadable')
    })
    return 'taken'
  }
}

/** Claim `name` for `canonical`: create the folder (never an existing one), then its `project.json`. */
async function claim(dataRoot: string, name: string, canonical: string): Promise<boolean> {
  try {
    await mkdir(join(dataRoot, ...folderSegments(name)), { mode: 0o700 })
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') return false
    throw new BrowserProfileError('write-failed', folderSegments(name).join('/'), `Creating the folder failed (${errnoCode(error) ?? 'unknown'})`, {
      cause: error
    })
  }
  const identity = JSON.stringify({ version: IDENTITY_VERSION, projectPath: canonical })
  await createFileExclusive(dataRoot, folderSegments(name, PROFILE_IDENTITY_FILE), identity)
  return true
}

/**
 * Find the folder of `canonical` under `<dataDir>/browser-profiles/`, or claim
 * the first free candidate for it. The caller holds the project lock, so the
 * only race is with another project claiming the same name; the loser moves on.
 *
 * @throws BrowserProfileError when the data folder cannot be used, a level is
 *   a link, or every candidate is taken
 */
export async function resolveProfileFolder(
  dataDir: string,
  canonical: string,
  platform: NodeJS.Platform
): Promise<ProfileFolder> {
  const dataRoot = await profilesRoot(dataDir)
  const base = profileFolderBaseName(canonical, platform)
  // Folded: on a case-insensitive volume `-a-Proj` and `-a-proj` are one folder
  const present = new Set((await readdir(join(dataRoot, PROFILES_DIR_NAME))).map((n) => n.toLowerCase()))
  const free: string[] = []
  for (let n = 1; n <= MAX_FOLDER_CANDIDATES; n++) {
    const name = candidateFolderName(base, n)
    const state = present.has(name.toLowerCase()) ? await candidateState(dataRoot, name, canonical) : 'absent'
    if (state === 'ours') return folderOf(dataRoot, name)
    if (state === 'absent') free.push(name)
  }
  for (const name of free) {
    if (await claim(dataRoot, name, canonical)) return folderOf(dataRoot, name)
    if ((await candidateState(dataRoot, name, canonical)) === 'ours') return folderOf(dataRoot, name)
  }
  throw new BrowserProfileError('write-failed', folderSegments(base).join('/'), 'No free browser profile folder name is left')
}

/**
 * Ensure `chromium/` exists, guarded (a link there refuses the tab).
 *
 * @throws BrowserProfileError naming the level
 */
export async function ensureChromiumDir(folder: ProfileFolder): Promise<void> {
  await ensureFolderLevel(folder.dataRoot, folderSegments(folder.name))
  await ensureFolderLevel(folder.dataRoot, folderSegments(folder.name, CHROMIUM_DIR_NAME))
}

/**
 * Rename `chromium/` to `chromium.untrusted-<stamp>` when the project half of
 * the profile was set aside (S-12), so none of its service workers, cache or
 * storage runs. Before the session exists.
 *
 * @param stamp the set-aside time, as in the project folder's own name
 * @returns the new name, or null when there was no Chromium folder
 * @throws BrowserProfileError('write-failed') when the rename fails
 */
export async function setChromiumAside(folder: ProfileFolder, stamp: string): Promise<string | null> {
  const source = folderSegments(folder.name, CHROMIUM_DIR_NAME)
  if (!(await checkExistingLevel(folder.dataRoot, source, 'dir'))) return null
  for (let attempt = 0; attempt < MAX_SET_ASIDE_ATTEMPTS; attempt++) {
    const name = `${UNTRUSTED_CHROMIUM_PREFIX}${stamp}${attempt === 0 ? '' : `-${attempt}`}`
    if (await checkExistingLevel(folder.dataRoot, folderSegments(folder.name, name), 'any')) continue
    try {
      await rename(join(folder.dataRoot, ...source), join(folder.dataRoot, ...folderSegments(folder.name, name)))
      return name
    } catch (error) {
      throw new BrowserProfileError('write-failed', source.join('/'), `Setting the profile aside failed (${errnoCode(error) ?? 'unknown'})`, {
        cause: error
      })
    }
  }
  throw new BrowserProfileError('write-failed', source.join('/'), 'Setting the profile aside failed (no free name)')
}

/**
 * Forget: delete every entry of the folder except `project.json`, so the name
 * stays this project's. On Windows an entry the running session holds open
 * is left, and `forget-pending` makes the next open of the project finish the
 * job before its session exists – at the next start
 * ({@link finishAllPendingClears}) or, failing that, the project's next open
 * ({@link finishPendingClear}).
 *
 * @throws BrowserProfileError('delete-failed') naming the first entry that
 *   could not be deleted; ('link') when the folder itself is a link
 */
export async function clearProfileFolder(folder: ProfileFolder, platform: NodeJS.Platform): Promise<FolderClearOutcome> {
  if (!(await checkExistingLevel(folder.dataRoot, folderSegments(folder.name), 'dir'))) return 'absent'
  const dir = join(folder.dataRoot, ...folderSegments(folder.name))
  const entries = (await readdir(dir)).filter((n) => n !== PROFILE_IDENTITY_FILE && n !== FORGET_PENDING_FILE)
  let pending = false
  let failure: BrowserProfileError | null = null
  for (const entry of entries) {
    try {
      // `rm` removes a link itself, never what it points to
      await rm(join(dir, entry), { recursive: true, force: false, maxRetries: 0 })
    } catch (error) {
      const code = errnoCode(error)
      if (platform === 'win32' && code !== undefined && BUSY_CODES.has(code)) {
        pending = true
        continue
      }
      failure ??= new BrowserProfileError('delete-failed', folderSegments(folder.name, entry).join('/'), `Deleting failed (${code ?? 'unknown'})`, {
        cause: error
      })
    }
  }
  if (failure !== null) throw failure
  if (pending) {
    await createFileExclusive(folder.dataRoot, folderSegments(folder.name, FORGET_PENDING_FILE), '').catch((error: unknown) => {
      if (errnoCode(error instanceof BrowserProfileError ? error.cause : error) !== 'EEXIST') throw error
    })
    return 'pending'
  }
  return entries.length > 0 ? 'deleted' : 'absent'
}

/**
 * Finish a Forget a running session blocked (Windows), before this run's
 * session for the project exists.
 *
 * @throws BrowserProfileError('delete-failed') when it still cannot finish –
 *   the tab must not open on data the user asked to forget
 */
export async function finishPendingClear(folder: ProfileFolder, platform: NodeJS.Platform): Promise<void> {
  const marker = folderSegments(folder.name, FORGET_PENDING_FILE)
  if (!(await checkExistingLevel(folder.dataRoot, marker, 'file'))) return
  if ((await clearProfileFolder(folder, platform)) === 'pending') {
    throw new BrowserProfileError('delete-failed', marker.join('/'), 'The forgotten browser data is still in use')
  }
  await unlink(join(folder.dataRoot, ...marker))
  logger.info('Browser profile: a pending Forget finished')
}

/**
 * At start: finish every Forget a running session blocked in an earlier run
 * (Windows), as the Forget toast promises. A folder that still cannot be
 * cleared is logged and left for its project's next open, which refuses the
 * tab until it is done. Never rejects.
 */
export async function finishAllPendingClears(dataDir: string, platform: NodeJS.Platform): Promise<void> {
  try {
    const dataRoot = await profilesRoot(dataDir)
    for (const name of await readdir(join(dataRoot, PROFILES_DIR_NAME))) {
      await finishPendingClear(folderOf(dataRoot, name), platform).catch((error: unknown) => {
        logger.warn('Browser profile: a pending Forget could not finish at start', {
          code: error instanceof BrowserProfileError ? error.code : (errnoCode(error) ?? 'unknown')
        })
      })
    }
  } catch (error) {
    logger.warn('Browser profile: the pending Forgets could not be read at start', {
      code: error instanceof BrowserProfileError ? error.code : (errnoCode(error) ?? 'unknown')
    })
  }
}

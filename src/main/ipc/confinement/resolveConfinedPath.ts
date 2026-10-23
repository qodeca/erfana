// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * resolveConfinedPath - the one check a `file:*` path argument passes.
 *
 * A renderer-supplied path is a string. Comparing strings is not enough to
 * know where it lands: `..` segments, symlinks, junctions, drive aliases and
 * letter case all change the answer. This module resolves the path against the
 * open project's canonical root (cached on the session) and returns both the
 * path as the caller wrote it (`requested`, what goes back to the renderer) and
 * the canonical one the handler should act on (`real`).
 *
 * Pure: the file system and the `path` flavour are injected, so the Windows
 * rows run on every host with fakes built from recorded Windows output.
 *
 * Modes (see {@link PathPolicy}):
 * - `project`        - the nearest existing ancestor of the whole path is
 *                      canonicalised and must lie inside the root; links are
 *                      followed, so a link that leaves the project is refused
 * - `project-entry`  - the same walk on the parent folder; the last segment is
 *                      kept literal, so a link inside the project can be
 *                      deleted or renamed and nothing outside is touched
 * - `external`       - form checks only, optionally refusing a path that looks
 *                      like it is in the project but resolves out of it
 *
 * Every refusal happens before the caller's own first `stat`, and an outside
 * path gives the same answer whether or not it exists.
 */
import nodePath from 'path'
import { lstat, realpath, stat } from 'fs/promises'
import type { ProjectSessionSnapshot } from '../../services/session/ProjectSession'
import { validateFilename } from '../../utils/validateFilename'
import {
  isInsideRoot,
  isSamePath,
  normaliseResolved,
  type PathFlavour
} from '../../utils/pathCompare'
import { ConfinementError, PROJECT_FOLDER_GONE_MESSAGE } from './ConfinementError'

/** Longest path accepted, matching the Windows extended-length limit. */
export { isInsideRoot, isSamePath, normaliseResolved }

export const MAX_PATH_CHARS = 32_767

export type PathPolicy =
  | {
      mode: 'project'
      mustExist?: boolean
      kind?: 'file' | 'directory'
      allowRoot?: boolean
    }
  | { mode: 'project-entry'; mustExist?: boolean }
  | { mode: 'external'; check?: 'none' | 'escape' }

export interface ConfinementStats {
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface ConfinementFs {
  lstat(target: string): Promise<ConfinementStats>
  stat(target: string): Promise<ConfinementStats>
  /** Must be the native resolver (`fs.promises.realpath`, `realpathSync.native`) */
  realpath(target: string): Promise<string>
}

export interface ConfinementDeps extends PathFlavour {
  fs: ConfinementFs
}

/** The part of the session snapshot the check reads. */
export type ConfinementSession = Pick<
  ProjectSessionSnapshot,
  'root' | 'realRoot' | 'caseSensitive' | 'ownerWebContentsId'
>

export interface ConfinementContext {
  session: ConfinementSession | null
  /** `webContents.id` of the caller; checked against the session's owner */
  senderId?: number | null
}

export interface ResolvedPath {
  /** `path.resolve(input)` - what the handler returns to the renderer */
  requested: string
  /** The canonical path the handler acts on */
  real: string
  /** Whether the whole path existed when it was checked (not probed for `external`) */
  existed: boolean
  /** Segments below the nearest existing ancestor; empty when the path exists */
  tail: readonly string[]
}

export const defaultConfinementDeps: ConfinementDeps = {
  // Lazy, so a test that mocks `fs/promises` only fails when a check reaches the disk
  fs: {
    lstat: (target) => lstat(target),
    stat: (target) => stat(target),
    realpath: (target) => realpath(target)
  },
  path: nodePath,
  platform: process.platform
}

const WIN_DEVICE_PREFIX = /^[\\/]{2}[?.](?:[\\/]|$)|^[\\/]\?\?(?:[\\/]|$)/
const WIN_DRIVE_ROOT = /^[A-Za-z]:[\\/]/
const WIN_UNC_ROOT = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/
const PATH_SEPARATORS = /[\\/]+/
/** Reserved device basenames; the superscript digits reserve COM and LPT too. */
const WIN_DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/i

const invalid = (): ConfinementError => new ConfinementError('INVALID_PATH')

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

/** Steps 1 and 2: the shape of the string, before the file system is asked anything. */
function checkForm(input: unknown, deps: ConfinementDeps): string {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.length > MAX_PATH_CHARS ||
    input.includes('\0')
  ) {
    throw invalid()
  }
  if (!deps.path.isAbsolute(input)) throw invalid()
  if (deps.platform !== 'win32') return input

  // Device and namespace prefixes name something other than a drive path
  if (WIN_DEVICE_PREFIX.test(input)) throw invalid()
  // `C:foo` is drive-relative; `\foo` has no drive. Only a drive or a UNC share is a root
  const drive = WIN_DRIVE_ROOT.test(input)
  if (!drive && !WIN_UNC_ROOT.test(input)) throw invalid()

  const rest = drive
    ? input.slice(2)
    : input.split(PATH_SEPARATORS).filter(Boolean).slice(2).join('\\')
  for (const segment of rest.split(PATH_SEPARATORS)) {
    if (segment === '' || segment === '.' || segment === '..') continue
    // `:` opens an alternate data stream; a trailing dot or space is trimmed by Win32,
    // so the lexical path and the one that gets opened would differ
    if (segment.includes(':') || segment.endsWith('.') || segment.endsWith(' ')) throw invalid()
    // `CON`, `NUL.txt`, `com1`, `COM¹` open a device, not a file, in any folder and
    // for every mode - a read or a delete reaches the device just as a create does
    if (WIN_DEVICE_NAME.test(segment.split('.')[0].replace(/ +$/, ''))) throw invalid()
  }
  return input
}

interface Walk {
  realProbe: string
  tail: string[]
  /** `lstat` of the nearest existing ancestor; null on the fast path, which does not need it */
  probeStats: ConfinementStats | null
}

/**
 * Step 5 and 6: climb to the nearest existing ancestor and canonicalise it.
 *
 * With `expectExists` the path is canonicalised first: when that succeeds the
 * path exists, there is nothing to climb, and the `lstat` the climb starts with
 * is not made (one call instead of two per check, each a round trip on a network
 * volume). When it fails for any reason the full climb runs and decides the
 * outcome exactly as before, so no refusal depends on the shortcut.
 */
async function walkToExistingAncestor(
  start: string,
  deps: ConfinementDeps,
  expectExists: boolean
): Promise<Walk> {
  const { path, fs } = deps
  if (expectExists) {
    try {
      return {
        realProbe: normaliseResolved(await fs.realpath(start), deps),
        tail: [],
        probeStats: null
      }
    } catch {
      // Missing, a dangling link or unreadable: the climb below tells which
    }
  }
  const tail: string[] = []
  let probe = start
  let probeStats: ConfinementStats
  for (;;) {
    try {
      probeStats = await fs.lstat(probe)
      break
    } catch (error) {
      const code = errnoCode(error)
      // ENOTDIR (a file in the middle of the path) climbs like ENOENT: that the
      // path is not found is only said after the root check, so a refusal for
      // an outside path never depends on what exists there
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        const up = path.dirname(probe)
        // Nothing on the way up exists: not a place inside any project
        if (up === probe) throw new ConfinementError('OUTSIDE_PROJECT')
        tail.unshift(path.basename(probe))
        probe = up
        continue
      }
      throw new ConfinementError('UNVERIFIABLE')
    }
  }

  let realProbe: string
  try {
    realProbe = normaliseResolved(await fs.realpath(probe), deps)
  } catch {
    // A link whose target is missing, or a path that changed under us: where it
    // leads cannot be shown, so it is not acted on
    throw new ConfinementError('UNVERIFIABLE')
  }
  return { realProbe, tail, probeStats }
}

/**
 * Step 7, after the root check: a missing tail below something that is not a
 * folder (a file, or a link to one) names nothing that can exist.
 */
async function refuseTailBelowNonFolder(walk: Walk, deps: ConfinementDeps): Promise<void> {
  const { realProbe, tail, probeStats } = walk
  if (tail.length === 0) return
  // Nothing can exist below a file or a special file (FIFO, socket, device);
  // Win32 can also report a missing child of a file as ENOENT, not ENOTDIR
  if (probeStats && !probeStats.isDirectory() && !probeStats.isSymbolicLink()) {
    throw new ConfinementError('NOT_FOUND')
  }
  if (probeStats?.isSymbolicLink()) {
    let target: ConfinementStats
    try {
      target = await deps.fs.stat(realProbe)
    } catch {
      throw new ConfinementError('UNVERIFIABLE')
    }
    if (!target.isDirectory()) throw new ConfinementError('NOT_FOUND')
  }
}

interface Located {
  real: string
  existed: boolean
  tail: string[]
  stats: ConfinementStats | null
  realProbe: string
}

/** Steps 4 to 8 for the project modes, without the policy checks or the owner check. */
async function locateInProject(
  lexical: string,
  session: ConfinementSession,
  entry: boolean,
  expectExists: boolean,
  deps: ConfinementDeps
): Promise<Located> {
  const { path, fs } = deps
  const start = entry ? path.dirname(lexical) : lexical
  if (entry && start === lexical) throw new ConfinementError('OUTSIDE_PROJECT')
  const last = entry ? path.basename(lexical) : null

  const walk = await walkToExistingAncestor(start, deps, expectExists)
  const { realProbe, tail, probeStats } = walk
  const below = [...tail, ...(last === null ? [] : [last])]
  const real = below.length > 0 ? path.join(realProbe, ...below) : realProbe

  if (!isInsideRoot(realProbe, session.realRoot, session.caseSensitive, deps)) {
    // The walk stopped above the root: the project folder itself is gone
    if (tail.length > 0 && isInsideRoot(real, session.realRoot, session.caseSensitive, deps)) {
      throw new ConfinementError('NOT_FOUND', PROJECT_FOLDER_GONE_MESSAGE)
    }
    throw new ConfinementError('OUTSIDE_PROJECT')
  }
  await refuseTailBelowNonFolder(walk, deps)

  // Whether the whole path exists. For an entry the parent exists when `tail` is empty
  let existed = false
  let stats: ConfinementStats | null = null
  if (!entry) {
    existed = tail.length === 0
    stats = existed ? probeStats : null
  } else if (tail.length === 0) {
    try {
      stats = await fs.lstat(lexical)
      existed = true
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') {
        throw new ConfinementError(errnoCode(error) === 'ENOTDIR' ? 'NOT_FOUND' : 'UNVERIFIABLE')
      }
    }
  }

  // Step 10: a name that is about to be created must be valid where it is created
  if (deps.platform === 'win32') {
    const created = existed || (entry && tail.length === 0) ? [] : below
    for (const segment of created) {
      if (!validateFilename(segment, deps.platform).valid) throw invalid()
    }
  }

  return { real, existed, tail, stats, realProbe }
}

/**
 * Resolve one path argument under a policy.
 *
 * @param input - The renderer-supplied value (any type; checked here)
 * @param ctx - The open project and the calling window
 * @param policy - What this argument may be
 * @param deps - File system and path flavour; the real ones by default
 * @throws ConfinementError with the reason the path was not accepted
 */
export async function resolveConfinedPath(
  input: unknown,
  ctx: ConfinementContext,
  policy: PathPolicy,
  deps: ConfinementDeps = defaultConfinementDeps
): Promise<ResolvedPath> {
  const raw = checkForm(input, deps)
  const lexical = deps.path.resolve(raw)
  const { session } = ctx

  if (policy.mode === 'external') {
    if (policy.check === 'escape' && session) {
      const looksInside =
        isInsideRoot(lexical, session.root, session.caseSensitive, deps) ||
        isInsideRoot(lexical, session.realRoot, session.caseSensitive, deps)
      if (looksInside) {
        try {
          await locateInProject(lexical, session, false, false, deps)
        } catch (error) {
          // Only a path that resolves out of the project is refused here; a
          // missing or unreadable one keeps failing with its own error later
          if (error instanceof ConfinementError && error.code === 'OUTSIDE_PROJECT') throw error
        }
      }
    }
    return { requested: lexical, real: lexical, existed: false, tail: [] }
  }

  if (!session) throw new ConfinementError('NO_PROJECT')
  if (session.ownerWebContentsId !== null && ctx.senderId !== session.ownerWebContentsId) {
    throw new ConfinementError('NOT_SESSION_OWNER')
  }

  const entry = policy.mode === 'project-entry'
  if (
    entry &&
    (isSamePath(lexical, session.root, session.caseSensitive, deps) ||
      isSamePath(lexical, session.realRoot, session.caseSensitive, deps))
  ) {
    throw new ConfinementError('ROOT_FORBIDDEN')
  }

  // An entry's parent, or a path that must exist or has a kind to match, is
  // expected to be there; a path about to be created is not
  const expectExists =
    entry || (policy.mode === 'project' && (policy.mustExist === true || policy.kind !== undefined))
  const located = await locateInProject(lexical, session, entry, expectExists, deps)

  if (policy.mustExist && !located.existed) throw new ConfinementError('NOT_FOUND')
  if (
    entry
      ? isSamePath(located.real, session.realRoot, session.caseSensitive, deps)
      : policy.mode === 'project' &&
        policy.allowRoot === false &&
        isSamePath(located.real, session.realRoot, session.caseSensitive, deps)
  ) {
    throw new ConfinementError('ROOT_FORBIDDEN')
  }
  if (policy.mode === 'project' && policy.kind && located.existed) {
    let target = located.stats
    // No `lstat` on the fast path, and a link needs its target's kind: both
    // ask `stat` about the canonical path
    if (target === null || target.isSymbolicLink()) {
      try {
        target = await deps.fs.stat(located.realProbe)
      } catch {
        throw new ConfinementError('UNVERIFIABLE')
      }
    }
    const matches = policy.kind === 'directory' ? target.isDirectory() : !target.isDirectory()
    if (!matches) {
      throw new ConfinementError(
        'WRONG_KIND',
        policy.kind === 'directory' ? 'Path is not a directory' : 'Path is a directory'
      )
    }
  }

  return { requested: lexical, real: located.real, existed: located.existed, tail: located.tail }
}

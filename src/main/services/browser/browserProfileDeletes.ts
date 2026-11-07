// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deletes and renames under `.erfana/browser` (spec 025, ADR 0009 decisions 3
 * and 11; panel finding S4).
 *
 * Every delete – Clear's capture step, Forget, capture expiry, setting a
 * distrusted profile aside – goes through {@link deleteUnderBrowser} or
 * {@link setProfileAside}, which re-run the per-level guard right before
 * acting, so a link planted since the last check is never followed out of the
 * project.
 *
 * Windows keeps the profile's files open while the session lives, so a delete
 * there can fail with `EBUSY` / `EPERM`. Such a delete is stored in
 * `~/.erfana/browser-pending-deletes.json` as the project's canonical path and
 * a project-relative path, HMAC-signed, and run at the next start after the
 * same guard. An entry that does not verify is dropped, never run.
 */
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteJSON, removeIfExists } from '../../utils/atomicWrite'
import { redactPath } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import {
  BrowserProfileError,
  canonicalProjectPath,
  guardDeleteTarget
} from './browserProfileGuards'
import { BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME, UNTRUSTED_PROFILE_PREFIX } from './browserProfilePaths'
import type { PurposeSigner } from './browserProfileMarker'

export const PENDING_DELETES_FILE = 'browser-pending-deletes.json'
export const PENDING_DELETE_PURPOSE = 'browser-pending-delete'
/** Error codes that mean "held open by a running session" on Windows. */
const BUSY_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY'])
/** Most entries kept; a longer file is not ours. */
const MAX_PENDING_ENTRIES = 256
/** Set-aside names tried before giving up (same-millisecond collisions). */
const MAX_SET_ASIDE_ATTEMPTS = 10

const PendingEntrySchema = z
  .object({
    project: z.string().min(1),
    rel: z.string().min(1),
    hmac: z.string().regex(/^[0-9a-f]{64}$/)
  })
  .strict()

const PendingFileSchema = z
  .object({ version: z.literal(1), entries: z.array(PendingEntrySchema).max(MAX_PENDING_ENTRIES) })
  .strict()

type PendingEntry = z.infer<typeof PendingEntrySchema>

export interface BrowserDeleteDeps {
  readonly homeDir: string
  readonly platform: NodeJS.Platform
  readonly signer: PurposeSigner
}

export type DeleteOutcome = 'deleted' | 'absent' | 'pending'

const errnoCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code

const pendingPath = (homeDir: string): string => join(homeDir, '.erfana', PENDING_DELETES_FILE)

const entryBody = (project: string, rel: string): string => JSON.stringify({ project, rel })

/**
 * Delete `.erfana/browser/<relBelowBrowser>` (`[]` for the whole folder) after
 * re-guarding every level. On Windows, a delete the running session blocks is
 * stored for the next start.
 *
 * @throws BrowserProfileError('delete-failed') when the delete fails and is
 *   not stored; the guard's own errors for a link or an escape
 */
export async function deleteUnderBrowser(
  canonical: string,
  relBelowBrowser: readonly string[],
  deps: BrowserDeleteDeps
): Promise<DeleteOutcome> {
  const segments = [...BROWSER_DIR_SEGMENTS, ...relBelowBrowser]
  const target = await guardDeleteTarget(canonical, segments)
  if (target === null) return 'absent'
  try {
    await rm(target, { recursive: true, force: false, maxRetries: 0 })
    return 'deleted'
  } catch (error) {
    const code = errnoCode(error)
    if (deps.platform === 'win32' && code !== undefined && BUSY_CODES.has(code)) {
      if (await recordPendingDelete(canonical, segments.join('/'), deps)) return 'pending'
    }
    throw new BrowserProfileError('delete-failed', segments.join('/'), `Deleting failed (${code ?? 'unknown'})`, {
      cause: error
    })
  }
}

/** `2026-11-02T10-15-30-123Z`: UTC, and legal in a Windows file name. */
export function setAsideStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[:.]/g, '-')
}

/**
 * Rename a distrusted `.erfana/browser/profile` to
 * `profile.untrusted-<UTC time>` (ADR 0009 decision 3), guarded like a delete.
 *
 * @returns the new folder name, or null when there was no profile
 * @throws BrowserProfileError('write-failed') when the rename fails
 */
export async function setProfileAside(canonical: string, epochMs: number): Promise<string | null> {
  const source = await guardDeleteTarget(canonical, [...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME])
  if (source === null) return null
  const stamp = setAsideStamp(epochMs)
  for (let attempt = 0; attempt < MAX_SET_ASIDE_ATTEMPTS; attempt++) {
    const name = `${UNTRUSTED_PROFILE_PREFIX}${stamp}${attempt === 0 ? '' : `-${attempt}`}`
    // An existing name (even an empty folder, which rename would replace) is skipped
    if ((await guardDeleteTarget(canonical, [...BROWSER_DIR_SEGMENTS, name])) !== null) continue
    try {
      await rename(source, join(canonical, ...BROWSER_DIR_SEGMENTS, name))
      return name
    } catch (error) {
      throw new BrowserProfileError('write-failed', [...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME].join('/'),
        `Setting the profile aside failed (${errnoCode(error) ?? 'unknown'})`, { cause: error })
    }
  }
  throw new BrowserProfileError('write-failed', [...BROWSER_DIR_SEGMENTS, PROFILE_DIR_NAME].join('/'),
    'Setting the profile aside failed (no free name)')
}

async function readPendingEntries(homeDir: string): Promise<PendingEntry[]> {
  let text: string
  try {
    text = await readFile(pendingPath(homeDir), 'utf8')
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return []
    throw error
  }
  try {
    const parsed = PendingFileSchema.safeParse(JSON.parse(text))
    if (parsed.success) return parsed.data.entries
  } catch {
    // Falls through to the log below
  }
  logger.warn('Browser pending deletes: the file is not valid and was ignored')
  return []
}

async function writePendingEntries(homeDir: string, entries: readonly PendingEntry[]): Promise<void> {
  if (entries.length === 0) {
    await removeIfExists(pendingPath(homeDir))
    return
  }
  await mkdir(join(homeDir, '.erfana'), { recursive: true, mode: 0o700 })
  await atomicWriteJSON(pendingPath(homeDir), { version: 1, entries })
}

/**
 * Store a delete for the next start. Unsigned entries are never stored: with
 * no key this run, the delete is reported as failed instead.
 *
 * @returns whether the entry was stored
 */
export async function recordPendingDelete(canonical: string, rel: string, deps: BrowserDeleteDeps): Promise<boolean> {
  const hmac = deps.signer.sign(PENDING_DELETE_PURPOSE, entryBody(canonical, rel))
  if (hmac === undefined) return false
  try {
    const entries = (await readPendingEntries(deps.homeDir)).filter(
      (entry) => !(entry.project === canonical && entry.rel === rel)
    )
    if (entries.length >= MAX_PENDING_ENTRIES) return false
    await writePendingEntries(deps.homeDir, [...entries, { project: canonical, rel, hmac }])
    return true
  } catch (error) {
    logger.warn('Browser pending deletes: storing a delete failed', { error: errnoCode(error) ?? String(error) })
    return false
  }
}

/** Run one stored delete; true when the entry is done (deleted, gone or dropped). */
async function runPendingEntry(entry: PendingEntry, deps: BrowserDeleteDeps): Promise<boolean> {
  if (deps.signer.verify(PENDING_DELETE_PURPOSE, entryBody(entry.project, entry.rel), entry.hmac) !== 'valid') {
    logger.warn('Browser pending deletes: dropped an entry that does not verify')
    return true
  }
  // The project must still be at the same canonical path, or the entry names nothing of ours
  const canonical = await canonicalProjectPath(entry.project).catch(() => null)
  if (canonical !== entry.project) return true
  const segments = entry.rel.split('/')
  try {
    const target = await guardDeleteTarget(canonical, segments)
    if (target !== null) await rm(target, { recursive: true, force: false, maxRetries: 0 })
    logger.info('Browser pending delete ran', { gone: target === null, path: redactPath(entry.rel) })
    return true
  } catch (error) {
    // Still held open: kept for the next start. Anything else (a link, an
    // escape, a bad path) is dropped and logged, never retried.
    const busy = BUSY_CODES.has(errnoCode(error) ?? '')
    logger.warn('Browser pending delete failed', {
      path: redactPath(entry.rel),
      code: error instanceof BrowserProfileError ? error.code : (errnoCode(error) ?? 'unknown'),
      kept: busy
    })
    return !busy
  }
}

/**
 * Run the deletes stored by earlier runs (at start). Entries still blocked are
 * kept for the next start; every other entry is removed from the file.
 */
export async function runPendingDeletes(deps: BrowserDeleteDeps): Promise<void> {
  const entries = await readPendingEntries(deps.homeDir)
  if (entries.length === 0) return
  const kept: PendingEntry[] = []
  for (const entry of entries) {
    if (!(await runPendingEntry(entry, deps))) kept.push(entry)
  }
  await writePendingEntries(deps.homeDir, kept)
}

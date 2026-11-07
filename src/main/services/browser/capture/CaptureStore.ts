// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Capture files in `<project>/.erfana/browser/captures/` (spec 025,
 * 025-FR-033, 025-FR-034, 025-FR-039, 025-FR-046; solution design § 3.1,
 * § 6.2, § 6.3; ADR 0009 decisions 2 and 11).
 *
 * - **Write** ({@link CaptureStore.write}): the folder levels are guarded
 *   again (`browserProfileGuards.ts`: no link, real path exactly where it
 *   belongs, one level at a time), then each file is created exclusively and
 *   without following a link, then its real path is checked. Names come only
 *   from `captureFileNames` (capture time and a random id), never from page
 *   text. A failure removes every file this write created and throws a
 *   {@link CaptureWriteError} that names the reason (025-FR-046).
 * - **Delete** ({@link CaptureStore.remove}): through the delete re-guard;
 *   only names matching the capture pattern.
 * - **Expiry** ({@link CaptureStore.expire}): regular files whose names match
 *   Erfana's pattern and whose name dates them more than 7 days back;
 *   links, folders and other names are left alone; one failure is logged
 *   and the sweep goes on (025-FR-039). {@link CaptureExpiry} runs it when a
 *   project opens and every 24 hours while it stays open.
 */
import { constants as fsConstants, type Dirent } from 'node:fs'
import { open, readdir, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clock, TimerHandle } from '../../../../shared/clock'
import { CAPTURE_FILE_NAME, isExpiredCapture } from '../../../../shared/browser/captureFiles'
import { logger } from '../../LoggingService'
import type { ProjectSession } from '../../session/ProjectSession'
import {
  assertRealPathAt,
  BrowserProfileError,
  canonicalProjectPath,
  checkExistingLevel,
  ensureBrowserFolder,
  ensureProfileTree,
  guardDeleteTarget
} from '../browserProfileGuards'
import { BROWSER_DIR_SEGMENTS, CAPTURES_DIR_NAME } from '../browserProfilePaths'

/** `.erfana/browser/captures` as segments. */
export const CAPTURES_SEGMENTS: readonly string[] = Object.freeze([...BROWSER_DIR_SEGMENTS, CAPTURES_DIR_NAME])
/** `.erfana/browser/captures` as a project-relative, `/`-separated path. */
export const CAPTURES_REL = CAPTURES_SEGMENTS.join('/')

/** The expiry sweep's period while a project stays open (025-FR-039). */
export const EXPIRY_PERIOD_MS = 24 * 60 * 60 * 1000

const FILE_MODE = 0o600
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const CREATE_EXCLUSIVE = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | O_NOFOLLOW

/** A capture write that failed; `message` is the toast's reason. */
export class CaptureWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CaptureWriteError'
  }
}

/** One file of a capture. */
export interface CaptureFile {
  /** A capture file name (`CAPTURE_FILE_NAME`). */
  readonly name: string
  readonly data: Uint8Array | string
}

/** Test seam: a failure forced before each file is created. */
export type WriteFault = (name: string) => Error | null

const errnoCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code

/** The toast's reason for a failed write: the level and the cause, never page text. */
function reasonOf(error: unknown): string {
  if (error instanceof BrowserProfileError) return `${error.message} (${error.relPath || CAPTURES_REL})`
  const code = errnoCode(error)
  if (code === 'ENOSPC') return 'The disk is full'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return `${CAPTURES_REL} is read-only`
  return error instanceof Error ? error.message : String(error)
}

/** Create a new file and write it; `created` runs once the file exists, so a rollback removes only files this write made. */
async function createExclusive(canonical: string, segments: readonly string[], data: Uint8Array | string, created: () => void): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await open(join(canonical, ...segments), CREATE_EXCLUSIVE, FILE_MODE)
    created()
    if (!(await handle.stat()).isFile()) throw new BrowserProfileError('wrong-type', segments.join('/'), 'Expected a file')
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle?.close()
  }
  await assertRealPathAt(canonical, segments)
}

export class CaptureStore {
  constructor(private readonly fault: () => WriteFault | null = () => null) {}

  /**
   * Write every file of one capture under `projectRoot`, or none.
   *
   * @returns the project-relative paths, in `files` order
   * @throws CaptureWriteError naming the reason; no file of this write remains
   */
  async write(projectRoot: string, files: readonly CaptureFile[]): Promise<string[]> {
    const written: string[] = []
    let canonical: string
    try {
      canonical = await canonicalProjectPath(projectRoot)
      await ensureBrowserFolder(canonical)
      await ensureProfileTree(canonical)
    } catch (error) {
      throw new CaptureWriteError(reasonOf(error), { cause: error })
    }
    try {
      for (const file of files) {
        if (!CAPTURE_FILE_NAME.test(file.name)) throw new Error('not a capture file name')
        const forced = this.fault()?.(file.name) ?? null
        if (forced !== null) throw forced
        // An existing file of the same name fails the exclusive create and is not this write's to remove.
        await createExclusive(canonical, [...CAPTURES_SEGMENTS, file.name], file.data, () => written.push(file.name))
      }
    } catch (error) {
      await this.removeIn(canonical, written)
      logger.warn('Browser capture write failed', { reason: errnoCode(error) ?? (error instanceof BrowserProfileError ? error.code : 'other') })
      throw new CaptureWriteError(reasonOf(error), { cause: error })
    }
    return files.map((f) => `${CAPTURES_REL}/${f.name}`)
  }

  /** Delete capture files by name under `projectRoot`. Never rejects; failures are logged. */
  async remove(projectRoot: string, names: readonly string[]): Promise<void> {
    try {
      await this.removeIn(await canonicalProjectPath(projectRoot), names)
    } catch (error) {
      logger.warn('Browser capture files could not be removed', { error: errnoCode(error) ?? 'other' })
    }
  }

  /**
   * Delete expired capture files under `projectRoot` (025-FR-039).
   *
   * @returns the names deleted
   */
  async expire(projectRoot: string, now: Date): Promise<string[]> {
    let canonical: string
    let entries: Dirent[]
    try {
      canonical = await canonicalProjectPath(projectRoot)
      for (let depth = 1; depth <= CAPTURES_SEGMENTS.length; depth++) {
        if (!(await checkExistingLevel(canonical, CAPTURES_SEGMENTS.slice(0, depth), 'dir'))) return []
      }
      entries = await readdir(join(canonical, ...CAPTURES_SEGMENTS), { withFileTypes: true })
    } catch (error) {
      logger.warn('Browser capture expiry could not read the captures folder', { error: errnoCode(error) ?? 'other' })
      return []
    }
    const deleted: string[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !CAPTURE_FILE_NAME.test(entry.name) || !isExpiredCapture(entry.name, now)) continue
      try {
        const abs = await guardDeleteTarget(canonical, [...CAPTURES_SEGMENTS, entry.name])
        if (abs === null) continue
        await unlink(abs)
        deleted.push(entry.name)
      } catch (error) {
        // The name is Erfana's own (time and random id); the reason is enough.
        logger.warn('Browser capture expiry could not delete a file', {
          error: errnoCode(error) ?? (error instanceof BrowserProfileError ? error.code : 'other')
        })
      }
    }
    return deleted
  }

  private async removeIn(canonical: string, names: readonly string[]): Promise<void> {
    for (const name of names) {
      if (!CAPTURE_FILE_NAME.test(name)) continue
      try {
        const abs = await guardDeleteTarget(canonical, [...CAPTURES_SEGMENTS, name])
        if (abs !== null) await unlink(abs)
      } catch (error) {
        if (errnoCode(error) !== 'ENOENT') logger.warn('Browser capture file could not be removed', { error: errnoCode(error) ?? 'other' })
      }
    }
  }
}

/**
 * Runs {@link CaptureStore.expire} when a project opens and every
 * {@link EXPIRY_PERIOD_MS} while it stays open (025-FR-039).
 */
export class CaptureExpiry {
  private timer: TimerHandle | undefined
  private unsubscribe: (() => void) | null = null
  private running: Promise<void> = Promise.resolve()

  constructor(
    private readonly store: Pick<CaptureStore, 'expire'>,
    private readonly clock: Clock
  ) {}

  /** Follow `session`; sweeps the project already open, if any. */
  attach(session: Pick<ProjectSession, 'onChange' | 'current'>): () => void {
    this.unsubscribe = session.onChange((_prev, next) => this.follow(next?.realRoot ?? null))
    this.follow(session.current()?.realRoot ?? null)
    return () => this.dispose()
  }

  /** The sweep in flight, for tests and the hook. */
  whenIdle(): Promise<void> {
    return this.running
  }

  /** Run one sweep of `projectRoot` now, after any sweep in flight. Never rejects: a failed sweep must not stop the next. */
  sweep(projectRoot: string): Promise<void> {
    this.running = this.running.then(async () => {
      try {
        await this.store.expire(projectRoot, new Date(this.clock.now()))
      } catch (error) {
        logger.warn('Browser capture expiry sweep failed', { error: errnoCode(error) ?? 'other' })
      }
    })
    return this.running
  }

  dispose(): void {
    this.clock.clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private follow(projectRoot: string | null): void {
    this.clock.clearInterval(this.timer)
    this.timer = undefined
    if (projectRoot === null) return
    void this.sweep(projectRoot)
    this.timer = this.clock.setInterval(() => void this.sweep(projectRoot), EXPIRY_PERIOD_MS)
  }
}

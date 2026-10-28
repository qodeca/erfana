// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { LOGS_DIR_RELATIVE } from '../../shared/constants'
import { redactPath, redactedLogError } from './redactUserInput'

/** File the synchronous fallback writes to, inside the logs directory */
const CRASH_FALLBACK_FILE = 'crash.log'
/** The previous generation, kept when `crash.log` reaches its size cap */
const CRASH_FALLBACK_ROTATED_FILE = 'crash.1.log'
/** Size at which `crash.log` is rotated (about 1 MB; at most two files are kept) */
export const CRASH_FALLBACK_MAX_BYTES = 1024 * 1024
/** Longest error text recorded on one fallback line */
const MAX_FALLBACK_TEXT_LENGTH = 2_000
/** At most one line per tag per this interval; the next line reports how many were skipped */
export const CRASH_FALLBACK_TAG_INTERVAL_MS = 5_000

/**
 * Two or more path segments after a separator or drive letter. A bare `/tmp` or
 * `and/or` is left alone; `/Users/alice/notes.md` or `C:\Users\alice\x` is not.
 */
const PATH_LIKE = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s'"`:,;()<>|]+){2,}[\\/]?/g

/** Per target file and tag: when the last line was written and how many were skipped since. */
const tagState = new Map<string, { lastWrite: number; skipped: number }>()

/**
 * Where the fallback line goes. Under Vitest it is the temp directory, so a
 * test run never writes into the real `~/.erfana/logs`.
 */
function fallbackDir(): string {
  if (process.env.VITEST) return join(tmpdir(), 'erfana-test-logs')
  return join(homedir(), LOGS_DIR_RELATIVE)
}

/**
 * Flatten an error (or any thrown value) to one bounded line with no absolute
 * paths: quoted errno paths go through `redactedLogError`, and any remaining
 * path-looking text (a message that embeds a path unquoted) is cut down to its
 * last segment. A user name in a home-folder path therefore never reaches the file.
 */
function describeForFallback(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${(redactedLogError(error) ?? error).message}`
      : String(error)
  const flat = text.replace(PATH_LIKE, (match) => redactPath(match)).replace(/[\r\n]+/g, ' ')
  return flat.length > MAX_FALLBACK_TEXT_LENGTH
    ? `${flat.slice(0, MAX_FALLBACK_TEXT_LENGTH)}[truncated]`
    : flat
}

/** Move a full `crash.log` aside so the file never grows past the cap. */
function rotateIfFull(dir: string): void {
  try {
    if (statSync(join(dir, CRASH_FALLBACK_FILE)).size >= CRASH_FALLBACK_MAX_BYTES) {
      renameSync(join(dir, CRASH_FALLBACK_FILE), join(dir, CRASH_FALLBACK_ROTATED_FILE))
    }
  } catch {
    // no file yet, or it cannot be rotated: appending still works or fails on its own
  }
}

/**
 * Appends one line to `crash.log`, synchronously.
 *
 * The normal logger writes asynchronously and may not be configured yet (a
 * start-up failure) or may not flush before the process dies (a crash). This
 * is the last-resort trail: a blocking append that never throws.
 *
 * - The text is redacted (no absolute paths or user names).
 * - Rate-limited per tag: a loop of the same failure writes one line per
 *   {@link CRASH_FALLBACK_TAG_INTERVAL_MS}, and the next line says how many
 *   were skipped. A skipped line still returns `true`, because the file does
 *   hold a line for that failure.
 * - Capped: at {@link CRASH_FALLBACK_MAX_BYTES} the file is renamed to
 *   `crash.1.log` (replacing the older one) and a fresh file starts.
 *
 * @param tag - Greppable label such as `[crash] startup-logging-init`
 * @param error - The failure to record (message only, no stack)
 * @param dir - Override of the target directory (tests)
 * @returns `true` when the failure is on record in `crash.log`; `false` when the write failed
 */
export function writeCrashFallbackLine(
  tag: string,
  error: unknown,
  dir: string = fallbackDir()
): boolean {
  try {
    const key = `${dir}\u0000${tag}`
    const now = Date.now()
    const state = tagState.get(key)
    if (state && now - state.lastWrite < CRASH_FALLBACK_TAG_INTERVAL_MS) {
      state.skipped += 1
      return true
    }

    mkdirSync(dir, { recursive: true })
    rotateIfFull(dir)
    const skippedNote = state && state.skipped > 0 ? ` (+${state.skipped} skipped)` : ''
    appendFileSync(
      join(dir, CRASH_FALLBACK_FILE),
      `[${new Date().toISOString()}] ${tag}${skippedNote} ${describeForFallback(error)}\n`,
      'utf-8'
    )
    tagState.set(key, { lastWrite: now, skipped: 0 })
    return true
  } catch {
    return false
  }
}

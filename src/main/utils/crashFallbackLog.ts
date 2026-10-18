// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { appendFileSync, mkdirSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { LOGS_DIR_RELATIVE } from '../../shared/constants'

/** File the synchronous fallback writes to, inside the logs directory */
const CRASH_FALLBACK_FILE = 'crash.log'
/** Longest error text recorded on one fallback line */
const MAX_FALLBACK_TEXT_LENGTH = 2_000

/**
 * Where the fallback line goes. Under Vitest it is the temp directory, so a
 * test run never writes into the real `~/.erfana/logs`.
 */
function fallbackDir(): string {
  if (process.env.VITEST) return join(tmpdir(), 'erfana-test-logs')
  return join(homedir(), LOGS_DIR_RELATIVE)
}

/** Flatten an error (or any thrown value) to one bounded line of text. */
function describeForFallback(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const flat = text.replace(/[\r\n]+/g, ' ')
  return flat.length > MAX_FALLBACK_TEXT_LENGTH
    ? `${flat.slice(0, MAX_FALLBACK_TEXT_LENGTH)}[truncated]`
    : flat
}

/**
 * Appends one line to `crash.log`, synchronously.
 *
 * The normal logger writes asynchronously and may not be configured yet (a
 * start-up failure) or may not flush before the process dies (a crash). This
 * is the last-resort trail: a blocking append that never throws.
 *
 * @param tag - Greppable label such as `[crash] startup-logging-init`
 * @param error - The failure to record (message only, no stack)
 * @param dir - Override of the target directory (tests)
 * @returns `true` when the line was written
 */
export function writeCrashFallbackLine(
  tag: string,
  error: unknown,
  dir: string = fallbackDir()
): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, CRASH_FALLBACK_FILE),
      `[${new Date().toISOString()}] ${tag} ${describeForFallback(error)}\n`,
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Read what the app's main-process log gains AFTER a point in time.
 *
 * The app logs to `~/.erfana/logs/main.log` (`LoggingService.getLogsDir` —
 * `homedir()` + `LOGS_DIR_RELATIVE`; the e2e `--user-data-dir` does not move
 * it), so the file is shared with every other Erfana process on the machine,
 * including a second Playwright worker. Two things keep a read honest: only
 * bytes appended after `mark()` are looked at, and the caller's pattern must
 * carry something unique to its own run (a random token in the URL it clicked).
 *
 * Rotation (`main.log` → `main.1.log`) shrinks the file; a size below the mark
 * resets the mark to zero so the read continues from the fresh file.
 *
 * Condition-based: `waitFor` is an `expect.poll` over the appended bytes.
 */

import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { expect } from '@playwright/test'
import { LOGS_DIR_RELATIVE } from '../../src/shared/constants'

/** Where the running app writes its main-process log. */
export function appMainLogPath(): string {
  return path.join(os.homedir(), LOGS_DIR_RELATIVE, 'main.log')
}

export class LogTail {
  private offset = 0

  constructor(private readonly file: string = appMainLogPath()) {}

  /** Remember the current end of the file; `appended()` reads from here. */
  async mark(): Promise<void> {
    this.offset = await this.size()
  }

  /** Everything written since `mark()` (or since the file was rotated). */
  async appended(): Promise<string> {
    const size = await this.size()
    if (size < this.offset) this.offset = 0
    if (size === this.offset) return ''
    const handle = await fsp.open(this.file, 'r')
    try {
      const buffer = Buffer.alloc(size - this.offset)
      await handle.read(buffer, 0, buffer.length, this.offset)
      return buffer.toString('utf-8')
    } finally {
      await handle.close()
    }
  }

  /**
   * Wait until the bytes appended since `mark()` match `pattern`.
   *
   * @returns The matched text.
   */
  async waitFor(pattern: RegExp, options: { timeout?: number; message?: string } = {}): Promise<string> {
    await expect
      .poll(() => this.appended(), {
        timeout: options.timeout ?? 10_000,
        message: options.message ?? `main.log never gained a line matching ${pattern}`
      })
      .toMatch(pattern)
    return (await this.appended()).match(pattern)?.[0] ?? ''
  }

  private async size(): Promise<number> {
    try {
      return (await fsp.stat(this.file)).size
    } catch {
      return 0
    }
  }
}

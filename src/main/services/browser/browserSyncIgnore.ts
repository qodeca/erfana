// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Best effort against cloud sync (spec 025, ADR 0009 decision 10; panel
 * finding S30): ask Dropbox and the macOS File Provider (iCloud Drive, other
 * providers) not to sync `.erfana/browser`. A synced profile spreads cookies
 * and a live Chromium database across machines.
 *
 * Only where it is cheap:
 * - macOS: `/usr/bin/xattr -w` for `com.dropbox.ignored` and
 *   `com.apple.fileprovider.ignore#P` (absolute binary, no shell);
 * - Windows: the `com.dropbox.ignored` NTFS stream on the folder;
 * - Linux: nothing – the attribute tool (`setfattr`) is often missing.
 *
 * A failure is logged and never stops the browser.
 */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { logger } from '../LoggingService'

const execFileAsync = promisify(execFile)

const XATTR_BINARY = '/usr/bin/xattr'
const DROPBOX_IGNORE = 'com.dropbox.ignored'
const FILE_PROVIDER_IGNORE = 'com.apple.fileprovider.ignore#P'
const XATTR_TIMEOUT_MS = 5_000

export interface SyncIgnoreDeps {
  readonly platform: NodeJS.Platform
  runXattr(args: string[]): Promise<unknown>
  writeStream(path: string, data: string): Promise<void>
}

const defaultDeps: SyncIgnoreDeps = {
  platform: process.platform,
  runXattr: (args) => execFileAsync(XATTR_BINARY, args, { timeout: XATTR_TIMEOUT_MS, shell: false }),
  writeStream: (path, data) => writeFile(path, data, 'utf8')
}

async function attempt(what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    logger.warn('Browser folder: could not set a sync-ignore attribute', {
      attribute: what,
      error: (error as NodeJS.ErrnoException).code ?? 'unknown'
    })
  }
}

/** Mark the guarded, absolute `.erfana/browser` folder as not to be synced. */
export async function markIgnoredBySync(browserDir: string, deps: SyncIgnoreDeps = defaultDeps): Promise<void> {
  if (deps.platform === 'darwin') {
    await attempt(DROPBOX_IGNORE, () => deps.runXattr(['-w', DROPBOX_IGNORE, '1', browserDir]))
    await attempt(FILE_PROVIDER_IGNORE, () => deps.runXattr(['-w', FILE_PROVIDER_IGNORE, '1', browserDir]))
  } else if (deps.platform === 'win32') {
    await attempt(DROPBOX_IGNORE, () => deps.writeStream(`${browserDir}:${DROPBOX_IGNORE}`, '1'))
  }
}

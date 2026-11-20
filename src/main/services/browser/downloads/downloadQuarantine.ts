// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The macOS quarantine mark on a finished browser download (spec 025, S-18):
 * Gatekeeper checks only a file that carries `com.apple.quarantine`, and
 * Electron's `DownloadItem` writes the file without it (Electron does not
 * supply the Chromium quarantine service). So the mark is written here, after
 * the file reaches its final path, with the absolute `/usr/bin/xattr` and no
 * shell – the same way `browserSyncIgnore` writes its attributes.
 *
 * Not `LSFileQuarantineEnabled`: that would mark every file Erfana writes.
 * Other platforms: nothing (Windows has its own Mark of the Web; Linux none).
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const XATTR_BINARY = '/usr/bin/xattr'
export const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine'
const XATTR_TIMEOUT_MS = 5_000
/** The agent name macOS shows in its "downloaded from the internet" prompt. */
const QUARANTINE_AGENT = 'Erfana'
/** `kLSQuarantineTypeWebDownload` flags, as browsers write them. */
const QUARANTINE_FLAGS = '0081'

export interface QuarantineDeps {
  readonly platform: NodeJS.Platform
  runXattr(args: string[]): Promise<unknown>
  now(): number
  newId(): string
}

const defaultDeps: QuarantineDeps = {
  platform: process.platform,
  runXattr: (args) => execFileAsync(XATTR_BINARY, args, { timeout: XATTR_TIMEOUT_MS, shell: false }),
  now: () => Date.now(),
  newId: () => randomUUID().toUpperCase()
}

/** The attribute value: `flags;hex seconds;agent;event id`. */
export function quarantineValue(nowMs: number, id: string): string {
  return `${QUARANTINE_FLAGS};${Math.floor(nowMs / 1000).toString(16)};${QUARANTINE_AGENT};${id}`
}

/**
 * Mark `path` (absolute) as downloaded from the internet. macOS only; rejects
 * when `xattr` fails (an exFAT or FAT disk has no extended attributes) – the
 * caller logs that and keeps the file.
 */
export async function markDownloadQuarantined(path: string, deps: QuarantineDeps = defaultDeps): Promise<void> {
  if (deps.platform !== 'darwin') return
  await deps.runXattr(['-w', QUARANTINE_ATTRIBUTE, quarantineValue(deps.now(), deps.newId()), path])
}

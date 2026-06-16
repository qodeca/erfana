// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tar.gz archive extraction with tar-slip + symlink protection.
 *
 * Thin wrapper over `tar@7.5.11`. The `filter` callback rejects anything
 * that isn't a regular file or directory (symlinks + hardlinks are the
 * classic tar-slip vector), plus any entry whose resolved path escapes
 * `destDir`.
 *
 * Used for the macOS whisper.cpp artifact (`.tar.gz`); Windows archives
 * use the zip wrapper in `zipArchive.ts`.
 *
 * @see docs/build/whisper-binaries.md
 */

import { x as extractTar } from 'tar'
import { mkdir } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'

export class TarSlipError extends Error {
  constructor(
    public readonly entryName: string,
    public readonly reason: string
  ) {
    super(`tar-slip rejected: "${entryName}" — ${reason}`)
    this.name = 'TarSlipError'
  }
}

/**
 * Extract a `.tar.gz` (or `.tgz`) into `destDir`.
 *
 * Rejects:
 *  - any entry type other than `File` or `Directory` (symlinks, hardlinks,
 *    devices, FIFOs)
 *  - absolute paths (POSIX or drive-letter)
 *  - paths that resolve outside `destDir` via `..` segments
 */
export async function untarGz(src: string, destDir: string): Promise<void> {
  const resolvedDest = resolve(destDir)
  // tar's `x` function requires cwd to exist; mkdir up-front so callers
  // don't have to.
  await mkdir(resolvedDest, { recursive: true })
  // Collect rejections — tar's filter returns false silently; we need to
  // surface the cause for diagnostics and for our test fixture to assert.
  const rejections: TarSlipError[] = []

  await extractTar({
    file: src,
    cwd: resolvedDest,
    preserveOwner: false,
    filter: (entryPath: string, entry) => {
      const type = (entry as { type: string }).type
      if (type !== 'File' && type !== 'Directory') {
        rejections.push(new TarSlipError(entryPath, `disallowed entry type: ${type}`))
        return false
      }
      if (isAbsolute(entryPath) || /^[A-Za-z]:/.test(entryPath)) {
        rejections.push(new TarSlipError(entryPath, 'absolute path'))
        return false
      }
      const target = resolve(resolvedDest, entryPath)
      const rel = relative(resolvedDest, target)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        rejections.push(new TarSlipError(entryPath, `resolves outside destDir (rel: ${rel})`))
        return false
      }
      return true
    }
  })

  if (rejections.length > 0) {
    // Surface the first rejection; the rest are still logged via their
    // own Error instances in `rejections` if caller wants them.
    throw rejections[0]
  }
}

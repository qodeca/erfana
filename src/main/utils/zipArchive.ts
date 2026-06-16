// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zip archive extraction with zip-slip protection.
 *
 * Thin wrapper over `extract-zip@2.0.1`. Pre-extract validation pass rejects
 * any entry whose resolved target escapes the destination directory; this is
 * our hard defense against malicious archives (upstream `whisper-build-*`
 * zips are SHA-pinned + manifest-signed, but defense-in-depth).
 *
 * Reject conditions:
 *  - absolute POSIX paths (`/…`)
 *  - Windows drive-letter paths (`C:…`)
 *  - UNC paths (`\\server\…`)
 *  - NTFS alternate-data-stream colons (`file.exe:Zone.Identifier`)
 *  - `..` traversal that resolves outside `destDir`
 *
 * @see docs/build/whisper-binaries.md
 */

import extract from 'extract-zip'
import { isAbsolute, relative, resolve } from 'path'
import yauzl from 'yauzl'

export class ZipSlipError extends Error {
  constructor(
    public readonly entryName: string,
    public readonly reason: string
  ) {
    super(`zip-slip rejected: "${entryName}" — ${reason}`)
    this.name = 'ZipSlipError'
  }
}

/**
 * Extract a zip file into `destDir` after validating every entry does not
 * escape the destination.
 *
 * `destDir` is resolved to an absolute path before validation; entries are
 * rejected in a pre-pass so the filesystem state is not mutated on failure.
 */
export async function unzip(src: string, destDir: string): Promise<void> {
  const resolvedDest = resolve(destDir)
  await validateEntries(src, resolvedDest)
  await extract(src, { dir: resolvedDest })
}

function validateEntries(src: string, resolvedDest: string): Promise<void> {
  return new Promise<void>((resolveP, rejectP) => {
    yauzl.open(src, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        rejectP(err ?? new Error('yauzl.open returned no zipfile'))
        return
      }
      // `zipfile.close()` is idempotent in yauzl, so calling it on every
      // terminal path (success / error / entry-rejection) is safe and prevents
      // FD leaks under retry loops or repeated unzip invocations.
      zipfile.on('error', (e) => {
        zipfile.close()
        rejectP(e)
      })
      zipfile.on('end', () => {
        zipfile.close()
        resolveP()
      })
      zipfile.on('entry', (entry: yauzl.Entry) => {
        try {
          assertSafeEntry(entry.fileName, resolvedDest)
        } catch (e) {
          zipfile.close()
          rejectP(e)
          return
        }
        zipfile.readEntry()
      })
      zipfile.readEntry()
    })
  })
}

/**
 * Validate a single zip entry name against our zip-slip rejection rules.
 *
 * Exported for unit-testing — production code calls it via the zipfile
 * event loop in {@link validateEntries}. Throws {@link ZipSlipError} on
 * the first rule violation; returns void on success.
 */
export function assertSafeEntry(name: string, resolvedDest: string): void {
  // Normalise slashes for cross-platform checks; zip entries always use `/`
  // internally per PKZIP spec, but defensive about `\` just in case.
  const normalised = name.replace(/\\/g, '/')

  // Check most-specific patterns first. On Windows, `path.isAbsolute` returns
  // true for drive-letter AND UNC paths, so we must flag those with their
  // specific reasons before the generic absolute-path check.
  if (normalised.startsWith('//')) {
    throw new ZipSlipError(name, 'UNC path')
  }
  if (/^[A-Za-z]:/.test(normalised)) {
    throw new ZipSlipError(name, 'Windows drive-letter path')
  }
  if (normalised.includes(':')) {
    throw new ZipSlipError(name, 'contains NTFS ADS colon')
  }
  if (isAbsolute(normalised)) {
    throw new ZipSlipError(name, 'absolute POSIX path')
  }

  const target = resolve(resolvedDest, normalised)
  const rel = relative(resolvedDest, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ZipSlipError(name, `resolves outside destDir (rel: ${rel})`)
  }
}

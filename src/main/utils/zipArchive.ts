// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zip archive extraction with zip-slip protection.
 *
 * Built directly on `yauzl` (#165): `extract-zip@2.0.1` – the wrapper this
 * module used before – follows symbolic-link entries (GHSA-jmr9-qjv8-65gv,
 * GHSA-7pqw-9j4j-h8q3) and has no fixed release. A pre-extract validation
 * pass rejects every unsafe entry before anything is written; this is our
 * hard defense against malicious archives (upstream `whisper-build-*` zips
 * are SHA-pinned + manifest-signed, but defense-in-depth).
 *
 * Reject conditions:
 *  - absolute POSIX paths (`/…`)
 *  - Windows drive-letter paths (`C:…`)
 *  - UNC paths (`\\server\…`)
 *  - NTFS alternate-data-stream colons (`file.exe:Zone.Identifier`)
 *  - `..` traversal that resolves outside `destDir`
 *  - symbolic-link entries, and any other entry that is not a regular file
 *    or a directory (devices, FIFOs, sockets)
 *
 * @see docs/build/whisper-binaries.md
 */

import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'path'
import { pipeline } from 'stream/promises'
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

// POSIX file-type bits, stored in the high 16 bits of a zip entry's
// external file attributes by Unix zip tools. DOS-made entries leave them 0.
const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

const DEFAULT_FILE_MODE = 0o644

/**
 * Extract a zip file into `destDir` after validating every entry does not
 * escape the destination.
 *
 * `destDir` is resolved to an absolute path before validation; entries are
 * rejected in a pre-pass so the filesystem state is not mutated on failure.
 */
export async function unzip(src: string, destDir: string): Promise<void> {
  const resolvedDest = resolve(destDir)
  await forEachEntry(src, async (entry) => {
    assertSafeEntry(entry.fileName, resolvedDest)
    assertSafeEntryType(entry.fileName, entryMode(entry))
  })
  await mkdir(resolvedDest, { recursive: true })
  await forEachEntry(src, (entry, zipfile) => extractEntry(entry, zipfile, resolvedDest))
}

function entryMode(entry: yauzl.Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff
}

async function extractEntry(
  entry: yauzl.Entry,
  zipfile: yauzl.ZipFile,
  resolvedDest: string
): Promise<void> {
  // Re-checked here as well as in the pre-pass: the archive is reopened for
  // this pass, so a file swapped on disk in between must not slip through.
  assertSafeEntry(entry.fileName, resolvedDest)
  const mode = entryMode(entry)
  assertSafeEntryType(entry.fileName, mode)

  const target = resolve(resolvedDest, entry.fileName)
  if (entry.fileName.endsWith('/') || (mode & S_IFMT) === S_IFDIR) {
    await mkdir(target, { recursive: true })
    return
  }
  await mkdir(dirname(target), { recursive: true })
  const readStream = await new Promise<NodeJS.ReadableStream>((resolveP, rejectP) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) rejectP(err ?? new Error('yauzl.openReadStream returned no stream'))
      else resolveP(stream)
    })
  })
  await pipeline(readStream, createWriteStream(target, { mode: (mode & 0o777) || DEFAULT_FILE_MODE }))
}

/**
 * Walk every entry of `src` in order, awaiting `visit` before reading the
 * next one. The first error (from yauzl or from `visit`) rejects and stops
 * the walk.
 */
function forEachEntry(
  src: string,
  visit: (entry: yauzl.Entry, zipfile: yauzl.ZipFile) => Promise<void>
): Promise<void> {
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
        visit(entry, zipfile).then(
          () => zipfile.readEntry(),
          (e: unknown) => {
            zipfile.close()
            rejectP(e)
          }
        )
      })
      zipfile.readEntry()
    })
  })
}

/**
 * Validate a single zip entry name against our zip-slip rejection rules.
 *
 * Exported for unit-testing — production code calls it from {@link unzip}
 * for every entry. Throws {@link ZipSlipError} on the first rule violation;
 * returns void on success.
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

/**
 * Validate a zip entry's POSIX file type (the high 16 bits of its external
 * file attributes). Only regular files and directories are extracted; a
 * symbolic link is the escape the extract-zip advisories describe, so it is
 * rejected outright rather than followed or recreated.
 *
 * Exported for unit-testing. Throws {@link ZipSlipError}.
 */
export function assertSafeEntryType(name: string, mode: number): void {
  const type = mode & S_IFMT
  if (type === 0 || type === S_IFREG || type === S_IFDIR) return
  if (type === S_IFLNK) {
    throw new ZipSlipError(name, 'symbolic-link entry')
  }
  throw new ZipSlipError(name, `unsupported entry type (mode 0o${mode.toString(8)})`)
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Read an image a Markdown document references (#71), from ONE file handle.
 *
 * A document – not the user – picks what is read, so this is stricter than the
 * image viewer's `readImage`:
 *
 * - **One open, then `fstat` on that handle.** The kind, the size and the
 *   version all describe the object actually opened, not whatever a path
 *   pointed at a moment earlier. Anything but a regular file is refused before
 *   a byte is read.
 * - **`O_NONBLOCK`** (POSIX): opening a special file such as a FIFO returns at
 *   once instead of waiting for a writer, so the `fstat` check gets to run and
 *   no thread-pool worker is held. It changes nothing for a regular file.
 *   Windows has no such flag; there the path check already refuses device and
 *   namespace paths (`\\.\`, `\\?\`, `CON`, …), and `fstat` refuses the rest.
 * - **`O_NOFOLLOW`** (POSIX): the path handed in is the canonical one the
 *   confinement check produced, so its last segment is not a link; if one was
 *   swapped in since, the open fails rather than following it.
 * - **The cap holds for the bytes read, not only for the size `fstat` saw.**
 *   At most `maxBytes + 1` bytes are read, so a file that grows after the check
 *   is still refused.
 *
 * The version token is the same as the viewer's (`formatVersion`), minted from
 * the `fstat` taken before the read, so it carries the change time too (#478
 * L4). Every answer also carries the stamp of that `fstat` (#478 plan S18):
 * what the Markdown preview's per-image tracker compares a check against.
 * Bytes that moved during the read keep the stamp from before it, so the next
 * check sees a difference and reads again.
 *
 * @module services/file/readDocumentImage
 */
import { constants } from 'fs'
import { open } from 'fs/promises'
import { extname } from 'path'
import type { ImageReadResponse } from '../../../shared/ipc/file-image-schema'
import { getImageMimeType } from '../../../shared/ipc/image-formats'
import { stampFromStats } from '../freshness/stampStats'
import { formatVersion, ImageTooLargeError, NotARegularFileError } from './imageRead'

// Declared in `imageRead` since #478 (the viewer refuses non-regular files too); re-exported for existing importers
export { NotARegularFileError }

/** Read size after the first, `fstat`-sized, read. */
const CHUNK_BYTES = 64 * 1024

/** Open flags: read-only, plus non-blocking and no-follow where the platform has them. */
export function documentImageOpenFlags(platform: NodeJS.Platform = process.platform): number {
  if (platform === 'win32') return constants.O_RDONLY
  return constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0)
}

/**
 * @param filePath - Canonical, already-confined path of the image
 * @param knownVersion - Version the caller shows; omit to force a read
 * @param maxBytes - Largest file accepted
 * @throws NotARegularFileError, ImageTooLargeError, or the open/read error
 */
export async function readDocumentImage(
  filePath: string,
  knownVersion: string | undefined,
  maxBytes: number
): Promise<ImageReadResponse> {
  const handle = await open(filePath, documentImageOpenFlags())
  try {
    const stats = await handle.stat({ bigint: true })
    if (!stats.isFile()) throw new NotARegularFileError()
    const size = Number(stats.size)
    const tooLarge = (): ImageTooLargeError =>
      new ImageTooLargeError(`Image file too large. Maximum size is ${maxBytes} bytes.`)
    if (size > maxBytes) throw tooLarge()

    const version = formatVersion(stats)
    const stamp = stampFromStats(stats)
    if (knownVersion !== undefined && knownVersion === version) return { status: 'unchanged', version, stamp }

    const chunks: Buffer[] = []
    let total = 0
    let buffer = Buffer.alloc(size + 1)
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total)
      if (bytesRead === 0) break
      chunks.push(buffer.subarray(0, bytesRead))
      total += bytesRead
      if (total > maxBytes) throw tooLarge()
      buffer = Buffer.alloc(Math.min(CHUNK_BYTES, maxBytes + 1 - total))
    }

    const mimeType = getImageMimeType(extname(filePath)) ?? 'application/octet-stream'
    const bytes = Buffer.concat(chunks, total)
    return { status: 'ok', dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, version, stamp }
  } finally {
    await handle.close()
  }
}

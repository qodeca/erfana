// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The classified text read behind the editor tab (#478, plan decision 31).
 *
 * One open (read-only, `O_NONBLOCK` on POSIX), `fstat` on that descriptor,
 * regular files only, at most `min(size, limit) + 1` bytes read, then `fstat`
 * again (read-verify): a size or time that moved during the read is `busy`,
 * so a half-written file is never shown (P3). The answer is one of:
 *
 * - `ok` – the text, its stamp (SHA-256 of the exact bytes) and its line ending;
 *   a UTF-8 BOM and the line endings are content and are kept as read;
 * - `too-large` – over the limit (10 MiB for the editor, owner decision Q2);
 * - `binary` – a NUL byte or invalid UTF-8;
 * - `unsupported-encoding` – a UTF-16 or UTF-32 byte-order mark;
 * - `unsupported` – not a regular file (FIFO, socket, folder, device);
 * - `missing`, `unreadable` (locked, access denied, …), `busy`.
 *
 * The hash of a good read seeds the stamper's cache, so the probe that follows
 * the read costs one `fstat`.
 *
 * @module services/freshness/textRead
 */
import type { FileHandle } from 'node:fs/promises'

import type { Eol, TextReadReply } from '../../../shared/freshness/freshnessTypes'
import { FRESHNESS_LIMITS } from '../../../shared/freshness/timingProfiles'
import { classifyReadError, fileStamper, readChunks, sameStats, sha256Hex, stampFromStats, type FileStamper } from './fileStamp'

/** Byte-order marks of encodings the editor cannot show. UTF-32 LE first: it starts with UTF-16 LE's mark. */
const UNSUPPORTED_BOMS: readonly (readonly number[])[] = [
  [0xff, 0xfe, 0x00, 0x00],
  [0x00, 0x00, 0xfe, 0xff],
  [0xff, 0xfe],
  [0xfe, 0xff],
]

function startsWith(bytes: Buffer, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte)
}

/** The bytes are text the editor can show, or why not. */
export function classifyTextBytes(
  bytes: Buffer
): { readonly kind: 'text'; readonly text: string } | { readonly kind: 'binary' | 'unsupported-encoding' } {
  if (UNSUPPORTED_BOMS.some((bom) => startsWith(bytes, bom))) return { kind: 'unsupported-encoding' }
  if (bytes.includes(0)) return { kind: 'binary' }
  try {
    // ignoreBOM keeps a UTF-8 BOM in the text: it is content, and a save writes it back
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  } catch {
    return { kind: 'binary' }
  }
}

/** The line ending of the first line break. */
export function detectEol(text: string): Eol {
  const lf = text.indexOf('\n')
  if (lf === -1) return 'none'
  return lf > 0 && text[lf - 1] === '\r' ? 'crlf' : 'lf'
}

/** Options of {@link readText}. */
export interface TextReadOptions {
  /** Largest file shown (bytes); default the editor's 10 MiB. */
  limit?: number
  stamper?: FileStamper
}

async function readOpenText(
  realPath: string,
  handle: FileHandle,
  limit: number,
  stamper: FileStamper
): Promise<TextReadReply> {
  const before = await handle.stat({ bigint: true })
  if (!before.isFile()) return { status: 'unsupported' }
  const size = Number(before.size)
  if (size > limit) return { status: 'too-large', size }

  const chunks: Buffer[] = []
  const read = await readChunks(handle, Math.min(size, limit) + 1, (chunk) => chunks.push(chunk))
  const after = await handle.stat({ bigint: true })
  if (read !== size || !sameStats(before, after)) return { status: 'busy' }

  const bytes = Buffer.concat(chunks, read)
  const classified = classifyTextBytes(bytes)
  if (classified.kind !== 'text') return { status: classified.kind }

  const hash = sha256Hex(bytes)
  stamper.remember(realPath, before, hash)
  return { status: 'ok', text: classified.text, stamp: stampFromStats(before, hash), eol: detectEol(classified.text) }
}

/**
 * Read `realPath` as editor text, classified. Never throws for a file-system
 * failure: every one maps to a status.
 *
 * @param realPath - the file's real path (confinement is the caller's job)
 */
export async function readText(realPath: string, options: TextReadOptions = {}): Promise<TextReadReply> {
  const limit = options.limit ?? FRESHNESS_LIMITS.editorTextMaxBytes
  const stamper = options.stamper ?? fileStamper
  let handle: FileHandle
  try {
    handle = await stamper.open(realPath)
  } catch (error) {
    return { status: classifyReadError(error).status }
  }
  try {
    return await readOpenText(realPath, handle, limit, stamper)
  } catch (error) {
    return { status: classifyReadError(error).status }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

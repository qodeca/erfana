// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * "Is this the same content?" for two {@link FileStamp}s (plan decision 28).
 *
 * - Both hashed: equal size and equal SHA-256. A touch-only write (new mtime,
 *   same bytes) is the same content and stays silent (N3); a copy that keeps
 *   the old mtime and size but changes the bytes is different (L4).
 * - Otherwise: every stat field equal – size, mtime, ctime and file id. The
 *   ctime moves on any write, even one that puts the old mtime back.
 *
 * @module shared/freshness/stamp
 */
import type { FileStamp } from './freshnessTypes'

/** Every stat field of the two stamps is equal (the hash is not looked at). */
export function isSameStat(a: FileStamp, b: FileStamp): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino
}

/** The two stamps label the same bytes, as far as they can tell. */
export function isSameContent(a: FileStamp, b: FileStamp): boolean {
  if (a.size !== b.size) return false
  if (a.hash !== undefined && b.hash !== undefined) return a.hash === b.hash
  return isSameStat(a, b)
}

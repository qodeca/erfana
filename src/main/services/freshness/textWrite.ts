// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The checked text write behind autosave (#478, plan decision 33).
 *
 * Own-save identity is decided here, in main, not in the renderer: with an
 * `expectedStamp` (the version the tab last read), the write lands only if the
 * file is still that version at the moment of the commit. The check is
 * **stat first** – an exact size/mtime/ctime/id match is "unchanged" with no
 * hash; only a stat mismatch hashes (through the stamper's cache) and compares
 * content, so a touch-only write does not raise a conflict. It runs right
 * before the rename, again before each rename retry, and before an in-place
 * write (`atomicWriteText`'s `beforeCommit`).
 *
 * - `written` – the stamp is a `stat` of the final path after the commit plus
 *   the SHA-256 of the exact bytes written (BOM and line endings included), so
 *   the next autosave's stat check matches, and an outside write that lands
 *   right after the commit hashes differently and is never taken for ours.
 * - `changed-on-disk` – nothing was written; the stamp is the version found
 *   (`null` when the file was gone).
 *
 * Known limit (ADR 0013): with no file lock, an outside write that lands
 * between the last check and the commit (one `stat` plus one `rename`) is
 * overwritten.
 *
 * Without `expectedStamp` (an explicit save, Save-to-restore, a save in the
 * conflict state – F7) the write is unconditional, as `file:writeFile` is.
 *
 * @module services/freshness/textWrite
 */
import type { BigIntStats } from 'node:fs'
import { stat as fsStat } from 'node:fs/promises'

import type { FileStamp, WriteTextReply } from '../../../shared/freshness/freshnessTypes'
import { isSameStat } from '../../../shared/freshness/stamp'
import { atomicWriteText } from '../../utils/atomicWrite'
import { fileStamper, sha256Hex, stampFromStats, type FileStamper } from './fileStamp'

/** `stat` with bigint times, injectable for tests. */
export type BigIntStatFn = (path: string) => Promise<BigIntStats>

const defaultStat: BigIntStatFn = (path) => fsStat(path, { bigint: true })

/** Options of {@link writeTextChecked}. */
export interface WriteTextCheckedOptions {
  /** Write only while the file is still this version. */
  expectedStamp?: FileStamp
  stamper?: FileStamper
  stat?: BigIntStatFn
}

/** What the commit check found. */
type CheckVerdict = { readonly same: true } | { readonly same: false; readonly found: FileStamp | null }

/** Is the file at `filePath` still `expected`? Stat first; hash only on a stat mismatch. */
async function checkStillExpected(
  filePath: string,
  expected: FileStamp,
  stamper: FileStamper,
  stat: BigIntStatFn
): Promise<CheckVerdict> {
  let stats: BigIntStats
  try {
    stats = await stat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { same: false, found: null }
    throw error
  }
  const statStamp = stampFromStats(stats)
  if (isSameStat(statStamp, expected)) return { same: true }
  if (expected.hash === undefined || statStamp.size !== expected.size) return { same: false, found: statStamp }

  const hashed = await stamper.stamp(filePath)
  if (hashed.status !== 'ok') return { same: false, found: statStamp }
  if (hashed.stamp.hash === expected.hash) return { same: true }
  return { same: false, found: hashed.stamp }
}

/**
 * Write `content` to `filePath` atomically; with `expectedStamp`, only while
 * the file is still that version. Throws like `file:writeFile` on an I/O error.
 */
export async function writeTextChecked(
  filePath: string,
  content: string,
  options: WriteTextCheckedOptions = {}
): Promise<WriteTextReply> {
  const { expectedStamp } = options
  const stamper = options.stamper ?? fileStamper
  const stat = options.stat ?? defaultStat

  let found: FileStamp | null = null
  const beforeCommit =
    expectedStamp === undefined
      ? undefined
      : async (): Promise<boolean> => {
          const verdict = await checkStillExpected(filePath, expectedStamp, stamper, stat)
          if (verdict.same) return true
          found = verdict.found
          return false
        }

  const outcome = await atomicWriteText(filePath, content, { beforeCommit })
  if (outcome === 'aborted') return { status: 'changed-on-disk', stamp: found }

  const written = await stat(filePath)
  return { status: 'written', stamp: stampFromStats(written, sha256Hex(content)) }
}

/**
 * The checked write the `file-watch:writeText` handler calls, behind one
 * object so the e2e freshness hook can hold a write mid-save (#478 G2) without
 * a seam in the handler. Production code calls `textWriter.write`.
 */
export const textWriter: { write: typeof writeTextChecked } = {
  write: (filePath, content, options) => writeTextChecked(filePath, content, options)
}

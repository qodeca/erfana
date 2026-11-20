// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * readStatStampOutcome - a file's version as a stat-only stamp (#478, P1):
 * one `stat`, no bytes read or hashed.
 *
 * For a main tracker whose consumer re-reads the file itself the moment it
 * hears of a change – the HTML preview reloads its page – a full read and
 * SHA-256 would only stand in front of that reload. Without a hash the
 * tracker compares every stat field (`isSameContent`): any write moves the
 * size, mtime or ctime, so no change is missed; a touch-only write counts as
 * a change and reloads once, as the preview did before #478. A file still
 * being written is the write gate's and the settled read's to wait for.
 *
 * @module services/freshness/statStamp
 */
import type { BigIntStats } from 'node:fs'
import { stat as fsStat } from 'node:fs/promises'

import type { FileStamp, ReadOutcome } from '../../../shared/freshness/freshnessTypes'
import { classifyReadError } from './fileStamp'
import { stampFromStats } from './stampStats'

/** `fs.promises.stat` with `bigint: true`; injectable for tests. */
export type BigIntStatFn = (path: string, options: { bigint: true }) => Promise<BigIntStats>

/**
 * Read `realPath`'s stat-only stamp as a tracker read outcome.
 *
 * @param realPath - the file's real path (confinement is the caller's job)
 * @returns `ok` with the stamp; `missing` when the file is gone; `failed` for
 *   anything but a regular file or any other stat error
 */
export async function readStatStampOutcome(
  realPath: string,
  stat: BigIntStatFn = fsStat
): Promise<ReadOutcome<FileStamp>> {
  try {
    const stats = await stat(realPath, { bigint: true })
    if (!stats.isFile()) return { status: 'failed' }
    const stamp = stampFromStats(stats)
    return { status: 'ok', version: stamp, stamp }
  } catch (error) {
    return classifyReadError(error).status === 'missing' ? { status: 'missing' } : { status: 'failed' }
  }
}

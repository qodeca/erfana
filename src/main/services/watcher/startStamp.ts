// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * startStamp - the stamp a subscribe answers with, read after the watcher is
 * ready (#478, plan decision 14, G3): the tracker compares it with the stamp
 * of what the tab shows, so a write that landed before the watcher listened is
 * caught up.
 */
import { stat } from 'fs/promises'
import type { FileStamp } from '../../../shared/freshness/freshnessTypes'
import { fileStamper } from '../freshness/fileStamp'
import { stampFromStats } from '../freshness/stampStats'

/**
 * The file's stamp, hashed when it can be; a file being written (`busy`) or
 * unreadable for a moment gets a stat-only stamp, which the tracker's settled
 * read resolves. `null` when the file is gone.
 */
export async function readStartStamp(realPath: string): Promise<FileStamp | null> {
  const result = await fileStamper.stamp(realPath)
  if (result.status === 'ok') return result.stamp
  if (result.status === 'missing') return null
  try {
    return stampFromStats(await stat(realPath, { bigint: true }))
  } catch {
    return null
  }
}

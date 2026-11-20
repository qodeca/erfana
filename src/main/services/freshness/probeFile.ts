// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * probeFile - is a file still the version a tracker last saw? (#478, plan
 * decisions 28, 37). One stamp through the shared {@link FileStamper}, so the
 * hash cache and the one-hash-per-path rule cover every caller: the
 * `file-watch:probe` handler (windows) and the main-side trackers (HTML
 * preview, comments).
 *
 * @module services/freshness/probeFile
 */
import type { ProbeReply } from '../../../shared/freshness/freshnessTypes'
import { readStartStamp } from '../watcher/startStamp'
import type { FileStamper } from './fileStamp'

/**
 * Is the file at `real` still the version hashed as `knownHash`? The tracker
 * compares the stamp itself; `same` is a shortcut for a caller with a hash.
 * A file being written answers a stat-only stamp, which the tracker's settled
 * read resolves.
 *
 * @param real - the file's real path (confinement is the caller's job)
 */
export async function probeFile(real: string, knownHash: string | undefined, stamper: FileStamper): Promise<ProbeReply> {
  const result = await stamper.stamp(real)
  switch (result.status) {
    case 'ok':
      return { status: knownHash !== undefined && result.stamp.hash === knownHash ? 'same' : 'changed', stamp: result.stamp }
    case 'busy': {
      const stamp = await readStartStamp(real)
      return stamp ? { status: 'changed', stamp } : { status: 'missing' }
    }
    case 'missing':
      return { status: 'missing' }
    case 'unsupported':
    case 'unreadable':
      return { status: result.status, code: result.code }
  }
}

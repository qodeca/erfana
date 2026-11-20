// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchEndMessages - why a single-file watch ended, in words, per reason.
 *
 * Read by `atomicRearm` (the reason a re-arm gave up) and by the tests that
 * pin those words. No message names the file: callers log it redacted.
 */
import type { WatchEndReason } from '../../../shared/freshness/freshnessTypes'

/** What a watch owner is told when its watch ended, per reason. */
export const WATCH_END_MESSAGES: Readonly<Record<WatchEndReason, string>> = {
  'project-switch': 'File watch ended because the project session changed',
  'project-closed': 'File watch ended because the project session changed',
  'restart-failed': 'File watch ended: could not re-arm after the file was replaced',
  'watcher-error': 'File watch ended: the file watcher reported an error',
  'outside-project': 'File watch ended: the file no longer resolves inside the project',
  unsupported: 'File watch ended: the file is no longer a regular file'
}

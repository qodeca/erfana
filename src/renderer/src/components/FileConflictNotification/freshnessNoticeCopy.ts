// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Which notice a tab shows about its file on disk, and its words (#478, plan
 * § 3.6, decision 51, F13).
 *
 * One notice per panel: the tab's {@link FreshnessState} can hold several
 * facts at once (a conflict while its watch waits for a slot), and the user is
 * told the one that matters most, by this priority:
 *
 *   deleted > conflict > content unavailable > watch stopped > watch queued > limited
 *
 * Copy is sentence case, names the file, and uses en dashes. The read-only
 * sentence is the editor's only (F1, F33): the image viewer never edits.
 * Every string is here so tests assert against these constants.
 *
 * @module components/FileConflictNotification/freshnessNoticeCopy
 */
import type { ContentUnavailableReason, FreshnessState, WatchStopReason } from '../../../../shared/freshness/freshnessTypes'
import { FRESHNESS_LIMITS } from '../../../../shared/freshness/timingProfiles'
import { IMAGE_READ_MAX_BYTES } from '../../../../shared/ipc/file-image-schema'
import { TEST_IDS } from '../../constants/testids'

/** The tab kind the notice is for. */
export type NoticeTab = 'editor' | 'image'

/** Which notice. */
export type NoticeKind = 'deleted' | 'conflict' | 'unavailable' | 'stopped' | 'queued' | 'limited'

/** What a notice button does; the panel wires each to its action. */
export type NoticeAction =
  | 'restore'
  | 'close'
  | 'reload-from-disk'
  | 'keep-local'
  | 'dismiss-conflict'
  | 'reload'
  | 'dismiss-limited'

/** The selected notice, ready to render. */
export interface NoticeModel {
  readonly kind: NoticeKind
  /** `warning`: the tab is behind or blocked; `info`: it still follows, more slowly. */
  readonly severity: 'warning' | 'info'
  /** The sentence the notice shows and the status region announces. */
  readonly message: string
  /** Buttons, in order. */
  readonly actions: readonly NoticeAction[]
  /** For the conflict entry: an autosave was given up (F16). */
  readonly notSaved?: boolean
  /** Test id of the notice element. */
  readonly testId: string
}

/** What {@link selectNotice} decides from. */
export interface NoticeInput {
  readonly state: FreshnessState
  readonly fileName: string
  readonly tab: NoticeTab
  /** The size of a file refused as too large, when the read said (bytes). */
  readonly tooLargeSize?: number
  /** The user dismissed the "limited" notice for this tab (F35). */
  readonly limitedDismissed?: boolean
}

const BYTES_PER_MB = 1024 * 1024

/** Largest file each tab kind shows (MB), from the limits the reads enforce: editor (Q2), image (`file:readImage`). */
export const NOTICE_SIZE_LIMIT_MB: Readonly<Record<NoticeTab, number>> = {
  editor: FRESHNESS_LIMITS.editorTextMaxBytes / BYTES_PER_MB,
  image: IMAGE_READ_MAX_BYTES / BYTES_PER_MB
}

/** Test ids, kept here: the shared `testids.ts` is at its size limit. */
export const FRESHNESS_NOTICE_TEST_IDS = {
  /** Kept from the "auto-refresh stopped" notice it replaced (#464), so e2e locators still hold. */
  stopped: 'file-watch-stopped-notice',
  reload: 'file-watch-stopped-btn-reload',
  deleted: 'freshness-notice-deleted',
  unavailable: 'freshness-notice-unavailable',
  queued: 'freshness-notice-queued',
  limited: 'freshness-notice-limited',
  restore: 'freshness-notice-btn-restore',
  close: 'freshness-notice-btn-close',
  dismissLimited: 'freshness-notice-btn-dismiss',
  /** The always-mounted `role="status"` region of a panel. */
  status: 'freshness-status-region'
} as const

/** Button labels. */
export const NOTICE_BUTTON_COPY = {
  restore: 'Restore file',
  close: 'Close tab',
  reload: 'Reload',
  dismiss: 'Dismiss'
} as const

const READ_ONLY_TAIL = ' This tab is read-only until the file can be shown again.'
const LAST_GOOD_READ = ' What you see is from the last good read.'

/** The fixed sentences, for tests and the docs. */
export const FRESHNESS_NOTICE_COPY = {
  deleted: (file: string): string => `${file} was deleted, renamed or moved on disk.`,
  changed: (file: string): string => `${file} changed on disk.`,
  notSaved: (file: string): string => `Not saved – ${file} changed on disk since it was last read.`,
  tooLarge: (file: string, size: string | null, limitMb: number): string =>
    `${file} is too large to show here (${size === null ? '' : `${size}; `}limit ${limitMb} MB).`,
  binary: (file: string): string => `${file} no longer contains text Erfana can show.`,
  encoding: (file: string): string => `${file} now uses a text encoding Erfana cannot show (UTF-16 or UTF-32).`,
  unreadable: (file: string): string =>
    `${file} cannot be read right now (it may be locked or access is denied).`,
  stopped: (file: string): string => `Auto-refresh stopped for ${file}. Changes on disk no longer show here.`,
  outside: (file: string): string => `${file} can no longer be followed: it now resolves outside the project.`,
  unsupported: (file: string): string => `${file} can no longer be followed: it is not a regular file.`,
  queued:
    'Too many files are open to follow this one live. It updates when you switch to it, and follows live again when a slot frees.',
  limited:
    'Live refresh is limited for files on network drives and WSL. Erfana checks for changes when you switch to this tab or window.',
  readOnlyTail: READ_ONLY_TAIL,
  lastGoodRead: LAST_GOOD_READ
} as const

/**
 * `12.3 MB`, one decimal; whole megabytes without one. Rounded **up**, so a
 * file just over a limit never reads as the limit itself ("10.1 MB; limit 10 MB").
 */
export function formatMegabytes(bytes: number): string {
  // Times ten first: dividing by a power of two stays exact, so a whole megabyte never rounds up
  const tenths = Math.ceil((bytes * 10) / BYTES_PER_MB)
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} MB`
}

function unavailableNotice(reason: ContentUnavailableReason, input: NoticeInput): NoticeModel {
  const { fileName: file, tab } = input
  let head: string
  switch (reason) {
    case 'too-large': {
      const size = input.tooLargeSize === undefined ? null : formatMegabytes(input.tooLargeSize)
      head = FRESHNESS_NOTICE_COPY.tooLarge(file, size, NOTICE_SIZE_LIMIT_MB[tab])
      break
    }
    case 'binary':
      head = FRESHNESS_NOTICE_COPY.binary(file)
      break
    case 'unsupported-encoding':
      head = FRESHNESS_NOTICE_COPY.encoding(file)
      break
    case 'unreadable':
      head = FRESHNESS_NOTICE_COPY.unreadable(file)
      break
    case 'outside-project':
      head = FRESHNESS_NOTICE_COPY.outside(file)
      break
  }
  // Too large, unreadable and outside (a link retargeted back) can change by
  // trying again; binary and encoding only by the next write, which the tab
  // picks up by itself
  const canRetry = reason === 'too-large' || reason === 'unreadable' || reason === 'outside-project'
  return {
    kind: 'unavailable',
    severity: 'warning',
    message: head + LAST_GOOD_READ + (tab === 'editor' ? READ_ONLY_TAIL : ''),
    actions: canRetry ? ['reload'] : [],
    testId: FRESHNESS_NOTICE_TEST_IDS.unavailable
  }
}

function stoppedNotice(reason: WatchStopReason, file: string): NoticeModel | null {
  if (reason === 'project-closed') return null
  const message =
    reason === 'outside-project'
      ? FRESHNESS_NOTICE_COPY.outside(file)
      : reason === 'unsupported'
        ? FRESHNESS_NOTICE_COPY.unsupported(file)
        : FRESHNESS_NOTICE_COPY.stopped(file)
  return { kind: 'stopped', severity: 'warning', message, actions: ['reload'], testId: FRESHNESS_NOTICE_TEST_IDS.stopped }
}

/**
 * The one notice a panel shows for `input.state`, or `null` for none.
 *
 * @example
 * ```ts
 * selectNotice({ state: { watch: { kind: 'queued' }, content: { kind: 'deleted' } }, fileName: 'a.md', tab: 'editor' })
 * // the deleted notice: deleted outranks the watch queue
 * ```
 */
export function selectNotice(input: NoticeInput): NoticeModel | null {
  const { state, fileName: file, tab } = input
  const { content, watch } = state

  if (content.kind === 'deleted') {
    return {
      kind: 'deleted',
      severity: 'warning',
      message: FRESHNESS_NOTICE_COPY.deleted(file),
      // Restore saves the buffer back; a viewer has nothing to save (F14)
      actions: tab === 'editor' ? ['restore', 'close'] : ['close'],
      testId: FRESHNESS_NOTICE_TEST_IDS.deleted
    }
  }
  if (content.kind === 'changed' && content.mode === 'held') {
    const notSaved = content.notSaved === true
    return {
      kind: 'conflict',
      severity: 'warning',
      message: notSaved ? FRESHNESS_NOTICE_COPY.notSaved(file) : FRESHNESS_NOTICE_COPY.changed(file),
      actions: ['reload-from-disk', 'keep-local', 'dismiss-conflict'],
      notSaved,
      testId: TEST_IDS.FILE_CONFLICT_NOTIFICATION
    }
  }
  if (content.kind === 'unavailable') return unavailableNotice(content.reason, input)
  if (watch.kind === 'stopped') return stoppedNotice(watch.reason, file)
  if (watch.kind === 'queued') {
    return {
      kind: 'queued',
      severity: 'info',
      message: FRESHNESS_NOTICE_COPY.queued,
      actions: [],
      testId: FRESHNESS_NOTICE_TEST_IDS.queued
    }
  }
  if (watch.kind === 'active' && watch.live === 'limited' && !input.limitedDismissed) {
    return {
      kind: 'limited',
      severity: 'info',
      message: FRESHNESS_NOTICE_COPY.limited,
      actions: ['dismiss-limited'],
      testId: FRESHNESS_NOTICE_TEST_IDS.limited
    }
  }
  return null
}

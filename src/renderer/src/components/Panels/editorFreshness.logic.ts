// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The editor panel's two touch points with "follow the file on disk" that are
 * not the tracker itself (#478, plan S14):
 *
 * - the initial read, through the classified `file-watch:readText` (10 MiB
 *   limit on open as on refresh – Q2): its stamp is the tracker's baseline
 *   (G3), and a file the editor cannot show fails the load with words that say
 *   why, so "Try again" is the Reload the owner asked for; a file being
 *   written or briefly locked is read again first (G3, L2 – QG-8 S4);
 * - which save the panel's trigger is for the save add-on (F7): only an
 *   autosave is conditional; Cmd/Ctrl+S on a deleted tab is Restore file.
 *
 * @module components/Panels/editorFreshness.logic
 */
import type { FileStamp, ReadOutcome, TextReadReply } from '../../../../shared/freshness/freshnessTypes'
import { readWithRetry } from '../../../../shared/freshness/readWithRetry'
import { delay } from '../../../../shared/freshness/settleRead'
import { FRESHNESS_LIMITS, TIMING_PROFILES } from '../../../../shared/freshness/timingProfiles'
import type { SaveTrigger as AddOnTrigger } from '../../../../shared/freshness/saveAddOn'
import { freshnessEnvironment } from '../../services/freshness/windowFreshness'
import { formatMegabytes } from '../FileConflictNotification/freshnessNoticeCopy'
import type { SaveTrigger } from './markdownEditorPanel.logic'

/** The text of a file the editor opens, with the stamp of what was read. */
export interface EditorText {
  readonly content: string
  readonly stamp: FileStamp
}

/** Why the editor could not open a file, in words for the load error ("…could not be opened: <why>."). */
export function openFailureReason(reply: Exclude<TextReadReply, { status: 'ok' }>): string {
  switch (reply.status) {
    case 'too-large':
      return `it is too large to show here (${formatMegabytes(reply.size)}; limit ${formatMegabytes(FRESHNESS_LIMITS.editorTextMaxBytes)})`
    case 'binary':
      return 'it does not contain text Erfana can show'
    case 'unsupported-encoding':
      return 'it uses a text encoding Erfana cannot show (UTF-16 or UTF-32)'
    case 'unsupported':
      return 'it is not a regular file'
    case 'missing':
      return 'it no longer exists on disk'
    case 'busy':
      return 'it was being written; try again in a moment'
    case 'unreadable':
      return 'it cannot be read right now (it may be locked or access is denied)'
    case 'outside-project':
      return 'it is outside the project'
  }
}

/** Answers that may be gone a moment later: a file moving while read, a lock. */
function isPassing(reply: TextReadReply): boolean {
  return reply.status === 'busy' || reply.status === 'unreadable'
}

/**
 * Read `filePath` for the editor. A `busy` or `unreadable` answer is read
 * again with the editor profile's retry delays (a `busy` one waits the settle
 * time first), so opening a file an agent is writing does not fail.
 *
 * @throws {Error} When the file cannot be shown; the message is the reason
 */
export async function readEditorText(filePath: string): Promise<EditorText> {
  const { source, clock } = freshnessEnvironment()
  const profile = TIMING_PROFILES.editor
  let reply = { status: 'unreadable' } as TextReadReply // set by every attempt
  await readWithRetry(
    async (): Promise<ReadOutcome<null>> => {
      reply = await source.readText(filePath)
      if (reply.status === 'busy') await delay(clock, profile.settleMs)
      // Only `failed` is retried; any other answer ends the loop and `reply` keeps it
      return isPassing(reply) ? { status: 'failed' } : { status: 'missing' }
    },
    { clock, delaysMs: profile.readRetryDelaysMs }
  )
  if (reply.status === 'ok') return { content: reply.text, stamp: reply.stamp }
  throw new Error(openFailureReason(reply))
}

/**
 * The save add-on's trigger for a panel save (F7): an autosave is conditional;
 * the tab's own Cmd/Ctrl+S on a deleted file restores it; everything else is
 * an unconditional, explicit save.
 */
export function saveTriggerFor(trigger: SaveTrigger, isFileDeleted: boolean): AddOnTrigger {
  if (trigger === 'autosave') return 'autosave'
  if (trigger === 'user' && isFileDeleted) return 'restore'
  return 'explicit'
}

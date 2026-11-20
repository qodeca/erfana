// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The editor's save, wired into its tracker (#478, plan decision 42).
 *
 * pause (own subscription only) → `writeText` → adopt or conflict → resume →
 * check. What that buys:
 * - own-save identity is decided in main, from the stamp: an autosave sends
 *   the tab's last stamp as `expectedStamp`, and main writes only if the file
 *   is still that version (L1). A change that beat the save becomes the
 *   conflict, with the "Not saved" copy (F16) – nothing is overwritten;
 * - `written` carries the stamp of exactly what was written; adopting it makes
 *   the save's own echo silent (N1) while a later outside write – even one that
 *   restores an earlier saved text – is still a change (L3);
 * - only this tab's subscription pauses, so another tab or window on the same
 *   file hears the save as an outside change (L5);
 * - the pause always ends, and the check after it delivers a change that
 *   arrived during the save (L1).
 *
 * Only autosave sends `expectedStamp`, and never in the deleted state: an
 * explicit Cmd/Ctrl+S, Save-to-restore and a save in the conflict state write
 * unconditionally, as before (F7).
 *
 * Only the editor gets this module (decision 7): it is the one importer of
 * {@link PausableSource}.
 *
 * @module shared/freshness/saveAddOn
 */
import type { FreshnessTracker } from './FreshnessTracker'
import type { FileStamp, PausableSource, WriteTextReply } from './freshnessTypes'

/** What started the save. */
export type SaveTrigger = 'autosave' | 'explicit' | 'restore'

/** What a save asks for beyond the text. */
export interface SaveRequest {
  readonly content: string
  readonly trigger: SaveTrigger
  /** The project generation the tab belongs to (main refuses a write for another project). */
  readonly generation?: number
  /** Save-to-restore into a folder that is gone. */
  readonly createParentDirs?: true
}

/** The editor's save, bound to its tracker and file. */
export interface SaveAddOn {
  /**
   * Save. Resolves `written` or `changed-on-disk` (the conflict is already on
   * the tracker); rejects like `file:writeFile` on an I/O error, after the
   * pause has been released.
   */
  save(request: SaveRequest): Promise<WriteTextReply>
}

export interface SaveAddOnOptions {
  readonly filePath: string
  readonly source: PausableSource
  readonly tracker: FreshnessTracker<unknown>
}

/** The stamp an autosave must still find on disk, or `undefined` for an unconditional write (F7). */
function expectedStampFor(trigger: SaveTrigger, tracker: FreshnessTracker<unknown>): FileStamp | undefined {
  if (trigger !== 'autosave') return undefined
  if (tracker.getState().content.kind === 'deleted') return undefined
  return tracker.lastStamp
}

export function createSaveAddOn(options: SaveAddOnOptions): SaveAddOn {
  const { filePath, source, tracker } = options

  return {
    async save(request: SaveRequest): Promise<WriteTextReply> {
      const watchId = tracker.watchId
      if (watchId !== null) await source.pause(watchId).catch(() => undefined)
      try {
        const expectedStamp = expectedStampFor(request.trigger, tracker)
        const reply = await source.writeText({
          filePath,
          content: request.content,
          ...(request.generation !== undefined ? { generation: request.generation } : {}),
          ...(request.createParentDirs ? { createParentDirs: true as const } : {}),
          ...(expectedStamp !== undefined ? { expectedStamp } : {}),
        })
        if (reply.status === 'written') tracker.adoptStamp(reply.stamp)
        else tracker.markChangedOnDisk(true)
        return reply
      } finally {
        if (watchId !== null) await source.resumeWatch(watchId).catch(() => ({ missed: true }))
        // Whether or not a change was missed, look once: the probe is silent for our own write (N1, N3)
        tracker.check('save')
      }
    },
  }
}

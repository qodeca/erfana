// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown editor's adapter on "follow the file on disk" (#478, plan S14,
 * decisions 41–45).
 *
 * It supplies only the editor's update rule; the shared tracker
 * (`useFreshness`) does the following, catching up, retrying, deleted and
 * restart work, and the save add-on decides own-save identity in main:
 *
 * - **Rule**: an unedited tab takes the disk's text (`onContentUpdate`, with
 *   the line ending it was read with – the panel keeps the cursor and scroll,
 *   F15); an edited tab whose text differs holds it as the conflict; an edited
 *   tab whose text equals the disk's adopts it silently. A keystroke during
 *   the read counts as an edit.
 * - **Save** (`save`): pause this tab's subscription → `writeText` → adopt the
 *   written stamp (its echo stays silent – N1) or, for an autosave that found
 *   the file changed, the "Not saved" conflict (F16) → resume → check. Only an
 *   autosave sends `expectedStamp`, and never in the deleted state (F7).
 * - **Blocked content** (too large, binary, another encoding, unreadable):
 *   `isReadOnlyBlocked` – the panel makes the editor read-only and autosave
 *   stops (F1).
 *
 * @module useFileWatcher
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { INDICATOR_DURATION_MS } from '../constants/fileWatch'
import { isContentBlocked } from '../../../shared/freshness/FreshnessTracker'
import type {
  Eol,
  FileStamp,
  FreshnessState,
  ReadOutcome,
  UpdateRule,
  WriteTextReply
} from '../../../shared/freshness/freshnessTypes'
import { createSaveAddOn, type SaveRequest } from '../../../shared/freshness/saveAddOn'
import { textReadOutcome, type TextVersion } from '../../../shared/freshness/textOutcome'
import { freshnessEnvironment, pausableFreshnessSource } from '../services/freshness/windowFreshness'
import { normalizeLF } from '../utils/lineEndings'
import { logger } from '../utils/logger'
import { useFreshness } from './useFreshness'
import { useLatestRef } from './useLatestRef'

export type { SaveRequest }

/** Return type of {@link useFileWatcher}. */
export interface UseFileWatcherReturn {
  /** The one state object every notice reads (decision 35). */
  state: FreshnessState
  /** The file changed on disk while the tab holds edits: the conflict bar is up. */
  externalChangeDetected: boolean
  /** The file is gone (confirmed); it clears itself when the file is back. */
  isFileDeleted: boolean
  /** The disk's text was just taken (the toolbar's brief indicator). */
  isReloading: boolean
  /** The content cannot be shown: the editor is read-only and autosave is off (F1). */
  isReadOnlyBlocked: boolean
  /** The size of the file when the last read refused it as too large. */
  tooLargeSize: number | undefined
  /** Reload from disk: a new watch and a forced read that discards the buffer (also the notices' Reload). */
  reloadFromDisk: () => Promise<void>
  /** Keep my version: adopt the disk's version, so autosave may write the buffer (N6). */
  keepLocal: () => void
  /** Dismiss the conflict bar: exactly Keep my version (owner decision N6). */
  dismissConflict: () => void
  /** Our own write landed elsewhere (a comment save): look at the disk now. */
  reloadIfUnedited: () => void
  /** Save the buffer through the save add-on (see the module header). Rejects on an I/O error. */
  save: (request: SaveRequest) => Promise<WriteTextReply>
}

/** Options of {@link useFileWatcher}. */
export interface UseFileWatcherOptions {
  /** Path of the file to follow. */
  filePath: string | null
  /** The tab holds unsaved local edits. */
  hasLocalChanges: boolean
  /** The tab has its initial text; the tracker starts from `baseline`. */
  ready?: boolean
  /** The stamp of the initial read (G3: anything newer is caught up). */
  baseline?: FileStamp
  /** The tab is shown (a shown tab checks the disk – S1). */
  visible?: boolean
  /** Put the disk's text in the editor; the tab is clean afterwards. */
  onContentUpdate: (content: string, eol: Eol) => void
  /** The editor's text now (`undefined`: no editor mounted). */
  bufferNow?: () => string | undefined
}

/**
 * Follow the editor tab's file on disk.
 *
 * @example
 * ```tsx
 * const watch = useFileWatcher({ filePath, hasLocalChanges, ready, baseline, visible, onContentUpdate })
 * await watch.save({ content, trigger: 'autosave', generation })
 * <FreshnessNotice notice={selectNotice({ state: watch.state, fileName, tab: 'editor' })} … />
 * ```
 */
export function useFileWatcher(options: UseFileWatcherOptions): UseFileWatcherReturn {
  const { filePath, hasLocalChanges, ready = true, baseline, visible = true } = options

  const [isReloading, setIsReloading] = useState(false)
  const [tooLargeSize, setTooLargeSize] = useState<number | undefined>(undefined)

  const hasLocalChangesRef = useLatestRef(hasLocalChanges)
  const onContentUpdateRef = useLatestRef(options.onContentUpdate)
  const bufferNowRef = useLatestRef(options.bufferNow)
  /** The buffer when the current read began: a keystroke during the read is an edit. */
  const bufferAtReadRef = useRef<string | undefined>(undefined)
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    }
  }, [])

  const flashReloaded = useCallback(() => {
    if (!isMountedRef.current) return
    setIsReloading(true)
    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    indicatorTimerRef.current = setTimeout(() => {
      indicatorTimerRef.current = null
      if (isMountedRef.current) setIsReloading(false)
    }, INDICATOR_DURATION_MS)
  }, [])

  const rule = useMemo<UpdateRule<TextVersion>>(
    () => ({
      read: async (): Promise<ReadOutcome<TextVersion>> => {
        if (!filePath) return { status: 'missing' }
        bufferAtReadRef.current = bufferNowRef.current?.()
        const reply = await freshnessEnvironment().source.readText(filePath)
        if (reply.status === 'too-large' && isMountedRef.current) setTooLargeSize(reply.size)
        return textReadOutcome(reply)
      },
      // The editor reads hidden or shown: an unedited background tab stays current
      readNow: () => true,
      apply: (version, _stamp, force) => {
        const buffer = bufferNowRef.current?.()
        const typedDuringRead = bufferAtReadRef.current !== undefined && buffer !== bufferAtReadRef.current
        const edited = hasLocalChangesRef.current || typedDuringRead
        if (force || !edited) {
          onContentUpdateRef.current(version.text, version.eol)
          flashReloaded()
          logger.info('File reloaded from disk', { filePath })
          return 'applied'
        }
        // Edited, but the disk already holds exactly this text: nothing to choose
        if (buffer !== undefined && normalizeLF(buffer) === normalizeLF(version.text)) return 'applied'
        logger.warn('Local changes held against a change on disk', { filePath })
        return 'held'
      }
    }),
    [filePath, bufferNowRef, hasLocalChangesRef, onContentUpdateRef, flashReloaded]
  )

  const { state, tracker } = useFreshness<TextVersion>({ filePath, profile: 'editor', rule, ready, baseline, visible })

  const reloadFromDisk = useCallback(async () => {
    await tracker?.reload()
  }, [tracker])

  const keepLocal = useCallback(() => {
    logger.info('User chose to keep the local version')
    void tracker?.keepLocal()
  }, [tracker])

  const reloadIfUnedited = useCallback(() => {
    tracker?.check('manual')
  }, [tracker])

  const save = useCallback(
    async (request: SaveRequest): Promise<WriteTextReply> => {
      const port = pausableFreshnessSource()
      if (!filePath) throw new Error('No file to save')
      if (!tracker) {
        // Not following yet (the initial read is still out): a plain, unconditional write
        return port.writeText({
          filePath,
          content: request.content,
          ...(request.generation !== undefined ? { generation: request.generation } : {}),
          ...(request.createParentDirs ? { createParentDirs: true as const } : {})
        })
      }
      return createSaveAddOn({ filePath, source: port, tracker }).save(request)
    },
    [filePath, tracker]
  )

  return {
    state,
    externalChangeDetected: state.content.kind === 'changed' && state.content.mode === 'held',
    isFileDeleted: state.content.kind === 'deleted',
    isReloading,
    isReadOnlyBlocked: isContentBlocked(state),
    tooLargeSize,
    reloadFromDisk,
    keepLocal,
    dismissConflict: keepLocal,
    reloadIfUnedited,
    save
  }
}

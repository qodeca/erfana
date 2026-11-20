// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image viewer's adapter on "follow the file on disk" (#478, plan S15,
 * decision 41, F30).
 *
 * It supplies only the viewer's update rule; the shared tracker
 * (`useFreshness`) does the following, catching up, settling, retrying,
 * deleted and restart work:
 *
 * - **read**: `file:readImage` with the version on screen, so an unchanged
 *   file costs no bytes (`unchanged`);
 * - **readNow**: only while the tab is shown – a hidden tab marks the change
 *   and reads when it is shown again (S1);
 * - **apply**: hand the bytes and stamp already read to the viewer
 *   (`onBytes`), which decodes and commits them – never a second read (F30, F8).
 *
 * The viewer never writes, so this module never sees the pause or the save
 * port (decision 7).
 *
 * @module useFileChangeSubscription
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { INDICATOR_DURATION_MS } from '../constants/fileWatch'
import type {
  FileStamp,
  FreshnessState,
  ReadOutcome,
  UpdateRule
} from '../../../shared/freshness/freshnessTypes'
import { fileGateway } from '../services/fileGateway'
import { freshnessEnvironment } from '../services/freshness/windowFreshness'
import { logger } from '../utils/logger'
import { useFreshness } from './useFreshness'
import { useLatestRef } from './useLatestRef'

/** The bytes of one version of an image, as `file:readImage` returned them. */
export interface ImageBytes {
  readonly dataUrl: string
  readonly version: string
  readonly stamp: FileStamp
}

/** What a read gave the tracker: new bytes, or "the version on screen is current". */
export type ImageVersion = { readonly kind: 'bytes'; readonly bytes: ImageBytes } | { readonly kind: 'unchanged' }

/** Options for {@link useFileChangeSubscription}. */
export interface UseFileChangeSubscriptionOptions {
  /** The viewer shows its first image; the tracker starts from `baseline`. */
  readonly ready: boolean
  /** The stamp of the image on screen when the tracker starts (G3). */
  readonly baseline?: FileStamp
  /** The tab is shown: only a shown tab reads. */
  readonly visible: boolean
  /** The version token of the image on screen (echoed to `file:readImage`). */
  readonly currentVersion: string | undefined
  /** Show these bytes; called once per new version read. */
  readonly onBytes: (bytes: ImageBytes) => void
}

/** State and actions returned by {@link useFileChangeSubscription}. */
export interface UseFileChangeSubscriptionResult {
  /** The one state object the banner reads (decision 35). */
  readonly state: FreshnessState
  /** True for `INDICATOR_DURATION_MS` after the viewer calls `markReloaded`. */
  readonly isReloading: boolean
  /** The file was deleted on disk and was still gone when re-checked. */
  readonly isFileDeleted: boolean
  /** Auto-refresh stopped (not for a project that closed). */
  readonly isWatchUnavailable: boolean
  /** The size of the file when the last read refused it as too large. */
  readonly tooLargeSize: number | undefined
  /** The viewer signals "the refresh landed" – raises the transient indicator. */
  readonly markReloaded: () => void
  /**
   * Reload: a new watch and a forced read. Resolves `true` when the tab follows
   * its file again. Before the first image is on screen there is no watch yet:
   * it only checks the file is there (the viewer then reads it afresh).
   */
  readonly reload: () => Promise<boolean>
  /** The last Reload found no file on disk (its verdict says "still missing", not "could not restart"). */
  readonly reloadFoundMissing: boolean
}

/** Rough parse of the main process's "too large" refusal (`imageRead.ts`): size in MB. */
const TOO_LARGE = /too large \((\d+(?:\.\d+)?) MB\)/i
const MISSING = /ENOENT|no such file|does not exist/i
/** The main process's torn-read refusal (`imageRead.ts` `FileBusyError`, P3): the file is still being written. */
const TORN_READ = /changed while it was read/i

/** Map a rejected `file:readImage` to what the tracker acts on. */
export function imageReadFailure(error: unknown): { outcome: ReadOutcome<ImageVersion>; tooLargeBytes?: number } {
  const message = error instanceof Error ? error.message : String(error)
  const tooLarge = TOO_LARGE.exec(message)
  if (tooLarge) {
    return { outcome: { status: 'blocked', reason: 'too-large' }, tooLargeBytes: Number(tooLarge[1]) * 1024 * 1024 }
  }
  if (MISSING.test(message)) return { outcome: { status: 'missing' } }
  // A torn read means "still being written": settle and read again, without using up a read retry (P3, decision 34)
  if (TORN_READ.test(message)) return { outcome: { status: 'busy' } }
  return { outcome: { status: 'failed' } }
}

/**
 * Follow an image file on disk for the viewer.
 *
 * @param filePath - Absolute path to follow. An empty string follows nothing.
 * @param options - When to start, visibility, and where new bytes go
 *
 * @example
 * ```tsx
 * const watch = useFileChangeSubscription(filePath, {
 *   ready: source !== null, baseline: source?.stamp, visible, currentVersion: source?.version, onBytes: pushSource
 * })
 * ```
 */
export function useFileChangeSubscription(
  filePath: string,
  options: UseFileChangeSubscriptionOptions
): UseFileChangeSubscriptionResult {
  const { ready, baseline, visible } = options
  const [isReloading, setIsReloading] = useState(false)
  const [tooLargeSize, setTooLargeSize] = useState<number | undefined>(undefined)
  const [reloadFoundMissing, setReloadFoundMissing] = useState(false)

  const currentVersionRef = useLatestRef(options.currentVersion)
  const onBytesRef = useLatestRef(options.onBytes)
  const visibleRef = useLatestRef(visible)
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    }
  }, [])

  const markReloaded = useCallback(() => {
    if (!isMountedRef.current) return
    setIsReloading(true)
    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    indicatorTimerRef.current = setTimeout(() => {
      indicatorTimerRef.current = null
      if (isMountedRef.current) setIsReloading(false)
    }, INDICATOR_DURATION_MS)
  }, [])

  const rule = useMemo<UpdateRule<ImageVersion>>(
    () => ({
      read: async (): Promise<ReadOutcome<ImageVersion>> => {
        try {
          const response = await fileGateway.readImage({ filePath, knownVersion: currentVersionRef.current })
          if (!response.stamp) return { status: 'failed' }
          if (response.status === 'unchanged') return { status: 'ok', version: { kind: 'unchanged' }, stamp: response.stamp }
          const bytes: ImageBytes = { dataUrl: response.dataUrl, version: response.version, stamp: response.stamp }
          return { status: 'ok', version: { kind: 'bytes', bytes }, stamp: response.stamp }
        } catch (error) {
          const { outcome, tooLargeBytes } = imageReadFailure(error)
          if (tooLargeBytes !== undefined && isMountedRef.current) setTooLargeSize(tooLargeBytes)
          if (outcome.status === 'failed') logger.warn('Image read for a refresh failed', { filePath })
          return outcome
        }
      },
      // A hidden tab marks the change and reads when it is shown (S1)
      readNow: () => visibleRef.current,
      apply: (version) => {
        if (version.kind === 'bytes') onBytesRef.current(version.bytes)
        return 'applied'
      }
    }),
    [filePath, currentVersionRef, onBytesRef, visibleRef]
  )

  const { state, tracker } = useFreshness<ImageVersion>({
    filePath: filePath || null,
    profile: 'image',
    rule,
    ready,
    baseline,
    visible
  })

  const reload = useCallback(async (): Promise<boolean> => {
    if (!filePath) return false
    const source = freshnessEnvironment().source
    if (tracker) {
      await tracker.reload()
      if (tracker.getState().watch.kind === 'stopped') return false
    }
    // The reload's read is scheduled, not awaited: ask the disk whether the file is there
    const missing = (await source.probe(filePath)).status === 'missing'
    if (isMountedRef.current) setReloadFoundMissing(missing)
    return !missing
  }, [tracker, filePath])

  return {
    state,
    isReloading,
    isFileDeleted: state.content.kind === 'deleted',
    isWatchUnavailable: state.watch.kind === 'stopped' && state.watch.reason !== 'project-closed',
    tooLargeSize,
    markReloaded,
    reload,
    reloadFoundMissing
  }
}

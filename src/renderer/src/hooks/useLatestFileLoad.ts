// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Loads a panel's file and applies only the latest read.
 *
 * Reads are async, so two loads can finish out of order: without a guard an
 * older read that lands last puts the wrong file's text on screen. Each load
 * takes a ticket (`beginLatestLoad`); a load applies its result – success or
 * failure – only while its ticket is still the newest. The effect's cleanup
 * retires the load in flight, which covers unmount, a path change and
 * React StrictMode's mount-unmount-mount.
 *
 * A failed load is never silent: the hook keeps the reason (`loadError`) for
 * the panel to render, and hands it to `onFailed` for a toast.
 *
 * @module hooks/useLatestFileLoad
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatLoadError, loggableError } from '../utils/errorUtils'
import { getBasename } from '../utils/fileUtils'
import { logger } from '../utils/logger'

/**
 * Start a load that only applies while it is still the latest one.
 *
 * Bumping the ref without starting a load retires every load in flight.
 *
 * @param ref - The panel's load counter
 * @returns A check to call after each await; true only while no newer load
 *   (or retirement) has bumped the counter
 *
 * @example
 * ```ts
 * const isLatest = beginLatestLoad(loadSeqRef)
 * const content = await fileGateway.readFile({ filePath })
 * if (!isLatest()) return
 * ```
 */
export function beginLatestLoad(ref: { current: number }): () => boolean {
  const ticket = ++ref.current
  return () => ref.current === ticket
}

/** What a read resolves to: the document text, plus anything the caller wants back with it. */
export interface FileLoadResult {
  /** Document text */
  content: string
}

/** Options for {@link useLatestFileLoad}. */
export interface UseLatestFileLoadOptions<T extends FileLoadResult> {
  /** Reads the file. Called once per load; may reject. */
  read: (filePath: string) => Promise<T>
  /** Called before each read starts (the panel resets its editor-ready flag). */
  onStart?: () => void
  /** Called with the result of the latest load only. */
  onLoaded: (filePath: string, result: T) => void
  /** Called with the user-facing reason when the latest load fails. */
  onFailed?: (message: string) => void
}

/** What {@link useLatestFileLoad} returns. */
export interface UseLatestFileLoadReturn {
  /** Why the latest load failed, or null (none yet, or it succeeded) */
  loadError: string | null
  /** Load the current path again (the error state's "Try again") */
  retry: () => void
}

/**
 * Load `filePath` whenever it changes, applying only the latest read.
 *
 * The callbacks are read through refs, so they may be new functions on every
 * render without re-triggering a load.
 *
 * @param filePath - The file to show, or undefined for none
 * @param options - How to read, and what to do with the result
 * @returns The latest failure reason and a retry
 *
 * @example
 * ```tsx
 * const { loadError, retry } = useLatestFileLoad(props.params?.filePath, {
 *   read: async (filePath) => ({ content: await fileGateway.readFile({ filePath }) }),
 *   onLoaded: (filePath, { content }) => setCurrentFile({ path: filePath, content, modified: false }),
 *   onFailed: (message) => showToast({ title: 'Could not open file', message, type: 'error' })
 * })
 * ```
 */
export function useLatestFileLoad<T extends FileLoadResult>(
  filePath: string | undefined,
  options: UseLatestFileLoadOptions<T>
): UseLatestFileLoadReturn {
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadSeqRef = useRef(0)
  // Ref mirrors, so new callbacks each render never re-trigger a load.
  // Declared before the load effect, so they are current when it runs.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const filePathRef = useRef(filePath)
  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  const load = useCallback(async (path: string): Promise<void> => {
    const isLatest = beginLatestLoad(loadSeqRef)
    logger.info('Loading file', { filePath: path })
    optionsRef.current.onStart?.()
    try {
      const result = await optionsRef.current.read(path)
      if (!isLatest()) return
      // Length only: the document's text stays out of the log
      logger.info('File loaded successfully', { filePath: path, contentLength: result.content.length })
      setLoadError(null)
      optionsRef.current.onLoaded(path, result)
    } catch (error) {
      // A stale failure is dropped too: no toast for a file no longer asked for
      if (!isLatest()) return
      logger.error('Error loading file', loggableError(error))
      const message = formatLoadError(error, getBasename(path) || path)
      setLoadError(message)
      optionsRef.current.onFailed?.(message)
    }
  }, [])

  useEffect(() => {
    if (!filePath) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the read is the effect's job; load() sets state only after its await
    void load(filePath)
    return () => {
      // Retire the load in flight (unmount, path change, StrictMode remount)
      loadSeqRef.current += 1
    }
  }, [filePath, load])

  const retry = useCallback(() => {
    if (filePathRef.current) void load(filePathRef.current)
  }, [load])

  return { loadError, retry }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Decode-first image loading for the image viewer.
 *
 * The refresh path builds the next image **off the DOM** and waits for it to
 * decode before touching React state. Consequences, all of them deliberate:
 *
 * - the currently painted image stays on screen for the whole round trip, so
 *   there is no blank frame while up to 50 MB decodes;
 * - `src`, the intrinsic dimensions, the file size and the timestamp commit in
 *   ONE state update, and the view reconciler (`onSourceCommit`) is called from
 *   the same synchronous block, so React batches the transform into that same
 *   commit - the refreshed image is never painted once at the old zoom and then
 *   snapped;
 * - nothing needs a ref to the rendered `<img>`, which removes the shared-ref
 *   defect where the full-screen portal image stole the panel image's ref.
 *
 * The read itself is version-gated: each accepted source carries the opaque
 * token the main process minted for its bytes, and the next read hands that
 * token back. A file that has not actually changed then answers `unchanged`,
 * which costs no base64 encode on the main-process event loop and no multi-MB
 * IPC payload - the difference between a watcher event being free and it
 * freezing the whole app for ~100-200 ms while an agent rewrites an asset.
 *
 * @module useImageSource
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { logger } from '../../../../utils/logger'

// ============================================================================
// Types
// ============================================================================

/**
 * One atomically-committed view of the file on disk.
 *
 * Every field moves together. Splitting them across several `useState` calls is
 * what produced the "old zoom then snap" frame the decode-first path removes.
 */
export interface ImageSource {
  /** `data:` URL produced by `file:readImage`. */
  url: string
  /**
   * Opaque version token the main process minted for {@link ImageSource.url}.
   *
   * Echoed back on the next read so an unchanged file answers `unchanged`
   * instead of re-encoding and re-sending up to ~67 MB of base64 (#70). It
   * lives in the source rather than in a ref of its own so it always moves
   * with the bytes it labels - in particular {@link UseImageSourceResult.handleImageError}
   * reverts both together, and the refresh after a revert then compares
   * against the version of the bytes actually on screen.
   *
   * Never parse it or build one: what goes into it is a main-process detail.
   */
  version: string
  /** Intrinsic width reported by the off-DOM decoder. */
  naturalWidth: number
  /** Intrinsic height reported by the off-DOM decoder. */
  naturalHeight: number
  /**
   * Monotonic counter, incremented once per accepted load.
   *
   * Guards out-of-order decodes: a slow big image resolving after a fast small
   * one must not overwrite the newer bytes. It is bookkeeping, not a render
   * trigger – the view reconciles through {@link UseImageSourceOptions.onSourceCommit},
   * which is why nothing keys off `onLoad` (entering full screen re-fires
   * `onLoad` without the file having changed).
   */
  generation: number
  /** File size in bytes at read time. Falls back to the previous value if `getStats` fails. */
  fileSize: number
  /** Milliseconds since the epoch when these bytes were read. */
  updatedAt: number
}

/** Intrinsic dimensions handed to {@link UseImageSourceOptions.onSourceCommit}. */
export interface SourceDimensions {
  width: number
  height: number
}

/** Options for {@link useImageSource}. */
export interface UseImageSourceOptions {
  /** Absolute path of the image. An empty string produces the "no file path" error. */
  filePath: string
  /**
   * Whether the panel is currently visible.
   *
   * The *watch* is always live; only the expensive base64 pull is deferred, so
   * a hidden tab costs nothing while an agent rewrites an asset in a loop and is
   * still fresh the moment the user looks at it.
   */
  isVisible: boolean
  /** Called once per successful **refresh** (never for the initial load). */
  onRefreshed?: () => void
  /**
   * Reconciles the view with the image that is being committed right now.
   *
   * Invoked **synchronously in the same block as the `setSource` call**, so any
   * state the callback sets is batched into the same React commit as the new
   * `src`. That is the whole point: a caller that instead derived the view from
   * `source` in an effect would paint the refreshed bytes once at the previous
   * zoom and pan before correcting on the next commit (UX-4).
   *
   * `previous` is `null` on the initial load and after a repoint, so a caller
   * that only reacts to *changed* dimensions still always fits the first image.
   *
   * @param previous - Intrinsic size of the image being replaced, or `null`
   * @param next - Intrinsic size of the image being committed
   */
  onSourceCommit?: (previous: SourceDimensions | null, next: SourceDimensions) => void
}

/** State and actions returned by {@link useImageSource}. */
export interface UseImageSourceResult {
  /** The current bytes, or `null` before the first successful load. */
  source: ImageSource | null
  /** True only during the *initial* load; a refresh never raises it. */
  isLoading: boolean
  /**
   * Fatal load error: there is nothing to show.
   *
   * Only the initial load raises it – a refresh keeps the last good image and
   * reports {@link UseImageSourceResult.isStale} instead. It is cleared by ANY
   * accepted commit, so a tab whose first load lost a race with a half-written
   * file recovers on the next watcher event instead of latching forever (H1).
   */
  error: string | null
  /**
   * The image on screen is older than the file on disk.
   *
   * Raised when a re-read fails (truncated write, a file that grew past the
   * read cap, a transient I/O error) or when the rendered element could not
   * paint the new bytes and we reverted. Without it a failed refresh is
   * invisible and reads as "the agent's edit did nothing" (H2).
   */
  isStale: boolean
  /** Request a re-read. Defers to the next visibility transition while hidden. */
  refresh: () => void
  /** `<img onError>` handler: reverts to the last good source, or reports failure. */
  handleImageError: () => void
}

// ============================================================================
// Off-DOM decoding
// ============================================================================

/**
 * Loads and decodes an image without attaching it to the document.
 *
 * Prefers `HTMLImageElement.decode()`, which resolves only once the bitmap is
 * ready to paint. jsdom does not implement it, so tests exercise the
 * `load`/`error` fallback unless they stub `decode`.
 *
 * @param url - `data:` URL to decode
 * @returns The decoded image's intrinsic dimensions
 * @throws {Error} When the bytes cannot be decoded (truncated or corrupt file)
 */
async function decodeOffDom(
  url: string
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  const image = new Image()
  image.src = url

  if (typeof image.decode === 'function') {
    await image.decode()
  } else {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image failed to decode'))
    })
  }

  return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }
}

/**
 * Reads file size without letting a stats failure break the load.
 *
 * Size is decoration; the image is the payload. A file on a volume that refuses
 * `stat` should still render.
 *
 * @param filePath - Path to stat
 * @returns Size in bytes, or `null` when stats are unavailable
 */
async function safeGetFileSize(filePath: string): Promise<number | null> {
  try {
    const stats = await window.api.file.getStats(filePath)
    return stats.size
  } catch (error) {
    logger.warn('Failed to get file stats', { filePath, error: String(error) })
    return null
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Loads an image as a data URL and keeps it in step with the file on disk.
 *
 * @param options - Path, visibility, the post-refresh callback and the view reconciler
 * @returns The current source plus loading/error state and a `refresh` trigger
 *
 * @example
 * ```tsx
 * const { source, isLoading, error, isStale, refresh, handleImageError } = useImageSource({
 *   filePath,
 *   isVisible: props.api.isVisible,
 *   onRefreshed: markReloaded,
 *   onSourceCommit: (previous, next) => applySourceChangeRef.current(previous, next)
 * })
 *
 * useFileChangeSubscription(filePath, { onExternalChange: refresh })
 * ```
 */
export function useImageSource(options: UseImageSourceOptions): UseImageSourceResult {
  const { filePath, isVisible, onRefreshed, onSourceCommit } = options

  const [source, setSource] = useState<ImageSource | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)

  const generationRef = useRef(0)
  const isMountedRef = useRef(true)
  /** Previous accepted source, used to revert if the rendered `<img>` fails to paint. */
  const previousSourceRef = useRef<ImageSource | null>(null)
  /** Latest accepted source, read by `load` without re-creating the callback. */
  const currentSourceRef = useRef<ImageSource | null>(null)
  /** A change arrived while the panel was hidden; run the read on the next visibility transition. */
  const pendingRefreshRef = useRef(false)

  const onRefreshedRef = useRef(onRefreshed)
  const onSourceCommitRef = useRef(onSourceCommit)
  useEffect(() => {
    onRefreshedRef.current = onRefreshed
    onSourceCommitRef.current = onSourceCommit
  }, [onRefreshed, onSourceCommit])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  /**
   * Hands the incoming dimensions to the view reconciler.
   *
   * Callers must invoke this from the *same* synchronous block as `setSource`;
   * that is what makes React batch the two updates into one commit.
   *
   * @param outgoing - Source being replaced, or `null` on the first load
   * @param incoming - Source being committed
   */
  const commitToView = useCallback(
    (outgoing: ImageSource | null, incoming: ImageSource): void => {
      try {
        onSourceCommitRef.current?.(
          outgoing ? { width: outgoing.naturalWidth, height: outgoing.naturalHeight } : null,
          { width: incoming.naturalWidth, height: incoming.naturalHeight }
        )
      } catch (commitError) {
        // The bytes are already committed, so a reconciler that throws is a
        // view bug, not a load failure. Swallowing it here keeps the caller's
        // catch for what it is for - and stops a throw being reported as
        // "keeping the last loaded image" while the new image is on screen.
        logger.error(
          'Image view reconciler threw; the image is committed but the zoom may be stale',
          commitError instanceof Error ? commitError : undefined
        )
      }
    },
    []
  )

  /**
   * Reads, decodes and commits the file.
   *
   * `initial` clears the view first and reports failure through `error`, which
   * preserves the pre-#70 error surface. `refresh` never clears anything and
   * never sets `error`: a truncated write that fails to decode leaves the last
   * good image on screen and only produces a log line.
   */
  const load = useCallback(
    async (mode: 'initial' | 'refresh'): Promise<void> => {
      if (!filePath) {
        setError('No file path provided')
        setIsLoading(false)
        return
      }

      const generation = generationRef.current + 1
      generationRef.current = generation

      if (mode === 'initial') {
        setIsLoading(true)
        setError(null)
        setSource(null)
        currentSourceRef.current = null
        previousSourceRef.current = null
      }

      // Set only when the bytes were accepted, so the post-`try` block can tell
      // "committed" from "failed" without re-reading state.
      let committed: { outgoing: ImageSource | null; next: ImageSource } | null = null

      try {
        // The version whose bytes are on screen right now. `initial` nulled the
        // ref just above, so this is naturally `undefined` there - a first load
        // or a repoint to another file must always do a full read, never
        // compare against the version of the file it has stopped showing.
        const knownVersion = currentSourceRef.current?.version
        const response = await window.api.file.readImage(filePath, knownVersion)

        // `unchanged` is a SUCCESS meaning "you are already current", so this
        // returns without decoding, without committing and without moving
        // `updatedAt`; `onRefreshed` stays silent too, because announcing
        // "Reloaded from disk" for a refresh that changed nothing is a lie.
        // `error` and `isStale` are left untouched for the same reason: the
        // response is evidence that nothing was read, not that a read of new
        // bytes succeeded.
        if (response.status === 'unchanged') return

        const { dataUrl: url, version } = response
        const { naturalWidth, naturalHeight } = await decodeOffDom(url)
        const fileSize = await safeGetFileSize(filePath)

        // Out-of-order guard: a slower earlier read must never overwrite a
        // newer one that already committed.
        if (!isMountedRef.current || generation !== generationRef.current) return

        const outgoing = currentSourceRef.current
        const next: ImageSource = {
          url,
          // Same atomic commit as the bytes: a version stored separately could
          // outlive a reverted `src` and skip the refresh that fixes it.
          version,
          naturalWidth,
          naturalHeight,
          generation,
          fileSize: fileSize ?? outgoing?.fileSize ?? 0,
          updatedAt: Date.now()
        }

        previousSourceRef.current = outgoing
        currentSourceRef.current = next
        setSource(next)
        // H1/H2: an accepted commit is proof that both degraded states are
        // over. Clearing them only in `initial` mode latched a failed first
        // load forever - a later successful refresh swapped the bytes in
        // behind an error screen the user could not dismiss.
        setError(null)
        setIsStale(false)
        committed = { outgoing, next }
      } catch (loadError) {
        if (!isMountedRef.current || generation !== generationRef.current) return

        const message =
          loadError instanceof Error ? loadError.message : 'Failed to load image'

        if (mode === 'refresh') {
          // Keep the last good image, but say so: the toolbar timestamp alone
          // is not a signal anyone reads, and silence looks like "the edit did
          // nothing" (H2).
          logger.error(
            'Image refresh failed; keeping the last loaded image',
            loadError instanceof Error ? loadError : undefined,
            { filePath }
          )
          setIsStale(true)
          return
        }

        logger.error(
          'Image load error',
          loadError instanceof Error ? loadError : undefined,
          { filePath }
        )
        setError(message)
      } finally {
        if (isMountedRef.current && mode === 'initial' && generation === generationRef.current) {
          setIsLoading(false)
        }
      }

      if (!committed) return

      // Still the same synchronous block - nothing above awaits after the
      // guard - so React batches `src` and the transform into ONE commit and
      // the refreshed image is never painted at the previous zoom (UX-4).
      // Outside the `try` on purpose: a reconciler that throws must not be
      // caught by the load's own error handling.
      commitToView(committed.outgoing, committed.next)
      if (mode === 'refresh') onRefreshedRef.current?.()
    },
    [filePath, commitToView]
  )

  // Initial load, and a full reload whenever the panel is repointed at another file.
  useEffect(() => {
    pendingRefreshRef.current = false
    void load('initial')
  }, [load])

  /**
   * Requests a refresh, deferring the read while the panel is hidden.
   *
   * Written against the hook's own `isVisible` input rather than reaching into
   * dockview, so swapping to `api.isActive` is a one-line change at the call
   * site if this dockview build reports `isVisible` for inactive tabs.
   */
  const refresh = useCallback(() => {
    if (!isVisible) {
      pendingRefreshRef.current = true
      return
    }
    void load('refresh')
  }, [isVisible, load])

  // Drain a deferred refresh when the panel becomes visible again.
  useEffect(() => {
    if (!isVisible || !pendingRefreshRef.current) return
    pendingRefreshRef.current = false
    void load('refresh')
  }, [isVisible, load])

  /**
   * Belt and braces for the residual case where the bytes decoded off-DOM but
   * the rendered element still failed to paint them.
   */
  const handleImageError = useCallback(() => {
    logger.error('Rendered image failed to paint', undefined, { filePath })

    const fallback = previousSourceRef.current
    if (fallback) {
      const outgoing = currentSourceRef.current
      currentSourceRef.current = fallback
      previousSourceRef.current = null
      setSource(fallback)
      // A silent revert is the same defect as a silent failed refresh: the user
      // is looking at bytes that are older than the file (H2).
      setIsStale(true)
      // The revert swaps `src` too, so it owes the view the same one-commit
      // guarantee as a normal load.
      commitToView(outgoing, fallback)
      return
    }

    setSource(null)
    currentSourceRef.current = null
    setError('Failed to display image')
  }, [filePath, commitToView])

  return { source, isLoading, error, isStale, refresh, handleImageError }
}

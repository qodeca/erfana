// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scroll Synchronization Hook for Markdown Editor
 *
 * Provides bidirectional scroll synchronization between the Monaco editor
 * and the markdown preview pane. Uses a scroll map to correlate line positions
 * in the editor with pixel offsets in the preview.
 *
 * @module MarkdownEditorPanel/hooks/useScrollSync
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { MonacoEditorHandle } from '../../MonacoMarkdownEditor'
import type { ViewMode } from '../types'
import {
  type ScrollMapEntry,
  processElementForScrollMap,
  aggregateLineOffsets,
  buildScrollMapEntries,
  enforceMonotonicPreviewOffsets,
  interpolateScrollPosition,
  isSplitMode
} from '../../../../components/Panels/markdownEditorPanel.logic'
import { logger } from '../../../../utils/logger'
import type { PreviewRenderedInfo } from '../../MarkdownPreview'

/**
 * Configuration options for the useScrollSync hook.
 */
export interface UseScrollSyncOptions {
  /** Reference to the Monaco editor handle */
  editorRef: React.RefObject<MonacoEditorHandle | null>
  /** Reference to the preview container element */
  previewRef: React.RefObject<HTMLDivElement | null>
  /** Current view mode of the editor panel */
  viewMode: ViewMode
  /** Path of the currently open file (used as dependency for rebuilds) */
  currentFilePath: string | null
}

/**
 * Return type for the useScrollSync hook.
 */
export interface UseScrollSyncReturn {
  /** Whether the editor is ready for scroll synchronization */
  isEditorReady: boolean
  /** Sets the editor ready state (called from editor mount callback) */
  setIsEditorReady: (ready: boolean) => void
  /** Reference to the current scroll map entries */
  scrollMapRef: React.RefObject<ScrollMapEntry[]>
  /** Triggers a rebuild of the scroll map */
  rebuildScrollMap: () => void
  /** Handles scroll events from the editor */
  handleEditorScroll: () => void
  /** Handles scroll events from the preview */
  handlePreviewScroll: () => void
  /**
   * Pass to `MarkdownPreview`'s `onRendered`: rebuilds the map when the
   * preview DOM changed. Stable while the view mode and readiness hold.
   */
  handlePreviewRendered: (info: PreviewRenderedInfo) => void
}

/** Debounce delay for resize observer callbacks (ms) */
const RESIZE_DEBOUNCE_MS = 150

/** Debounce delay for mermaid/image render callbacks (ms) */
const RENDER_DEBOUNCE_MS = 120

/** Fallback timeout for waiting for preview content (ms) */
const CONTENT_READY_FALLBACK_MS = 600

/** Fallback timeout for mermaid render events (ms) */
const MERMAID_READY_FALLBACK_MS = 800

/**
 * Hook for synchronizing scroll positions between editor and preview.
 *
 * Creates a bidirectional scroll map that correlates editor line numbers
 * with preview pixel offsets. Handles resize events, content changes,
 * and asynchronous content rendering (images, Mermaid diagrams).
 *
 * @param options - Configuration options for scroll sync
 * @returns Scroll sync state and controls
 *
 * @example
 * ```tsx
 * function MarkdownEditor() {
 *   const editorRef = useRef<MonacoEditorHandle>(null)
 *   const previewRef = useRef<HTMLDivElement>(null)
 *
 *   const {
 *     isEditorReady,
 *     setIsEditorReady,
 *     rebuildScrollMap,
 *     handleEditorScroll,
 *     handlePreviewScroll
 *   } = useScrollSync({
 *     editorRef,
 *     previewRef,
 *     viewMode: 'split',
 *     currentFilePath: '/path/to/file.md',
 *   })
 *
 *   const handleEditorMount = (editor) => {
 *     setIsEditorReady(true)
 *   }
 *
 *   return (
 *     <div className="split-view">
 *       <MonacoEditor ref={editorRef} onMount={handleEditorMount} />
 *       <Preview ref={previewRef} />
 *     </div>
 *   )
 * }
 * ```
 */
export function useScrollSync(options: UseScrollSyncOptions): UseScrollSyncReturn {
  const { editorRef, previewRef, viewMode, currentFilePath } = options

  // Scroll synchronization state
  const scrollMapRef = useRef<ScrollMapEntry[]>([])
  const isSyncingRef = useRef(false)
  const [isEditorReady, setIsEditorReady] = useState(false)

  // Unified helper: detect any split mode (vertical or horizontal)
  const isAnySplitMode = isSplitMode(viewMode)

  /**
   * Builds the scroll map from preview DOM elements.
   *
   * Scans the preview container for elements with `data-line-start` attributes
   * and creates a mapping between editor line positions and preview pixel offsets.
   *
   * @returns Array of scroll map entries sorted by line number
   */
  const buildScrollMap = useCallback((): ScrollMapEntry[] => {
    logger.debug('buildScrollMap() called')

    if (!editorRef.current || !previewRef.current) {
      logger.debug('Skipping buildScrollMap: missing refs')
      return []
    }

    const editor = editorRef.current.getEditor()
    if (!editor) {
      logger.debug('Skipping buildScrollMap: no editor')
      return []
    }

    const container = previewRef.current
    const containerRect = container.getBoundingClientRect()
    const containerScrollTop = container.scrollTop

    // Collect candidates using start/end ranges
    const nodeList = container.querySelectorAll('[data-line-start]')
    logger.debug(`Found ${nodeList.length} elements with data-line-start attribute`)

    // Process each element using extracted logic
    const config = { containerRect, containerScrollTop }
    const elementsData = Array.from(nodeList)
      .map((el) => processElementForScrollMap(el, config))
      .filter((data): data is NonNullable<typeof data> => data !== null)

    // Aggregate and build map using extracted functions
    const lineToOffset = aggregateLineOffsets(elementsData)
    const getEditorOffset = (line: number) => editor.getTopForLineNumber(line)
    const entries = buildScrollMapEntries(lineToOffset, getEditorOffset)
    const map = enforceMonotonicPreviewOffsets(entries)

    logger.debug(`buildScrollMap completed: ${map.length} entries`)
    return map
  }, [editorRef, previewRef])

  /**
   * Rebuilds the scroll map after a layout change.
   *
   * Uses double requestAnimationFrame to ensure DOM has settled
   * before measuring element positions.
   */
  const rebuildScrollMap = useCallback(() => {
    logger.debug('rebuildScrollMap called, checking conditions', {
      hasEditor: !!editorRef.current,
      hasPreview: !!previewRef.current,
      isAnySplitMode
    })

    if (!editorRef.current || !previewRef.current || !isAnySplitMode) {
      logger.debug('Skipping scroll map rebuild: preconditions not met')
      return
    }

    // Double RAF ensures DOM has fully settled after layout changes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          logger.debug('Building scroll map')
          const map = buildScrollMap()
          scrollMapRef.current = map
          logger.debug(`Scroll map rebuilt: ${map.length} entries`)
          if (map.length > 0) {
            logger.debug('First few entries', { entries: map.slice(0, 3) })
          }
        } catch (error) {
          logger.error('Error rebuilding scroll map', error instanceof Error ? error : undefined)
          scrollMapRef.current = []
        }
      })
    })
  }, [isAnySplitMode, buildScrollMap, editorRef, previewRef])

  /**
   * Handles scroll events from the Monaco editor.
   *
   * Calculates the corresponding preview scroll position using the scroll map
   * and syncs the preview pane.
   */
  const handleEditorScroll = useCallback(() => {
    if (isSyncingRef.current || !previewRef.current) return

    try {
      // Defensive: verify previewRef is still attached to DOM
      if (!previewRef.current.offsetParent) return

      const editor = editorRef.current?.getEditor()
      if (!editor || scrollMapRef.current.length === 0) return

      const scrollTop = editor.getScrollTop()
      const targetOffset = interpolateScrollPosition(scrollTop, scrollMapRef.current, 'editor')

      isSyncingRef.current = true
      previewRef.current.scrollTop = targetOffset

      // Use RAF instead of setTimeout (more reliable)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isSyncingRef.current = false
        })
      })
    } catch (error) {
      logger.error('Error in handleEditorScroll', error instanceof Error ? error : undefined)
      isSyncingRef.current = false
    }
  }, [editorRef, previewRef])

  /**
   * Handles scroll events from the preview pane.
   *
   * Calculates the corresponding editor scroll position using the scroll map
   * and syncs the editor.
   */
  const handlePreviewScroll = useCallback(() => {
    if (isSyncingRef.current || !previewRef.current) return

    try {
      // Defensive: verify previewRef is still attached to DOM
      if (!previewRef.current.offsetParent) return

      const editor = editorRef.current?.getEditor()
      if (!editor || scrollMapRef.current.length === 0) return

      const scrollTop = previewRef.current.scrollTop
      const targetOffset = interpolateScrollPosition(scrollTop, scrollMapRef.current, 'preview')

      isSyncingRef.current = true
      editor.setScrollTop(targetOffset)

      // Use RAF instead of setTimeout (more reliable)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isSyncingRef.current = false
        })
      })
    } catch (error) {
      logger.error('Error in handlePreviewScroll', error instanceof Error ? error : undefined)
      isSyncingRef.current = false
    }
  }, [editorRef, previewRef])

  // Reset editor state when view mode changes - force rebuild on next effect
  // Uses functional update to avoid unnecessary state changes if already false
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kept as an effect on purpose: moving the reset into render would change what the scroll-listener and rebuild effects below see on the view-mode commit
    setIsEditorReady((prev) => {
      if (prev) {
        logger.debug('Resetting editor state due to view mode change', { viewMode })
        return false
      }
      return prev
    })
  }, [viewMode])

  // Notify Monaco of layout changes (no state coordination needed)
  useEffect(() => {
    if (!isAnySplitMode) return

    const editor = editorRef.current?.getEditor()
    if (editor) {
      requestAnimationFrame(() => {
        logger.debug('Notifying Monaco Editor of layout change')
        editor.layout()
      })
    }
  }, [isAnySplitMode, viewMode, editorRef])

  // Resize observers: rebuild mapping when preview/editor containers resize
  useEffect(() => {
    if (!isAnySplitMode) return
    const previewEl = previewRef.current
    const editorEl = editorRef.current?.getEditor()?.getDomNode() || null
    if (!previewEl || !editorEl) return

    let debounceTimer: number | null = null
    const debouncedRebuild = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        rebuildScrollMap()
      }, RESIZE_DEBOUNCE_MS)
    }

    const ro = new ResizeObserver(() => debouncedRebuild())
    ro.observe(previewEl)
    ro.observe(editorEl)

    const onWindowResize = () => debouncedRebuild()
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      ro.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [isAnySplitMode, currentFilePath, isEditorReady, rebuildScrollMap, editorRef, previewRef])

  /**
   * Wait until a preview root is worth measuring: its images have loaded (or
   * failed) and, if it has diagrams, one has reported drawing – each bounded
   * by a fallback so a stuck image or diagram cannot hold the map back.
   */
  const waitForPreviewReady = useCallback(async (root: HTMLElement): Promise<void> => {
    const loadingImages = Array.from(root.querySelectorAll('img'))
      .filter((img) => !(img as HTMLImageElement).complete)
      .map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          })
      )

    const mermaidReady =
      root.querySelector('.mermaid-wrapper') !== null
        ? new Promise<void>((resolve) => {
            const handler = (): void => {
              root.removeEventListener('mermaid:rendered', handler)
              resolve()
            }
            root.addEventListener('mermaid:rendered', handler, { once: true })
            setTimeout(() => {
              root.removeEventListener('mermaid:rendered', handler)
              resolve()
            }, MERMAID_READY_FALLBACK_MS)
          })
        : Promise.resolve()

    const fallback = new Promise<void>((resolve) => setTimeout(resolve, CONTENT_READY_FALLBACK_MS))
    await Promise.race([Promise.all([Promise.all(loadingImages), mermaidReady]).then(() => undefined), fallback])
  }, [])

  // One pending "content" rebuild at a time; a newer preview commit cancels it.
  const pendingContentRebuildRef = useRef<(() => void) | null>(null)
  // Debounce for diagram / late-image rebuilds.
  const lateRebuildTimerRef = useRef<number | null>(null)

  const scheduleLateRebuild = useCallback(() => {
    if (lateRebuildTimerRef.current) clearTimeout(lateRebuildTimerRef.current)
    lateRebuildTimerRef.current = window.setTimeout(() => {
      lateRebuildTimerRef.current = null
      rebuildScrollMap()
    }, RENDER_DEBOUNCE_MS)
  }, [rebuildScrollMap])

  // Mode and readiness as of the last commit, for the stable callback below.
  const syncGateRef = useRef({ isAnySplitMode, isEditorReady })
  useEffect(() => {
    syncGateRef.current = { isAnySplitMode, isEditorReady }
  }, [isAnySplitMode, isEditorReady])

  /**
   * The preview's DOM changed – the ONLY trigger for content rebuilds.
   *
   * The preview renders behind the editor (deferred, and debounced for large
   * documents), so an editor content change says nothing about the DOM. And
   * the preview remounts on a view-mode switch (`split` ↔ `split-horizontal`),
   * so `info.root` – not a listener attached to an earlier element – is what
   * gets measured.
   */
  const handlePreviewRendered = useCallback(
    (info: PreviewRenderedInfo) => {
      // Point the shared ref at the element that just rendered; the panel
      // re-syncs it only after its own effects run, which is later.
      if (previewRef.current !== info.root) {
        ;(previewRef as React.MutableRefObject<HTMLDivElement | null>).current = info.root
      }
      const { isAnySplitMode: split, isEditorReady: ready } = syncGateRef.current
      if (!split || !ready) return

      // A diagram drawn or an image arrived: content moved after the commit
      if (info.reason === 'diagram' || info.reason === 'image') {
        scheduleLateRebuild()
        return
      }

      pendingContentRebuildRef.current?.()
      let cancelled = false
      pendingContentRebuildRef.current = () => {
        cancelled = true
      }

      // Images that finish after the readiness fallback still move content.
      for (const img of Array.from(info.root.querySelectorAll('img'))) {
        if (!(img as HTMLImageElement).complete) {
          img.addEventListener('load', scheduleLateRebuild, { once: true })
          img.addEventListener('error', scheduleLateRebuild, { once: true })
        }
      }

      void waitForPreviewReady(info.root).then(() => {
        if (cancelled) return
        logger.debug('Preview rendered and ready. Rebuilding scroll map')
        rebuildScrollMap()
      })
    },
    [previewRef, rebuildScrollMap, scheduleLateRebuild, waitForPreviewReady]
  )

  // A split view (re)entered or the editor (re)mounted: build the map once the
  // preview is ready. Later content changes arrive via handlePreviewRendered.
  useEffect(() => {
    if (!isAnySplitMode || !isEditorReady || !previewRef.current) return
    let cancelled = false
    void waitForPreviewReady(previewRef.current).then(() => {
      if (!cancelled) rebuildScrollMap()
    })
    return () => {
      cancelled = true
    }
  }, [viewMode, isEditorReady, isAnySplitMode, rebuildScrollMap, waitForPreviewReady, previewRef])

  // Drop pending rebuilds on unmount.
  useEffect(
    () => () => {
      pendingContentRebuildRef.current?.()
      if (lateRebuildTimerRef.current) clearTimeout(lateRebuildTimerRef.current)
    },
    []
  )

  // Attach scroll listeners
  useEffect(() => {
    if (!isAnySplitMode || !isEditorReady || !previewRef.current) {
      logger.debug('Skipping listener attachment', {
        isAnySplitMode,
        isEditorReady,
        hasPreviewRef: !!previewRef.current
      })
      return
    }

    const editor = editorRef.current?.getEditor()
    if (!editor) {
      logger.debug('Skipping listener attachment: no editor')
      return
    }

    logger.debug('Attaching scroll listeners directly')

    // Attach listeners immediately - scroll map should be built by now
    try {
      const editorDisposable = editor.onDidScrollChange(handleEditorScroll)
      const previewElement = previewRef.current!
      previewElement.addEventListener('scroll', handlePreviewScroll)

      logger.debug('Scroll listeners attached successfully', { scrollMapSize: scrollMapRef.current.length })

      return () => {
        logger.debug('Removing scroll listeners')
        editorDisposable.dispose()
        previewElement.removeEventListener('scroll', handlePreviewScroll)
      }
    } catch (error) {
      logger.error('Error attaching scroll listeners', error instanceof Error ? error : undefined)
      return undefined
    }
  }, [viewMode, currentFilePath, isEditorReady, handleEditorScroll, handlePreviewScroll, isAnySplitMode, editorRef, previewRef])

  return {
    isEditorReady,
    setIsEditorReady,
    scrollMapRef,
    rebuildScrollMap,
    handleEditorScroll,
    handlePreviewScroll,
    handlePreviewRendered
  }
}

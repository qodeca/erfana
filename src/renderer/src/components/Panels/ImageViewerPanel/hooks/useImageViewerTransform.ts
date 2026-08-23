// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zoom, pan and fit state for the image viewer.
 *
 * The hook never learns that full screen exists. It asks the caller for
 * "whatever container is active right now" through `getActiveContainer`, so the
 * panel owns the full-screen decision and the hook stays a pure
 * transform-state machine.
 *
 * @module useImageViewerTransform
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  Transform,
  INITIAL_TRANSFORM,
  PAN_CONFIG,
  getNextZoomLevel,
  clampScale,
  clampPan,
  calculateFitScale,
  calculateCursorCenteredZoom,
  getKeyboardAction,
  getZoomButtonStates
} from '../imageViewer.logic'

/** Intrinsic image dimensions the fit maths works from. */
export interface ImageDimensions {
  width: number
  height: number
}

/** Options for {@link useImageViewerTransform}. */
export interface UseImageViewerTransformOptions {
  /**
   * Returns the element the image is currently displayed in.
   *
   * Called on every geometry read rather than captured once, because the active
   * container swaps when the panel enters or leaves full screen.
   */
  getActiveContainer: () => HTMLElement | null
  /** Intrinsic size of the current image, or `null` before the first decode. */
  imageSize: ImageDimensions | null
  /** Whether keyboard shortcuts should apply right now (focus is inside this viewer). */
  isKeyboardScoped: () => boolean
  /** Invoked for the Escape shortcut; the panel decides what "escape" means. */
  onEscape: () => void
  /** Returns true when a mousedown target must not start a pan (toolbar, buttons). */
  isDragBlocked: (target: HTMLElement) => boolean
}

/** State and actions returned by {@link useImageViewerTransform}. */
export interface UseImageViewerTransformResult {
  transform: Transform
  isFitMode: boolean
  canZoomIn: boolean
  canZoomOut: boolean
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  fitToView: () => void
  handleDoubleClick: () => void
  handleMouseDown: (event: React.MouseEvent) => void
  /** Reconcile the view with a newly loaded image. See the hook docs. */
  applySourceChange: (previous: ImageDimensions | null, next: ImageDimensions) => void
}

/**
 * Upper bound on frames spent waiting for a container to be laid out.
 *
 * The pre-#70 code retried unboundedly, which spins forever for a panel that is
 * never laid out. One second at 60 fps is generous for a dockview panel and
 * fails quiet rather than burning a frame budget indefinitely.
 */
const MAX_LAYOUT_WAIT_FRAMES = 60

/**
 * Manages the viewer's transform.
 *
 * @param options - Container accessor, image size, and input-scoping callbacks
 * @returns Transform state and the actions that mutate it
 *
 * @example
 * ```tsx
 * const transform = useImageViewerTransform({
 *   getActiveContainer: () => (isFullScreen ? fsRef.current : containerRef.current),
 *   imageSize: source && { width: source.naturalWidth, height: source.naturalHeight },
 *   isKeyboardScoped: () => panelRef.current?.contains(document.activeElement) ?? false,
 *   onEscape: closeFullScreen,
 *   isDragBlocked: (target) => Boolean(target.closest('button'))
 * })
 * ```
 */
export function useImageViewerTransform(
  options: UseImageViewerTransformOptions
): UseImageViewerTransformResult {
  const { getActiveContainer, imageSize, isKeyboardScoped, onEscape, isDragBlocked } = options

  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM)
  const [isFitMode, setIsFitMode] = useState(false)

  // Handlers registered once on `document` read live values through refs so they
  // never need re-registration (and never capture a stale transform).
  const transformRef = useRef(transform)
  /**
   * Bumped once per accepted transform change.
   *
   * A fit that is waiting for the container to be laid out compares this against
   * the value it captured when it was scheduled, so it abandons itself the
   * moment anything else moves the view. Without that check, the fit for a
   * just-loaded image lands several frames later and yanks a view the user has
   * since zoomed or panned.
   */
  const transformRevisionRef = useRef(0)
  useEffect(() => {
    transformRef.current = transform
    transformRevisionRef.current += 1
  }, [transform])

  /**
   * Current fit mode, read from inside the layout-deferred fit.
   *
   * A ref rather than a dependency, so `applySourceChange` keeps a stable
   * identity - the panel publishes it into a ref for the source hook to call at
   * commit time, and a new identity on every zoom would churn that wiring.
   */
  const isFitModeRef = useRef(isFitMode)
  useEffect(() => {
    isFitModeRef.current = isFitMode
  }, [isFitMode])

  /** Handle of the frame a layout-deferred fit is waiting on, if any. */
  const pendingFitFrameRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  /** Cancels a fit that is still waiting for the container to be laid out. */
  const cancelPendingFit = useCallback((): void => {
    if (pendingFitFrameRef.current !== null) {
      cancelAnimationFrame(pendingFitFrameRef.current)
      pendingFitFrameRef.current = null
    }
  }, [])

  // A chain that re-queues itself up to MAX_LAYOUT_WAIT_FRAMES times must be
  // cancellable, or a panel closed (or a project switched) mid-wait keeps
  // running frames and calls setTransform after unmount.
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      cancelPendingFit()
    }
  }, [cancelPendingFit])

  const getActiveContainerRef = useRef(getActiveContainer)
  const isKeyboardScopedRef = useRef(isKeyboardScoped)
  const isDragBlockedRef = useRef(isDragBlocked)
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    getActiveContainerRef.current = getActiveContainer
    isKeyboardScopedRef.current = isKeyboardScoped
    isDragBlockedRef.current = isDragBlocked
    onEscapeRef.current = onEscape
  }, [getActiveContainer, isKeyboardScoped, isDragBlocked, onEscape])

  const isDragging = useRef(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  const { canZoomIn, canZoomOut } = getZoomButtonStates(transform.scale)

  // ========================================
  // Zoom actions
  // ========================================

  const zoomIn = useCallback(() => {
    setIsFitMode(false)
    setTransform((prev) => ({ ...prev, scale: getNextZoomLevel(prev.scale, 'in') }))
  }, [])

  const zoomOut = useCallback(() => {
    setIsFitMode(false)
    setTransform((prev) => ({ ...prev, scale: getNextZoomLevel(prev.scale, 'out') }))
  }, [])

  const reset = useCallback(() => {
    setIsFitMode(false)
    setTransform(INITIAL_TRANSFORM)
  }, [])

  const fitToView = useCallback(() => {
    const container = getActiveContainerRef.current()
    if (!container || !imageSize) return

    const rect = container.getBoundingClientRect()
    const fitScale = calculateFitScale(imageSize.width, imageSize.height, rect.width, rect.height)

    setTransform({ scale: clampScale(fitScale), translateX: 0, translateY: 0 })
    setIsFitMode(true)
  }, [imageSize])

  /**
   * Toggle between "see the whole image" and "see actual pixels".
   *
   * In fit mode or zoomed out, go to 100 %; at or above 100 %, go to fit.
   */
  const handleDoubleClick = useCallback(() => {
    if (isFitMode || transform.scale < 1) {
      reset()
    } else {
      fitToView()
    }
  }, [isFitMode, transform.scale, reset, fitToView])

  // ========================================
  // Source changes
  // ========================================

  /**
   * Reconciles the view with a newly loaded image.
   *
   * Two rules, in this order:
   *
   * 1. **Unchanged intrinsic dimensions change nothing.** The flagship workflow
   *    is an agent rewriting an SVG while the user is zoomed in; a `viewBox`-only
   *    edit reports stable natural dimensions, so preserving zoom and pan is
   *    what keeps the tab usable instead of yanking the view on every write.
   * 2. **Changed dimensions make the view valid again, without discarding a
   *    deliberate zoom.** If the user was fitting, re-fit - that is what fit
   *    mode means. If they had zoomed to a level they chose, keep the scale and
   *    reset the pan to centre, so the resized image cannot end up off-screen
   *    while the magnification survives. Agents rewrite an SVG's `width` and
   *    `height` routinely, and throwing the zoom away on each of those writes is
   *    the same interruption rule 1 exists to avoid (QG-11a).
   *
   * The initial load passes `previous: null` and always fits.
   *
   * Called from the same synchronous block as the source swap, so the resulting
   * transform batches into the commit that changes `src` (UX-4). The one case
   * that cannot commit together is the initial load, where the container does
   * not exist yet - that fit waits for layout, gives way to any input the user
   * manages in the meantime, and is cancelled on unmount.
   *
   * @param previous - Dimensions of the image being replaced, or `null` on first load
   * @param next - Dimensions of the image just decoded
   */
  const applySourceChange = useCallback(
    (previous: ImageDimensions | null, next: ImageDimensions) => {
      // Whatever an earlier source was still waiting to fit is now about the
      // wrong image.
      cancelPendingFit()

      if (previous && previous.width === next.width && previous.height === next.height) {
        return
      }

      // The first image is always fitted; after that, fit mode decides.
      const shouldFit = previous === null || isFitModeRef.current
      const scheduledAtRevision = transformRevisionRef.current
      let framesWaited = 0

      const apply = (): void => {
        if (!isMountedRef.current) return

        // Someone moved the view while this fit waited for layout. Their input
        // is deliberate; this fit is speculative, so it yields.
        if (transformRevisionRef.current !== scheduledAtRevision) return

        const container = getActiveContainerRef.current()
        const rect = container?.getBoundingClientRect()

        // The container may not be laid out yet on first paint.
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          if (framesWaited >= MAX_LAYOUT_WAIT_FRAMES) {
            pendingFitFrameRef.current = null
            return
          }
          framesWaited += 1
          pendingFitFrameRef.current = requestAnimationFrame(apply)
          return
        }

        pendingFitFrameRef.current = null

        if (!shouldFit) {
          // Keep the chosen magnification, recentre so the resized image is
          // still on screen.
          setTransform((prev) => ({ ...prev, translateX: 0, translateY: 0 }))
          return
        }

        const fitScale = calculateFitScale(next.width, next.height, rect.width, rect.height)
        setTransform({
          scale: fitScale < 1 ? clampScale(fitScale) : 1,
          translateX: 0,
          translateY: 0
        })
        setIsFitMode(fitScale < 1)
      }

      apply()
    },
    [cancelPendingFit]
  )

  // ========================================
  // Mouse wheel (cursor-centered)
  // ========================================

  useEffect(() => {
    const handleWheel = (e: WheelEvent): void => {
      const container = getActiveContainerRef.current()
      if (!container || !container.contains(e.target as Node)) return

      e.preventDefault()

      const rect = container.getBoundingClientRect()
      const current = transformRef.current
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = clampScale(current.scale * delta)

      if (newScale === current.scale) return

      setIsFitMode(false)
      setTransform(calculateCursorCenteredZoom(current, newScale, e.clientX, e.clientY, rect))
    }

    document.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => document.removeEventListener('wheel', handleWheel, { capture: true })
  }, [])

  // ========================================
  // Drag to pan
  // ========================================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isDragBlockedRef.current(e.target as HTMLElement)) return

    isDragging.current = true
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    document.body.style.cursor = 'grabbing'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDragging.current) return

      const deltaX = e.clientX - lastMousePos.current.x
      const deltaY = e.clientY - lastMousePos.current.y
      lastMousePos.current = { x: e.clientX, y: e.clientY }

      setTransform((prev) => ({
        ...prev,
        translateX: clampPan(prev.translateX + deltaX),
        translateY: clampPan(prev.translateY + deltaY)
      }))
    }

    const handleMouseUp = (): void => {
      isDragging.current = false
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
    }
  }, [])

  // ========================================
  // Keyboard shortcuts
  // ========================================

  useEffect(() => {
    const panBy = (axis: 'translateX' | 'translateY', amount: number): void => {
      setTransform((prev) => ({ ...prev, [axis]: clampPan(prev[axis] + amount) }))
      setIsFitMode(false)
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (!isKeyboardScopedRef.current()) return

      const action = getKeyboardAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey
      })
      if (!action) return

      e.preventDefault()

      switch (action) {
        case 'zoomIn':
          zoomIn()
          break
        case 'zoomOut':
          zoomOut()
          break
        case 'reset':
          reset()
          break
        case 'fit':
          fitToView()
          break
        case 'fullscreen':
          onEscapeRef.current()
          break
        case 'panUp':
          panBy('translateY', PAN_CONFIG.STEP_SIZE)
          break
        case 'panDown':
          panBy('translateY', -PAN_CONFIG.STEP_SIZE)
          break
        case 'panLeft':
          panBy('translateX', PAN_CONFIG.STEP_SIZE)
          break
        case 'panRight':
          panBy('translateX', -PAN_CONFIG.STEP_SIZE)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [zoomIn, zoomOut, reset, fitToView])

  // ========================================
  // Keep fit mode honest across resizes
  // ========================================

  useEffect(() => {
    if (!isFitMode || !imageSize) return

    // Depends on `getActiveContainer` identity, not the ref, so entering or
    // leaving full screen re-observes the container that is actually on screen.
    const container = getActiveContainer()
    if (!container) return

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver(() => {
      // Debounced so a continuous drag-resize does not thrash the transform.
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        const rect = container.getBoundingClientRect()
        const fitScale = calculateFitScale(
          imageSize.width,
          imageSize.height,
          rect.width,
          rect.height
        )
        setTransform((prev) => ({ ...prev, scale: clampScale(fitScale) }))
      }, 16) // ~1 frame at 60 fps
    })

    observer.observe(container)
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      observer.disconnect()
    }
  }, [isFitMode, imageSize, getActiveContainer])

  return {
    transform,
    isFitMode,
    canZoomIn,
    canZoomOut,
    zoomIn,
    zoomOut,
    reset,
    fitToView,
    handleDoubleClick,
    handleMouseDown,
    applySourceChange
  }
}

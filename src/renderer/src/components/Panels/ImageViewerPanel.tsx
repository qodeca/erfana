// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ImageViewerPanel Component
 *
 * Displays an image file with zoom, pan, and full-screen capabilities.
 * Used as a Dockview panel component for viewing images within the IDE.
 *
 * Features:
 * - Loading state with spinner while image loads
 * - Error state if image fails to load
 * - Zoom controls: in/out buttons, level indicator (clickable to reset)
 * - Fit button to fit image to container
 * - Full-screen button with portal overlay
 * - Metadata display: dimensions, file size, format
 * - Mouse wheel zoom centered on cursor
 * - Click-drag to pan when zoomed
 * - Keyboard shortcuts: +/- (zoom), 0 (reset), F (fit), Escape (exit fullscreen)
 * - Double-click to toggle between fit and 100%
 * - ResizeObserver to recalculate fit on resize
 *
 * @module ImageViewerPanel
 * @see Spec #015 - Image preview viewer specification
 * @see {@link imageViewer.logic} for pure zoom/pan logic functions
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { IDockviewPanelProps } from 'dockview'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  AlertCircle,
  ImageIcon
} from 'lucide-react'
import {
  Transform,
  INITIAL_TRANSFORM,
  PAN_CONFIG,
  getNextZoomLevel,
  clampScale,
  calculateFitScale,
  calculateCursorCenteredZoom,
  clampPan,
  formatZoomLevel,
  formatFileSize,
  formatDimensions,
  getKeyboardAction,
  getZoomButtonStates
} from './imageViewer.logic'
import { getImageFormat } from '../../utils/imageUtils'
import { getBasename } from '../../utils/fileUtils'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import styles from './ImageViewerPanel.module.css'

// ============================================================================
// Constants
// ============================================================================

/**
 * CSS selector for focusable elements, used for focus trap in fullscreen mode.
 */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Maximum length for displayed filename (for defense-in-depth).
 */
const MAX_FILENAME_LENGTH = 255

/**
 * Sanitize filename for display in alt/aria-label attributes.
 * Defense-in-depth against path traversal and control characters in filenames.
 *
 * @param filePath - The file path to extract and sanitize filename from
 * @returns Sanitized filename safe for display
 */
function sanitizeFileName(filePath: string): string {
  // Extract filename from path
  const fileName = getBasename(filePath) || 'image'

  // Remove control characters (ASCII 0-31 and 127) and truncate to max length
  // Using split/filter/join instead of regex to avoid eslint no-control-regex warning
  const sanitized = fileName
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .slice(0, MAX_FILENAME_LENGTH)

  return sanitized || 'image'
}

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters passed to ImageViewerPanel via Dockview.
 */
interface ImageViewerPanelParams {
  /** Absolute path to the image file */
  filePath: string
  /** Unique panel identifier */
  panelId?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Image viewer panel with zoom/pan/fullscreen support.
 *
 * Renders an image file from the filesystem with interactive controls.
 * Loads the image as a data URL via IPC for security (sandboxed renderer).
 *
 * @param props - Dockview panel props with filePath in params
 * @returns Rendered image viewer panel
 *
 * @example
 * ```tsx
 * // Registered in AppDockLayout editorComponents
 * const editorComponents = {
 *   imageViewer: ImageViewerPanel,
 * };
 *
 * // Added via Dockview API
 * dockviewApi.addPanel({
 *   id: 'image-panel-1',
 *   component: 'imageViewer',
 *   params: { filePath: '/path/to/image.png' },
 * });
 * ```
 */
export function ImageViewerPanel(props: IDockviewPanelProps<ImageViewerPanelParams>) {
  const { params } = props
  const filePath = params?.filePath || ''

  // ========================================
  // State
  // ========================================

  // Image data
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Image metadata
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [fileSize, setFileSize] = useState(0)

  // Transform state (local per panel, not in store)
  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM)

  // UI mode state
  const [isFitMode, setIsFitMode] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)

  // ========================================
  // Refs
  // ========================================

  const panelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const fullScreenContainerRef = useRef<HTMLDivElement>(null)
  const fullScreenOverlayRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<Element | null>(null)

  // Drag state refs (avoid re-renders during drag)
  const isDragging = useRef(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  // Keep transform in ref for handlers that shouldn't depend on transform state
  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  }, [transform])

  // Track fullscreen state in ref for handlers that need current value without re-registration
  const isFullScreenRef = useRef(isFullScreen)
  useEffect(() => {
    isFullScreenRef.current = isFullScreen
  }, [isFullScreen])

  // ========================================
  // Derived Values
  // ========================================

  const format = useMemo(() => getImageFormat(filePath), [filePath])
  const zoomStates = useMemo(() => getZoomButtonStates(transform.scale), [transform.scale])
  const { canZoomIn, canZoomOut } = zoomStates

  // ========================================
  // Image Loading
  // ========================================

  useEffect(() => {
    if (!filePath) {
      setError('No file path provided')
      setIsLoading(false)
      return
    }

    let isCancelled = false

    async function loadImage() {
      setIsLoading(true)
      setError(null)
      setDataUrl(null)
      setImageSize(null)

      try {
        // Load image as base64 data URL via IPC
        const result = await window.api.file.readAsBase64(filePath)

        if (isCancelled) return

        setDataUrl(result)

        // Get file stats for size display
        try {
          const stats = await window.api.file.getStats(filePath)
          if (!isCancelled) {
            setFileSize(stats.size)
          }
        } catch (statsError) {
          // Non-fatal, just log
          logger.warn('Failed to get file stats', { filePath, error: String(statsError) })
        }
      } catch (loadError) {
        if (isCancelled) return

        const message = loadError instanceof Error ? loadError.message : 'Failed to load image'
        logger.error(
          'Image load error',
          loadError instanceof Error ? loadError : undefined,
          { filePath }
        )
        setError(message)
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    loadImage()

    return () => {
      isCancelled = true
    }
  }, [filePath])

  // ========================================
  // Image Dimension Detection
  // ========================================

  /**
   * Capture image natural dimensions when loaded.
   * This is called from the img onLoad handler.
   */
  const handleImageLoad = useCallback(() => {
    if (!imageRef.current) return

    const { naturalWidth, naturalHeight } = imageRef.current
    setImageSize({ width: naturalWidth, height: naturalHeight })

    // Auto-fit on initial load if image is larger than container
    const applyFitIfNeeded = () => {
      const container = isFullScreenRef.current
        ? fullScreenContainerRef.current
        : containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()

      // Validate container has been laid out (not 0x0)
      if (containerRect.width <= 0 || containerRect.height <= 0) {
        // Container not ready yet, defer to next frame
        requestAnimationFrame(applyFitIfNeeded)
        return
      }

      const fitScale = calculateFitScale(
        naturalWidth,
        naturalHeight,
        containerRect.width,
        containerRect.height
      )

      // If image needs to be scaled down to fit, apply fit mode
      if (fitScale < 1) {
        setTransform({ scale: fitScale, translateX: 0, translateY: 0 })
        setIsFitMode(true)
      }
    }

    applyFitIfNeeded()
  }, [])

  // ========================================
  // Zoom Handlers
  // ========================================

  const handleZoomIn = useCallback(() => {
    setIsFitMode(false)
    setTransform((prev) => ({
      ...prev,
      scale: getNextZoomLevel(prev.scale, 'in')
    }))
  }, [])

  const handleZoomOut = useCallback(() => {
    setIsFitMode(false)
    setTransform((prev) => ({
      ...prev,
      scale: getNextZoomLevel(prev.scale, 'out')
    }))
  }, [])

  const handleReset = useCallback(() => {
    setIsFitMode(false)
    setTransform(INITIAL_TRANSFORM)
  }, [])

  const handleFitToView = useCallback(() => {
    const container = isFullScreen ? fullScreenContainerRef.current : containerRef.current
    if (!container || !imageSize) return

    const containerRect = container.getBoundingClientRect()
    const fitScale = calculateFitScale(
      imageSize.width,
      imageSize.height,
      containerRect.width,
      containerRect.height
    )

    setTransform({
      scale: clampScale(fitScale),
      translateX: 0,
      translateY: 0
    })
    setIsFitMode(true)
  }, [imageSize, isFullScreen])

  // ========================================
  // Full Screen Handlers
  // ========================================

  const openFullScreen = useCallback(() => {
    // Verify portal-root exists before entering fullscreen
    if (!document.getElementById('portal-root')) {
      logger.error('Cannot enter fullscreen: portal-root element not found')
      return
    }
    previousActiveElement.current = document.activeElement
    setIsFullScreen(true)
  }, [])

  const closeFullScreen = useCallback(() => {
    setIsFullScreen(false)

    // Restore focus after close
    if (previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus()
    }
  }, [])

  // ========================================
  // Double-Click Toggle
  // ========================================

  /**
   * L8: Double-click behavior:
   * - If in fit mode OR zoomed out (scale < 1): switch to 100% (reset)
   * - Otherwise (zoomed in at or above 100%): switch to fit mode
   * This provides a consistent toggle between "see full image" and "see actual pixels".
   */
  const handleDoubleClick = useCallback(() => {
    if (isFitMode || transform.scale < 1) {
      // Currently in fit mode or zoomed out - switch to 100% to see actual pixels
      handleReset()
    } else {
      // Currently at 100% or zoomed in - switch to fit to see full image
      handleFitToView()
    }
  }, [isFitMode, transform.scale, handleReset, handleFitToView])

  // ========================================
  // Mouse Wheel Zoom (Cursor-Centered)
  // ========================================

  useEffect(() => {
    // Single wheel handler that checks current container based on fullscreen state
    const handleWheel = (e: WheelEvent) => {
      const container = isFullScreenRef.current
        ? fullScreenContainerRef.current
        : containerRef.current
      if (!container || !container.contains(e.target as Node)) return

      e.preventDefault()

      const containerRect = container.getBoundingClientRect()
      const currentTransform = transformRef.current

      // Determine zoom direction
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = clampScale(currentTransform.scale * delta)

      // Skip if no change (at limits)
      if (newScale === currentTransform.scale) return

      setIsFitMode(false)
      setTransform(
        calculateCursorCenteredZoom(currentTransform, newScale, e.clientX, e.clientY, containerRect)
      )
    }

    // Register once on document, check container inside handler
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => document.removeEventListener('wheel', handleWheel, { capture: true })
  }, [])

  // ========================================
  // Mouse Drag Pan
  // ========================================

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only primary button, not on controls
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('.' + styles.toolbar)) return

    isDragging.current = true
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    document.body.style.cursor = 'grabbing'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
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

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // C1: Clean up cursor state on unmount
      document.body.style.cursor = ''
    }
  }, [])

  // ========================================
  // Keyboard Shortcuts
  // ========================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      // Scope keyboard shortcuts to the panel - check if focus is within panel or fullscreen overlay
      const panel = panelRef.current
      const overlay = fullScreenOverlayRef.current
      const isPanelFocused = panel?.contains(document.activeElement)
      const isOverlayFocused = overlay?.contains(document.activeElement)
      if (!isPanelFocused && !isOverlayFocused) return

      const action = getKeyboardAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey
      })

      switch (action) {
        case 'zoomIn':
          e.preventDefault()
          handleZoomIn()
          break
        case 'zoomOut':
          e.preventDefault()
          handleZoomOut()
          break
        case 'reset':
          e.preventDefault()
          handleReset()
          break
        case 'fit':
          e.preventDefault()
          handleFitToView()
          break
        case 'fullscreen':
          e.preventDefault()
          if (isFullScreen) {
            closeFullScreen()
          }
          break
        case 'panUp':
          e.preventDefault()
          setTransform((prev) => ({
            ...prev,
            translateY: clampPan(prev.translateY + PAN_CONFIG.STEP_SIZE)
          }))
          setIsFitMode(false)
          break
        case 'panDown':
          e.preventDefault()
          setTransform((prev) => ({
            ...prev,
            translateY: clampPan(prev.translateY - PAN_CONFIG.STEP_SIZE)
          }))
          setIsFitMode(false)
          break
        case 'panLeft':
          e.preventDefault()
          setTransform((prev) => ({
            ...prev,
            translateX: clampPan(prev.translateX + PAN_CONFIG.STEP_SIZE)
          }))
          setIsFitMode(false)
          break
        case 'panRight':
          e.preventDefault()
          setTransform((prev) => ({
            ...prev,
            translateX: clampPan(prev.translateX - PAN_CONFIG.STEP_SIZE)
          }))
          setIsFitMode(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // H2: setTransform/setIsFitMode are stable setState functions, no need in deps
  }, [handleZoomIn, handleZoomOut, handleReset, handleFitToView, isFullScreen, closeFullScreen])

  // ========================================
  // Focus Trap for Full Screen Mode
  // ========================================

  useEffect(() => {
    if (!isFullScreen) return

    const overlay = fullScreenOverlayRef.current
    if (!overlay) return

    // Focus the first focusable element when entering fullscreen
    const focusableElements = overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusableElements.length > 0) {
      focusableElements[0].focus()
    }

    // Handle Tab key to trap focus within the overlay
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusable = overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return

      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [isFullScreen])

  // ========================================
  // ResizeObserver for Fit Mode
  // ========================================

  useEffect(() => {
    if (!isFitMode || !imageSize) return

    const container = isFullScreen ? fullScreenContainerRef.current : containerRef.current
    if (!container) return

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver(() => {
      // Debounce resize updates to prevent jank during continuous resize
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }

      resizeTimeout = setTimeout(() => {
        const containerRect = container.getBoundingClientRect()
        const fitScale = calculateFitScale(
          imageSize.width,
          imageSize.height,
          containerRect.width,
          containerRect.height
        )

        setTransform((prev) => ({
          ...prev,
          scale: clampScale(fitScale)
        }))
      }, 16) // ~1 frame at 60fps
    })

    observer.observe(container)
    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      observer.disconnect()
    }
  }, [isFitMode, imageSize, isFullScreen])

  // ========================================
  // Render Helpers
  // ========================================

  /**
   * Renders the toolbar with metadata and zoom controls.
   * Follows MarkdownToolbar styling pattern.
   */
  const renderToolbar = (inFullScreen: boolean = false) => (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Image viewer controls"
      data-testid={TEST_IDS.IMAGE_VIEWER_TOOLBAR}
    >
      {/* Left: Metadata */}
      <div className={styles.toolbarMetadata}>
        {imageSize && (
          <span
            className={styles.metadataItem}
            title="Dimensions"
            aria-label={`Dimensions: ${formatDimensions(imageSize.width, imageSize.height)}`}
          >
            {formatDimensions(imageSize.width, imageSize.height)}
          </span>
        )}
        {fileSize > 0 && (
          <span
            className={styles.metadataItem}
            title="File size"
            aria-label={`File size: ${formatFileSize(fileSize)}`}
          >
            {formatFileSize(fileSize)}
          </span>
        )}
        <span
          className={styles.metadataItem}
          title="Format"
          aria-label={`Format: ${format}`}
        >
          {format}
        </span>
      </div>

      {/* Spacer to push controls to the right */}
      <div className={styles.toolbarSpacer} />

      {/* Zoom controls */}
      <div className={styles.toolbarControls}>
        <button
          className={styles.controlButton}
          onClick={handleZoomOut}
          disabled={!canZoomOut}
          title="Zoom out (-)"
          aria-label="Zoom out"
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_OUT}
        >
          <ZoomOut size={16} strokeWidth={2} />
        </button>

        <button
          className={styles.zoomLevel}
          onClick={handleReset}
          title="Reset zoom (0)"
          aria-label={`Zoom level ${formatZoomLevel(transform.scale)}, click to reset`}
          aria-live="polite"
          data-testid={TEST_IDS.IMAGE_VIEWER_ZOOM_LEVEL}
        >
          {formatZoomLevel(transform.scale)}
        </button>

        <button
          className={styles.controlButton}
          onClick={handleZoomIn}
          disabled={!canZoomIn}
          title="Zoom in (+)"
          aria-label="Zoom in"
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_ZOOM_IN}
        >
          <ZoomIn size={16} strokeWidth={2} />
        </button>

        <button
          className={styles.controlButton}
          onClick={handleFitToView}
          title="Fit to view (F)"
          aria-label="Fit image to view"
          data-testid={TEST_IDS.IMAGE_VIEWER_BTN_FIT}
        >
          <Minimize2 size={16} strokeWidth={2} />
        </button>
      </div>

      {/* Separator */}
      <div className={styles.toolbarSeparator} />

      {/* Full screen button */}
      <div className={styles.toolbarActions}>
        {inFullScreen ? (
          <button
            className={styles.controlButton}
            onClick={closeFullScreen}
            title="Exit full screen (Escape)"
            aria-label="Exit full screen"
            data-testid={TEST_IDS.IMAGE_VIEWER_BTN_CLOSE}
          >
            <X size={16} strokeWidth={2} />
          </button>
        ) : (
          <button
            className={styles.controlButton}
            onClick={openFullScreen}
            title="Full screen"
            aria-label="Enter full screen"
            data-testid={TEST_IDS.IMAGE_VIEWER_BTN_FULLSCREEN}
          >
            <Maximize2 size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )

  /**
   * Renders the image content area with transform applied.
   */
  const renderImageContent = (
    ref: React.RefObject<HTMLDivElement>,
    inFullScreen: boolean = false
  ) => {
    const fileName = sanitizeFileName(filePath)

    return (
      <div
        ref={ref}
        className={styles.content}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        role="img"
        aria-label={`Image preview: ${fileName}`}
        data-testid={
          inFullScreen ? TEST_IDS.IMAGE_VIEWER_FULLSCREEN_CONTENT : TEST_IDS.IMAGE_VIEWER_CONTENT
        }
      >
        {dataUrl && (
          <img
            ref={imageRef}
            src={dataUrl}
            alt={`Preview of ${fileName}`}
            className={styles.image}
            style={{
              transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
              transformOrigin: 'center center'
            }}
            onLoad={handleImageLoad}
            draggable={false}
            data-testid={TEST_IDS.IMAGE_VIEWER_IMAGE}
          />
        )}
      </div>
    )
  }

  // ========================================
  // Render: Loading State
  // ========================================

  if (isLoading) {
    return (
      <div className={styles.container} data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}>
        <div className={styles.loadingState} role="status" aria-live="polite">
          <Loader2 className={styles.spinner} size={32} aria-hidden="true" />
          <span>Loading image...</span>
        </div>
      </div>
    )
  }

  // ========================================
  // Render: Error State
  // ========================================

  if (error) {
    return (
      <div className={styles.container} data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}>
        <div className={styles.errorState} role="alert">
          <AlertCircle size={32} aria-hidden="true" />
          <span className={styles.errorMessage}>{error}</span>
        </div>
      </div>
    )
  }

  // ========================================
  // Render: Empty State
  // ========================================

  if (!dataUrl) {
    return (
      <div className={styles.container} data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}>
        <div className={styles.emptyState}>
          <ImageIcon size={32} />
          <span>No image to display</span>
        </div>
      </div>
    )
  }

  // ========================================
  // Render: Main Panel
  // ========================================

  const portalRoot = document.getElementById('portal-root')

  return (
    <div
      ref={panelRef}
      className={styles.container}
      data-testid={TEST_IDS.IMAGE_VIEWER_PANEL}
      tabIndex={0}
    >
      {/* Toolbar at top */}
      {renderToolbar(false)}

      {/* Image content area */}
      {renderImageContent(containerRef)}

      {/* Full-screen overlay */}
      {isFullScreen &&
        portalRoot &&
        createPortal(
          <div
            ref={fullScreenOverlayRef}
            className={styles.fullScreenOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Full screen image viewer"
            data-testid={TEST_IDS.IMAGE_VIEWER_FULLSCREEN}
          >
            {/* Full screen toolbar */}
            {renderToolbar(true)}
            {/* Full screen content */}
            {renderImageContent(fullScreenContainerRef, true)}
          </div>,
          portalRoot
        )}
    </div>
  )
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { getKeyboardAction, getZoomButtonStates, ZOOM_CONFIG } from './diagramViewer.logic'
import { ChatBubble } from './ChatBubble'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'
import { logger } from '../../../utils/logger'
import { TEST_IDS } from '../../../constants/testids'
import './DiagramViewer.css'

interface Transform {
  scale: number
  translateX: number // Pan offset in pixels
  translateY: number // Pan offset in pixels
}

interface SvgDimensions {
  width: number
  height: number
}

/**
 * DiagramViewer - Full-screen diagram viewer with zoom/pan support
 *
 * Reads state from useDiagramViewerStore instead of props.
 * This allows the viewer to stay open and receive updates when the source
 * markdown file is edited (MermaidDiagram components are recreated but store persists).
 *
 * The terminal is now integrated into the ChatBubble panel instead of a side pane.
 */
export function DiagramViewer() {
  // Read all state from the store
  const {
    isOpen,
    mermaidCode,
    svgContent,
    filePath,
    startLine,
    endLine,
    closeViewer
  } = useDiagramViewerStore()

  const overlayRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<Element | null>(null)
  const isDragging = useRef(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    translateX: 0,
    translateY: 0
  })
  const [svgDimensions, setSvgDimensions] = useState<SvgDimensions | null>(null)
  // Track whether we've done the initial fit-to-view for this session
  // This prevents zoom/pan from resetting when svgContent changes (file updates)
  const [hasInitialized, setHasInitialized] = useState(false)

  // Inject SVG content exactly like MermaidDiagram does - via innerHTML
  //
  // ⚠️  DO NOT ADD SVG SANITIZATION HERE (e.g., DOMPurify)
  //
  // svgContent comes from MermaidDiagram which uses mermaid.render() with
  // securityLevel: 'strict' (default since v10). Additional sanitization BREAKS diagrams:
  // - DOMPurify strips foreignObject content (GitHub DOMPurify #1002, #1088)
  // - DOMPurify strips xlink:href internal references used for markers (#233)
  //
  // See: https://github.com/cure53/DOMPurify/issues/1002
  useEffect(() => {
    if (!isOpen || !svgContainerRef.current || !svgContent) return

    svgContainerRef.current.innerHTML = svgContent

    // Capture original dimensions and set up SVG for scaling
    const svgElement = svgContainerRef.current.querySelector('svg')
    if (svgElement) {
      svgElement.style.display = 'block'
      svgElement.style.maxWidth = 'none'
      svgElement.style.maxHeight = 'none'

      // Get original dimensions from viewBox or attributes
      const viewBox = svgElement.viewBox?.baseVal
      let width: number
      let height: number

      if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
        width = viewBox.width
        height = viewBox.height
      } else {
        // Fallback to width/height attributes or computed size
        width = svgElement.width?.baseVal?.value || svgElement.getBoundingClientRect().width
        height = svgElement.height?.baseVal?.value || svgElement.getBoundingClientRect().height
      }

      if (width > 0 && height > 0) {
        // Set explicit dimensions so we can scale them
        svgElement.setAttribute('width', String(width))
        svgElement.setAttribute('height', String(height))
        setSvgDimensions({ width, height })
      }
    }
  }, [isOpen, svgContent])

  // Reset hasInitialized when viewer closes
  useEffect(() => {
    if (!isOpen) {
      setHasInitialized(false)
    }
  }, [isOpen])

  // Fit to view on FIRST open only (not on every svgContent change)
  // This preserves zoom/pan when file is edited while viewer is open
  useEffect(() => {
    if (!isOpen || !containerRef.current || !svgContainerRef.current) return
    // Skip if already initialized this session - preserves zoom/pan on content changes
    if (hasInitialized) return

    const fitToView = () => {
      const container = containerRef.current
      const svgContainer = svgContainerRef.current
      if (!container || !svgContainer) return

      const svgElement = svgContainer.querySelector('svg')
      if (!svgElement) return

      const containerRect = container.getBoundingClientRect()
      const svgWidth = svgElement.viewBox?.baseVal?.width || svgElement.getBoundingClientRect().width
      const svgHeight = svgElement.viewBox?.baseVal?.height || svgElement.getBoundingClientRect().height

      if (svgWidth <= 0 || svgHeight <= 0) return

      // Calculate scale to fit with padding
      const padding = 40
      const scaleX = (containerRect.width - padding * 2) / svgWidth
      const scaleY = (containerRect.height - padding * 2) / svgHeight
      const scale = Math.min(scaleX, scaleY, ZOOM_CONFIG.MAX_SCALE)

      setTransform({
        scale: Math.max(scale, ZOOM_CONFIG.MIN_SCALE),
        translateX: 0,
        translateY: 0
      })

      // Mark as initialized so subsequent content changes preserve zoom/pan
      setHasInitialized(true)
    }

    // Small delay to ensure SVG is rendered
    const timer = setTimeout(fitToView, 100)
    return () => clearTimeout(timer)
  }, [isOpen, svgContent, hasInitialized])

  // Focus management - store previous focus
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement
    }
  }, [isOpen])

  // Focus management - restore focus on close
  useEffect(() => {
    if (!isOpen && previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus()
    }
  }, [isOpen])

  // Mouse wheel zoom
  useEffect(() => {
    if (!isOpen || !containerRef.current) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setTransform(prev => {
        const newScale = Math.min(
          Math.max(prev.scale * delta, ZOOM_CONFIG.MIN_SCALE),
          ZOOM_CONFIG.MAX_SCALE
        )
        return { ...prev, scale: newScale }
      })
    }

    const container = containerRef.current
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [isOpen])

  // Mouse drag for panning
  useEffect(() => {
    if (!isOpen) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const deltaX = e.clientX - lastMousePos.current.x
      const deltaY = e.clientY - lastMousePos.current.y
      lastMousePos.current = { x: e.clientX, y: e.clientY }

      setTransform(prev => ({
        ...prev,
        translateX: prev.translateX + deltaX,
        translateY: prev.translateY + deltaY
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
    }
  }, [isOpen])

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start drag on primary button and not on buttons
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    isDragging.current = true
    lastMousePos.current = { x: e.clientX, y: e.clientY }
    document.body.style.cursor = 'grabbing'
  }

  // Control button handlers - wrapped in useCallback to avoid stale closures in keyboard effect
  // Must be defined before the keyboard shortcuts useEffect that uses them
  const handleZoomIn = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.min(prev.scale * 1.2, ZOOM_CONFIG.MAX_SCALE)
    }))
  }, [])

  const handleZoomOut = useCallback(() => {
    setTransform(prev => ({
      ...prev,
      scale: Math.max(prev.scale * 0.8, ZOOM_CONFIG.MIN_SCALE)
    }))
  }, [])

  const handleFitToView = useCallback(() => {
    if (!containerRef.current || !svgContainerRef.current) return

    const svgElement = svgContainerRef.current.querySelector('svg')
    if (!svgElement) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const svgWidth = svgElement.viewBox?.baseVal?.width || svgElement.getBoundingClientRect().width
    const svgHeight = svgElement.viewBox?.baseVal?.height || svgElement.getBoundingClientRect().height

    if (svgWidth <= 0 || svgHeight <= 0) return

    const padding = 40
    const scaleX = (containerRect.width - padding * 2) / svgWidth
    const scaleY = (containerRect.height - padding * 2) / svgHeight
    const scale = Math.min(scaleX, scaleY, ZOOM_CONFIG.MAX_SCALE)

    setTransform({
      scale: Math.max(scale, ZOOM_CONFIG.MIN_SCALE),
      translateX: 0,
      translateY: 0
    })
  }, [])

  const handleReset = useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 })
  }, [])

  // Backdrop click handler
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        closeViewer()
      }
    },
    [closeViewer]
  )

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip keyboard shortcuts when user is typing in textarea or input
      // This allows native copy/paste and text editing to work normally
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        return
      }

      const action = getKeyboardAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey
      })

      switch (action) {
        case 'zoom-in':
          e.preventDefault()
          handleZoomIn()
          break
        case 'zoom-out':
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
        // Note: 'close' action removed - use X button instead
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleZoomIn, handleZoomOut, handleReset, handleFitToView])

  // Apply dimension-based zoom (fixes pixelation - issue #31)
  // Scales SVG width/height for native vector rendering at any size
  useEffect(() => {
    if (!isOpen || !svgContainerRef.current || !svgDimensions) return

    const svgElement = svgContainerRef.current.querySelector('svg')
    if (!svgElement) return

    // Scale the SVG's display size - browser renders at this size natively
    const scaledWidth = svgDimensions.width * transform.scale
    const scaledHeight = svgDimensions.height * transform.scale

    svgElement.setAttribute('width', String(scaledWidth))
    svgElement.setAttribute('height', String(scaledHeight))
  }, [isOpen, svgDimensions, transform.scale])

  if (!isOpen) return null

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) {
    logger.error('DiagramViewer: portal-root not found!')
    return null
  }

  const { zoomInDisabled, zoomOutDisabled } = getZoomButtonStates(
    transform.scale,
    ZOOM_CONFIG.MIN_SCALE,
    ZOOM_CONFIG.MAX_SCALE
  )

  return createPortal(
    <div
      ref={overlayRef}
      className="diagram-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid Diagram"
      onClick={handleBackdropClick}
      data-testid={TEST_IDS.DIAGRAM_VIEWER}
    >
      {/* Floating close button (issue #37) */}
      <button
        className="diagram-viewer-close-floating"
        onClick={closeViewer}
        title="Close"
        aria-label="Close diagram viewer"
        autoFocus
        data-testid={TEST_IDS.DIAGRAM_VIEWER_BTN_CLOSE}
      >
        <X size={16} />
      </button>

      {/* Full-width diagram content area */}
      <div className="diagram-viewer-content-wrapper" data-testid={TEST_IDS.DIAGRAM_VIEWER_CONTENT}>
        {/* SVG Content with dimension-based zoom (fixes pixelation - issue #31) */}
        <div
          ref={containerRef}
          className="diagram-viewer-content"
          onMouseDown={handleMouseDown}
        >
          <div
            ref={svgContainerRef}
            className="diagram-viewer-svg-container"
            style={{
              transform: `translate(${transform.translateX}px, ${transform.translateY}px)`
            }}
            data-testid={TEST_IDS.DIAGRAM_VIEWER_SVG}
          />
        </div>

        {/* Chat bubble for AI-assisted diagram modifications (contains terminal) */}
        {mermaidCode && filePath && (
          <ChatBubble
            mermaidCode={mermaidCode}
            filePath={filePath}
            startLine={startLine}
            endLine={endLine}
            transform={transform}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFitToView={handleFitToView}
            onReset={handleReset}
            zoomInDisabled={zoomInDisabled}
            zoomOutDisabled={zoomOutDisabled}
          />
        )}
      </div>
    </div>,
    portalRoot
  )
}

import { useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, Maximize, RotateCcw, Terminal, ChevronLeft } from 'lucide-react'
import {
  getKeyboardAction,
  formatZoomLevel,
  getZoomButtonStates,
  ZOOM_CONFIG
} from './diagramViewer.logic'
import {
  calculatePaneWidths,
  handleResizeDrag
} from './diagramViewerResize.logic'
import { ChatBubble } from './ChatBubble'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'
import { useTerminalPortalOptional } from '../../../context/TerminalPortalContext'
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
    closeViewer,
    // Terminal panel state
    isTerminalVisible,
    terminalWidth,
    toggleTerminal,
    setTerminalWidth
  } = useDiagramViewerStore()

  // Portal context for terminal integration
  const portalContext = useTerminalPortalOptional()

  const overlayRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<Element | null>(null)
  const isDragging = useRef(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  // Resize state
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

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

  // Portal management: move terminal into viewer when open, back to main when closed
  useEffect(() => {
    if (!portalContext) return

    if (isOpen) {
      portalContext.setPortalTarget('diagram-viewer')
      // Request refit after portal move
      portalContext.requestRefit()
    } else {
      portalContext.setPortalTarget('main')
      portalContext.requestRefit()
    }

    return () => {
      // Ensure terminal returns to main on unmount
      portalContext.setPortalTarget('main')
    }
  }, [isOpen, portalContext])

  // Request terminal refit when visibility or width changes
  useEffect(() => {
    if (portalContext && isOpen && isTerminalVisible) {
      portalContext.requestRefit()
    }
  }, [isTerminalVisible, terminalWidth, portalContext, isOpen])

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

  // Resize handle for split pane
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = terminalWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [terminalWidth])

  // Split resize mouse move handler
  useEffect(() => {
    if (!isOpen) return

    const handleResizeMove = (e: MouseEvent) => {
      if (!isResizing.current || !splitContainerRef.current) return

      const deltaX = e.clientX - resizeStartX.current
      const containerWidth = splitContainerRef.current.getBoundingClientRect().width
      const newWidth = handleResizeDrag(resizeStartWidth.current, deltaX, containerWidth)
      setTerminalWidth(newWidth)
    }

    const handleResizeEnd = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)

    return () => {
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isOpen, setTerminalWidth])

  // Backdrop click handler
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        closeViewer()
      }
    },
    [closeViewer]
  )

  // Keyboard shortcuts - must come after handler definitions
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
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
        case 'toggle-terminal':
          e.preventDefault()
          toggleTerminal()
          break
        // Note: 'close' action removed - use X button instead
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleZoomIn, handleZoomOut, handleReset, handleFitToView, toggleTerminal])

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
    console.error('DiagramViewer: portal-root not found!')
    return null
  }

  const { zoomInDisabled, zoomOutDisabled } = getZoomButtonStates(
    transform.scale,
    ZOOM_CONFIG.MIN_SCALE,
    ZOOM_CONFIG.MAX_SCALE
  )

  // Calculate pane widths based on container and terminal width
  const containerWidth = splitContainerRef.current?.getBoundingClientRect().width ?? 800
  const paneWidths = calculatePaneWidths(containerWidth, terminalWidth)

  return createPortal(
    <div
      ref={overlayRef}
      className="diagram-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid Diagram"
      onClick={handleBackdropClick}
    >
      {/* Toolbar */}
      <div className="diagram-viewer-toolbar" role="toolbar" aria-label="Diagram viewer controls">
        <div className="diagram-viewer-toolbar-left">
          <span className="diagram-viewer-title">Mermaid Diagram</span>
        </div>

        <div className="diagram-viewer-toolbar-center">
          <button
            className="diagram-viewer-btn"
            onClick={handleZoomOut}
            disabled={zoomOutDisabled}
            title="Zoom out (-)"
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>

          <div className="diagram-viewer-zoom-indicator" aria-live="polite">
            {formatZoomLevel(transform.scale)}
          </div>

          <button
            className="diagram-viewer-btn"
            onClick={handleZoomIn}
            disabled={zoomInDisabled}
            title="Zoom in (+)"
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>

          <div className="diagram-viewer-separator" />

          <button
            className="diagram-viewer-btn"
            onClick={handleFitToView}
            title="Fit to screen (F)"
            aria-label="Fit to screen"
          >
            <Maximize size={16} />
          </button>

          <button
            className="diagram-viewer-btn"
            onClick={handleReset}
            title="Reset view (0)"
            aria-label="Reset view"
          >
            <RotateCcw size={16} />
          </button>

          <div className="diagram-viewer-separator" />

          {/* Terminal toggle button */}
          <button
            className={`diagram-viewer-btn ${isTerminalVisible ? 'diagram-viewer-btn-active' : ''}`}
            onClick={toggleTerminal}
            title={isTerminalVisible ? 'Hide Terminal (⌘J)' : 'Show Terminal (⌘J)'}
            aria-label={isTerminalVisible ? 'Hide terminal' : 'Show terminal'}
            aria-pressed={isTerminalVisible}
          >
            <Terminal size={16} />
          </button>
        </div>

        <div className="diagram-viewer-toolbar-right">
          <button
            className="diagram-viewer-btn diagram-viewer-btn-close"
            onClick={closeViewer}
            title="Close"
            aria-label="Close viewer"
            autoFocus
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Split container: Diagram + Terminal */}
      <div ref={splitContainerRef} className="diagram-viewer-split">
        {/* Diagram pane */}
        <div
          className="diagram-viewer-diagram-pane"
          style={{ flex: isTerminalVisible ? `0 0 ${paneWidths.diagramWidth}px` : 1 }}
        >
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
            />
          </div>

          {/* Chat bubble for AI-assisted diagram modifications */}
          {mermaidCode && filePath && (
            <ChatBubble
              mermaidCode={mermaidCode}
              filePath={filePath}
              startLine={startLine}
              endLine={endLine}
            />
          )}
        </div>

        {/* Resize handle (only when terminal visible) */}
        {isTerminalVisible && (
          <div
            className={`diagram-viewer-resizer ${isResizing.current ? 'dragging' : ''}`}
            onMouseDown={handleResizeStart}
          />
        )}

        {/* Terminal pane (portal target) */}
        {isTerminalVisible && (
          <div
            ref={portalContext?.diagramViewerContainerRef}
            className="diagram-viewer-terminal-pane"
            style={{ width: paneWidths.terminalWidth }}
          />
        )}

        {/* Collapsed state: vertical toggle bar */}
        {!isTerminalVisible && (
          <div
            className="diagram-viewer-terminal-collapsed"
            onClick={toggleTerminal}
            title="Show Terminal (⌘J)"
            role="button"
            aria-label="Show terminal"
          >
            <ChevronLeft size={16} />
          </div>
        )}
      </div>
    </div>,
    portalRoot
  )
}

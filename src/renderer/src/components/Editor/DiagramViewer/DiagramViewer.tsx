import { useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react'
import {
  getKeyboardAction,
  formatZoomLevel,
  getZoomButtonStates,
  ZOOM_CONFIG
} from './diagramViewer.logic'
import './DiagramViewer.css'

interface DiagramViewerProps {
  isOpen: boolean
  onClose: () => void
  svgContent: string
  title?: string
}

interface Transform {
  scale: number
  translateX: number // Pan offset in pixels
  translateY: number // Pan offset in pixels
}

interface SvgDimensions {
  width: number
  height: number
}

export function DiagramViewer({ isOpen, onClose, svgContent, title }: DiagramViewerProps) {
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

  // Inject SVG content exactly like MermaidDiagram does - via innerHTML
  // SECURITY: svgContent must be pre-sanitized. This component trusts that the
  // SVG comes from MermaidDiagram which uses mermaid.render() with securityLevel: 'strict'.
  // Never pass untrusted/user-provided SVG directly to this component.
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

  // Fit to view on open
  useEffect(() => {
    if (!isOpen || !containerRef.current || !svgContainerRef.current) return

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
    }

    // Small delay to ensure SVG is rendered
    const timer = setTimeout(fitToView, 100)
    return () => clearTimeout(timer)
  }, [isOpen, svgContent])

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
        onClose()
      }
    },
    [onClose]
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
        case 'close':
          e.preventDefault()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, handleZoomIn, handleZoomOut, handleReset, handleFitToView])

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

  return createPortal(
    <div
      ref={overlayRef}
      className="diagram-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Diagram Viewer'}
      onClick={handleBackdropClick}
    >
      {/* Toolbar */}
      <div className="diagram-viewer-toolbar" role="toolbar" aria-label="Diagram viewer controls">
        <div className="diagram-viewer-toolbar-left">
          <span className="diagram-viewer-title">{title || 'Diagram Viewer'}</span>
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
        </div>

        <div className="diagram-viewer-toolbar-right">
          <button
            className="diagram-viewer-btn diagram-viewer-btn-close"
            onClick={onClose}
            title="Close (Escape)"
            aria-label="Close viewer"
            autoFocus
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* SVG Content with dimension-based zoom (fixes pixelation - issue #31) */}
      {/* Cursor is managed via document.body.style.cursor in handleMouseDown/handleMouseUp */}
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
    </div>,
    portalRoot
  )
}

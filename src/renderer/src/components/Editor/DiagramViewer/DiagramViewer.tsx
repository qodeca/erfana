import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
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

/** Toolbar controls component - uses ref to access transform controls */
function ViewerToolbar({
  scale,
  onClose,
  title,
  isOpen,
  transformRef
}: {
  scale: number
  onClose: () => void
  title?: string
  isOpen: boolean
  transformRef: React.RefObject<ReactZoomPanPinchRef | null>
}) {
  const { zoomInDisabled, zoomOutDisabled } = getZoomButtonStates(
    scale,
    ZOOM_CONFIG.MIN_SCALE,
    ZOOM_CONFIG.MAX_SCALE
  )

  const zoomIn = () => transformRef.current?.zoomIn()
  const zoomOut = () => transformRef.current?.zoomOut()
  const resetTransform = () => transformRef.current?.resetTransform()
  const centerView = () => transformRef.current?.centerView()

  // Handle keyboard shortcuts
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
          zoomIn()
          break
        case 'zoom-out':
          e.preventDefault()
          zoomOut()
          break
        case 'reset':
          e.preventDefault()
          resetTransform()
          break
        case 'fit':
          e.preventDefault()
          centerView()
          break
        case 'close':
          e.preventDefault()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return (
    <div className="diagram-viewer-toolbar" role="toolbar" aria-label="Diagram viewer controls">
      <div className="diagram-viewer-toolbar-left">
        <span className="diagram-viewer-title">{title || 'Diagram Viewer'}</span>
      </div>

      <div className="diagram-viewer-toolbar-center">
        <button
          className="diagram-viewer-btn"
          onClick={zoomOut}
          disabled={zoomOutDisabled}
          title="Zoom out (-)"
          aria-label="Zoom out"
        >
          <ZoomOut size={16} />
        </button>

        <div className="diagram-viewer-zoom-indicator" aria-live="polite">
          {formatZoomLevel(scale)}
        </div>

        <button
          className="diagram-viewer-btn"
          onClick={zoomIn}
          disabled={zoomInDisabled}
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          <ZoomIn size={16} />
        </button>

        <div className="diagram-viewer-separator" />

        <button
          className="diagram-viewer-btn"
          onClick={centerView}
          title="Fit to screen (F)"
          aria-label="Fit to screen"
        >
          <Maximize size={16} />
        </button>

        <button
          className="diagram-viewer-btn"
          onClick={resetTransform}
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
  )
}

export function DiagramViewer({ isOpen, onClose, svgContent, title }: DiagramViewerProps) {
  const [scale, setScale] = useState<number>(ZOOM_CONFIG.INITIAL_SCALE)
  const [isDragging, setIsDragging] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<Element | null>(null)
  const transformRef = useRef<ReactZoomPanPinchRef>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const hasCenteredRef = useRef(false)

  // Store previously focused element when opening
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement
      hasCenteredRef.current = false // Reset centering flag when opening
    }
  }, [isOpen])

  // Restore focus when closing
  useEffect(() => {
    if (!isOpen && previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus()
    }
  }, [isOpen])

  // Center view after SVG content is rendered - use useLayoutEffect for sync execution
  useLayoutEffect(() => {
    if (isOpen && svgContent && transformRef.current && !hasCenteredRef.current) {
      // Use requestAnimationFrame to ensure DOM is painted
      requestAnimationFrame(() => {
        // Double RAF to ensure layout is complete
        requestAnimationFrame(() => {
          transformRef.current?.centerView(undefined, 0) // 0 = no animation
          hasCenteredRef.current = true
        })
      })
    }
  }, [isOpen, svgContent])

  // Handle backdrop click (only close if not dragging)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current && !isDragging) {
        onClose()
      }
    },
    [isDragging, onClose]
  )

  if (!isOpen) return null

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) {
    console.error('DiagramViewer: portal-root not found!')
    return null
  }

  return createPortal(
    <div
      ref={overlayRef}
      className="diagram-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Diagram Viewer'}
      onClick={handleBackdropClick}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={ZOOM_CONFIG.INITIAL_SCALE}
        minScale={ZOOM_CONFIG.MIN_SCALE}
        maxScale={ZOOM_CONFIG.MAX_SCALE}
        centerZoomedOut={true}
        disablePadding={true}
        onTransformed={(_, state) => setScale(state.scale)}
        onPanningStart={() => setIsDragging(true)}
        onPanningStop={() => setIsDragging(false)}
        wheel={{ step: ZOOM_CONFIG.ZOOM_STEP }}
        panning={{ velocityDisabled: true }}
        doubleClick={{ disabled: true }}
      >
        <ViewerToolbar
          scale={scale}
          onClose={onClose}
          title={title}
          isOpen={isOpen}
          transformRef={transformRef}
        />

        <TransformComponent
          wrapperClass="diagram-viewer-content"
          contentClass="diagram-viewer-svg-container"
          wrapperStyle={{
            width: '100%',
            height: 'calc(100vh - 48px)'
          }}
          contentStyle={{
            width: '100%',
            height: '100%'
          }}
        >
          <div ref={svgContainerRef} dangerouslySetInnerHTML={{ __html: svgContent }} />
        </TransformComponent>
      </TransformWrapper>
    </div>,
    portalRoot
  )
}

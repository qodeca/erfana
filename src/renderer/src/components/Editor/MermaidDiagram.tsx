import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Bug } from 'lucide-react'
import { executePromptTemplate } from '../../utils/panelUtils'
import { formatLineRange } from '../../prompts/helpers'
import { MermaidToolbar } from './MermaidToolbar'
import { getMermaidConfig } from '../../utils/mermaidThemes'
import { useDiagramViewerStore, buildDiagramId } from '../../stores/useDiagramViewerStore'

interface MermaidDiagramProps {
  code: string
  className?: string
  filePath?: string
  startLine?: number
  endLine?: number
}

export function MermaidDiagram({ code, className = '', filePath, startLine, endLine }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [svgContent, setSvgContent] = useState<string>('')

  // Store for persisting viewer state across component remounts
  const {
    isOpen,
    filePath: storedFilePath,
    originalStartLine,
    openViewer,
    updateDiagram
  } = useDiagramViewerStore()

  // Generate unique ID for this diagram
  const currentDiagramId = buildDiagramId(filePath, startLine, endLine)

  // Check if THIS diagram is the one currently open in the viewer
  // Match by filePath AND check if line ranges are close (handles line drift from edits above)
  // but distinguishes between different diagrams in the same file
  // IMPORTANT: Compare against originalStartLine (fixed at open time), not startLine (which drifts)
  const LINE_DRIFT_TOLERANCE = 20 // lines - handles typical edits while distinguishing diagrams
  const isViewerOpenForThis = (() => {
    if (!isOpen || filePath !== storedFilePath) return false
    if (startLine === undefined || originalStartLine === undefined) return false

    // Check if this diagram's start line is within tolerance of the ORIGINAL start line
    // originalStartLine never changes, so other diagrams can't "drift" into matching
    return Math.abs(startLine - originalStartLine) <= LINE_DRIFT_TOLERANCE
  })()

  // Handle bug report button click
  const handleBugReport = async () => {
    if (!error || !filePath) return

    try {
      // Construct file reference
      const fileRef = startLine && endLine
        ? `@${filePath}:${startLine}-${endLine}`
        : `@${filePath}`

      // Format line range string
      const lineRange = formatLineRange(startLine, endLine) || undefined

      // Execute prompt template using centralized function
      await executePromptTemplate('mermaid-bug-report', {
        selectedText: '',
        filePath,
        fullDocument: '',
        startLine,
        endLine,
        lineRange,
        fileRef,
        mermaidError: error,
        mermaidCode: code
      })
    } catch (err) {
      console.error('Failed to send bug report:', err)
    }
  }

  // Initialize mermaid with built-in theme
  useEffect(() => {
    const config = getMermaidConfig(true) // isDarkMode param ignored, uses ACTIVE_THEME
    mermaid.initialize(config)
    setInitialized(true)
  }, [])

  // Render diagram whenever code changes
  useEffect(() => {
    if (!initialized || !containerRef.current) {
      return
    }

    const renderDiagram = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`

        // Render diagram using mermaid v11 API
        const { svg } = await mermaid.render(id, code)

        if (containerRef.current) {
          // ⚠️  DO NOT ADD SVG SANITIZATION HERE (e.g., DOMPurify)
          //
          // Mermaid's securityLevel: 'strict' (default since v10) already sanitizes output.
          // Additional sanitization BREAKS diagrams:
          // - DOMPurify strips foreignObject content (GitHub DOMPurify #1002, #1088)
          // - DOMPurify strips xlink:href internal references used for markers (#233)
          // - These SVG features are essential for flowcharts, sequence diagrams, etc.
          //
          // See: https://github.com/cure53/DOMPurify/issues/1002
          containerRef.current.innerHTML = svg
          setSvgContent(svg)

          // Make SVG responsive
          const svgElement = containerRef.current.querySelector('svg')
          if (svgElement) {
            svgElement.setAttribute('width', '100%')
            svgElement.style.maxWidth = '100%'
            svgElement.style.height = 'auto'
          }
        }

        setIsLoading(false)

        // Dispatch a custom event to inform preview that mermaid finished rendering
        // Bubble so listeners on preview container can catch it
        const target = containerRef.current
        if (target) {
          const event = new CustomEvent('mermaid:rendered', {
            bubbles: true,
            detail: { startLine, endLine, ok: true }
          })
          target.dispatchEvent(event)
        }
      } catch (err) {
        console.error('Mermaid rendering error:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
        // Clean up error message - remove technical details
        const cleanMessage = errorMessage
          .replace(/Parse error on line \d+:\n/, '')
          .replace(/\^-+/, '')
          .trim()
        setError(cleanMessage)
        setIsLoading(false)

        // Notify listeners even on error so scroll map can stabilize
        if (containerRef.current) {
          const event = new CustomEvent('mermaid:rendered', {
            bubbles: true,
            detail: { startLine, endLine, ok: false }
          })
          containerRef.current.dispatchEvent(event)
        }
      }
    }

    renderDiagram()
  }, [code, initialized])

  const handleExpandClick = () => {
    if (svgContent && filePath) {
      openViewer({
        diagramId: currentDiagramId,
        mermaidCode: code,
        svgContent,
        filePath,
        startLine,
        endLine
      })
    }
  }

  // When diagram re-renders with new code/SVG, update the store if viewer is open for this diagram
  // This enables live updates when editing the source file with viewer open
  useEffect(() => {
    if (svgContent && isViewerOpenForThis && filePath) {
      updateDiagram({
        filePath,
        mermaidCode: code,
        svgContent,
        startLine,
        endLine
      })
    }
  }, [svgContent, code, isViewerOpenForThis, filePath, startLine, endLine, updateDiagram])

  return (
    <div className={`mermaid-container ${className}`}>
      {error && (
        <div className="mermaid-error">
          <div className="mermaid-error-header">
            <strong>Mermaid Diagram Error:</strong>
            {filePath && (
              <button
                className="mermaid-bug-btn"
                onClick={handleBugReport}
                title="Report this error to Claude Code"
              >
                <Bug size={16} strokeWidth={2} />
              </button>
            )}
          </div>
          <pre>{error}</pre>
          <div className="mermaid-error-hint">
            Check your diagram syntax. See{' '}
            <a
              href="https://mermaid.js.org/"
              onClick={(e) => {
                e.preventDefault()
                // @ts-expect-error - shell is available via electron
                window.electron.shell.openExternal('https://mermaid.js.org/')
              }}
            >
              Mermaid documentation
            </a>
          </div>
        </div>
      )}

      {isLoading && !error && (
        <div className="mermaid-loading">
          <div className="mermaid-loading-spinner"></div>
          <span>Rendering diagram...</span>
        </div>
      )}

      {!error && (
        <>
          {!isLoading && (
            <MermaidToolbar
              code={code}
              hasSvgContent={!!svgContent}
              filePath={filePath}
              startLine={startLine}
              endLine={endLine}
              isLoading={isLoading}
              onExpand={handleExpandClick}
            />
          )}
          <div
            ref={containerRef}
            className="mermaid-diagram"
            style={{ display: isLoading ? 'none' : 'flex' }}
          />
        </>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Bug, Maximize2 } from 'lucide-react'
import { executePromptTemplate } from '../../utils/panelUtils'
import { DiagramViewer } from './DiagramViewer'
import { getMermaidConfig } from '../../utils/mermaidThemes'

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
  const [showViewer, setShowViewer] = useState(false)
  const [svgContent, setSvgContent] = useState<string>('')
  const expandButtonRef = useRef<HTMLButtonElement>(null)

  // Handle bug report button click
  const handleBugReport = async () => {
    if (!error || !filePath) return

    try {
      // Construct file reference
      const fileRef = startLine && endLine
        ? `@${filePath}:${startLine}-${endLine}`
        : `@${filePath}`

      // Format line range string
      const lineRange = startLine && endLine
        ? startLine === endLine
          ? `line ${startLine}`
          : `lines ${startLine}-${endLine}`
        : undefined

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
    if (svgContent) {
      setShowViewer(true)
    }
  }

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
          <button
            ref={expandButtonRef}
            className="mermaid-expand-btn"
            onClick={handleExpandClick}
            title="View fullscreen"
            aria-label="Open diagram in fullscreen"
            style={{ display: isLoading ? 'none' : 'flex' }}
          >
            <Maximize2 size={14} />
          </button>
          <div
            ref={containerRef}
            className="mermaid-diagram"
            style={{ display: isLoading ? 'none' : 'flex' }}
          />
          <DiagramViewer
            isOpen={showViewer}
            onClose={() => setShowViewer(false)}
            svgContent={svgContent}
            title="Mermaid Diagram"
          />
        </>
      )}
    </div>
  )
}

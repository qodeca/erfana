import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Bug } from 'lucide-react'
import { executePromptTemplate } from '../../utils/panelUtils'

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

  // Initialize mermaid once on component mount
  useEffect(() => {
    console.log('🔷 Mermaid: Initializing...')
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#1e1e1e',
        primaryColor: '#4fc3f7',
        primaryTextColor: '#d4d4d4',
        primaryBorderColor: '#555',
        lineColor: '#888',
        secondaryColor: '#2d2d30',
        tertiaryColor: '#3e3e42',
        // Additional theme variables for better dark mode
        noteBkgColor: '#2d2d30',
        noteTextColor: '#d4d4d4',
        noteBorderColor: '#555',
        // Sequence diagram colors
        actorBkg: '#2d2d30',
        actorBorder: '#555',
        actorTextColor: '#d4d4d4',
        actorLineColor: '#888',
        signalColor: '#d4d4d4',
        signalTextColor: '#d4d4d4',
        labelBoxBkgColor: '#2d2d30',
        labelBoxBorderColor: '#555',
        labelTextColor: '#d4d4d4',
        // Flowchart colors
        mainBkg: '#2d2d30',
        secondBkg: '#3e3e42',
        border1: '#555',
        border2: '#666',
        // Class diagram colors
        classText: '#d4d4d4',
        // State diagram colors
        labelColor: '#d4d4d4',
        // Git graph colors
        git0: '#4fc3f7',
        git1: '#ce9178',
        git2: '#dcdcaa',
        git3: '#569cd6',
        git4: '#c586c0',
        git5: '#4ec9b0',
        git6: '#d7ba7d',
        git7: '#b267e6'
      },
      // Additional config for better rendering
      flowchart: {
        htmlLabels: true,
        curve: 'basis'
      },
      sequence: {
        diagramMarginX: 50,
        diagramMarginY: 10,
        actorMargin: 50,
        width: 150,
        height: 65,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35
      },
      gantt: {
        titleTopMargin: 25,
        barHeight: 20,
        barGap: 4,
        topPadding: 50,
        leftPadding: 75,
        gridLineStartPadding: 35,
        fontSize: 11
      }
    })
    console.log('✅ Mermaid: Initialized')
    setInitialized(true)
  }, [])

  // Render diagram whenever code changes
  useEffect(() => {
    if (!initialized || !containerRef.current) {
      console.log('⏳ Mermaid: Waiting for initialization or container...', { initialized, hasContainer: !!containerRef.current })
      return
    }

    console.log('🎨 Mermaid: Starting render...', { codeLength: code.length })

    const renderDiagram = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`

        console.log('🔨 Mermaid: Calling mermaid.render() with ID:', id)

        // Render diagram using mermaid v11 API
        const { svg } = await mermaid.render(id, code)

        console.log('✅ Mermaid: Render successful, SVG length:', svg.length)

        if (containerRef.current) {
          containerRef.current.innerHTML = svg

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
        console.error('❌ Mermaid rendering error:', err)
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
        <div
          ref={containerRef}
          className="mermaid-diagram"
          style={{ display: isLoading ? 'none' : 'flex' }}
        />
      )}
    </div>
  )
}

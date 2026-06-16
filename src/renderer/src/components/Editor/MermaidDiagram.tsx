// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Bug } from 'lucide-react'
import { executePromptTemplate } from '../../utils/panelUtils'
import { formatLineRange } from '../../prompts/helpers'
import { MermaidToolbar } from './MermaidToolbar'
import { getMermaidConfig } from '../../utils/mermaidThemes'
import { useDiagramViewerStore, buildDiagramId, hashDiagramContent } from '../../stores/useDiagramViewerStore'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { scheduleScrollIfNeeded } from '../../utils/promptScrollScheduler.logic'
import { logger } from '../../utils/logger'

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
    contentHash: storedContentHash,
    originalStartLine,
    openViewer,
    updateDiagram
  } = useDiagramViewerStore()

  // Generate unique ID for this diagram
  const currentDiagramId = buildDiagramId(filePath, startLine, endLine)

  // Terminal portal context for scroll scheduling (issue #52)
  const terminalPortal = useTerminalPortalOptional()

  // Reduced tolerance - only for tie-breaking when content changes
  const LINE_DRIFT_TOLERANCE = 10

  // Check if THIS diagram is the one currently open in the viewer
  // Primary identity: content hash (survives line drift and external file reloads)
  // Secondary: position tie-breaker (for identical diagrams or when content is edited)
  const isViewerOpenForThis = (() => {
    if (!isOpen || filePath !== storedFilePath) return false

    // Primary check: Content hash match
    // If content is identical, this IS the diagram (regardless of position)
    if (storedContentHash) {
      const currentHash = hashDiagramContent(code)
      if (currentHash === storedContentHash) {
        return true
      }
    }

    // Secondary check: Position-based matching for edited content
    // When user edits the diagram, content hash changes but it's still "the same diagram"
    // Accept if position is close to where we opened the viewer
    if (startLine === undefined || originalStartLine === undefined) return false

    const positionDrift = Math.abs(startLine - originalStartLine)
    return positionDrift <= LINE_DRIFT_TOLERANCE
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
      const result = await executePromptTemplate('mermaid-bug-report', {
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

      // Schedule scroll-to-bottom after prompt execution (issue #52)
      if (result.success && result.completionTs && terminalPortal?.lastUserScrollTsRef) {
        scheduleScrollIfNeeded({
          completionTs: result.completionTs,
          terminalPortal: {
            terminalControls: terminalPortal.terminalControls,
            isTerminalReady: terminalPortal.isTerminalReady
          },
          lastUserScrollTsRef: terminalPortal.lastUserScrollTsRef,
          delayMs: 1000
        })
      }
    } catch (err) {
      logger.error('Failed to send bug report', err instanceof Error ? err : undefined)
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
        logger.error('Mermaid rendering error', err instanceof Error ? err : undefined)
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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { useIdleDebouncedValue } from '../../hooks/useIdleDebouncedValue'
import { useLatestRef } from '../../hooks/useLatestRef'
import { PreviewWorkContext } from './previewWork'

/**
 * Quiet period (ms) after the diagram source last changed before it is redrawn.
 * `mermaid.render` costs tens of milliseconds per diagram, and a diagram being
 * typed is invalid most of the time, so redrawing per keystroke both stalls
 * typing and flashes the error panel. The first draw is never delayed.
 */
export const MERMAID_IDLE_DELAY_MS = 300

interface MermaidDiagramProps {
  code: string
  className?: string
  filePath?: string
  startLine?: number
  endLine?: number
}

export function MermaidDiagram({
  code: sourceCode,
  className = '',
  filePath,
  startLine: sourceStartLine,
  endLine: sourceEndLine
}: MermaidDiagramProps) {
  // Everything below – the drawing, the viewer identity, bug reports – works on
  // the debounced source. Code and line range are debounced as ONE value, so the
  // SVG, the code it is reported with and the lines it claims always match.
  const source = useMemo(
    () => ({ code: sourceCode, startLine: sourceStartLine, endLine: sourceEndLine }),
    [sourceCode, sourceStartLine, sourceEndLine]
  )
  const { value: released, flush } = useIdleDebouncedValue(source, { delayMs: MERMAID_IDLE_DELAY_MS })
  const { code, startLine, endLine } = released
  const { tracker, flushEpoch } = useContext(PreviewWorkContext)

  // The source this diagram last finished drawing (or failing to draw); null
  // before the first draw. While it differs from the live source the diagram
  // is "busy" – the preview's flush() waits for that (PDF / DOCX export).
  const [drawnCode, setDrawnCode] = useState<string | null>(null)
  const isBusy = drawnCode !== sourceCode
  // Layout effect: registered before the preview body's own commit callback
  // runs, so a flush waiting on that commit already sees this diagram as busy.
  useLayoutEffect(() => {
    if (!isBusy || !tracker) return
    return tracker.begin()
  }, [isBusy, tracker])

  // A preview flush releases a held-back redraw at once.
  useEffect(() => {
    if (flushEpoch > 0) flush()
  }, [flushEpoch, flush])

  // Each draw takes a token; an async draw that finishes after a newer one
  // started must not overwrite it.
  const drawTokenRef = useRef(0)

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
  const openMermaidDocs = (e: React.MouseEvent): void => {
    e.preventDefault()
    window.electron.shell.openExternal('https://mermaid.js.org/')
  }

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the flag records that the external mermaid.initialize() call above has run; the draw effect below must wait for it
    setInitialized(true)
  }, [])

  // Render diagram whenever code changes
  // The line range only labels the 'mermaid:rendered' event: read it through a
  // ref so a range shift (an edit above the diagram) does not redraw it.
  const lineRangeRef = useLatestRef({ startLine, endLine })
  useEffect(() => {
    if (!initialized || !containerRef.current) {
      return
    }
    const { startLine: drawStartLine, endLine: drawEndLine } = lineRangeRef.current

    const token = ++drawTokenRef.current
    const isCurrent = (): boolean => token === drawTokenRef.current

    const renderDiagram = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`

        // Render diagram using mermaid v11 API
        const { svg } = await mermaid.render(id, code)
        if (!isCurrent()) return

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
        setDrawnCode(code)

        // Dispatch a custom event to inform preview that mermaid finished rendering
        // Bubble so listeners on preview container can catch it
        const target = containerRef.current
        if (target) {
          const event = new CustomEvent('mermaid:rendered', {
            bubbles: true,
            detail: { startLine: drawStartLine, endLine: drawEndLine, ok: true }
          })
          target.dispatchEvent(event)
        }
      } catch (err) {
        // A newer draw has started; its outcome is the one to show.
        if (!isCurrent()) return
        logger.error('Mermaid rendering error', err instanceof Error ? err : undefined)
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
        // Clean up error message - remove technical details
        const cleanMessage = errorMessage
          .replace(/Parse error on line \d+:\n/, '')
          .replace(/\^-+/, '')
          .trim()
        setError(cleanMessage)
        setIsLoading(false)
        setDrawnCode(code)

        // Notify listeners even on error so scroll map can stabilize
        if (containerRef.current) {
          const event = new CustomEvent('mermaid:rendered', {
            bubbles: true,
            detail: { startLine: drawStartLine, endLine: drawEndLine, ok: false }
          })
          containerRef.current.dispatchEvent(event)
        }
      }
    }

    renderDiagram()
  }, [code, initialized, lineRangeRef])

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
              onClick={openMermaidDocs}
              onAuxClick={(e) => {
                if (e.button === 1) openMermaidDocs(e)
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

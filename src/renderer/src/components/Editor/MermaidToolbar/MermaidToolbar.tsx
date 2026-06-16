// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MermaidToolbar - Unified toolbar for Mermaid diagrams
 * Shows direction buttons (for supported chart types) and expand button
 */

import { Maximize2 } from 'lucide-react'
import { executePromptTemplate } from '../../../utils/panelUtils'
import { formatLineRange } from '../../../prompts/helpers'
import {
  detectChartType,
  supportsDirection,
  getAvailableDirections,
  detectCurrentDirection,
  isDirectionDisabled,
  isDirectionActive,
  getDirectionTooltip,
  DIRECTION_LABELS
} from '../../../utils/mermaidDirections'
import { useTerminalPortalOptional } from '../../../context/TerminalPortalContext'
import { scheduleScrollIfNeeded } from '../../../utils/promptScrollScheduler.logic'
import { logger } from '../../../utils/logger'
import { TEST_IDS } from '../../../constants/testids'
import './MermaidToolbar.css'

export interface MermaidToolbarProps {
  /** The Mermaid diagram code */
  code: string
  /** Whether the diagram has rendered SVG content available */
  hasSvgContent: boolean
  /** File path for prompt context */
  filePath?: string
  /** Start line number for prompt context */
  startLine?: number
  /** End line number for prompt context */
  endLine?: number
  /** Whether the diagram is still loading */
  isLoading: boolean
  /** Callback when expand button is clicked */
  onExpand: () => void
}

export function MermaidToolbar({
  code,
  hasSvgContent,
  filePath,
  startLine,
  endLine,
  isLoading,
  onExpand
}: MermaidToolbarProps) {
  const chartType = detectChartType(code)
  const showDirectionButtons = supportsDirection(chartType)
  const availableDirections = getAvailableDirections(chartType)
  const currentDirection = detectCurrentDirection(code, chartType)

  // Terminal portal context for scroll scheduling (issue #52)
  const terminalPortal = useTerminalPortalOptional()

  const handleDirectionClick = async (direction: string) => {
    if (!filePath) {
      return
    }

    try {
      // Construct file reference
      const fileRef =
        startLine && endLine ? `@${filePath}:${startLine}-${endLine}` : `@${filePath}`

      // Format line range string
      const lineRange = formatLineRange(startLine, endLine) || undefined

      // Execute prompt template
      const result = await executePromptTemplate('change-mermaid-direction', {
        selectedText: '',
        filePath,
        fullDocument: '',
        startLine,
        endLine,
        lineRange,
        fileRef,
        mermaidCode: code,
        targetDirection: direction,
        directionLabel: DIRECTION_LABELS[direction] || direction
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
      logger.error('Failed to execute direction change prompt', err instanceof Error ? err : undefined)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <div className="mermaid-toolbar" role="toolbar" aria-label="Mermaid diagram toolbar" data-testid={TEST_IDS.MERMAID_TOOLBAR}>
      <div className="mermaid-toolbar-directions" role="group" aria-label="Layout direction" data-testid={TEST_IDS.MERMAID_DIRECTIONS_GROUP}>
        {showDirectionButtons && (
          <>
            {availableDirections.map((direction) => {
              const disabled = isDirectionDisabled(direction, currentDirection, chartType)
              const active = isDirectionActive(direction, currentDirection, chartType)

              return (
                <button
                  key={direction}
                  className={`mermaid-direction-btn ${active ? 'mermaid-direction-btn--active' : ''}`}
                  onClick={() => handleDirectionClick(direction)}
                  disabled={disabled}
                  title={getDirectionTooltip(direction)}
                  aria-label={`Change layout to ${getDirectionTooltip(direction)}`}
                  aria-pressed={active}
                  data-testid={`${TEST_IDS.MERMAID_DIRECTION_BTN}-${direction}`}
                >
                  {direction}
                </button>
              )
            })}
          </>
        )}

        <button
          className="mermaid-toolbar-expand-btn"
          onClick={onExpand}
          disabled={!hasSvgContent}
          title="View fullscreen"
          aria-label="Open diagram in fullscreen"
          data-testid={TEST_IDS.MERMAID_BTN_EXPAND}
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  )
}

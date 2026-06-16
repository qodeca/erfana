// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Mermaid diagram direction detection and management
 * Pure logic module for detecting chart types and directions
 *
 * Supported diagram types with direction:
 * - flowchart/graph: TB, TD, BT, LR, RL (syntax: flowchart LR)
 * - stateDiagram: TB, BT, LR, RL (syntax: direction LR)
 * - classDiagram: TB, BT, LR, RL (syntax: direction LR)
 * - erDiagram: TB, BT, LR, RL (syntax: direction LR)
 * - requirementDiagram: TB, BT, LR, RL (syntax: direction LR)
 * - gitGraph: LR, TB, BT (syntax: gitGraph LR:)
 *
 * Sources:
 * - https://mermaid.js.org/syntax/flowchart.html
 * - https://mermaid.js.org/syntax/stateDiagram.html
 * - https://mermaid.js.org/syntax/classDiagram.html
 * - https://mermaid.js.org/syntax/entityRelationshipDiagram.html
 * - https://mermaid.js.org/syntax/requirementDiagram.html
 * - https://mermaid.js.org/syntax/gitgraph.html
 */

// Chart types that support layout direction
export const DIRECTION_CAPABLE_CHARTS = [
  'flowchart',
  'graph',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
  'requirementDiagram',
  'gitGraph'
] as const
export type DirectionCapableChart = (typeof DIRECTION_CAPABLE_CHARTS)[number]

// Available directions per chart type
export const FLOWCHART_DIRECTIONS = ['TB', 'TD', 'BT', 'LR', 'RL'] as const
export const STANDARD_DIRECTIONS = ['TB', 'BT', 'LR', 'RL'] as const // stateDiagram, classDiagram, erDiagram, requirementDiagram
export const GITGRAPH_DIRECTIONS = ['LR', 'TB', 'BT'] as const // gitGraph has fewer options, LR is default

export type FlowchartDirection = (typeof FLOWCHART_DIRECTIONS)[number]
export type StandardDirection = (typeof STANDARD_DIRECTIONS)[number]
export type GitGraphDirection = (typeof GITGRAPH_DIRECTIONS)[number]
export type Direction = FlowchartDirection | StandardDirection | GitGraphDirection

// Direction labels for UI
export const DIRECTION_LABELS: Record<string, string> = {
  TB: 'Top to Bottom',
  TD: 'Top Down',
  BT: 'Bottom to Top',
  LR: 'Left to Right',
  RL: 'Right to Left'
}

// Short labels for compact buttons
export const DIRECTION_SHORT_LABELS: Record<string, string> = {
  TB: 'TB',
  TD: 'TD',
  BT: 'BT',
  LR: 'LR',
  RL: 'RL'
}

/**
 * Detect the chart type from Mermaid code
 * Returns the chart type keyword or null if not detected
 */
export function detectChartType(code: string): string | null {
  if (!code || typeof code !== 'string') return null

  const trimmed = code.trim()
  const firstLine = trimmed.split('\n')[0].trim().toLowerCase()

  // Flowchart: "flowchart LR" or "graph TD"
  if (firstLine.startsWith('flowchart')) return 'flowchart'
  if (firstLine.startsWith('graph')) return 'graph'

  // State diagram: "stateDiagram" or "stateDiagram-v2"
  if (firstLine.startsWith('statediagram')) return 'stateDiagram'

  // Class diagram: "classDiagram" or "classDiagram-v2"
  if (firstLine.startsWith('classdiagram')) return 'classDiagram'

  // ER diagram: "erDiagram"
  if (firstLine.startsWith('erdiagram')) return 'erDiagram'

  // Requirement diagram: "requirementDiagram"
  if (firstLine.startsWith('requirementdiagram')) return 'requirementDiagram'

  // Git graph: "gitGraph" or "gitGraph LR:" or "gitGraph TB:"
  if (firstLine.startsWith('gitgraph')) return 'gitGraph'

  // Other chart types (no direction support)
  const otherTypes = [
    'sequencediagram',
    'journey',
    'gantt',
    'pie',
    'quadrantchart',
    'c4context',
    'c4container',
    'c4component',
    'c4deployment',
    'mindmap',
    'timeline',
    'zenuml',
    'sankey',
    'xychart',
    'block',
    'packet',
    'kanban',
    'architecture',
    'radar'
  ]

  for (const type of otherTypes) {
    if (firstLine.startsWith(type)) return type
  }

  return null
}

/**
 * Check if a chart type supports direction changes
 */
export function supportsDirection(chartType: string | null): boolean {
  if (!chartType) return false
  const normalized = chartType.toLowerCase()
  return (
    normalized === 'flowchart' ||
    normalized === 'graph' ||
    normalized === 'statediagram' ||
    normalized === 'classdiagram' ||
    normalized === 'erdiagram' ||
    normalized === 'requirementdiagram' ||
    normalized === 'gitgraph'
  )
}

/**
 * Get available directions for a chart type
 */
export function getAvailableDirections(chartType: string | null): readonly string[] {
  if (!chartType) return []

  const normalized = chartType.toLowerCase()

  // Flowchart/graph: TB, TD, BT, LR, RL
  if (normalized === 'flowchart' || normalized === 'graph') {
    return FLOWCHART_DIRECTIONS
  }

  // stateDiagram, classDiagram, erDiagram, requirementDiagram: TB, BT, LR, RL
  if (
    normalized === 'statediagram' ||
    normalized === 'classdiagram' ||
    normalized === 'erdiagram' ||
    normalized === 'requirementdiagram'
  ) {
    return STANDARD_DIRECTIONS
  }

  // gitGraph: LR, TB, BT (no RL, no TD)
  if (normalized === 'gitgraph') {
    return GITGRAPH_DIRECTIONS
  }

  return []
}

/**
 * Detect the current direction from Mermaid code
 * Returns the direction or null if not explicitly set
 */
export function detectCurrentDirection(code: string, chartType: string | null): string | null {
  if (!code || !chartType) return null

  const trimmed = code.trim()
  const normalized = chartType.toLowerCase()

  // Flowchart/graph: direction is on the first line after the keyword
  // e.g., "flowchart LR" or "graph TD"
  if (normalized === 'flowchart' || normalized === 'graph') {
    const firstLine = trimmed.split('\n')[0].trim()
    const match = firstLine.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)/i)
    if (match) {
      return match[1].toUpperCase()
    }
    return null // No explicit direction
  }

  // stateDiagram, classDiagram, erDiagram, requirementDiagram: direction is a separate statement
  // e.g., "direction LR" anywhere in the code
  if (
    normalized === 'statediagram' ||
    normalized === 'classdiagram' ||
    normalized === 'erdiagram' ||
    normalized === 'requirementdiagram'
  ) {
    const match = trimmed.match(/^\s*direction\s+(TB|BT|LR|RL)/im)
    if (match) {
      return match[1].toUpperCase()
    }
    return null // No explicit direction
  }

  // gitGraph: direction is after the keyword with a colon
  // e.g., "gitGraph LR:" or "gitGraph TB:"
  if (normalized === 'gitgraph') {
    const firstLine = trimmed.split('\n')[0].trim()
    const match = firstLine.match(/^gitGraph\s+(LR|TB|BT)\s*:/i)
    if (match) {
      return match[1].toUpperCase()
    }
    return null // No explicit direction (default is LR)
  }

  return null
}

/**
 * Get the default direction for a chart type
 * This is what Mermaid uses when no direction is specified
 */
export function getDefaultDirection(chartType: string | null): string | null {
  if (!chartType) return null

  const normalized = chartType.toLowerCase()

  // Flowchart/graph default to TB (Top to Bottom)
  if (normalized === 'flowchart' || normalized === 'graph') {
    return 'TB'
  }

  // stateDiagram, classDiagram, erDiagram, requirementDiagram default to TB
  if (
    normalized === 'statediagram' ||
    normalized === 'classdiagram' ||
    normalized === 'erdiagram' ||
    normalized === 'requirementdiagram'
  ) {
    return 'TB'
  }

  // gitGraph defaults to LR (Left to Right)
  if (normalized === 'gitgraph') {
    return 'LR'
  }

  return null
}

/**
 * Check if a direction is valid for a chart type
 */
export function isValidDirection(direction: string, chartType: string | null): boolean {
  const available = getAvailableDirections(chartType)
  return available.includes(direction.toUpperCase())
}

/**
 * Get tooltip text for a direction button
 */
export function getDirectionTooltip(direction: string): string {
  return DIRECTION_LABELS[direction] || direction
}

/**
 * Determine if a direction button should be disabled
 * A button is disabled when it matches the current direction
 */
export function isDirectionDisabled(
  direction: string,
  currentDirection: string | null,
  chartType: string | null
): boolean {
  if (!currentDirection) {
    // No explicit direction set - check against default
    const defaultDir = getDefaultDirection(chartType)
    return defaultDir === direction
  }
  return currentDirection.toUpperCase() === direction.toUpperCase()
}

/**
 * Determine if a direction button should be highlighted as active
 * A button is active when it matches the current direction
 */
export function isDirectionActive(
  direction: string,
  currentDirection: string | null,
  chartType: string | null
): boolean {
  // Same logic as disabled - active and disabled are coupled
  return isDirectionDisabled(direction, currentDirection, chartType)
}

/**
 * Check if a chart type uses the "direction statement" syntax
 * (stateDiagram, classDiagram, erDiagram, requirementDiagram)
 * vs inline direction (flowchart LR) or colon syntax (gitGraph LR:)
 */
export function usesDirectionStatement(chartType: string | null): boolean {
  if (!chartType) return false
  const normalized = chartType.toLowerCase()
  return (
    normalized === 'statediagram' ||
    normalized === 'classdiagram' ||
    normalized === 'erdiagram' ||
    normalized === 'requirementdiagram'
  )
}

/**
 * Check if a chart type uses the colon syntax (gitGraph LR:)
 */
export function usesColonSyntax(chartType: string | null): boolean {
  if (!chartType) return false
  return chartType.toLowerCase() === 'gitgraph'
}

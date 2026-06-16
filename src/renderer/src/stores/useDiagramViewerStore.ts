// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create } from 'zustand'
import { CHAT_PANEL_CONFIG } from '../components/Editor/DiagramViewer/chatBubble.logic'

/**
 * Diagram Viewer State Store
 *
 * Persists DiagramViewer state across component remounts.
 * When a markdown file is edited, MermaidDiagram components are recreated
 * (React destroys old instance, creates new with default state).
 * This store ensures the viewer stays open and updates with new content.
 *
 * Flow:
 * 1. User clicks expand → openViewer() stores diagram ID + content
 * 2. User edits markdown → MermaidDiagram remounts with new code
 * 3. New MermaidDiagram checks diagramId match → calls updateDiagram()
 * 4. DiagramViewer (rendered at MarkdownPreview level) receives updated content
 * 5. Viewer stays open, zoom/pan preserved (via hasInitialized in DiagramViewer)
 */

interface DiagramViewerState {
  // Current viewer state
  isOpen: boolean
  /** Unique diagram identifier: `${filePath}:${startLine}-${endLine}` */
  diagramId: string | null
  mermaidCode: string
  svgContent: string
  filePath: string | null
  /** Current line numbers (updated as diagram drifts) */
  startLine: number | undefined
  endLine: number | undefined
  /** Original line numbers when viewer was opened (NEVER updated, used for matching) */
  originalStartLine: number | undefined
  /** Content hash when viewer was opened (primary identity, NEVER updated) */
  contentHash: string | null
  /** Original end line when viewer was opened (for position tie-breaking) */
  originalEndLine: number | undefined

  // Chat panel state (contains terminal when expanded)
  chatPanelHeight: number

  // Actions
  openViewer: (params: {
    diagramId: string
    mermaidCode: string
    svgContent: string
    filePath: string
    startLine?: number
    endLine?: number
  }) => void
  closeViewer: () => void
  updateDiagram: (params: {
    filePath: string
    mermaidCode: string
    svgContent: string
    startLine?: number
    endLine?: number
  }) => void

  // Chat panel actions
  setChatPanelHeight: (height: number) => void
}

export const useDiagramViewerStore = create<DiagramViewerState>((set, get) => ({
  isOpen: false,
  diagramId: null,
  mermaidCode: '',
  svgContent: '',
  filePath: null,
  startLine: undefined,
  endLine: undefined,
  originalStartLine: undefined,
  contentHash: null,
  originalEndLine: undefined,

  // Chat panel height - persists across viewer opens/closes
  chatPanelHeight: CHAT_PANEL_CONFIG.DEFAULT_HEIGHT,

  openViewer: ({ diagramId, mermaidCode, svgContent, filePath, startLine, endLine }) => {
    set({
      isOpen: true,
      diagramId,
      mermaidCode,
      svgContent,
      filePath,
      startLine,
      endLine,
      originalStartLine: startLine, // Capture original position - never updated
      originalEndLine: endLine, // NEW - for position tie-breaking
      contentHash: hashDiagramContent(mermaidCode) // NEW - primary identity
      // Note: chatPanelHeight persists from previous session
    })
  },

  closeViewer: () => {
    set({
      isOpen: false,
      diagramId: null,
      mermaidCode: '',
      svgContent: '',
      filePath: null,
      startLine: undefined,
      endLine: undefined,
      originalStartLine: undefined,
      originalEndLine: undefined, // NEW
      contentHash: null // NEW
      // Note: chatPanelHeight persists for next open
    })
  },

  updateDiagram: ({ filePath, mermaidCode, svgContent, startLine, endLine }) => {
    const state = get()
    // Match by filePath only - allows updates even when line numbers shift
    // (e.g., when user adds/removes lines above the diagram)
    if (state.isOpen && state.filePath === filePath) {
      const newDiagramId = buildDiagramId(filePath, startLine, endLine)
      set({
        mermaidCode,
        svgContent,
        startLine,
        endLine,
        diagramId: newDiagramId // Sync ID to current line numbers
      })
    }
  },

  // Chat panel actions
  setChatPanelHeight: (height) => {
    set({ chatPanelHeight: height })
  }
}))

/**
 * Helper to generate a unique diagram ID from file path and line range
 */
export function buildDiagramId(
  filePath: string | undefined,
  startLine: number | undefined,
  endLine: number | undefined
): string {
  return `${filePath ?? 'unknown'}:${startLine ?? 0}-${endLine ?? 0}`
}

/**
 * Simple hash function for diagram content comparison.
 * Used to identify diagrams by their content rather than position.
 */
export function hashDiagramContent(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

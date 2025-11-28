import { create } from 'zustand'

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
  startLine: number | undefined
  endLine: number | undefined

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
  updateDiagram: (diagramId: string, mermaidCode: string, svgContent: string) => void
}

export const useDiagramViewerStore = create<DiagramViewerState>((set, get) => ({
  isOpen: false,
  diagramId: null,
  mermaidCode: '',
  svgContent: '',
  filePath: null,
  startLine: undefined,
  endLine: undefined,

  openViewer: ({ diagramId, mermaidCode, svgContent, filePath, startLine, endLine }) => {
    set({
      isOpen: true,
      diagramId,
      mermaidCode,
      svgContent,
      filePath,
      startLine,
      endLine
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
      endLine: undefined
    })
  },

  updateDiagram: (diagramId, mermaidCode, svgContent) => {
    const state = get()
    // Only update if this is the currently open diagram
    if (state.isOpen && state.diagramId === diagramId) {
      set({ mermaidCode, svgContent })
    }
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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramViewerStore, buildDiagramId, hashDiagramContent } from './useDiagramViewerStore'

describe('useDiagramViewerStore', () => {
  // Reset store state before each test
  beforeEach(() => {
    useDiagramViewerStore.setState({
      isOpen: false,
      diagramId: null,
      mermaidCode: '',
      svgContent: '',
      filePath: null,
      startLine: undefined,
      endLine: undefined
    })
  })

  describe('initial state', () => {
    it('should have isOpen as false initially', () => {
      const { isOpen } = useDiagramViewerStore.getState()
      expect(isOpen).toBe(false)
    })

    it('should have null diagramId initially', () => {
      const { diagramId } = useDiagramViewerStore.getState()
      expect(diagramId).toBeNull()
    })

    it('should have empty strings for content initially', () => {
      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('')
      expect(svgContent).toBe('')
    })
  })

  describe('openViewer', () => {
    it('should set isOpen to true', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      openViewer({
        diagramId: 'test:1-10',
        mermaidCode: 'flowchart TD',
        svgContent: '<svg></svg>',
        filePath: '/path/to/file.md',
        startLine: 1,
        endLine: 10
      })

      const { isOpen } = useDiagramViewerStore.getState()
      expect(isOpen).toBe(true)
    })

    it('should store all provided data', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      openViewer({
        diagramId: 'file.md:5-15',
        mermaidCode: 'graph LR\n  A-->B',
        svgContent: '<svg>content</svg>',
        filePath: '/project/file.md',
        startLine: 5,
        endLine: 15
      })

      const state = useDiagramViewerStore.getState()
      expect(state.diagramId).toBe('file.md:5-15')
      expect(state.mermaidCode).toBe('graph LR\n  A-->B')
      expect(state.svgContent).toBe('<svg>content</svg>')
      expect(state.filePath).toBe('/project/file.md')
      expect(state.startLine).toBe(5)
      expect(state.endLine).toBe(15)
    })

    it('should handle optional line numbers', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      openViewer({
        diagramId: 'file.md:0-0',
        mermaidCode: 'pie title Test',
        svgContent: '<svg></svg>',
        filePath: '/file.md'
        // startLine and endLine omitted
      })

      const { startLine, endLine } = useDiagramViewerStore.getState()
      expect(startLine).toBeUndefined()
      expect(endLine).toBeUndefined()
    })
  })

  describe('closeViewer', () => {
    it('should set isOpen to false', () => {
      const { openViewer, closeViewer } = useDiagramViewerStore.getState()

      // First open the viewer
      openViewer({
        diagramId: 'test:1-10',
        mermaidCode: 'code',
        svgContent: '<svg></svg>',
        filePath: '/file.md'
      })

      // Then close it
      closeViewer()

      const { isOpen } = useDiagramViewerStore.getState()
      expect(isOpen).toBe(false)
    })

    it('should reset all state to initial values', () => {
      const { openViewer, closeViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: 'test:1-10',
        mermaidCode: 'code',
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 1,
        endLine: 10
      })

      closeViewer()

      const state = useDiagramViewerStore.getState()
      expect(state.isOpen).toBe(false)
      expect(state.diagramId).toBeNull()
      expect(state.mermaidCode).toBe('')
      expect(state.svgContent).toBe('')
      expect(state.filePath).toBeNull()
      expect(state.startLine).toBeUndefined()
      expect(state.endLine).toBeUndefined()
    })
  })

  describe('updateDiagram', () => {
    it('should update content when filePath matches and viewer is open', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: 'original code',
        svgContent: '<svg>original</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      updateDiagram({
        filePath: '/file.md',
        mermaidCode: 'updated code',
        svgContent: '<svg>updated</svg>',
        startLine: 10,
        endLine: 20
      })

      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('updated code')
      expect(svgContent).toBe('<svg>updated</svg>')
    })

    it('should NOT update when filePath does not match', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: 'original code',
        svgContent: '<svg>original</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      // Try to update with different filePath
      updateDiagram({
        filePath: '/different.md',
        mermaidCode: 'new code',
        svgContent: '<svg>new</svg>',
        startLine: 1,
        endLine: 5
      })

      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('original code')
      expect(svgContent).toBe('<svg>original</svg>')
    })

    it('should NOT update when viewer is closed', () => {
      const { updateDiagram } = useDiagramViewerStore.getState()

      // Viewer is closed by default (isOpen: false)
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: 'new code',
        svgContent: '<svg>new</svg>',
        startLine: 10,
        endLine: 20
      })

      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('')
      expect(svgContent).toBe('')
    })

    it('should update line numbers and diagramId when they change (line drift fix)', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      // Open viewer with diagram at lines 10-20
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: 'original',
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      // Simulate user adding lines above the diagram, shifting it to lines 15-25
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: 'updated',
        svgContent: '<svg>new</svg>',
        startLine: 15,
        endLine: 25
      })

      const state = useDiagramViewerStore.getState()
      // Content should be updated
      expect(state.mermaidCode).toBe('updated')
      expect(state.svgContent).toBe('<svg>new</svg>')
      // Line numbers should be synced
      expect(state.startLine).toBe(15)
      expect(state.endLine).toBe(25)
      // diagramId should be updated to reflect new line numbers
      expect(state.diagramId).toBe('/file.md:15-25')
      // Viewer should remain open
      expect(state.isOpen).toBe(true)
    })

    it('should preserve isOpen and filePath when updating', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/project/file.md:10-20',
        mermaidCode: 'original',
        svgContent: '<svg></svg>',
        filePath: '/project/file.md',
        startLine: 10,
        endLine: 20
      })

      updateDiagram({
        filePath: '/project/file.md',
        mermaidCode: 'updated',
        svgContent: '<svg>new</svg>',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()
      // These should NOT change
      expect(state.isOpen).toBe(true)
      expect(state.filePath).toBe('/project/file.md')
    })
  })

  describe('live update scenario (file edit while viewer open)', () => {
    it('should update diagram content when file is edited', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      // 1. User opens diagram viewer
      openViewer({
        diagramId: '/project/README.md:5-15',
        mermaidCode: 'flowchart TD\n  A-->B',
        svgContent: '<svg>v1</svg>',
        filePath: '/project/README.md',
        startLine: 5,
        endLine: 15
      })

      // Verify viewer is open
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)

      // 2. User edits the markdown file (simulated by MermaidDiagram calling updateDiagram)
      updateDiagram({
        filePath: '/project/README.md',
        mermaidCode: 'flowchart TD\n  A-->B-->C',
        svgContent: '<svg>v2</svg>',
        startLine: 5,
        endLine: 15
      })

      // 3. Viewer should still be open with updated content
      const state = useDiagramViewerStore.getState()
      expect(state.isOpen).toBe(true)
      expect(state.mermaidCode).toBe('flowchart TD\n  A-->B-->C')
      expect(state.svgContent).toBe('<svg>v2</svg>')
    })

    it('should NOT close viewer when content changes', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/test.md:1-10',
        mermaidCode: 'v1',
        svgContent: '<svg>1</svg>',
        filePath: '/test.md',
        startLine: 1,
        endLine: 10
      })

      // Multiple updates (simulating rapid typing)
      updateDiagram({ filePath: '/test.md', mermaidCode: 'v2', svgContent: '<svg>2</svg>', startLine: 1, endLine: 10 })
      updateDiagram({ filePath: '/test.md', mermaidCode: 'v3', svgContent: '<svg>3</svg>', startLine: 1, endLine: 10 })
      updateDiagram({ filePath: '/test.md', mermaidCode: 'v4', svgContent: '<svg>4</svg>', startLine: 1, endLine: 10 })

      // Viewer should still be open
      const { isOpen, mermaidCode } = useDiagramViewerStore.getState()
      expect(isOpen).toBe(true)
      expect(mermaidCode).toBe('v4')
    })
  })
})

describe('buildDiagramId', () => {
  it('should build ID from filePath and line range', () => {
    const id = buildDiagramId('/path/to/file.md', 10, 20)
    expect(id).toBe('/path/to/file.md:10-20')
  })

  it('should handle undefined filePath', () => {
    const id = buildDiagramId(undefined, 5, 15)
    expect(id).toBe('unknown:5-15')
  })

  it('should handle undefined line numbers', () => {
    const id = buildDiagramId('/file.md', undefined, undefined)
    expect(id).toBe('/file.md:0-0')
  })

  it('should handle all undefined values', () => {
    const id = buildDiagramId(undefined, undefined, undefined)
    expect(id).toBe('unknown:0-0')
  })

  it('should handle mixed undefined values', () => {
    const id = buildDiagramId('/file.md', 5, undefined)
    expect(id).toBe('/file.md:5-0')
  })
})

describe('issue #39 regression tests - multi-diagram scenarios', () => {
  beforeEach(() => {
    useDiagramViewerStore.getState().closeViewer()
  })

  describe('hashDiagramContent', () => {
    it('should return consistent hash for same content', () => {
      const code = 'flowchart TD\n    A --> B'
      expect(hashDiagramContent(code)).toBe(hashDiagramContent(code))
    })

    it('should return different hash for different content', () => {
      const codeA = 'flowchart TD\n    A --> B'
      const codeB = 'flowchart TD\n    C --> D'
      expect(hashDiagramContent(codeA)).not.toBe(hashDiagramContent(codeB))
    })

    it('should handle empty string', () => {
      expect(hashDiagramContent('')).toBe('0')
    })

    it('should handle whitespace differences', () => {
      const codeA = 'flowchart TD\n    A --> B'
      const codeB = 'flowchart TD\n    A --> B '  // trailing space
      expect(hashDiagramContent(codeA)).not.toBe(hashDiagramContent(codeB))
    })

    it('should be case-sensitive', () => {
      const codeA = 'flowchart TD\n    A --> B'
      const codeB = 'flowchart td\n    a --> b'
      expect(hashDiagramContent(codeA)).not.toBe(hashDiagramContent(codeB))
    })

    it('should handle multiline diagrams', () => {
      const code = 'flowchart TD\n    A --> B\n    B --> C\n    C --> D'
      const hash = hashDiagramContent(code)
      expect(hash).toBeTruthy()
      expect(typeof hash).toBe('string')
    })

    it('should handle special characters', () => {
      const code = 'flowchart TD\n    A["Special: @#$%^&*()"] --> B'
      const hash = hashDiagramContent(code)
      expect(hash).toBeTruthy()
    })
  })

  describe('openViewer stores content hash', () => {
    it('should store contentHash when opening viewer', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    A --> B'

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBe(hashDiagramContent(code))
    })

    it('should store originalEndLine when opening viewer', () => {
      const { openViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: 'test',
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()
      expect(state.originalEndLine).toBe(20)
    })

    it('should store originalStartLine when opening viewer', () => {
      const { openViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:15-25',
        mermaidCode: 'test',
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 15,
        endLine: 25
      })

      const state = useDiagramViewerStore.getState()
      expect(state.originalStartLine).toBe(15)
    })

    it('should handle undefined line numbers gracefully', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    A --> B'

      openViewer({
        diagramId: '/file.md:0-0',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md'
      })

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBe(hashDiagramContent(code))
      expect(state.originalStartLine).toBeUndefined()
      expect(state.originalEndLine).toBeUndefined()
    })
  })

  describe('closeViewer resets identity fields', () => {
    it('should reset contentHash on close', () => {
      const { openViewer, closeViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: 'test',
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      closeViewer()

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBeNull()
      expect(state.originalEndLine).toBeUndefined()
    })

    it('should reset all identity fields on close', () => {
      const { openViewer, closeViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: 'test',
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      expect(useDiagramViewerStore.getState().contentHash).not.toBeNull()
      expect(useDiagramViewerStore.getState().originalStartLine).toBeDefined()

      closeViewer()

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBeNull()
      expect(state.originalStartLine).toBeUndefined()
      expect(state.originalEndLine).toBeUndefined()
    })
  })

  describe('content-based identity scenarios', () => {
    it('should correctly identify diagram by content hash when lines drift', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    A --> B'

      // Open diagram at lines 10-20
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()

      // Same content at new position (lines 50-60) should have matching hash
      const originalHash = state.contentHash
      const newPositionHash = hashDiagramContent(code)
      expect(newPositionHash).toBe(originalHash)
    })

    it('should distinguish different diagrams even if within position tolerance', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const codeA = 'flowchart TD\n    A --> B'
      const codeB = 'flowchart TD\n    C --> D'

      // Open diagram A at lines 10-20
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: codeA,
        svgContent: '<svg>A</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()

      // Diagram B at lines 15-25 (within tolerance) has different hash
      const hashB = hashDiagramContent(codeB)
      expect(hashB).not.toBe(state.contentHash)
    })

    it('should track same diagram when content is identical but position changes significantly', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    Original --> Diagram'

      // Open diagram at lines 10-20
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const originalHash = useDiagramViewerStore.getState().contentHash

      // Same diagram at completely different position (100 lines away)
      const movedHash = hashDiagramContent(code)
      expect(movedHash).toBe(originalHash)
    })
  })

  describe('external file change scenarios', () => {
    it('should track original diagram when external edit adds new diagram at old position', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const originalCode = 'flowchart TD\n    Original --> Diagram'
      const newCode = 'flowchart TD\n    New --> Diagram'

      // Open original diagram at lines 10-20
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: originalCode,
        svgContent: '<svg>Original</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()
      const originalHash = state.contentHash

      // New diagram at same position has different hash
      const newHash = hashDiagramContent(newCode)
      expect(newHash).not.toBe(originalHash)

      // Original diagram moved elsewhere still has matching hash
      const movedOriginalHash = hashDiagramContent(originalCode)
      expect(movedOriginalHash).toBe(originalHash)
    })

    it('should handle complete file reload with diagram moved to different position', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    A --> B'

      // Open at lines 10-20
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const originalHash = useDiagramViewerStore.getState().contentHash

      // External edit: diagram moves to lines 50-60
      // updateDiagram is called by MermaidDiagram when it re-renders
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: code,
        svgContent: '<svg>updated</svg>',
        startLine: 50,
        endLine: 60
      })

      const state = useDiagramViewerStore.getState()

      // Store should update position but contentHash remains the same
      expect(state.startLine).toBe(50)
      expect(state.endLine).toBe(60)
      // contentHash is NEVER updated - it's the original identity
      expect(state.contentHash).toBe(originalHash)
    })

    it('should handle diagram being deleted and recreated at different position', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    Persistent --> Diagram'

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const originalHash = useDiagramViewerStore.getState().contentHash

      // External edit: diagram deleted at 10-20, recreated at 100-110
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: code,
        svgContent: '<svg>new position</svg>',
        startLine: 100,
        endLine: 110
      })

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBe(originalHash)
      expect(state.startLine).toBe(100)
      expect(state.endLine).toBe(110)
    })
  })

  describe('identical diagrams tie-breaking', () => {
    it('should store position for tie-breaking identical diagrams', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    A --> B'

      // Two identical diagrams exist at lines 10-20 and 50-60
      // User opens the second one
      openViewer({
        diagramId: '/file.md:50-60',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 50,
        endLine: 60
      })

      const state = useDiagramViewerStore.getState()

      // Both have same content hash (identical diagrams)
      expect(state.contentHash).toBe(hashDiagramContent(code))

      // Position stored for tie-breaking
      expect(state.originalStartLine).toBe(50)
      expect(state.originalEndLine).toBe(60)
    })

    it('should maintain original position even when diagram drifts', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()
      const code = 'flowchart TD\n    A --> B'

      openViewer({
        diagramId: '/file.md:50-60',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 50,
        endLine: 60
      })

      // Lines above added, diagram drifts to 55-65
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        startLine: 55,
        endLine: 65
      })

      const state = useDiagramViewerStore.getState()

      // Original position preserved for tie-breaking
      expect(state.originalStartLine).toBe(50)
      expect(state.originalEndLine).toBe(60)

      // Current position updated
      expect(state.startLine).toBe(55)
      expect(state.endLine).toBe(65)
    })
  })

  describe('updateDiagram does NOT change identity fields', () => {
    it('should NOT update contentHash when updateDiagram is called', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()
      const originalCode = 'flowchart TD\n    A --> B'
      const editedCode = 'flowchart TD\n    A --> B --> C'

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: originalCode,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const originalHash = useDiagramViewerStore.getState().contentHash

      // User edits the diagram
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: editedCode,
        svgContent: '<svg>edited</svg>',
        startLine: 10,
        endLine: 22  // grew by 2 lines
      })

      const state = useDiagramViewerStore.getState()

      // contentHash should NOT change (it's the original identity)
      expect(state.contentHash).toBe(originalHash)

      // originalStartLine should NOT change
      expect(state.originalStartLine).toBe(10)
      expect(state.originalEndLine).toBe(20)

      // Current position fields DO update
      expect(state.startLine).toBe(10)
      expect(state.endLine).toBe(22)
      expect(state.mermaidCode).toBe(editedCode)
    })

    it('should preserve original identity across multiple edits', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()
      const v1 = 'flowchart TD\n    A --> B'
      const v2 = 'flowchart TD\n    A --> B --> C'
      const v3 = 'flowchart TD\n    A --> B --> C --> D'

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: v1,
        svgContent: '<svg>v1</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const originalHash = useDiagramViewerStore.getState().contentHash
      const originalStart = useDiagramViewerStore.getState().originalStartLine
      const originalEnd = useDiagramViewerStore.getState().originalEndLine

      // Multiple rapid edits
      updateDiagram({
        filePath: '/file.md',
        mermaidCode: v2,
        svgContent: '<svg>v2</svg>',
        startLine: 10,
        endLine: 21
      })

      updateDiagram({
        filePath: '/file.md',
        mermaidCode: v3,
        svgContent: '<svg>v3</svg>',
        startLine: 10,
        endLine: 22
      })

      const state = useDiagramViewerStore.getState()

      // Original identity NEVER changes
      expect(state.contentHash).toBe(originalHash)
      expect(state.originalStartLine).toBe(originalStart)
      expect(state.originalEndLine).toBe(originalEnd)

      // Current content reflects latest edit
      expect(state.mermaidCode).toBe(v3)
      expect(state.endLine).toBe(22)
    })
  })

  describe('multi-diagram file scenarios (issue #39 reproduction)', () => {
    it('should distinguish between first and second diagram when expanding', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const diagram1 = 'flowchart TD\n    First --> Diagram'
      const diagram2 = 'flowchart TD\n    Second --> Diagram'

      // User expands SECOND diagram (lines 50-60)
      openViewer({
        diagramId: '/file.md:50-60',
        mermaidCode: diagram2,
        svgContent: '<svg>Second</svg>',
        filePath: '/file.md',
        startLine: 50,
        endLine: 60
      })

      const state = useDiagramViewerStore.getState()

      // Should store hash of second diagram, NOT first
      expect(state.contentHash).toBe(hashDiagramContent(diagram2))
      expect(state.contentHash).not.toBe(hashDiagramContent(diagram1))
      expect(state.originalStartLine).toBe(50)
    })

    it('should track correct diagram when file has 3+ diagrams', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const diagram1 = 'flowchart TD\n    First'
      const diagram2 = 'flowchart TD\n    Second'
      const diagram3 = 'flowchart TD\n    Third'

      // User expands middle diagram
      openViewer({
        diagramId: '/file.md:50-60',
        mermaidCode: diagram2,
        svgContent: '<svg>Second</svg>',
        filePath: '/file.md',
        startLine: 50,
        endLine: 60
      })

      const state = useDiagramViewerStore.getState()
      const hash2 = hashDiagramContent(diagram2)

      expect(state.contentHash).toBe(hash2)
      expect(state.contentHash).not.toBe(hashDiagramContent(diagram1))
      expect(state.contentHash).not.toBe(hashDiagramContent(diagram3))
    })

    it('should handle expanding different diagram while viewer is already open', () => {
      const { openViewer } = useDiagramViewerStore.getState()
      const diagram1 = 'flowchart TD\n    First'
      const diagram2 = 'flowchart TD\n    Second'

      // Open first diagram
      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: diagram1,
        svgContent: '<svg>First</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const hash1 = useDiagramViewerStore.getState().contentHash

      // User clicks expand on second diagram
      openViewer({
        diagramId: '/file.md:50-60',
        mermaidCode: diagram2,
        svgContent: '<svg>Second</svg>',
        filePath: '/file.md',
        startLine: 50,
        endLine: 60
      })

      const state = useDiagramViewerStore.getState()

      // Should now track second diagram
      expect(state.contentHash).not.toBe(hash1)
      expect(state.contentHash).toBe(hashDiagramContent(diagram2))
      expect(state.originalStartLine).toBe(50)
    })
  })

  describe('edge cases', () => {
    it('should handle diagram with only whitespace differences', () => {
      const code1 = 'flowchart TD\n    A --> B'
      const code2 = 'flowchart TD\n\n    A --> B' // extra newline

      const hash1 = hashDiagramContent(code1)
      const hash2 = hashDiagramContent(code2)

      expect(hash1).not.toBe(hash2)
    })

    it('should handle very long diagram code', () => {
      const longCode = 'flowchart TD\n' +
        Array.from({ length: 100 }, (_, i) => `    Node${i} --> Node${i + 1}`).join('\n')

      const { openViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-110',
        mermaidCode: longCode,
        svgContent: '<svg>long</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 110
      })

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBeTruthy()
      expect(state.contentHash).toBe(hashDiagramContent(longCode))
    })

    it('should handle unicode characters in diagram content', () => {
      const code = 'flowchart TD\n    A["Hello 世界 🚀"] --> B["Ñoño"]'

      const { openViewer } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: '/file.md:10-20',
        mermaidCode: code,
        svgContent: '<svg></svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      const state = useDiagramViewerStore.getState()
      expect(state.contentHash).toBe(hashDiagramContent(code))
    })

    it('should handle diagram code with escaped characters', () => {
      const code = 'flowchart TD\n    A["Text with \\"quotes\\""] --> B[\'Single \\\'quotes\\\']'

      const hash = hashDiagramContent(code)
      expect(hash).toBeTruthy()
      expect(hashDiagramContent(code)).toBe(hash) // deterministic
    })
  })
})

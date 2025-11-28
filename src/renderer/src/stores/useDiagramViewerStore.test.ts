import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramViewerStore, buildDiagramId } from './useDiagramViewerStore'

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
    it('should update content when diagramId matches and viewer is open', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: 'file.md:10-20',
        mermaidCode: 'original code',
        svgContent: '<svg>original</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      updateDiagram('file.md:10-20', 'updated code', '<svg>updated</svg>')

      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('updated code')
      expect(svgContent).toBe('<svg>updated</svg>')
    })

    it('should NOT update when diagramId does not match', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: 'file.md:10-20',
        mermaidCode: 'original code',
        svgContent: '<svg>original</svg>',
        filePath: '/file.md',
        startLine: 10,
        endLine: 20
      })

      // Try to update with different diagramId
      updateDiagram('different:1-5', 'new code', '<svg>new</svg>')

      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('original code')
      expect(svgContent).toBe('<svg>original</svg>')
    })

    it('should NOT update when viewer is closed', () => {
      const { updateDiagram } = useDiagramViewerStore.getState()

      // Viewer is closed by default (isOpen: false)
      updateDiagram('file.md:10-20', 'new code', '<svg>new</svg>')

      const { mermaidCode, svgContent } = useDiagramViewerStore.getState()
      expect(mermaidCode).toBe('')
      expect(svgContent).toBe('')
    })

    it('should preserve other state fields when updating', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: 'file.md:10-20',
        mermaidCode: 'original',
        svgContent: '<svg></svg>',
        filePath: '/project/file.md',
        startLine: 10,
        endLine: 20
      })

      updateDiagram('file.md:10-20', 'updated', '<svg>new</svg>')

      const state = useDiagramViewerStore.getState()
      // These should NOT change
      expect(state.isOpen).toBe(true)
      expect(state.diagramId).toBe('file.md:10-20')
      expect(state.filePath).toBe('/project/file.md')
      expect(state.startLine).toBe(10)
      expect(state.endLine).toBe(20)
    })
  })

  describe('live update scenario (file edit while viewer open)', () => {
    it('should update diagram content when file is edited', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      // 1. User opens diagram viewer
      openViewer({
        diagramId: 'README.md:5-15',
        mermaidCode: 'flowchart TD\n  A-->B',
        svgContent: '<svg>v1</svg>',
        filePath: '/project/README.md',
        startLine: 5,
        endLine: 15
      })

      // Verify viewer is open
      expect(useDiagramViewerStore.getState().isOpen).toBe(true)

      // 2. User edits the markdown file (simulated by MermaidDiagram calling updateDiagram)
      updateDiagram('README.md:5-15', 'flowchart TD\n  A-->B-->C', '<svg>v2</svg>')

      // 3. Viewer should still be open with updated content
      const state = useDiagramViewerStore.getState()
      expect(state.isOpen).toBe(true)
      expect(state.mermaidCode).toBe('flowchart TD\n  A-->B-->C')
      expect(state.svgContent).toBe('<svg>v2</svg>')
    })

    it('should NOT close viewer when content changes', () => {
      const { openViewer, updateDiagram } = useDiagramViewerStore.getState()

      openViewer({
        diagramId: 'test:1-10',
        mermaidCode: 'v1',
        svgContent: '<svg>1</svg>',
        filePath: '/test.md'
      })

      // Multiple updates (simulating rapid typing)
      updateDiagram('test:1-10', 'v2', '<svg>2</svg>')
      updateDiagram('test:1-10', 'v3', '<svg>3</svg>')
      updateDiagram('test:1-10', 'v4', '<svg>4</svg>')

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

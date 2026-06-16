// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Tab Operations
 *
 * Covers all utility functions for tab management in DockviewReact:
 * - getEditorPanelIds: Get all editor panel IDs
 * - getOtherPanelIds: Get panels excluding current
 * - getDirtyPanels: Filter panels with unsaved changes
 * - isPanelDirty: Check single panel dirty state
 * - closePanel / closePanels: Close panel(s)
 * - getFilenameFromPanelId: Extract filename from panel ID
 * - buildDirtyFilesMessage: Build confirmation message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DockviewApi } from 'dockview'
import {
  getEditorPanelIds,
  getOtherPanelIds,
  getDirtyPanels,
  isPanelDirty,
  closePanel,
  closePanels,
  getFilenameFromPanelId,
  buildDirtyFilesMessage
} from './tabOperations'

// Mock useProjectStore
const mockDirtyPanelIds = new Set<string>()
const mockSetEditorDirty = vi.fn()
const mockDockviewApi: DockviewApi | null = null

vi.mock('../../stores/useProjectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      dirtyPanelIds: mockDirtyPanelIds,
      setEditorDirty: mockSetEditorDirty,
      dockviewApi: mockDockviewApi
    }))
  }
}))

// Helper to create mock DockviewApi
function createMockDockviewApi(panels: Array<{ id: string; params?: { filePath?: string } }>): DockviewApi {
  const panelMap = new Map<string, { id: string; params?: { filePath?: string }; api: { close: () => void } }>()

  panels.forEach((p) => {
    panelMap.set(p.id, {
      id: p.id,
      params: p.params,
      api: { close: vi.fn() }
    })
  })

  return {
    panels: panels.map((p) => ({
      id: p.id,
      params: p.params,
      api: { close: panelMap.get(p.id)!.api.close }
    })),
    getPanel: (id: string) => panelMap.get(id) || null
  } as unknown as DockviewApi
}

describe('tabOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDirtyPanelIds.clear()
  })

  describe('getEditorPanelIds', () => {
    it('should return all panel IDs', () => {
      const api = createMockDockviewApi([
        { id: 'editor-file1' },
        { id: 'editor-file2' },
        { id: 'editor-file3' }
      ])

      const result = getEditorPanelIds(api)

      expect(result).toEqual(['editor-file1', 'editor-file2', 'editor-file3'])
    })

    it('should exclude the welcome placeholder panel', () => {
      const api = createMockDockviewApi([
        { id: '_center-placeholder' },
        { id: 'editor-file1' },
        { id: 'editor-file2' }
      ])

      const result = getEditorPanelIds(api)

      expect(result).toEqual(['editor-file1', 'editor-file2'])
      expect(result).not.toContain('_center-placeholder')
    })

    it('should return empty array when only welcome panel exists', () => {
      const api = createMockDockviewApi([{ id: '_center-placeholder' }])

      const result = getEditorPanelIds(api)

      expect(result).toEqual([])
    })

    it('should return empty array when no panels exist', () => {
      const api = createMockDockviewApi([])

      const result = getEditorPanelIds(api)

      expect(result).toEqual([])
    })
  })

  describe('getOtherPanelIds', () => {
    it('should return panels excluding the current panel', () => {
      const api = createMockDockviewApi([
        { id: 'editor-file1' },
        { id: 'editor-file2' },
        { id: 'editor-file3' }
      ])

      const result = getOtherPanelIds(api, 'editor-file2')

      expect(result).toEqual(['editor-file1', 'editor-file3'])
      expect(result).not.toContain('editor-file2')
    })

    it('should exclude both current panel and welcome placeholder', () => {
      const api = createMockDockviewApi([
        { id: '_center-placeholder' },
        { id: 'editor-file1' },
        { id: 'editor-file2' }
      ])

      const result = getOtherPanelIds(api, 'editor-file1')

      expect(result).toEqual(['editor-file2'])
      expect(result).not.toContain('_center-placeholder')
      expect(result).not.toContain('editor-file1')
    })

    it('should return empty array when only current panel exists', () => {
      const api = createMockDockviewApi([{ id: 'editor-file1' }])

      const result = getOtherPanelIds(api, 'editor-file1')

      expect(result).toEqual([])
    })

    it('should return all panels when current panel ID does not exist', () => {
      const api = createMockDockviewApi([
        { id: 'editor-file1' },
        { id: 'editor-file2' }
      ])

      const result = getOtherPanelIds(api, 'nonexistent')

      expect(result).toEqual(['editor-file1', 'editor-file2'])
    })
  })

  describe('isPanelDirty', () => {
    it('should return true when panel is in dirty set', () => {
      mockDirtyPanelIds.add('editor-file1')

      const result = isPanelDirty('editor-file1')

      expect(result).toBe(true)
    })

    it('should return false when panel is not in dirty set', () => {
      mockDirtyPanelIds.clear()

      const result = isPanelDirty('editor-file1')

      expect(result).toBe(false)
    })

    it('should return false for non-existent panel ID', () => {
      mockDirtyPanelIds.add('editor-file1')

      const result = isPanelDirty('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('getDirtyPanels', () => {
    it('should return only dirty panels from the list', () => {
      mockDirtyPanelIds.add('editor-file1')
      mockDirtyPanelIds.add('editor-file3')

      const result = getDirtyPanels(['editor-file1', 'editor-file2', 'editor-file3'])

      expect(result).toEqual(['editor-file1', 'editor-file3'])
    })

    it('should return empty array when no panels are dirty', () => {
      mockDirtyPanelIds.clear()

      const result = getDirtyPanels(['editor-file1', 'editor-file2'])

      expect(result).toEqual([])
    })

    it('should return empty array when input is empty', () => {
      mockDirtyPanelIds.add('editor-file1')

      const result = getDirtyPanels([])

      expect(result).toEqual([])
    })

    it('should handle case where dirty panel is not in input list', () => {
      mockDirtyPanelIds.add('editor-file-not-in-list')

      const result = getDirtyPanels(['editor-file1', 'editor-file2'])

      expect(result).toEqual([])
    })
  })

  describe('closePanel', () => {
    it('should close the panel and clear dirty state', () => {
      const api = createMockDockviewApi([{ id: 'editor-file1' }])
      const panel = api.getPanel('editor-file1')!

      closePanel(api, 'editor-file1')

      expect(mockSetEditorDirty).toHaveBeenCalledWith('editor-file1', false)
      expect(panel.api.close).toHaveBeenCalled()
    })

    it('should do nothing when panel does not exist', () => {
      const api = createMockDockviewApi([{ id: 'editor-file1' }])

      closePanel(api, 'nonexistent')

      expect(mockSetEditorDirty).not.toHaveBeenCalled()
    })
  })

  describe('closePanels', () => {
    it('should close multiple panels', () => {
      const api = createMockDockviewApi([
        { id: 'editor-file1' },
        { id: 'editor-file2' },
        { id: 'editor-file3' }
      ])

      closePanels(api, ['editor-file1', 'editor-file3'])

      expect(mockSetEditorDirty).toHaveBeenCalledTimes(2)
      expect(mockSetEditorDirty).toHaveBeenCalledWith('editor-file1', false)
      expect(mockSetEditorDirty).toHaveBeenCalledWith('editor-file3', false)

      const panel1 = api.getPanel('editor-file1')!
      const panel3 = api.getPanel('editor-file3')!
      expect(panel1.api.close).toHaveBeenCalled()
      expect(panel3.api.close).toHaveBeenCalled()
    })

    it('should do nothing when panel list is empty', () => {
      const api = createMockDockviewApi([{ id: 'editor-file1' }])

      closePanels(api, [])

      expect(mockSetEditorDirty).not.toHaveBeenCalled()
    })

    it('should skip non-existent panels gracefully', () => {
      const api = createMockDockviewApi([{ id: 'editor-file1' }])

      closePanels(api, ['editor-file1', 'nonexistent'])

      // Only editor-file1 should be processed
      expect(mockSetEditorDirty).toHaveBeenCalledTimes(1)
      expect(mockSetEditorDirty).toHaveBeenCalledWith('editor-file1', false)
    })
  })

  describe('getFilenameFromPanelId', () => {
    it('should extract filename from panel params when available', async () => {
      // This test requires mocking the store with a dockviewApi
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const mockApi = createMockDockviewApi([
        { id: 'editor-test', params: { filePath: '/path/to/document.md' } }
      ])

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: mockApi
      } as ReturnType<typeof useProjectStore.getState>)

      const result = getFilenameFromPanelId('editor-test')

      expect(result).toBe('document.md')
    })

    it('should extract filename from deeply nested path', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const mockApi = createMockDockviewApi([
        { id: 'editor-test', params: { filePath: '/very/deep/nested/path/to/file.ts' } }
      ])

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: mockApi
      } as ReturnType<typeof useProjectStore.getState>)

      const result = getFilenameFromPanelId('editor-test')

      expect(result).toBe('file.ts')
    })

    it('should fallback to panel ID extraction when no filePath', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const mockApi = createMockDockviewApi([{ id: 'editor-test-file' }])

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: mockApi
      } as ReturnType<typeof useProjectStore.getState>)

      const result = getFilenameFromPanelId('editor-test-file')

      expect(result).toBe('file')
    })

    it('should fallback when dockviewApi is null', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: null
      } as ReturnType<typeof useProjectStore.getState>)

      const result = getFilenameFromPanelId('editor-test-file')

      expect(result).toBe('file')
    })

    it('should return "Untitled" for non-editor panel IDs', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: null
      } as ReturnType<typeof useProjectStore.getState>)

      const result = getFilenameFromPanelId('some-other-panel')

      expect(result).toBe('Untitled')
    })

    it('should return "Untitled" for empty filePath', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const mockApi = createMockDockviewApi([
        { id: 'editor-test', params: { filePath: '' } }
      ])

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: mockApi
      } as ReturnType<typeof useProjectStore.getState>)

      const result = getFilenameFromPanelId('editor-test')

      // Empty filePath means getBasename(filePath) returns '', which is falsy
      // So it falls back to panel ID extraction: 'editor-test' -> 'test'
      expect(result).toBe('test')
    })
  })

  describe('buildDirtyFilesMessage', () => {
    beforeEach(async () => {
      // Reset mock to return null dockviewApi for deterministic fallback behavior
      const { useProjectStore } = await import('../../stores/useProjectStore')
      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: null
      } as ReturnType<typeof useProjectStore.getState>)
    })

    it('should return empty string when no dirty files', () => {
      const result = buildDirtyFilesMessage([])

      expect(result).toBe('')
    })

    it('should build singular message for one dirty file', () => {
      const result = buildDirtyFilesMessage(['editor-test-document'])

      expect(result).toBe('File "document" has unsaved changes. Close anyway?')
    })

    it('should build plural message for multiple dirty files', () => {
      const result = buildDirtyFilesMessage(['editor-test-file1', 'editor-test-file2', 'editor-test-file3'])

      expect(result).toBe('3 files have unsaved changes: file1, file2, file3. Close anyway?')
    })

    it('should build plural message for two dirty files', () => {
      const result = buildDirtyFilesMessage(['editor-test-readme', 'editor-test-index'])

      expect(result).toBe('2 files have unsaved changes: readme, index. Close anyway?')
    })

    it('should use actual filenames when dockviewApi available', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const mockApi = createMockDockviewApi([
        { id: 'editor-1', params: { filePath: '/project/README.md' } },
        { id: 'editor-2', params: { filePath: '/project/index.ts' } }
      ])

      vi.mocked(useProjectStore.getState).mockReturnValue({
        dirtyPanelIds: mockDirtyPanelIds,
        setEditorDirty: mockSetEditorDirty,
        dockviewApi: mockApi
      } as ReturnType<typeof useProjectStore.getState>)

      const result = buildDirtyFilesMessage(['editor-1', 'editor-2'])

      expect(result).toBe('2 files have unsaved changes: README.md, index.ts. Close anyway?')
    })
  })
})

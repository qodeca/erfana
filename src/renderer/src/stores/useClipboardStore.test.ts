// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createClipboardStore } from './useClipboardStore'
import type { IFileOperations } from '../interfaces/IFileOperations'

// Mock file operations
const mockMoveItem = vi.fn()
const mockCopyItem = vi.fn()

const mockFileOps: IFileOperations = {
  moveItem: mockMoveItem,
  copyItem: mockCopyItem
}

// Create store instance with mocked dependencies
const useClipboardStore = createClipboardStore(mockFileOps)

beforeEach(() => {
  // Reset store state before each test
  useClipboardStore.setState({
    itemPath: null,
    operation: null,
    itemName: null,
    itemType: null
  })

  // Reset mocks
  mockMoveItem.mockReset()
  mockCopyItem.mockReset()
})

describe('useClipboardStore (with dependency injection)', () => {
  describe('cut', () => {
    it('should set clipboard state for cut operation', () => {
      const { cut } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')

      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/file.md')
      expect(state.operation).toBe('cut')
      expect(state.itemName).toBe('file.md')
      expect(state.itemType).toBe('file')
    })

    it('should set clipboard state for directory cut', () => {
      const { cut } = useClipboardStore.getState()

      cut('/project/folder', 'folder', 'directory')

      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/folder')
      expect(state.operation).toBe('cut')
      expect(state.itemName).toBe('folder')
      expect(state.itemType).toBe('directory')
    })
  })

  describe('copy', () => {
    it('should set clipboard state for copy operation', () => {
      const { copy } = useClipboardStore.getState()

      copy('/project/file.md', 'file.md', 'file')

      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/file.md')
      expect(state.operation).toBe('copy')
      expect(state.itemName).toBe('file.md')
      expect(state.itemType).toBe('file')
    })

    it('should overwrite previous clipboard content', () => {
      const { cut, copy } = useClipboardStore.getState()

      cut('/project/file1.md', 'file1.md', 'file')
      copy('/project/file2.md', 'file2.md', 'file')

      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/file2.md')
      expect(state.operation).toBe('copy')
      expect(state.itemName).toBe('file2.md')
    })
  })

  describe('paste', () => {
    it('should call moveItem for cut operations and clear clipboard', async () => {
      mockMoveItem.mockResolvedValue({ path: '/project/target/file.md' })

      const { cut, paste } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      const result = await paste('/project/target')

      // Updated to expect all 4 parameters (last two undefined)
      expect(mockMoveItem).toHaveBeenCalledWith(
        '/project/file.md',
        '/project/target',
        undefined,
        undefined
      )
      expect(result).toEqual({
        success: true,
        newPath: '/project/target/file.md'
      })

      // Verify clipboard cleared after cut
      const state = useClipboardStore.getState()
      expect(state.itemPath).toBeNull()
      expect(state.operation).toBeNull()
    })

    it('should call copyItem for copy operations and keep clipboard', async () => {
      mockCopyItem.mockResolvedValue({ path: '/project/target/file.md' })

      const { copy, paste } = useClipboardStore.getState()

      copy('/project/file.md', 'file.md', 'file')
      const result = await paste('/project/target')

      expect(mockCopyItem).toHaveBeenCalledWith('/project/file.md', '/project/target')
      expect(result).toEqual({
        success: true,
        newPath: '/project/target/file.md'
      })

      // Verify clipboard NOT cleared after copy
      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/file.md')
      expect(state.operation).toBe('copy')
    })

    it('should allow multiple paste operations for copy', async () => {
      mockCopyItem.mockResolvedValue({ path: '/project/target1/file.md' })

      const { copy, paste } = useClipboardStore.getState()

      copy('/project/file.md', 'file.md', 'file')

      // First paste
      await paste('/project/target1')
      expect(mockCopyItem).toHaveBeenCalledTimes(1)

      // Second paste (clipboard still has content)
      mockCopyItem.mockResolvedValue({ path: '/project/target2/file.md' })
      await paste('/project/target2')
      expect(mockCopyItem).toHaveBeenCalledTimes(2)
    })

    it('should return error when clipboard is empty', async () => {
      const { paste } = useClipboardStore.getState()

      const result = await paste('/project/target')

      expect(result).toEqual({
        success: false,
        error: 'No item in clipboard'
      })
      expect(mockMoveItem).not.toHaveBeenCalled()
      expect(mockCopyItem).not.toHaveBeenCalled()
    })

    it('should handle move errors gracefully', async () => {
      mockMoveItem.mockRejectedValue(new Error('Move failed'))

      const { cut, paste } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      const result = await paste('/project/target')

      expect(result).toEqual({
        success: false,
        error: 'Move failed'
      })

      // Clipboard should still contain the item after failed move
      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/file.md')
      expect(state.operation).toBe('cut')
    })

    it('should handle copy errors gracefully', async () => {
      mockCopyItem.mockRejectedValue(new Error('Copy failed'))

      const { copy, paste } = useClipboardStore.getState()

      copy('/project/file.md', 'file.md', 'file')
      const result = await paste('/project/target')

      expect(result).toEqual({
        success: false,
        error: 'Copy failed'
      })

      // Clipboard should still contain the item after failed copy
      const state = useClipboardStore.getState()
      expect(state.itemPath).toBe('/project/file.md')
      expect(state.operation).toBe('copy')
    })
  })

  describe('clear', () => {
    it('should clear all clipboard state', () => {
      const { cut, clear } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      clear()

      const state = useClipboardStore.getState()
      expect(state.itemPath).toBeNull()
      expect(state.operation).toBeNull()
      expect(state.itemName).toBeNull()
      expect(state.itemType).toBeNull()
    })
  })

  describe('hasClipboard', () => {
    it('should return false when clipboard is empty', () => {
      const { hasClipboard } = useClipboardStore.getState()

      expect(hasClipboard()).toBe(false)
    })

    it('should return true when clipboard has content', () => {
      const { cut, hasClipboard } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')

      expect(hasClipboard()).toBe(true)
    })

    it('should return false after clipboard is cleared', () => {
      const { cut, clear, hasClipboard } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      clear()

      expect(hasClipboard()).toBe(false)
    })
  })

  describe('getOperation', () => {
    it('should return null when no operation is set', () => {
      const { getOperation } = useClipboardStore.getState()

      expect(getOperation()).toBeNull()
    })

    it('should return current operation type', () => {
      const { cut, getOperation } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')

      expect(getOperation()).toBe('cut')
    })

    it('should update when operation changes', () => {
      const { cut, copy, getOperation } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      expect(getOperation()).toBe('cut')

      copy('/project/other.md', 'other.md', 'file')
      expect(getOperation()).toBe('copy')
    })
  })

  describe('paste with replaceExisting parameter', () => {
    it('should pass replaceExisting=true to moveItem for cut operations', async () => {
      mockMoveItem.mockResolvedValue({ path: '/project/target/file.md' })

      const { cut, paste } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      await paste('/project/target', true)

      // Verify moveItem called with 4 parameters including replaceExisting=true
      expect(mockMoveItem).toHaveBeenCalledWith(
        '/project/file.md',
        '/project/target',
        undefined,
        true
      )
    })

    it('should pass replaceExisting=false to moveItem for cut operations', async () => {
      mockMoveItem.mockResolvedValue({ path: '/project/target/file.md' })

      const { cut, paste } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      await paste('/project/target', false)

      // Verify moveItem called with replaceExisting=false
      expect(mockMoveItem).toHaveBeenCalledWith(
        '/project/file.md',
        '/project/target',
        undefined,
        false
      )
    })

    it('should pass replaceExisting=undefined when not provided', async () => {
      mockMoveItem.mockResolvedValue({ path: '/project/target/file.md' })

      const { cut, paste } = useClipboardStore.getState()

      cut('/project/file.md', 'file.md', 'file')
      await paste('/project/target')

      // Verify moveItem called with undefined for replaceExisting (default behavior)
      expect(mockMoveItem).toHaveBeenCalledWith(
        '/project/file.md',
        '/project/target',
        undefined,
        undefined
      )
    })

    it('should not pass replaceExisting to copyItem (copy operations)', async () => {
      mockCopyItem.mockResolvedValue({ path: '/project/target/file.md' })

      const { copy, paste } = useClipboardStore.getState()

      copy('/project/file.md', 'file.md', 'file')
      await paste('/project/target', true)

      // Copy operations don't use replaceExisting (auto-rename behavior)
      expect(mockCopyItem).toHaveBeenCalledWith('/project/file.md', '/project/target')
      expect(mockCopyItem).toHaveBeenCalledTimes(1)
      // Verify it was called with exactly 2 arguments (no replaceExisting)
      expect(mockCopyItem.mock.calls[0]).toHaveLength(2)
    })
  })
})

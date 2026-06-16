// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClipboardStore } from '../../stores/useClipboardStore'
import type { IFileOperations } from '../../interfaces/IFileOperations'

declare global {
  interface Window {
    api: any
  }
}

/**
 * Integration tests for clipboard store paste operations with replaceExisting parameter
 *
 * These tests verify the store-level logic for paste operations, focusing on:
 * 1. Parameter passing through the call chain (paste → moveItem/copyItem)
 * 2. replaceExisting flag handling (undefined, true, false)
 * 3. Clipboard state preservation (cleared after cut, preserved after copy)
 * 4. Error handling and recovery
 * 5. Symlink result indicator preservation
 *
 * Note: These are integration tests at the store layer, not full component UI tests.
 * Component-level interactions (conflict detection via window.api.file.checkConflict,
 * dialog confirmations via showConfirm) are tested separately in component UI tests.
 *
 * Coverage includes:
 * - Cut/Copy/Paste operations with different replaceExisting values
 * - State management (clipboard cleared after cut, preserved after copy)
 * - Error scenarios and state preservation on failure
 */
describe('ProjectTree paste operations (integration tests)', () => {
  let mockFileOps: IFileOperations
  let mockShowConfirm: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Create mock file operations
    mockFileOps = {
      moveItem: vi.fn(async () => ({ path: '/project/target/file.md' })),
      copyItem: vi.fn(async () => ({ path: '/project/target/file.md' }))
    }

    // Mock showConfirm dialog
    mockShowConfirm = vi.fn(async () => true) // Default: user confirms

    // Setup window.api mock
    ;(window as any).api = {
      file: {
        getLastProjectPath: vi.fn(async () => '/project'),
        readDirectory: vi.fn(async () => [
          {
            name: 'source.md',
            path: '/project/source.md',
            type: 'file',
            extension: '.md'
          },
          {
            name: 'target',
            path: '/project/target',
            type: 'directory',
            children: []
          }
        ]),
        checkConflict: vi.fn(async () => false), // Default: no conflict
        moveItem: mockFileOps.moveItem,
        copyItem: mockFileOps.copyItem,
        onProjectChanged: vi.fn(() => () => {})
      },
      directoryWatch: {
        start: vi.fn(async () => ({ success: true })),
        stop: vi.fn(async () => ({ success: true })),
        pause: vi.fn(async () => ({ success: true })),
        resume: vi.fn(async () => ({ success: true })),
        onDirectoryChanged: vi.fn(() => () => {}),
        onProjectDeleted: vi.fn(() => () => {}),
        onDirectoryError: vi.fn(() => () => {})
      }
    }

    // Mock dialog hook in component
    // Note: This requires the component to use DialogContext
    vi.mock('../Dialog', async () => {
      const actual = await vi.importActual('../Dialog')
      return {
        ...actual,
        useDialog: () => ({
          showConfirm: mockShowConfirm,
          showRename: vi.fn(),
          showNewFile: vi.fn(),
          showNewFolder: vi.fn()
        })
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    ;(window as any).api = undefined
  })

  describe('Paste without conflict', () => {
    it('should paste item when replaceExisting is undefined', async () => {
      // Setup: Cut operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source.md', 'source.md', 'file')

      // Simulate paste call (component would check conflict first, then call paste)
      const result = await clipboard.getState().paste('/project/target')

      // Verify: moveItem was called without replaceExisting
      expect(mockFileOps.moveItem).toHaveBeenCalledWith(
        '/project/source.md',
        '/project/target',
        undefined,
        undefined
      )

      // Verify: Success
      expect(result.success).toBe(true)
      expect(result.newPath).toBe('/project/target/file.md')
    })

    it('should paste copy operation (auto-rename, no replaceExisting)', async () => {
      // Setup: Copy operation (not cut)
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().copy('/project/source.md', 'source.md', 'file')

      // Simulate paste
      const result = await clipboard.getState().paste('/project/target')

      // Verify: copyItem was called (no replaceExisting parameter)
      expect(mockFileOps.copyItem).toHaveBeenCalledWith('/project/source.md', '/project/target')

      // Verify: Success
      expect(result.success).toBe(true)
    })
  })

  describe('Paste with conflict - replaceExisting=true', () => {
    it('should pass replaceExisting=true to moveItem when requested', async () => {
      // Setup: Cut operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source.md', 'source.md', 'file')

      // Component would detect conflict and ask user, then call paste with replaceExisting=true
      // This test verifies the store correctly passes the flag through

      // Execute paste with replaceExisting=true
      const result = await clipboard.getState().paste('/project/target', true)

      // Verify: moveItem called with replaceExisting=true
      expect(mockFileOps.moveItem).toHaveBeenCalledWith(
        '/project/source.md',
        '/project/target',
        undefined,
        true
      )

      // Verify: Success
      expect(result.success).toBe(true)
    })

    it('should pass replaceExisting=true for directory moves', async () => {
      // Setup: Cut directory
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source', 'source', 'directory')

      // Execute paste with replace
      const result = await clipboard.getState().paste('/project/target', true)

      // Verify: moveItem called with replaceExisting=true
      expect(mockFileOps.moveItem).toHaveBeenCalledWith(
        '/project/source',
        '/project/target',
        undefined,
        true
      )

      expect(result.success).toBe(true)
    })
  })

  describe('Clipboard state preservation', () => {
    it('should preserve clipboard state when paste is not called', async () => {
      // Setup: Cut operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source.md', 'source.md', 'file')

      // Component would detect conflict, show dialog, and user cancels
      // In this case, paste() is never called - the component returns early
      // This test verifies the clipboard state is preserved

      // Verify: Clipboard still contains the item (available for retry)
      expect(clipboard.getState().itemPath).toBe('/project/source.md')
      expect(clipboard.getState().operation).toBe('cut')
      expect(clipboard.getState().itemName).toBe('source.md')
      expect(clipboard.getState().itemType).toBe('file')

      // Verify: moveItem was NOT called (component didn't proceed with paste)
      expect(mockFileOps.moveItem).not.toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('should pass replaceExisting=false when explicitly set', async () => {
      // Setup: Cut operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source.md', 'source.md', 'file')

      // Component might call paste with replaceExisting=false after error in conflict check
      // This test verifies the store correctly handles the explicit false value
      const result = await clipboard.getState().paste('/project/target', false)

      // Verify: moveItem called with replaceExisting=false
      expect(mockFileOps.moveItem).toHaveBeenCalledWith(
        '/project/source.md',
        '/project/target',
        undefined,
        false
      )

      expect(result.success).toBe(true)
    })

    it('should handle move errors during paste', async () => {
      // Setup: Cut operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source.md', 'source.md', 'file')

      // Mock moveItem failure
      mockFileOps.moveItem = vi.fn(async () => {
        throw new Error('Target path does not exist')
      })

      // Execute paste
      const result = await clipboard.getState().paste('/project/target')

      // Verify: Error returned
      expect(result.success).toBe(false)
      expect(result.error).toBe('Target path does not exist')

      // Verify: Clipboard preserved (can retry)
      expect(clipboard.getState().itemPath).toBe('/project/source.md')
      expect(clipboard.getState().operation).toBe('cut')
    })
  })

  describe('Symlink handling', () => {
    it('should preserve isSymlink indicator in result', async () => {
      // Setup: Cut symlink
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/symlink.md', 'symlink.md', 'file')

      // Mock moveItem returns isSymlink=true
      mockFileOps.moveItem = vi.fn(async () => ({ path: '/project/target/symlink.md', isSymlink: true }))

      // Execute paste
      const result = await clipboard.getState().paste('/project/target')

      // Verify: isSymlink flag preserved
      expect(result.success).toBe(true)
      expect(result.isSymlink).toBe(true)

      // Component should show warning toast for symlinks
      // (tested separately in component UI tests)
    })
  })

  describe('Store state after operations', () => {
    it('should clear clipboard after successful cut operation', async () => {
      // Setup: Cut operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().cut('/project/source.md', 'source.md', 'file')

      // Verify clipboard has content before paste
      expect(clipboard.getState().hasClipboard()).toBe(true)

      // Execute paste
      await clipboard.getState().paste('/project/target')

      // Verify: Clipboard cleared after cut operation
      expect(clipboard.getState().hasClipboard()).toBe(false)
      expect(clipboard.getState().itemPath).toBeNull()
      expect(clipboard.getState().operation).toBeNull()
    })

    it('should preserve clipboard after successful copy operation', async () => {
      // Setup: Copy operation
      const clipboard = createClipboardStore(mockFileOps)
      clipboard.getState().copy('/project/source.md', 'source.md', 'file')

      // Execute paste
      await clipboard.getState().paste('/project/target')

      // Verify: Clipboard NOT cleared after copy operation (can paste multiple times)
      expect(clipboard.getState().hasClipboard()).toBe(true)
      expect(clipboard.getState().itemPath).toBe('/project/source.md')
      expect(clipboard.getState().operation).toBe('copy')
    })
  })
})

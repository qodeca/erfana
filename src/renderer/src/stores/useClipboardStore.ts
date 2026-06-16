// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { IFileOperations } from '../interfaces/IFileOperations'
import { logger } from '../utils/logger'

type ClipboardOperation = 'cut' | 'copy'

interface ClipboardStore {
  // State
  itemPath: string | null
  operation: ClipboardOperation | null
  itemName: string | null
  itemType: 'file' | 'directory' | null

  // Actions
  cut: (path: string, name: string, type: 'file' | 'directory') => void
  copy: (path: string, name: string, type: 'file' | 'directory') => void
  paste: (targetPath: string, replaceExisting?: boolean) => Promise<{ success: boolean; newPath?: string; isSymlink?: boolean; error?: string }>
  clear: () => void
  hasClipboard: () => boolean
  getOperation: () => ClipboardOperation | null
}

/**
 * Factory function to create clipboard store with injected file operations
 * Enables dependency injection and testing
 */
export function createClipboardStore(
  fileOps: IFileOperations
): UseBoundStore<StoreApi<ClipboardStore>> {
  return create<ClipboardStore>((set, get) => ({
  // Initial state
  itemPath: null,
  operation: null,
  itemName: null,
  itemType: null,

  // Cut operation - stores path and marks as 'cut' for visual dimming
  cut: (path: string, name: string, type: 'file' | 'directory') => {
    logger.info('Clipboard: Cut', { path, name, type })
    set({
      itemPath: path,
      operation: 'cut',
      itemName: name,
      itemType: type
    })
  },

  // Copy operation - stores path without visual changes
  copy: (path: string, name: string, type: 'file' | 'directory') => {
    logger.info('Clipboard: Copy', { path, name, type })
    set({
      itemPath: path,
      operation: 'copy',
      itemName: name,
      itemType: type
    })
  },

  // Paste operation - executes move or copy via IPC
  paste: async (targetPath: string, replaceExisting?: boolean) => {
    const state = get()

    if (!state.itemPath || !state.operation) {
      return {
        success: false,
        error: 'No item in clipboard'
      }
    }

    logger.info('Clipboard: Paste', {
      operation: state.operation,
      from: state.itemPath,
      to: targetPath,
      replaceExisting
    })

    try {
      let result: { path: string; isSymlink?: boolean }

      if (state.operation === 'cut') {
        // Move item using injected file operations
        result = await fileOps.moveItem(state.itemPath, targetPath, undefined, replaceExisting)
        logger.info('Clipboard: Move completed', { path: result.path })

        // Clear clipboard after successful cut
        set({
          itemPath: null,
          operation: null,
          itemName: null,
          itemType: null
        })
      } else {
        // Copy item using injected file operations
        result = await fileOps.copyItem(state.itemPath, targetPath)
        logger.info('Clipboard: Copy completed', { path: result.path })

        // Keep clipboard for multiple paste operations (standard behavior)
      }

      return { success: true, newPath: result.path, isSymlink: result.isSymlink }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Clipboard: Paste failed', error instanceof Error ? error : undefined)

      return {
        success: false,
        error: message
      }
    }
  },

  // Clear clipboard
  clear: () => {
    logger.info('Clipboard: Clear')
    set({
      itemPath: null,
      operation: null,
      itemName: null,
      itemType: null
    })
  },

  // Check if clipboard has content
  hasClipboard: () => {
    const state = get()
    return state.itemPath !== null && state.operation !== null
  },

  // Get current operation type
  getOperation: () => {
    return get().operation
  }
  }))
}

// Default instance using window.api for backward compatibility
// TODO: Remove after all consumers use dependency injection
// Lazy initialization to avoid accessing window.api at module load time
let _defaultStore: ReturnType<typeof createClipboardStore> | null = null

function getDefaultStore() {
  if (!_defaultStore) {
    _defaultStore = createClipboardStore(window.api.file)
  }
  return _defaultStore
}

// Export as a proxy to enable lazy initialization
// The Proxy needs to support both function calls (for hook usage) and property access
export const useClipboardStore = new Proxy(
  function(...args: Parameters<ReturnType<typeof createClipboardStore>>) {
    // When called as a hook, forward to the real store
    return getDefaultStore()(...args)
  } as ReturnType<typeof createClipboardStore>,
  {
    get(_target, prop) {
      // When accessing properties, get from the real store
      return getDefaultStore()[prop as keyof ReturnType<typeof createClipboardStore>]
    }
  }
)

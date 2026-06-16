// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react'
import { subscribeGlobalDialogs } from './dialogService'
import type {
  Dialog,
  DialogContextType,
  ConfirmDialogConfig,
  PromptDialogConfig,
  AlertDialogConfig,
  CustomDialogConfig,
  RenameDialogConfig,
  NewFileDialogConfig,
  NewFolderDialogConfig,
  DropModeDialogConfig,
  DropModeDialogResult,
  ConflictDialogConfig,
  ConflictDialogResult
} from './types'

const DialogContext = createContext<DialogContextType | undefined>(undefined)

// Base z-index for dialogs (similar to Toast system)
const BASE_ZINDEX = 10000

// Hook to use dialog system
export function useDialog() {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error('useDialog must be used within DialogProvider')
  }
  return context
}

// Provider component
export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialogs, setDialogs] = useState<Dialog[]>([])

  // Use ref-based counter to prevent race conditions when multiple dialogs open rapidly
  // This ensures each dialog gets a unique z-index even if opened in the same render cycle
  const zIndexCounter = useRef(0)

  // Generate unique ID for dialogs
  const generateId = useCallback(() => {
    return `dialog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }, [])

  // Calculate z-index using incrementing counter (prevents race conditions)
  const getNextZIndex = useCallback(() => {
    zIndexCounter.current += 1
    return BASE_ZINDEX + zIndexCounter.current
  }, [])

  // Show confirm dialog
  const showConfirm = useCallback(
    (config: Omit<ConfirmDialogConfig, 'id'>): Promise<boolean> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'confirm',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(false)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show prompt dialog (replaces UserInputDialog)
  const showPrompt = useCallback(
    (config: Omit<PromptDialogConfig, 'id'>): Promise<string | null> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'prompt',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(null)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show alert dialog
  const showAlert = useCallback(
    (config: Omit<AlertDialogConfig, 'id'>): Promise<void> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'alert',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: resolve as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show custom dialog
  const showCustom = useCallback(
    (config: Omit<CustomDialogConfig, 'id'>): Promise<void> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'custom',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: resolve as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show rename dialog (replaces prompt for file/folder renaming)
  const showRename = useCallback(
    (config: Omit<RenameDialogConfig, 'id'>): Promise<string | null> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'rename',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(null)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show new file dialog
  const showNewFile = useCallback(
    (config: Omit<NewFileDialogConfig, 'id'>): Promise<string | null> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'newFile',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(null)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show new folder dialog
  const showNewFolder = useCallback(
    (config: Omit<NewFolderDialogConfig, 'id'>): Promise<string | null> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'newFolder',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(null)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show drop mode dialog (for external file drop)
  const showDropMode = useCallback(
    (config: Omit<DropModeDialogConfig, 'id'>): Promise<DropModeDialogResult | null> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'dropMode',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(null)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Show conflict resolution dialog
  const showConflict = useCallback(
    (config: Omit<ConflictDialogConfig, 'id'>): Promise<ConflictDialogResult | null> => {
      return new Promise((resolve) => {
        const id = generateId()
        const zIndex = getNextZIndex()

        const dialog: Dialog = {
          id,
          type: 'conflict',
          config: { ...config, id },
          zIndex,
          resolve: resolve as (value: unknown) => void,
          reject: (() => resolve(null)) as (reason?: unknown) => void
        }

        setDialogs((prev) => [...prev, dialog])
      })
    },
    [generateId, getNextZIndex]
  )

  // Close specific dialog
  const closeDialog = useCallback((id: string) => {
    setDialogs((prev) => {
      const dialog = prev.find((d) => d.id === id)
      if (dialog) {
        // Reject the promise when dialog is closed without user action
        dialog.reject()
      }
      return prev.filter((d) => d.id !== id)
    })
  }, [])

  // Close all dialogs
  const closeAll = useCallback(() => {
    setDialogs((prev) => {
      // Reject all pending promises
      prev.forEach((dialog) => dialog.reject())
      return []
    })
  }, [])

  // Subscribe to global dialog events (similar to Toast)
  // Allows non-React code to trigger dialogs
  useEffect(() => {
    const unsubscribe = subscribeGlobalDialogs((payload) => {
      switch (payload.type) {
        case 'confirm':
          showConfirm(payload.config as ConfirmDialogConfig)
          break
        case 'prompt':
          showPrompt(payload.config as PromptDialogConfig)
          break
        case 'alert':
          showAlert(payload.config as AlertDialogConfig)
          break
        case 'custom':
          showCustom(payload.config as CustomDialogConfig)
          break
      }
    })
    return () => unsubscribe()
  }, [showConfirm, showPrompt, showAlert, showCustom])

  return (
    <DialogContext.Provider
      value={{
        dialogs,
        showConfirm,
        showPrompt,
        showAlert,
        showCustom,
        showRename,
        showNewFile,
        showNewFolder,
        showDropMode,
        showConflict,
        closeDialog,
        closeAll
      }}
    >
      {children}
    </DialogContext.Provider>
  )
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Unified Dialog Framework - Main exports

export { DialogProvider, useDialog } from './DialogContext'
export { DialogManager } from './DialogManager'
export { BaseDialog } from './BaseDialog'
export { ConfirmDialog } from './ConfirmDialog'
export { PromptDialog } from './PromptDialog'
export { AlertDialog } from './AlertDialog'
export { RenameDialog } from './RenameDialog'
export { NewFileDialog } from './NewFileDialog'
export { NewFolderDialog } from './NewFolderDialog'
export { DropModeDialog } from './DropModeDialog'
export { ConflictDialog } from './ConflictDialog'
export { ScreenSelectDialog } from './ScreenSelectDialog'
export { WindowPickerDialog } from './WindowPickerDialog'
export { CameraDialog } from './CameraDialog'
export { showGlobalDialog, subscribeGlobalDialogs } from './dialogService'
export type { PromptDialogResult } from './PromptDialog'

// Re-export validation utilities for convenience
export { ValidationErrorCode } from '../../utils/fileValidation'
export type { ValidationResult } from '../../utils/fileValidation'

export type {
  DialogType,
  BaseDialogConfig,
  ConfirmDialogConfig,
  PromptDialogConfig,
  AlertDialogConfig,
  CustomDialogConfig,
  RenameDialogConfig,
  NewFileDialogConfig,
  NewFolderDialogConfig,
  DropMode,
  DropModeDialogConfig,
  DropModeDialogResult,
  ConflictDialogConfig,
  ConflictDialogResult,
  DialogConfig,
  Dialog,
  DialogContextType,
  DropdownOption
} from './types'

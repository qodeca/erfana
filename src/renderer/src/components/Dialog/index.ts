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
export { ScreenSelectDialog } from './ScreenSelectDialog'
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
  DialogConfig,
  Dialog,
  DialogContextType,
  DropdownOption
} from './types'

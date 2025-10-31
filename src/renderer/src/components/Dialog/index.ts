// Unified Dialog Framework - Main exports

export { DialogProvider, useDialog } from './DialogContext'
export { DialogManager } from './DialogManager'
export { BaseDialog } from './BaseDialog'
export { ConfirmDialog } from './ConfirmDialog'
export { PromptDialog } from './PromptDialog'
export { AlertDialog } from './AlertDialog'
export { showGlobalDialog, subscribeGlobalDialogs } from './dialogService'

export type {
  DialogType,
  BaseDialogConfig,
  ConfirmDialogConfig,
  PromptDialogConfig,
  AlertDialogConfig,
  CustomDialogConfig,
  DialogConfig,
  Dialog,
  DialogContextType,
  ValidationResult
} from './types'

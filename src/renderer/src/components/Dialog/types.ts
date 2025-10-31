/**
 * Type definitions for unified dialog framework
 *
 * This module provides type-safe definitions for all dialog types in the application.
 * All dialogs use a Promise-based API accessible via the useDialog() hook.
 */

/** Dialog type discriminator */
export type DialogType = 'confirm' | 'prompt' | 'alert' | 'custom' | 'rename' | 'newFile' | 'newFolder'

/**
 * Base configuration shared by all dialog types
 */
export interface BaseDialogConfig {
  /** Unique identifier (auto-generated if not provided) */
  id?: string
  /** Dialog title displayed in header */
  title: string
  /** Main message/content text */
  message: string
  /** Apply danger/destructive styling (red buttons) */
  danger?: boolean
}

/**
 * Confirm dialog configuration
 * Used for yes/no decisions and destructive actions
 */
export interface ConfirmDialogConfig extends BaseDialogConfig {
  /** Label for confirm button (default: "Confirm") */
  confirmLabel?: string
  /** Label for cancel button (default: "Cancel") */
  cancelLabel?: string
  /** Optional callback when confirmed (deprecated: use Promise return value instead) */
  onConfirm?: () => void | Promise<void>
  /** Optional callback when cancelled (deprecated: use Promise return value instead) */
  onCancel?: () => void
}

/**
 * Prompt dialog configuration (replaces UserInputDialog)
 * Used for collecting text input from users
 */
export interface PromptDialogConfig extends BaseDialogConfig {
  /** Selected text to display in preview section */
  selectedText?: string
  /** Label for input field (default: "Your input:") */
  inputLabel?: string
  /** Placeholder text for input */
  inputPlaceholder?: string
  /** Pre-filled default value */
  defaultValue?: string
  /** Maximum character length (default: 2000) */
  maxLength?: number
  /** Minimum character length (default: 3) */
  minLength?: number
  /** Custom validation function. Return true or error message string. */
  validation?: (value: string) => boolean | string
  /** Optional callback when submitted (deprecated: use Promise return value instead) */
  onSubmit?: (value: string) => void | Promise<void>
  /** Optional callback when cancelled (deprecated: use Promise return value instead) */
  onCancel?: () => void
}

/**
 * Alert dialog configuration
 * Used for simple notifications with single OK button
 */
export interface AlertDialogConfig extends BaseDialogConfig {
  /** Label for OK button (default: "OK") */
  confirmLabel?: string
  /** Optional callback when closed (deprecated: use Promise return value instead) */
  onConfirm?: () => void | Promise<void>
}

/**
 * Rename dialog configuration
 * Used for renaming files and folders with context and validation
 */
export interface RenameDialogConfig extends BaseDialogConfig {
  /** Current item name (file or folder) */
  currentName: string
  /** Full path to the item being renamed */
  itemPath: string
  /** Type of item (file or directory) */
  itemType: 'file' | 'directory'
  /** Parent directory path for context */
  parentPath: string
  /** Existing sibling names to check for duplicates */
  existingNames?: string[]
}

/**
 * New File dialog configuration
 * Used for creating new files with path context and validation
 */
export interface NewFileDialogConfig extends BaseDialogConfig {
  /** Parent directory path where file will be created */
  parentPath: string
  /** Placeholder for file name input */
  inputPlaceholder?: string
  /** Existing sibling names to check for duplicates */
  existingNames?: string[]
}

/**
 * New Folder dialog configuration
 * Used for creating new folders with path context and validation
 */
export interface NewFolderDialogConfig extends BaseDialogConfig {
  /** Parent directory path where folder will be created */
  parentPath: string
  /** Placeholder for folder name input */
  inputPlaceholder?: string
  /** Existing sibling names to check for duplicates */
  existingNames?: string[]
}

// Custom dialog configuration for advanced use cases
// WARNING: CustomDialog accepts arbitrary React content. Be cautious when rendering user-generated content.
// React sanitizes JSX by default, but if you use dangerouslySetInnerHTML or render raw HTML elsewhere,
// ensure proper sanitization to prevent XSS attacks.
export interface CustomDialogConfig extends BaseDialogConfig {
  content: React.ReactNode
  actions?: React.ReactNode
  onClose?: () => void
}

// Union type for all dialog configurations
export type DialogConfig =
  | ConfirmDialogConfig
  | PromptDialogConfig
  | AlertDialogConfig
  | CustomDialogConfig
  | RenameDialogConfig
  | NewFileDialogConfig
  | NewFolderDialogConfig

// Internal dialog state (used by DialogContext)
// Uses unknown for resolve/reject to support all dialog types (contravariance)
export interface Dialog {
  id: string
  type: DialogType
  config: DialogConfig
  zIndex: number
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

// Validation result type
export type ValidationResult = boolean | string

// Dialog context type
export interface DialogContextType {
  dialogs: Dialog[]
  showConfirm: (config: Omit<ConfirmDialogConfig, 'id'>) => Promise<boolean>
  showPrompt: (config: Omit<PromptDialogConfig, 'id'>) => Promise<string | null>
  showAlert: (config: Omit<AlertDialogConfig, 'id'>) => Promise<void>
  showCustom: (config: Omit<CustomDialogConfig, 'id'>) => Promise<void>
  showRename: (config: Omit<RenameDialogConfig, 'id'>) => Promise<string | null>
  showNewFile: (config: Omit<NewFileDialogConfig, 'id'>) => Promise<string | null>
  showNewFolder: (config: Omit<NewFolderDialogConfig, 'id'>) => Promise<string | null>
  closeDialog: (id: string) => void
  closeAll: () => void
}

/**
 * Type definitions for unified dialog framework
 *
 * This module provides type-safe definitions for all dialog types in the application.
 * All dialogs use a Promise-based API accessible via the useDialog() hook.
 */

/** Dialog type discriminator */
export type DialogType = 'confirm' | 'prompt' | 'alert' | 'custom'

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

// Internal dialog state (used by DialogContext)
export interface Dialog {
  id: string
  type: DialogType
  config: DialogConfig
  zIndex: number
  resolve: (value: boolean | string | null | void) => void
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
  closeDialog: (id: string) => void
  closeAll: () => void
}

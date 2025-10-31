import { useDialog } from './DialogContext'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { AlertDialog } from './AlertDialog'
import { RenameDialog } from './RenameDialog'
import { NewFileDialog } from './NewFileDialog'
import { NewFolderDialog } from './NewFolderDialog'
import type {
  DialogType,
  ConfirmDialogConfig,
  PromptDialogConfig,
  AlertDialogConfig,
  RenameDialogConfig,
  NewFileDialogConfig,
  NewFolderDialogConfig
} from './types'

/**
 * Union type for all dialog configurations
 * Provides type safety across the dialog system
 */
type DialogConfigUnion =
  | ConfirmDialogConfig
  | PromptDialogConfig
  | AlertDialogConfig
  | RenameDialogConfig
  | NewFileDialogConfig
  | NewFolderDialogConfig

/**
 * Component registry for dialog types
 *
 * Maps dialog types to their corresponding components.
 * This follows the Open/Closed Principle - easier to extend without modifying existing code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DIALOG_COMPONENTS: Record<DialogType, React.ComponentType<any> | null> = {
  confirm: ConfirmDialog,
  prompt: PromptDialog,
  alert: AlertDialog,
  rename: RenameDialog,
  newFile: NewFileDialog,
  newFolder: NewFolderDialog,
  custom: null // Custom dialogs handled separately
}

/**
 * DialogManager - Renders all active dialogs
 *
 * This component should be placed once at the app root level.
 * It subscribes to the DialogContext and renders all active dialogs
 * with proper z-index stacking.
 *
 * Uses a component registry pattern for better extensibility and adherence
 * to the Open/Closed Principle.
 *
 * @example
 * ```typescript
 * <DialogProvider>
 *   <DialogManager />
 *   <App />
 * </DialogProvider>
 * ```
 */
export function DialogManager() {
  const { dialogs, closeDialog } = useDialog()

  if (dialogs.length === 0) return null

  return (
    <>
      {dialogs.map((dialog) => {
        const handleConfirm = () => {
          dialog.resolve(true)
          closeDialog(dialog.id)
        }

        const handleCancel = () => {
          dialog.resolve(false)
          closeDialog(dialog.id)
        }

        const handleSubmit = (value: string) => {
          dialog.resolve(value)
          closeDialog(dialog.id)
        }

        // Get component from registry
        const DialogComponent = DIALOG_COMPONENTS[dialog.type]

        if (!DialogComponent) {
          console.warn(`No component registered for dialog type: ${dialog.type}`)
          return null
        }

        // Determine which handlers to pass based on dialog type
        const isConfirmType = dialog.type === 'confirm'
        const isAlertType = dialog.type === 'alert'
        const isSubmitType = dialog.type === 'prompt' || dialog.type === 'rename' ||
                             dialog.type === 'newFile' || dialog.type === 'newFolder'

        return (
          <DialogComponent
            key={dialog.id}
            config={dialog.config as DialogConfigUnion}
            zIndex={dialog.zIndex}
            onConfirm={isConfirmType || isAlertType ? handleConfirm : undefined}
            onCancel={!isAlertType ? handleCancel : undefined}
            onSubmit={isSubmitType ? handleSubmit : undefined}
          />
        )
      })}
    </>
  )
}

import { useDialog } from './DialogContext'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { AlertDialog } from './AlertDialog'
import type {
  ConfirmDialogConfig,
  PromptDialogConfig,
  AlertDialogConfig
} from './types'

/**
 * DialogManager - Renders all active dialogs
 *
 * This component should be placed once at the app root level.
 * It subscribes to the DialogContext and renders all active dialogs
 * with proper z-index stacking.
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

        switch (dialog.type) {
          case 'confirm':
            return (
              <ConfirmDialog
                key={dialog.id}
                config={dialog.config as ConfirmDialogConfig}
                zIndex={dialog.zIndex}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
              />
            )

          case 'prompt':
            return (
              <PromptDialog
                key={dialog.id}
                config={dialog.config as PromptDialogConfig}
                zIndex={dialog.zIndex}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
              />
            )

          case 'alert':
            return (
              <AlertDialog
                key={dialog.id}
                config={dialog.config as AlertDialogConfig}
                zIndex={dialog.zIndex}
                onConfirm={handleConfirm}
              />
            )

          default:
            return null
        }
      })}
    </>
  )
}

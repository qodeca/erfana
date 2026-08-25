// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ScreenPermissionDialog
 *
 * Shown when a macOS screenshot is denied for lack of Screen Recording
 * permission. Replaces the previous dead-end error toast with an actionable
 * flow: open the Screen Recording settings pane, then relaunch Erfana (macOS
 * applies a fresh grant only to a newly-launched process).
 *
 * Advisory only — this dialog never blocks a capture; it appears after the OS
 * itself has denied one. `status` enriches the copy but does not gate anything.
 */
import { useId } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ScreenRecordingPermission } from '../../../../shared/ipc/screenshot-schema'
import { BaseDialog } from './BaseDialog'
import { TEST_IDS } from '../../constants/testids'

interface ScreenPermissionDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean
  /** Called on Close, Escape, or backdrop click */
  onClose: () => void
  /** Advisory macOS permission status (used only to tailor the copy) */
  status: ScreenRecordingPermission
  /** Z-index for portal layering */
  zIndex: number
}

export function ScreenPermissionDialog({
  isOpen,
  onClose,
  status,
  zIndex
}: ScreenPermissionDialogProps) {
  const titleId = `screen-permission-title-${useId()}`
  const bodyId = `screen-permission-body-${useId()}`

  const handleOpenSettings = (): void => {
    void window.api.system.openScreenRecordingSettings()
  }

  const handleRelaunch = (): void => {
    void window.api.system.relaunchApp()
  }

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={onClose}
      zIndex={zIndex}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={bodyId}
    >
      <div data-testid={TEST_IDS.SCREEN_PERMISSION_DIALOG}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <ShieldAlert size={20} strokeWidth={2} />
          </div>
          <h3 id={titleId} className="dialog-title">
            Screen Recording permission needed
          </h3>
        </div>

        <div className="dialog-body">
          <p id={bodyId} className="dialog-message">
            {status === 'denied'
              ? 'Erfana is currently blocked from recording the screen. '
              : ''}
            To take screenshots, enable Screen Recording for Erfana in System
            Settings, then relaunch Erfana for the change to take effect.
          </p>
        </div>

        <div className="dialog-actions">
          <button
            className="dialog-btn dialog-btn-secondary"
            onClick={onClose}
            data-testid={TEST_IDS.SCREEN_PERMISSION_BTN_CLOSE}
          >
            Close
          </button>
          <button
            className="dialog-btn dialog-btn-secondary"
            onClick={handleRelaunch}
            data-testid={TEST_IDS.SCREEN_PERMISSION_BTN_RELAUNCH}
          >
            Relaunch Erfana
          </button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={handleOpenSettings}
            data-testid={TEST_IDS.SCREEN_PERMISSION_BTN_OPEN_SETTINGS}
          >
            Open Screen Recording settings
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}

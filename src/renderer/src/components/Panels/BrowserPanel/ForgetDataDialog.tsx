// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * **Forget this project's browser data** (spec 025, 025-FR-023; deck *Clear
 * browsing data and Forget* row *Forget*; `menus-and-data.html`): the
 * confirmation, with focus on Cancel (the choice that loses nothing), and a
 * busy **Forgetting…** while main closes the project's tabs and deletes
 * `.erfana/browser/` – the dialog stays until main answers, then the outcome
 * is a toast. Built on the shared BaseDialog, so the native page hides
 * behind it (the native-view guard).
 */
import { useId, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { BaseDialog } from '../../Dialog/BaseDialog'
import { FORGET_CONFIRM, forgetNow } from './browserDataActions'

/** Props for {@link ForgetDataDialog}. */
export interface ForgetDataDialogProps {
  readonly onClose: () => void
  /** Runs the forget; resolves when main answered (tests inject it). */
  readonly forget?: () => Promise<void>
}

/**
 * The dialog.
 *
 * @param props - {@link ForgetDataDialogProps}
 * @returns The dialog
 */
export function ForgetDataDialog({ onClose, forget = forgetNow }: ForgetDataDialogProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const base = `erf-forget-${useId().replace(/[^\w-]/g, '')}`
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = (): void => {
    if (busy) return
    setBusy(true)
    void forget().finally(onClose)
  }

  return (
    <BaseDialog
      isOpen={true}
      onClose={() => {
        if (!busy) onClose()
      }}
      zIndex={10000}
      closeOnBackdrop={false}
      ariaLabelledBy={`${base}-title`}
      ariaDescribedBy={`${base}-message`}
      initialFocusRef={cancelRef}
    >
      <div className="dialog-header-with-icon">
        <div className="dialog-icon">
          <AlertTriangle size={20} strokeWidth={2} />
        </div>
        <h3 id={`${base}-title`} className="dialog-title">
          {FORGET_CONFIRM.title}
        </h3>
      </div>
      <div className="dialog-body">
        <p id={`${base}-message`} className="dialog-message">
          {FORGET_CONFIRM.message}
        </p>
      </div>
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" className="dialog-btn dialog-btn-secondary" disabled={busy} onClick={onClose}>
          {FORGET_CONFIRM.cancelLabel}
        </button>
        <button
          type="button"
          className="dialog-btn dialog-btn-danger"
          // Busy is aria-disabled, never disabled: Chromium would blur the focused button mid-request (Buttons card).
          aria-disabled={busy ? true : undefined}
          onClick={confirm}
        >
          {busy ? 'Forgetting…' : FORGET_CONFIRM.confirmLabel}
        </button>
      </div>
    </BaseDialog>
  )
}

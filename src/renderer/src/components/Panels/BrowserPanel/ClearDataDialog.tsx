// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * **Clear browsing data** (spec 025, 025-FR-023; deck *Clear browsing data and
 * Forget*; `menus-and-data.html`): five checkboxes for this project, Cookies
 * and other site data, Cached files and Captures ticked on opening; **Clear**
 * blocked with "Tick at least one kind of data." while none is ticked;
 * "Clearing…" while main works. A step that failed or timed out is one error
 * toast each; all done is one success toast. Built on the shared BaseDialog,
 * so the native page hides behind it (the native-view guard).
 */
import { useId, useRef, useState } from 'react'
import type { ClearDataCategory, ClearDataResponse } from '../../../../../shared/ipc/browser-tab-page-schema'
import { BaseDialog } from '../../Dialog/BaseDialog'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { showErrorToast, showSuccessToast } from '../../../utils/toastHelpers'
import { logger } from '../../../utils/logger'

type Categories = Record<ClearDataCategory, boolean>

/** The five kinds in dialog order, with their spec-fixed labels and descriptions. */
export const CLEAR_DATA_KINDS: ReadonlyArray<{ id: ClearDataCategory; label: string; description: string }> = [
  { id: 'cookies', label: 'Cookies and other site data', description: 'Signs you out of most sites. Also clears the address history.' },
  { id: 'cache', label: 'Cached files', description: 'Saved copies of files that make pages load faster.' },
  {
    id: 'permissions',
    label: 'Site permissions, certificate exceptions and pop-up exceptions',
    description: 'Your Allow and Block answers, Proceed anyway choices and allowed pop-ups.'
  },
  { id: 'credentials', label: 'Saved sign-in credentials', description: 'Usernames and passwords saved with Remember for this project.' },
  { id: 'captures', label: 'Captures', description: "Screenshots and context files sent to your agent. They're deleted after 7 days anyway." }
]

/** What the dialog opens with (025-FR-023). */
export const CLEAR_DATA_DEFAULTS: Readonly<Categories> = {
  cookies: true,
  cache: true,
  permissions: false,
  credentials: false,
  captures: true
}

/**
 * Tell the user what `clearData` came to.
 *
 * @param response - main's answer
 */
export function reportClearData(response: ClearDataResponse): void {
  if ('error' in response) {
    showErrorToast('Some data wasn’t cleared', `${response.error}. Data you didn't tick wasn't touched.`)
    return
  }
  if (response.failed.length === 0) {
    showSuccessToast('Browsing data cleared', 'Browsing data cleared for this project.')
    return
  }
  for (const step of response.failed) {
    const kind = CLEAR_DATA_KINDS.find(k => k.id === step.category)?.label.toLowerCase() ?? step.category
    const reason = step.reason === 'timeout' ? 'it took longer than 10 seconds' : 'the step failed'
    showErrorToast('Some data wasn’t cleared', `Couldn't clear ${kind} – ${reason}. Data you didn't tick wasn't touched.`)
  }
}

/** Props for {@link ClearDataDialog}. */
export interface ClearDataDialogProps {
  readonly onClose: () => void
}

/**
 * The dialog.
 *
 * @param props - {@link ClearDataDialogProps}
 * @returns The dialog
 */
export function ClearDataDialog({ onClose }: ClearDataDialogProps): JSX.Element {
  const [ticked, setTicked] = useState<Categories>({ ...CLEAR_DATA_DEFAULTS })
  const [busy, setBusy] = useState(false)
  const base = `erf-clear-${useId().replace(/[^\w-]/g, '')}`
  const cancelRef = useRef<HTMLButtonElement>(null)
  const none = !Object.values(ticked).some(Boolean)

  const clear = (): void => {
    if (none || busy) return
    setBusy(true)
    browserTabGateway
      .clearData(ticked)
      .then(reportClearData)
      .catch((error: unknown) => {
        logger.warn('Clear browsing data failed', { error: error instanceof Error ? error.message : String(error) })
        showErrorToast('Some data wasn’t cleared', "Erfana couldn't reach the browser. Data you didn't tick wasn't touched.")
      })
      .finally(onClose)
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
      ariaDescribedBy={`${base}-intro`}
      initialFocusRef={cancelRef}
    >
      <div className="dialog-header">
        <h3 id={`${base}-title`} className="dialog-title">
          Clear browsing data
        </h3>
      </div>
      <div className="dialog-body erf-brw-clear">
        <p id={`${base}-intro`} className="dialog-message">
          For this project only. Its open browser tabs reload afterwards.
        </p>
        {CLEAR_DATA_KINDS.map(kind => (
          <label key={kind.id} className="erf-brw-clear__option">
            <input
              type="checkbox"
              checked={ticked[kind.id]}
              disabled={busy}
              // Named by the label text alone: the description wrapped in the same label is its description, never part of its name.
              aria-labelledby={`${base}-${kind.id}-label`}
              aria-describedby={`${base}-${kind.id}`}
              onChange={event => setTicked(prev => ({ ...prev, [kind.id]: event.target.checked }))}
            />
            <span id={`${base}-${kind.id}-label`}>{kind.label}</span>
            <span id={`${base}-${kind.id}`} className="erf-brw-clear__desc">
              {kind.description}
            </span>
          </label>
        ))}
        {none && (
          // Not a live region: Clear names it, and ticking is not a submit (Form card, decided).
          <p id={`${base}-blocked`} className="dialog-validation-error">
            Tick at least one kind of data.
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" className="dialog-btn dialog-btn-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="dialog-btn dialog-btn-primary"
          aria-disabled={none || busy ? true : undefined}
          aria-describedby={none ? `${base}-blocked` : undefined}
          onClick={clear}
        >
          {busy ? 'Clearing…' : 'Clear'}
        </button>
      </div>
    </BaseDialog>
  )
}

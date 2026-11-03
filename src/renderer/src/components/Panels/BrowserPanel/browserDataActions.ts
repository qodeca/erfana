// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser tab's actions that leave the tab (spec 025, 025-FR-023,
 * 025-FR-057; deck *Clear browsing data and Forget*, *Other toasts*):
 * **Forget this project's browser data** behind its confirmation, and **Open
 * in system browser**. Each reports its outcome as a toast; neither throws.
 */
import type { ForgetResponse } from '../../../../../shared/ipc/browser-tab-page-schema'
import type { ConfirmDialogConfig } from '../../Dialog/types'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { showErrorToast, showSuccessToast } from '../../../utils/toastHelpers'
import { logger } from '../../../utils/logger'

/** The confirmation's words (deck *Forget*). */
export const FORGET_CONFIRM: Omit<ConfirmDialogConfig, 'id'> = {
  title: "Forget this project's browser data?",
  message:
    "This closes the project's browser tabs and deletes the .erfana/browser folder – cookies, saved sign-ins, permissions, history and captures. You'll be signed out of every site in this project.",
  confirmLabel: 'Forget browser data',
  cancelLabel: 'Cancel',
  danger: true
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Tell the user what `forget` came to.
 *
 * @param response - main's answer
 */
export function reportForget(response: ForgetResponse): void {
  if ('error' in response) {
    const what = response.path ?? '.erfana/browser'
    showErrorToast('Browser data not fully deleted', `Couldn't delete ${what} – ${response.error}.`)
    return
  }
  showSuccessToast(
    'Browser data forgotten',
    response.deleted === 'pending'
      ? "This project's browser data is deleted. A few files still in use go the next time Erfana starts."
      : "This project's browser data is deleted."
  )
}

/**
 * Ask, then forget the project's browser data; main closes its tabs.
 *
 * @param confirm - The dialog system's `showConfirm`
 */
export async function forgetBrowserData(confirm: (config: Omit<ConfirmDialogConfig, 'id'>) => Promise<boolean>): Promise<void> {
  if (!(await confirm(FORGET_CONFIRM))) return
  try {
    reportForget(await browserTabGateway.forget())
  } catch (error) {
    logger.warn('Forget browser data failed', { error: errorText(error) })
    showErrorToast('Browser data not fully deleted', "Erfana couldn't reach the browser.")
  }
}

/**
 * **Open in system browser**: the tab's address, or `url` (a link from the page menu).
 *
 * @param tabId - The tab
 * @param url - Another address than the tab's own
 */
export async function openInSystemBrowser(tabId: string, url?: string): Promise<void> {
  let reason: string
  try {
    const response = await browserTabGateway.openExternal(tabId, url)
    if ('ok' in response) return
    reason = response.error
  } catch (error) {
    logger.warn('Open in system browser failed', { error: errorText(error) })
    reason = "Erfana couldn't reach the browser"
  }
  showErrorToast("Couldn't open in your system browser", `${reason}. Copy the address from the address bar instead.`)
}

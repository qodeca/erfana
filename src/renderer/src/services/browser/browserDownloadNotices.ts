// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The window's download notices (spec 025, 025-FR-020; design
 * `docs/designs/browser/site-prompts.html` § Download notice): main sends
 * `downloadDone` and `downloadFailed` to the window the download belongs to,
 * also after its tab closed, and they become toasts here.
 *
 * - **Finished** – a success toast "Downloaded {name}" with **Show in folder**,
 *   which asks main to reveal the file by the notice's `downloadId` (main
 *   keeps the path; the window never sees it). A toast with an action stays
 *   until the user acts or closes it (`ToastProvider`).
 * - **Failed** – an error toast "Couldn’t download {name}" whose message gives
 *   the reason and that the partial file is gone; it stays until closed.
 *
 * Other notice kinds are not handled here.
 */
import type { NoticeEvent } from '../../../../shared/ipc/browser-tab-schema'
import { downloadDoneTitle, downloadFailedTitle, downloadFailureMessage } from '../../../../shared/browser/downloadNotice'
import { showGlobalToast } from '../../components/Toast/toastService'
import { browserTabGateway } from '../browserTabGateway'
import { showErrorToast } from '../../utils/toastHelpers'
import { logger } from '../../utils/logger'

/** The finished toast's action label (the design keeps it generic on macOS too). */
export const SHOW_IN_FOLDER_LABEL = 'Show in folder'

function showInFolder(downloadId: string): void {
  browserTabGateway.showDownload(downloadId).catch((error: unknown) => {
    logger.error('Show in folder failed for a download', error instanceof Error ? error : undefined)
    showErrorToast('Couldn’t show the file', 'Erfana could not open its folder.')
  })
}

/**
 * Show `event` as a toast when it is a download notice.
 *
 * @returns Whether `event` was a download notice
 */
export function showDownloadNotice(event: NoticeEvent): boolean {
  const download = event.download
  if (download === undefined) return false
  if (event.kind === 'downloadDone') {
    const downloadId = download.downloadId
    showGlobalToast({
      type: 'success',
      title: downloadDoneTitle(download.fileName),
      message: '',
      action: downloadId === null ? undefined : { label: SHOW_IN_FOLDER_LABEL, onClick: () => showInFolder(downloadId) }
    })
    return true
  }
  if (event.kind === 'downloadFailed' && download.reason !== null) {
    showErrorToast(downloadFailedTitle(download.fileName), downloadFailureMessage(download.reason))
    return true
  }
  return false
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({ showDownload: vi.fn<(id: string) => Promise<void>>(async () => undefined) }))
vi.mock('../browserTabGateway', () => ({ browserTabGateway: gateway }))
const toasts = vi.hoisted(() => ({ showErrorToast: vi.fn() }))
vi.mock('../../utils/toastHelpers', () => toasts)
const service = vi.hoisted(() => ({ showGlobalToast: vi.fn() }))
vi.mock('../../components/Toast/toastService', () => service)
const log = vi.hoisted(() => ({ logger: { error: vi.fn() } }))
vi.mock('../../utils/logger', () => log)

import type { NoticeEvent } from '../../../../shared/ipc/browser-tab-schema'
import type { GlobalToastPayload } from '../../components/Toast/toastService'
import { SHOW_IN_FOLDER_LABEL, showDownloadNotice } from './browserDownloadNotices'

afterEach(() => {
  vi.clearAllMocks()
})

const done = (downloadId: string | null): NoticeEvent => ({
  tabId: 'browser-tab-1',
  kind: 'downloadDone',
  text: 'Downloaded report.pdf',
  download: { fileName: 'report.pdf', downloadId, reason: null }
})

function lastToast(): GlobalToastPayload {
  return service.showGlobalToast.mock.calls.at(-1)![0] as GlobalToastPayload
}

describe('showDownloadNotice (025-FR-020)', () => {
  it('shows a finished download as a success toast naming the file, with Show in folder by its id', () => {
    expect(showDownloadNotice(done('dl1'))).toBe(true)
    const toast = lastToast()
    expect(toast).toMatchObject({ type: 'success', title: 'Downloaded report.pdf', message: '' })
    expect(toast.action?.label).toBe(SHOW_IN_FOLDER_LABEL)
    toast.action!.onClick()
    expect(gateway.showDownload).toHaveBeenCalledExactlyOnceWith('dl1')
  })

  it('shows no action when main kept no id', () => {
    showDownloadNotice(done(null))
    expect(lastToast().action).toBeUndefined()
  })

  it('reports a Show in folder that main refused to run', async () => {
    gateway.showDownload.mockRejectedValueOnce(new Error('gone'))
    showDownloadNotice(done('dl2'))
    lastToast().action!.onClick()
    await vi.waitFor(() => expect(toasts.showErrorToast).toHaveBeenCalledWith('Couldn’t show the file', 'Erfana could not open its folder.'))
    expect(log.logger.error).toHaveBeenCalled()
  })

  it.each([
    ['interrupted', 'The download was interrupted. The partial file was deleted.'],
    ['folderNotWritable', 'Erfana can’t write to that folder. The partial file was deleted.'],
    ['refusedFolder', 'Erfana doesn’t save downloads inside a .erfana folder.']
  ] as const)('shows a failed download (%s) as an error toast naming the file and the reason', (reason, message) => {
    const event: NoticeEvent = { tabId: null, kind: 'downloadFailed', text: 'x', download: { fileName: 'a.bin', downloadId: null, reason } }
    expect(showDownloadNotice(event)).toBe(true)
    expect(toasts.showErrorToast).toHaveBeenCalledExactlyOnceWith('Couldn’t download a.bin', message)
  })

  it('ignores notices that are not downloads, and a failure without a reason', () => {
    expect(showDownloadNotice({ tabId: null, kind: 'localAddressSeen', text: 'http://localhost:1/' })).toBe(false)
    expect(showDownloadNotice({ tabId: null, kind: 'downloadDone', text: 'x' })).toBe(false)
    expect(
      showDownloadNotice({ tabId: null, kind: 'downloadFailed', text: 'x', download: { fileName: 'a', downloadId: null, reason: null } })
    ).toBe(false)
    expect(service.showGlobalToast).not.toHaveBeenCalled()
    expect(toasts.showErrorToast).not.toHaveBeenCalled()
  })
})

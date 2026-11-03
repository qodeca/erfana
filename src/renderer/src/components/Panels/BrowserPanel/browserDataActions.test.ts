// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'

const { gateway, toast } = vi.hoisted(() => ({
  gateway: { forget: vi.fn(), openExternal: vi.fn() },
  toast: { showErrorToast: vi.fn(), showSuccessToast: vi.fn() }
}))
vi.mock('../../../services/browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('../../../utils/toastHelpers', () => toast)
vi.mock('../../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { FORGET_CONFIRM, forgetBrowserData, openInSystemBrowser, reportForget } from './browserDataActions'

afterEach(() => vi.clearAllMocks())

describe('forgetBrowserData', () => {
  it('asks first and does nothing on Cancel', async () => {
    const confirm = vi.fn(async () => false)
    await forgetBrowserData(confirm)
    expect(confirm).toHaveBeenCalledWith(FORGET_CONFIRM)
    expect(gateway.forget).not.toHaveBeenCalled()
  })

  it('forgets on confirm and reports, or reports an unreachable browser', async () => {
    gateway.forget.mockResolvedValueOnce({ deleted: 'deleted' })
    await forgetBrowserData(async () => true)
    expect(toast.showSuccessToast).toHaveBeenCalledWith('Browser data forgotten', "This project's browser data is deleted.")
    gateway.forget.mockRejectedValueOnce(new Error('gone'))
    await forgetBrowserData(async () => true)
    expect(toast.showErrorToast).toHaveBeenCalledWith('Browser data not fully deleted', "Erfana couldn't reach the browser.")
  })

  it('reports pending files and a failed path', () => {
    reportForget({ deleted: 'pending' })
    expect(toast.showSuccessToast).toHaveBeenCalledWith('Browser data forgotten', expect.stringMatching(/next time Erfana starts/))
    reportForget({ error: 'in use', path: '.erfana/browser/Cookies' })
    expect(toast.showErrorToast).toHaveBeenCalledWith('Browser data not fully deleted', "Couldn't delete .erfana/browser/Cookies – in use.")
    reportForget({ error: 'denied', path: null })
    expect(toast.showErrorToast).toHaveBeenLastCalledWith('Browser data not fully deleted', "Couldn't delete .erfana/browser – denied.")
  })
})

describe('openInSystemBrowser', () => {
  it('is silent on success, toasts main\'s refusal or a transport failure', async () => {
    gateway.openExternal.mockResolvedValueOnce({ ok: true })
    await openInSystemBrowser('browser-tab-1')
    expect(gateway.openExternal).toHaveBeenCalledWith('browser-tab-1', undefined)
    expect(toast.showErrorToast).not.toHaveBeenCalled()
    gateway.openExternal.mockResolvedValueOnce({ error: 'Only http and https addresses open in your system browser' })
    await openInSystemBrowser('browser-tab-1', 'ftp://x.test')
    expect(toast.showErrorToast).toHaveBeenLastCalledWith(
      "Couldn't open in your system browser",
      'Only http and https addresses open in your system browser. Copy the address from the address bar instead.'
    )
    gateway.openExternal.mockRejectedValueOnce(new Error('gone'))
    await openInSystemBrowser('browser-tab-1')
    expect(toast.showErrorToast).toHaveBeenLastCalledWith(
      "Couldn't open in your system browser",
      "Erfana couldn't reach the browser. Copy the address from the address bar instead."
    )
  })
})

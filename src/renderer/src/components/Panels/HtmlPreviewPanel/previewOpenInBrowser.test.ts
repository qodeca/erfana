// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the shared "Open in default browser" action (issue #124, part 4).
 *
 * One test per row of the UX spec's §7 table: silent success, the fallback
 * notice, each named refusal, and the launch-failure text that `NO_PROJECT`,
 * `INVALID_REQUEST` and a request that never answered all share (RU13).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../../shared/errors'
import type { BrowserOpenErrorCode } from '../../../../../shared/ipc/browser-schema'
import { logger } from '../../../utils/logger'
import { isMacOS, isWindows } from '../../../utils/platform'
import { showGlobalToast } from '../../Toast/toastService'
import {
  OPEN_IN_BROWSER_ERROR_TITLE,
  OPEN_IN_BROWSER_FALLBACK_TITLE,
  describeOpenInBrowserFailure,
  openInDefaultBrowser
} from './previewOpenInBrowser'

vi.mock('../../Toast/toastService', () => ({ showGlobalToast: vi.fn() }))
vi.mock('../../../utils/platform', () => ({ isMacOS: vi.fn(), isWindows: vi.fn() }))
vi.mock('../../../utils/logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

/** A Windows path on purpose: it must reach the bridge exactly as given. */
const PAGE = 'C:\\proj\\site\\pricing.html'
const FINDER_TEXT =
  'Your browser did not start. Try again, or use Reveal in Finder to open the file yourself.'

const openFile = vi.fn()

/** Main's refusal for one code; `error` is the generic text, naming no file. */
const refusal = (errorCode: BrowserOpenErrorCode) => ({
  success: false as const,
  errorCode,
  error: 'generic text from main'
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isMacOS).mockReturnValue(true)
  vi.mocked(isWindows).mockReturnValue(false)
  ;(window as unknown as { api: unknown }).api = { browser: { openFile } }
})

describe('openInDefaultBrowser', () => {
  it('passes the path through unchanged and stays silent on success', async () => {
    openFile.mockResolvedValue({ success: true, usedFallback: false })

    await openInDefaultBrowser(PAGE)

    expect(openFile).toHaveBeenCalledWith(PAGE)
    expect(showGlobalToast).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('raises the info notice, naming the file, when the fallback app was used', async () => {
    openFile.mockResolvedValue({ success: true, usedFallback: true })

    await openInDefaultBrowser(PAGE)

    expect(showGlobalToast).toHaveBeenCalledWith({
      type: 'info',
      title: OPEN_IN_BROWSER_FALLBACK_TITLE,
      message:
        'Erfana could not find your default web browser, so pricing.html opened in the app your system uses for .html files.'
    })
  })

  it.each<[BrowserOpenErrorCode, string]>([
    [
      ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT,
      'pricing.html leads outside the open project, so Erfana will not open it in a browser.'
    ],
    [
      ErrorCode.OPEN_IN_BROWSER_NOT_HTML,
      'pricing.html is not an HTML page. Only .html and .htm files can be opened in a browser.'
    ],
    [
      ErrorCode.OPEN_IN_BROWSER_MISSING,
      'pricing.html is no longer there – it may have been moved or deleted.'
    ]
  ])('shows the named error toast for %s', async (code, message) => {
    openFile.mockResolvedValue(refusal(code))

    await openInDefaultBrowser(PAGE)

    expect(showGlobalToast).toHaveBeenCalledWith({
      type: 'error',
      title: OPEN_IN_BROWSER_ERROR_TITLE,
      message
    })
  })

  it.each<BrowserOpenErrorCode>([
    ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED,
    ErrorCode.OPEN_IN_BROWSER_NO_PROJECT,
    ErrorCode.OPEN_IN_BROWSER_INVALID_REQUEST
  ])('shows the launch-failure text for %s (RU13)', async (code) => {
    openFile.mockResolvedValue(refusal(code))

    await openInDefaultBrowser(PAGE)

    expect(showGlobalToast).toHaveBeenCalledWith({
      type: 'error',
      title: OPEN_IN_BROWSER_ERROR_TITLE,
      message: FINDER_TEXT
    })
  })

  it('never shows the generic text main sent', async () => {
    openFile.mockResolvedValue(refusal(ErrorCode.OPEN_IN_BROWSER_MISSING))

    await openInDefaultBrowser(PAGE)

    expect(JSON.stringify(vi.mocked(showGlobalToast).mock.calls)).not.toContain('generic text')
  })

  it('shows the launch-failure text when the invoke rejects (the sender gate)', async () => {
    openFile.mockRejectedValue(new Error('Refused untrusted sender'))

    await expect(openInDefaultBrowser(PAGE)).resolves.toBeUndefined()

    expect(showGlobalToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: FINDER_TEXT })
    )
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { errorCode: 'INVOKE_REJECTED' })
  })

  it('shows the launch-failure text when the bridge is missing', async () => {
    ;(window as unknown as { api: unknown }).api = {}

    await expect(openInDefaultBrowser(PAGE)).resolves.toBeUndefined()

    expect(showGlobalToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: FINDER_TEXT })
    )
  })

  it.each([
    ['a code from another domain', { success: false, errorCode: 'FILE_NOT_FOUND', error: 'x' }],
    ['no answer at all', undefined],
    ['a success with extra keys', { success: true, usedFallback: false, path: PAGE }]
  ])('treats %s as an unknown error', async (_label, reply) => {
    openFile.mockResolvedValue(reply)

    await openInDefaultBrowser(PAGE)

    expect(showGlobalToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: FINDER_TEXT })
    )
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { errorCode: 'INVALID_RESPONSE' })
  })

  it('logs the code only – never the path or the file name', async () => {
    openFile.mockResolvedValue(refusal(ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT))

    await openInDefaultBrowser(PAGE)

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
      errorCode: ErrorCode.OPEN_IN_BROWSER_OUTSIDE_PROJECT
    })
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('pricing')
  })
})

describe('describeOpenInBrowserFailure', () => {
  it('names "Reveal in Explorer" on Windows', () => {
    vi.mocked(isMacOS).mockReturnValue(false)
    vi.mocked(isWindows).mockReturnValue(true)

    expect(describeOpenInBrowserFailure(ErrorCode.OPEN_IN_BROWSER_LAUNCH_FAILED, 'a.html')).toBe(
      'Your browser did not start. Try again, or use Reveal in Explorer to open the file yourself.'
    )
  })

  it('names the tree\'s own "Reveal in File Manager" elsewhere', () => {
    vi.mocked(isMacOS).mockReturnValue(false)
    vi.mocked(isWindows).mockReturnValue(false)

    expect(describeOpenInBrowserFailure(null, 'a.html')).toContain('Reveal in File Manager')
  })
})

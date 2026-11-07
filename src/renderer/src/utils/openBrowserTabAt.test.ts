// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview'

const { ensure, navigate, openLocalFile, toast } = vi.hoisted(() => ({
  ensure: vi.fn(),
  navigate: vi.fn(),
  openLocalFile: vi.fn(),
  toast: vi.fn()
}))
vi.mock('../services/browser/browserTabLifecycle', () => ({ ensureBrowserTab: ensure }))
vi.mock('../services/browserTabGateway', () => ({ browserTabGateway: { navigate, openLocalFile } }))
vi.mock('./toastHelpers', () => ({ showErrorToast: toast }))
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { OPEN_TAB_FAILED_TITLE, openBrowserTabAt } from './openBrowserTabAt'
import { useProjectStore } from '../stores/useProjectStore'

function fakeApi(): DockviewApi {
  const panel = { id: '', api: { setActive: vi.fn() }, group: { focus: vi.fn() } }
  return {
    getPanel: vi.fn(() => undefined),
    addPanel: vi.fn((options: { id: string }) => {
      panel.id = options.id
      return panel
    })
  } as unknown as DockviewApi
}

beforeEach(() => {
  vi.clearAllMocks()
  ensure.mockResolvedValue({ tabId: 'browser-tab-4' })
  navigate.mockResolvedValue({ ok: true })
  openLocalFile.mockResolvedValue({ ok: true })
})
afterEach(() => {
  useProjectStore.setState({ editorPanelIds: new Set() })
})

describe('openBrowserTabAt', () => {
  it('returns false with no editor area, so the caller can fall back', async () => {
    expect(await openBrowserTabAt(null, { kind: 'url', url: 'https://a.test/', source: 'terminalLink' })).toBe(false)
    expect(ensure).not.toHaveBeenCalled()
  })

  it('025-AC-009 opens a tab without focusing its address bar and loads the link as a terminal link', async () => {
    const api = fakeApi()
    expect(await openBrowserTabAt(api, { kind: 'url', url: 'http://localhost:4100/', source: 'terminalLink' })).toBe(true)
    const options = vi.mocked(api.addPanel).mock.calls[0][0] as unknown as { id: string; params: Record<string, unknown> }
    expect(options.params.focusAddress).toBe(false)
    expect(ensure).toHaveBeenCalledWith(options.id)
    expect(navigate).toHaveBeenCalledWith({ tabId: 'browser-tab-4', input: 'http://localhost:4100/', source: 'terminalLink' })
    expect(toast).not.toHaveBeenCalled()
  })

  it('025-AC-010 loads a previewed file through openLocalFile', async () => {
    await openBrowserTabAt(fakeApi(), { kind: 'file', filePath: '/p/site/index.html' })
    expect(openLocalFile).toHaveBeenCalledWith('browser-tab-4', '/p/site/index.html')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('says why main refused the address', async () => {
    navigate.mockResolvedValueOnce({ refused: 'network-path' })
    await openBrowserTabAt(fakeApi(), { kind: 'url', url: 'https://a.test/', source: 'terminalLink' })
    expect(toast).toHaveBeenCalledWith(OPEN_TAB_FAILED_TITLE, expect.stringContaining('network share'))
    openLocalFile.mockResolvedValueOnce({ error: 'The file is outside the project' })
    await openBrowserTabAt(fakeApi(), { kind: 'file', filePath: '/elsewhere.html' })
    expect(toast).toHaveBeenCalledWith(OPEN_TAB_FAILED_TITLE, 'The file is outside the project')
  })

  it('loads nothing when the tab could not open (the panel reports it)', async () => {
    ensure.mockResolvedValueOnce({ error: 'No project' })
    expect(await openBrowserTabAt(fakeApi(), { kind: 'url', url: 'https://a.test/', source: 'terminalLink' })).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('reports a bridge failure as a toast', async () => {
    navigate.mockRejectedValueOnce(new Error('gone'))
    await openBrowserTabAt(fakeApi(), { kind: 'url', url: 'https://a.test/', source: 'terminalLink' })
    expect(toast).toHaveBeenCalledWith(OPEN_TAB_FAILED_TITLE, 'The browser tab did not answer.')
    navigate.mockRejectedValueOnce('odd')
    await openBrowserTabAt(fakeApi(), { kind: 'url', url: 'https://a.test/', source: 'terminalLink' })
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it('still shows the toast, with no reason, for a refusal it has no words for', async () => {
    navigate.mockResolvedValueOnce({ refused: 'something-new' } as never)
    await openBrowserTabAt(fakeApi(), { kind: 'url', url: 'https://a.test/', source: 'terminalLink' })
    expect(toast).toHaveBeenCalledWith(OPEN_TAB_FAILED_TITLE, '')
  })
})

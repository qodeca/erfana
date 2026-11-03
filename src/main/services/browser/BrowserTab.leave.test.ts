// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A tab arms the leave-page prompt before every load the user starts, with a
 * way to repeat it (025-FR-058, ADR 0011 decision 7); page-started loads,
 * Stop and refused addresses arm nothing.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BrowserTab } from './BrowserTab'
import type { AppAddresses } from './browserNavigationPolicy'
import { fakeHost, fakeView } from './__test-helpers__/fakeBrowserView'

const APP: AppAddresses = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app', devServerOrigin: null }

function make() {
  const view = fakeView()
  const armed: Array<() => void> = []
  const armLeave = vi.fn((repeat: () => void) => armed.push(repeat))
  const local = {
    isLocalAddress: (url: string) => url.startsWith('http://127.0.0.1:4000/'),
    arm: vi.fn(),
    displayAddress: () => null,
    allowsRequest: () => true
  }
  const tab = new BrowserTab({
    id: 'browser-tab-1',
    panelId: 'panel-1',
    host: fakeHost().host,
    view: view.view,
    projectRoot: '/p',
    caseSensitive: true,
    appAddresses: () => APP,
    resolveDomain: (h) => h,
    expectDevTools: vi.fn(() => () => undefined),
    onStateChange: vi.fn(),
    onDestroyed: vi.fn(),
    local,
    armLeave
  })
  return { tab, contents: view.contents, armed, armLeave }
}

describe('BrowserTab arms the leave-page prompt', () => {
  it('before a navigation the user started; the repeat loads the same address again', () => {
    const { armed, contents, tab } = make()
    tab.navigate('https://a.test/', 'address')
    expect(armed).toHaveLength(1)
    armed[0]!()
    expect(contents.loadURL).toHaveBeenCalledTimes(2)
    expect(contents.loadURL).toHaveBeenLastCalledWith('https://a.test/')
  })

  it('before a served local file opens', () => {
    const { armed, contents, tab } = make()
    tab.navigateLocal('http://127.0.0.1:4000/index.html', 'previewOpen')
    armed[0]!()
    expect(contents.loadURL).toHaveBeenLastCalledWith('http://127.0.0.1:4000/index.html')
  })

  it('before Reload, Back and Forward, each repeating its own step', () => {
    const { armed, contents, tab } = make()
    contents.commit('https://a.test/1')
    contents.commit('https://a.test/2')
    tab.history('reload')
    tab.history('back')
    contents.index = 0
    tab.history('forward')
    expect(armed).toHaveLength(3)
    armed[0]!()
    expect(contents.reload).toHaveBeenCalledTimes(2)
    contents.index = 1
    armed[1]!()
    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(2)
    contents.index = 0
    armed[2]!()
    expect(contents.navigationHistory.goForward).toHaveBeenCalledTimes(2)
  })

  it('never for Stop, a refused address, a history step that cannot go, or a load the page started', () => {
    const { armLeave, tab } = make()
    tab.history('stop')
    tab.history('back')
    tab.navigate('javascript:alert(1)', 'address')
    tab.navigateForPage('https://a.test/')
    expect(armLeave).not.toHaveBeenCalled()
  })
})

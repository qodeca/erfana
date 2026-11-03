// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The app menu's **New browser tab** (spec 025, 025-FR-001; commit 18): a
 * File item on Ctrl/Cmd+T that tells only a main window – the one the click
 * names, else the focused one – and says whether the accelerator fired it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeWindow = { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }

const { focused, kind, FakeBrowserWindow } = vi.hoisted(() => {
  const focused = { current: null as null | FakeWindow }
  class FakeBrowserWindow {
    readonly webContents = { send: vi.fn() }
    isDestroyed(): boolean {
      return false
    }
    static getFocusedWindow(): FakeWindow | null {
      return focused.current
    }
  }
  return { focused, kind: { current: 'main' as string | null }, FakeBrowserWindow }
})

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn((template: unknown) => ({ _template: template })) },
  app: { name: 'ERFANA' },
  BrowserWindow: FakeBrowserWindow
}))
vi.mock('./utils/spawnNewInstance', () => ({ spawnNewInstance: vi.fn() }))
vi.mock('./ipc/appWebContents', () => ({ appWebContentsKind: () => kind.current }))

import { createApplicationMenu, sendNewBrowserTab } from './menu'
import { BROWSER_TAB_EVENTS } from '../shared/ipc/browser-tab-channels'

interface Item {
  label?: string
  accelerator?: string
  submenu?: Item[]
  click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void
}

function newTabItem(): Item {
  const template = (createApplicationMenu() as unknown as { _template: Item[] })._template
  const file = template.find((entry) => entry.label === 'File')!
  return file.submenu!.find((entry) => entry.label === 'New browser tab')!
}

beforeEach(() => {
  focused.current = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  kind.current = 'main'
})

describe('New browser tab menu item', () => {
  it('is a File item on CmdOrCtrl+T with the spec-fixed name', () => {
    expect(newTabItem().accelerator).toBe('CmdOrCtrl+T')
  })

  it('tells the focused main window, with byKey from the accelerator', () => {
    const item = newTabItem()
    item.click!({}, undefined, { triggeredByAccelerator: true })
    item.click!({}, undefined, {})
    expect(focused.current!.webContents.send.mock.calls).toEqual([
      [BROWSER_TAB_EVENTS.newTabCommand, { byKey: true }],
      [BROWSER_TAB_EVENTS.newTabCommand, { byKey: false }]
    ])
  })

  it('tells the window the click names over the focused one', () => {
    const clicked = new FakeBrowserWindow()
    newTabItem().click!({}, clicked, {})
    expect(clicked.webContents.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.newTabCommand, { byKey: false })
    expect(focused.current!.webContents.send).not.toHaveBeenCalled()
  })

  it('tells no popup, overlay, destroyed or missing window', () => {
    const send = focused.current!.webContents.send
    kind.current = 'browserPopup'
    sendNewBrowserTab(undefined, true)
    kind.current = 'main'
    focused.current = { isDestroyed: () => true, webContents: { send } }
    sendNewBrowserTab(undefined, true)
    focused.current = null
    expect(() => sendNewBrowserTab(undefined, false)).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})

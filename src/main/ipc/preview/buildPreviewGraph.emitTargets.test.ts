// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The default emit targets carry each window's id for routing (an acting event
 * goes to one window only) without writing onto the live Electron `webContents`
 * (#120).
 *
 * Split from `buildPreviewGraph.test.ts`: its module-level `electron` mock
 * would change what that file tests.
 */
import { describe, expect, it, vi } from 'vitest'

interface FakeContents {
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
  focus?: () => void
}
interface FakeWindow {
  readonly id: number
  isDestroyed(): boolean
  isFocused?(): boolean
  readonly webContents: FakeContents
}

const electron = vi.hoisted(() => ({ windows: [] as FakeWindow[] }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electron.windows, fromId: () => null },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false, on: vi.fn() }
}))
vi.mock('../../services/LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

import { defaultResolveEmitTargets } from './buildPreviewGraph'

describe('defaultResolveEmitTargets', () => {
  it('carries the window id on a wrapper and leaves the live webContents untouched', () => {
    const send = vi.fn()
    const contents: FakeContents = { isDestroyed: () => false, send }
    electron.windows = [{ id: 7, isDestroyed: () => false, webContents: contents }]

    const [target] = defaultResolveEmitTargets()

    expect(target.windowId).toBe(7)
    expect(contents).not.toHaveProperty('windowId')
    expect(target).not.toBe(contents)
    target.send('preview:x', { a: 1 })
    expect(send).toHaveBeenCalledWith('preview:x', { a: 1 })
  })

  it('skips a destroyed window', () => {
    electron.windows = [
      { id: 1, isDestroyed: () => true, webContents: { isDestroyed: () => true, send: vi.fn() } }
    ]

    expect(defaultResolveEmitTargets()).toEqual([])
  })

  it('focusHost focuses the own contents of the window only while the window is key (§19 Rev 4 owner test)', () => {
    const focus = vi.fn()
    let key = true
    electron.windows = [
      { id: 3, isDestroyed: () => false, isFocused: () => key, webContents: { isDestroyed: () => false, send: vi.fn(), focus } }
    ]

    const [target] = defaultResolveEmitTargets()

    expect(target.focusHost?.()).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)
    key = false
    expect(target.focusHost?.()).toBe(false)
    expect(focus).toHaveBeenCalledTimes(1)
  })
})

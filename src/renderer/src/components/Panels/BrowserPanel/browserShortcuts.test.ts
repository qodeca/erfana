// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'

const platform = vi.hoisted(() => ({ mac: true }))
vi.mock('../../../utils/platform', () => ({
  isMacOS: () => platform.mac,
  isWindows: () => !platform.mac
}))

import { browserShortcut } from './browserShortcuts'

afterEach(() => {
  platform.mac = true
})

describe('browserShortcut', () => {
  it('names the macOS keys', () => {
    expect(browserShortcut('back')).toEqual({ label: '⌘[', aria: 'Meta+[' })
    expect(browserShortcut('forward')).toEqual({ label: '⌘]', aria: 'Meta+]' })
    expect(browserShortcut('reload')).toEqual({ label: '⌘R', aria: 'Meta+R' })
    expect(browserShortcut('close')).toEqual({ label: '⌘W', aria: 'Meta+W' })
    expect(browserShortcut('pick')).toEqual({ label: '⌘E', aria: 'Meta+E' })
    expect(browserShortcut('devTools')).toEqual({ label: 'F12', aria: 'F12' })
    expect(browserShortcut('zoomReset')).toEqual({ label: '⌘0', aria: 'Meta+0' })
    expect(browserShortcut('find')).toEqual({ label: '⌘F', aria: 'Meta+F' })
  })

  it('names the Windows and Linux keys', () => {
    platform.mac = false
    expect(browserShortcut('back')).toEqual({ label: 'Alt+←', aria: 'Alt+ArrowLeft' })
    expect(browserShortcut('forward')).toEqual({ label: 'Alt+→', aria: 'Alt+ArrowRight' })
    expect(browserShortcut('reload')).toEqual({ label: 'Ctrl+R or F5', aria: 'Control+R' })
    expect(browserShortcut('pick')).toEqual({ label: 'Ctrl+E', aria: 'Control+E' })
    expect(browserShortcut('zoomReset')).toEqual({ label: 'Ctrl+0', aria: 'Control+0' })
    expect(browserShortcut('find')).toEqual({ label: 'Ctrl+F', aria: 'Control+F' })
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clipboardMenuItems, clipboardShortcut, CLIPBOARD_LABELS } from './clipboardMenuItems'
import { isMacOS } from '../../utils/platform'
import { toAriaKeyShortcuts } from './ariaKeyShortcuts'

vi.mock('../../utils/platform', () => ({ isMacOS: vi.fn(), isWindows: vi.fn() }))

const { mockLogger } = vi.hoisted(() => ({ mockLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

const mockIsMacOS = vi.mocked(isMacOS)

describe('clipboardShortcut (#463)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('spells the hints out on Windows and Linux', () => {
    mockIsMacOS.mockReturnValue(false)
    expect(['cut', 'copy', 'paste', 'delete'].map((a) => clipboardShortcut(a as 'cut'))).toEqual([
      'Ctrl+X',
      'Ctrl+C',
      'Ctrl+V',
      'Delete'
    ])
    expect(clipboardShortcut('delete', 'item')).toBe('Delete')
  })

  it('uses the glyphs on macOS: ⌫ for text, ⌘⌫ for a project item', () => {
    mockIsMacOS.mockReturnValue(true)
    expect(clipboardShortcut('cut')).toBe('⌘X')
    expect(clipboardShortcut('copy')).toBe('⌘C')
    expect(clipboardShortcut('paste')).toBe('⌘V')
    expect(clipboardShortcut('delete')).toBe('⌫')
    expect(clipboardShortcut('delete', 'item')).toBe('⌘⌫')
  })

  it('every hint converts to a valid aria-keyshortcuts value', () => {
    for (const mac of [true, false]) {
      mockIsMacOS.mockReturnValue(mac)
      for (const action of ['cut', 'copy', 'paste', 'delete'] as const) {
        expect(toAriaKeyShortcuts(clipboardShortcut(action))).toBeDefined()
      }
      expect(toAriaKeyShortcuts(clipboardShortcut('delete', 'item'))).toBeDefined()
    }
  })
})

describe('clipboardMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMacOS.mockReturnValue(false)
  })

  it('builds the items in the given order with the shared labels, hints and icons', () => {
    const items = clipboardMenuItems([
      { action: 'cut', run: vi.fn() },
      { action: 'copy', run: vi.fn() },
      { action: 'paste', run: vi.fn() },
      { action: 'delete', run: vi.fn(), disabled: true, testId: 'del' }
    ])
    expect(items.map((i) => i.label)).toEqual(['Cut', 'Copy', 'Paste', 'Delete'])
    expect(items.map((i) => i.shortcut)).toEqual(['Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Delete'])
    expect(items.every((i) => i.icon !== undefined)).toBe(true)
    expect(items[3]).toMatchObject({ disabled: true, testId: 'del' })
    expect(CLIPBOARD_LABELS.delete).toBe('Delete')
  })

  it('runs the command synchronously when the item is activated', () => {
    const run = vi.fn()
    clipboardMenuItems([{ action: 'copy', run }])[0].action()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('logs a rejected command instead of leaving it unhandled', async () => {
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    clipboardMenuItems([{ action: 'paste', run }])[0].action()
    await vi.waitFor(() => expect(mockLogger.error).toHaveBeenCalledWith('Clipboard paste failed', expect.any(Error)))
  })
})

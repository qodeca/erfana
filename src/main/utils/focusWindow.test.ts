// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * focusWindow.test.ts
 *
 * Tests for platform-adaptive window focusing utilities
 *
 * Coverage:
 * - focusWindow restores minimized window
 * - focusWindow shows hidden window
 * - focusWindow returns false for destroyed window
 * - focusWindow uses platform-specific focus (macOS, Windows, Linux)
 * - findWindowByWebContentsId returns correct window
 * - getMainWindow returns first non-destroyed window
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import { focusWindow, findWindowByWebContentsId, getMainWindow } from './focusWindow'

// Mock Electron
vi.mock('electron', () => {
  const mockApp = {
    dock: {
      bounce: vi.fn()
    }
  }

  const mockBrowserWindow = {
    getAllWindows: vi.fn(() => [])
  }

  return {
    BrowserWindow: mockBrowserWindow,
    app: mockApp
  }
})

// Import after mocking
import { BrowserWindow, app } from 'electron'

const mockedGetAllWindows = vi.mocked(BrowserWindow.getAllWindows)
const mockedDockBounce = vi.mocked(app.dock!.bounce)

// Helper to create a mock BrowserWindow
function createMockWindow(overrides?: Partial<BrowserWindow>): BrowserWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isFocused: vi.fn(() => false),
    isAlwaysOnTop: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    webContents: {
      id: 1
    },
    ...overrides
  } as unknown as BrowserWindow
}

describe('focusWindow', () => {
  let originalPlatform: string

  beforeEach(() => {
    vi.clearAllMocks()
    originalPlatform = process.platform
  })

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    })
  })

  it('returns false for destroyed window', async () => {
    const destroyedWindow = createMockWindow({
      isDestroyed: vi.fn(() => true)
    })

    const result = await focusWindow(destroyedWindow)

    expect(result).toBe(false)
    expect(destroyedWindow.restore).not.toHaveBeenCalled()
    expect(destroyedWindow.focus).not.toHaveBeenCalled()
  })

  it('returns false for null window', async () => {
    const result = await focusWindow(null as any)

    expect(result).toBe(false)
  })

  it('restores minimized window before focusing', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    const minimizedWindow = createMockWindow({
      isMinimized: vi.fn(() => true)
    })

    const result = await focusWindow(minimizedWindow)

    expect(result).toBe(true)
    expect(minimizedWindow.restore).toHaveBeenCalled()
    expect(minimizedWindow.focus).toHaveBeenCalled()
  })

  it('shows hidden window before focusing', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    const hiddenWindow = createMockWindow({
      isVisible: vi.fn(() => false)
    })

    const result = await focusWindow(hiddenWindow)

    expect(result).toBe(true)
    expect(hiddenWindow.show).toHaveBeenCalled()
    expect(hiddenWindow.focus).toHaveBeenCalled()
  })

  it('handles errors gracefully and returns false', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })

    const errorWindow = createMockWindow({
      focus: vi.fn(() => {
        throw new Error('Focus failed')
      })
    })

    const result = await focusWindow(errorWindow)

    expect(result).toBe(false)
  })

  describe('macOS platform behavior', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
    })

    it('bounces dock when window is not focused', async () => {
      const unfocusedWindow = createMockWindow({
        isFocused: vi.fn(() => false)
      })

      await focusWindow(unfocusedWindow)

      expect(mockedDockBounce).toHaveBeenCalledWith('informational')
      expect(unfocusedWindow.focus).toHaveBeenCalled()
    })

    it('does not bounce dock when window is already focused', async () => {
      const focusedWindow = createMockWindow({
        isFocused: vi.fn(() => true)
      })

      await focusWindow(focusedWindow)

      expect(mockedDockBounce).not.toHaveBeenCalled()
      expect(focusedWindow.focus).toHaveBeenCalled()
    })

    it('calls focus() directly without setAlwaysOnTop', async () => {
      const window = createMockWindow()

      await focusWindow(window)

      expect(window.focus).toHaveBeenCalled()
      expect(window.setAlwaysOnTop).not.toHaveBeenCalled()
    })
  })

  describe('Windows platform behavior', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
    })

    it('uses setAlwaysOnTop trick when window is not already on top', async () => {
      const window = createMockWindow({
        isAlwaysOnTop: vi.fn(() => false)
      })

      await focusWindow(window)

      expect(window.setAlwaysOnTop).toHaveBeenCalledTimes(2)
      expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true)
      expect(window.focus).toHaveBeenCalled()
      expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false)
    })

    it('does not toggle setAlwaysOnTop when window is already on top', async () => {
      const alwaysOnTopWindow = createMockWindow({
        isAlwaysOnTop: vi.fn(() => true)
      })

      await focusWindow(alwaysOnTopWindow)

      expect(alwaysOnTopWindow.setAlwaysOnTop).not.toHaveBeenCalled()
      expect(alwaysOnTopWindow.focus).toHaveBeenCalled()
    })

    it('does not use dock bounce on Windows', async () => {
      const window = createMockWindow()

      await focusWindow(window)

      expect(mockedDockBounce).not.toHaveBeenCalled()
    })
  })

  describe('Linux platform behavior', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
    })

    it('calls focus() directly without platform-specific tricks', async () => {
      const window = createMockWindow()

      await focusWindow(window)

      expect(window.focus).toHaveBeenCalled()
      expect(window.setAlwaysOnTop).not.toHaveBeenCalled()
      expect(mockedDockBounce).not.toHaveBeenCalled()
    })

    it('performs best-effort focus on Wayland', async () => {
      const window = createMockWindow()

      const result = await focusWindow(window)

      // Should succeed even though Wayland may ignore it
      expect(result).toBe(true)
      expect(window.focus).toHaveBeenCalled()
    })
  })
})

describe('findWindowByWebContentsId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns window with matching webContents ID', () => {
    const window1 = createMockWindow({ webContents: { id: 1 } as any })
    const window2 = createMockWindow({ webContents: { id: 2 } as any })
    const window3 = createMockWindow({ webContents: { id: 3 } as any })

    mockedGetAllWindows.mockReturnValue([window1, window2, window3])

    const result = findWindowByWebContentsId(2)

    expect(result).toBe(window2)
  })

  it('returns undefined when no window matches', () => {
    const window1 = createMockWindow({ webContents: { id: 1 } as any })
    const window2 = createMockWindow({ webContents: { id: 2 } as any })

    mockedGetAllWindows.mockReturnValue([window1, window2])

    const result = findWindowByWebContentsId(99)

    expect(result).toBeUndefined()
  })

  it('skips destroyed windows', () => {
    const destroyedWindow = createMockWindow({
      isDestroyed: vi.fn(() => true),
      webContents: { id: 1 } as any
    })
    const validWindow = createMockWindow({ webContents: { id: 1 } as any })

    mockedGetAllWindows.mockReturnValue([destroyedWindow, validWindow])

    const result = findWindowByWebContentsId(1)

    expect(result).toBe(validWindow)
  })

  it('returns undefined when all windows are destroyed', () => {
    const destroyedWindow1 = createMockWindow({
      isDestroyed: vi.fn(() => true),
      webContents: { id: 1 } as any
    })
    const destroyedWindow2 = createMockWindow({
      isDestroyed: vi.fn(() => true),
      webContents: { id: 2 } as any
    })

    mockedGetAllWindows.mockReturnValue([destroyedWindow1, destroyedWindow2])

    const result = findWindowByWebContentsId(1)

    expect(result).toBeUndefined()
  })

  it('returns undefined when no windows exist', () => {
    mockedGetAllWindows.mockReturnValue([])

    const result = findWindowByWebContentsId(1)

    expect(result).toBeUndefined()
  })
})

describe('getMainWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns first non-destroyed window', () => {
    const window1 = createMockWindow()
    const window2 = createMockWindow()
    const window3 = createMockWindow()

    mockedGetAllWindows.mockReturnValue([window1, window2, window3])

    const result = getMainWindow()

    expect(result).toBe(window1)
  })

  it('skips destroyed windows and returns first valid window', () => {
    const destroyedWindow = createMockWindow({
      isDestroyed: vi.fn(() => true)
    })
    const validWindow = createMockWindow()

    mockedGetAllWindows.mockReturnValue([destroyedWindow, validWindow])

    const result = getMainWindow()

    expect(result).toBe(validWindow)
  })

  it('returns undefined when all windows are destroyed', () => {
    const destroyedWindow1 = createMockWindow({
      isDestroyed: vi.fn(() => true)
    })
    const destroyedWindow2 = createMockWindow({
      isDestroyed: vi.fn(() => true)
    })

    mockedGetAllWindows.mockReturnValue([destroyedWindow1, destroyedWindow2])

    const result = getMainWindow()

    expect(result).toBeUndefined()
  })

  it('returns undefined when no windows exist', () => {
    mockedGetAllWindows.mockReturnValue([])

    const result = getMainWindow()

    expect(result).toBeUndefined()
  })

  it('works with single window', () => {
    const window = createMockWindow()

    mockedGetAllWindows.mockReturnValue([window])

    const result = getMainWindow()

    expect(result).toBe(window)
  })
})

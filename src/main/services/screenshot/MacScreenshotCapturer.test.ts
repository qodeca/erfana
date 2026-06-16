// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for MacScreenshotCapturer.
 *
 * Verifies the macOS `/usr/sbin/screencapture` argv composition for every
 * mode, the cancel/timeout/permission error mapping, multi-monitor
 * `-D` flag routing, and that windowEnumeration intentionally returns []
 * (macOS uses screencapture's native picker, not our in-app one).
 *
 * @see Issue #86 - original macOS screenshot capture
 * @see Issue #164 - extracted behind `IScreenshotCapturer`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

const REAL_TMPDIR = os.tmpdir()

function escRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function screenshotPathRx(tmpdir: string = REAL_TMPDIR, { anchor = true } = {}): RegExp {
  const sep = '[/\\\\]'
  const pattern = `${escRx(tmpdir)}${sep}erfana-screenshot-\\d+\\.png`
  return new RegExp(anchor ? `^${pattern}$` : pattern)
}

interface MockChildProcess extends EventEmitter {
  pid?: number
  killed: boolean
}

const mockExecFile = vi.fn()

vi.mock('child_process', () => ({
  execFile: mockExecFile
}))

const mockAccess = vi.fn()

vi.mock('fs/promises', () => ({
  access: mockAccess
}))

const mockTmpdir = vi.fn(() => REAL_TMPDIR)

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    tmpdir: (...args: unknown[]) => mockTmpdir(...args)
  }
})

const mockGetAllDisplays = vi.fn()
const mockGetPrimaryDisplay = vi.fn()

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: mockGetAllDisplays,
    getPrimaryDisplay: mockGetPrimaryDisplay
  }
}))

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

vi.mock('../LoggingService', () => ({
  logger: mockLogger
}))

describe('MacScreenshotCapturer', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockTmpdir.mockReturnValue(REAL_TMPDIR)
    mockGetAllDisplays.mockReturnValue([
      { id: 1, label: 'Built-in', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    ])
    mockGetPrimaryDisplay.mockReturnValue({ id: 1 })
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true })
  })

  describe('argv composition', () => {
    function resolveOk(): void {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    }

    it('captureScreen uses -x flag', async () => {
      resolveOk()
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'screen' })

      expect(result.success).toBe(true)
      expect(mockExecFile).toHaveBeenCalledWith(
        '/usr/sbin/screencapture',
        expect.arrayContaining(['-x']),
        expect.objectContaining({ timeout: 30_000 }),
        expect.any(Function)
      )
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('-x')
      expect(args[1]).toMatch(screenshotPathRx())
    })

    it('captureScreen uses -R <x,y,w,h> bounds for a specific displayId (#164 F[14])', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'A', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 102, label: 'B', bounds: { x: 1920, y: 0, width: 2560, height: 1440 } }
      ])
      resolveOk()
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'screen', displayId: 102 })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('-x')
      expect(args[1]).toBe('-R')
      expect(args[2]).toBe('1920,0,2560,1440')
      expect(args[3]).toMatch(screenshotPathRx())
      // Never use the unreliable `-D` index flag (#164 F[14]).
      expect(args).not.toContain('-D')
    })

    it('captureScreen falls back to no `-R` flag when displayId not found', async () => {
      resolveOk()
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'screen', displayId: 999 })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args).not.toContain('-R')
      expect(args).not.toContain('-D')
    })

    it('window-native uses -x -o -i -w (#164 round-2 D4)', async () => {
      resolveOk()
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'window-native' })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.slice(0, 4)).toEqual(['-x', '-o', '-i', '-w'])
      expect(args[4]).toMatch(screenshotPathRx())
    })

    it('rejects window mode (#164 round-2 D4 — Windows-only)', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({
        mode: 'window',
        windowId: 'window:42:0'
      })
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_NOT_SUPPORTED')
    })

    it('captureArea uses -x -i -s', async () => {
      resolveOk()
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'area' })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args.slice(0, 3)).toEqual(['-x', '-i', '-s'])
      expect(args[3]).toMatch(screenshotPathRx())
    })
  })

  describe('cancellation and error handling', () => {
    it('returns SCREENSHOT_CANCELLED when execFile succeeds but file is absent', async () => {
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockRejectedValue(new Error('ENOENT'))
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'window-native' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
    })

    it('returns SCREENSHOT_CANCELLED on exit code 1 + missing file', async () => {
      const err = new Error('Cancelled') as NodeJS.ErrnoException
      err.code = 1
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(err, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockRejectedValue(new Error('ENOENT'))
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'area' })

      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
    })

    it('returns SCREENSHOT_TIMEOUT when process is killed', async () => {
      const err = new Error('Timeout') as NodeJS.ErrnoException
      err.killed = true
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(err, '', '')
        return new EventEmitter() as ChildProcess
      })
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'screen' })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_TIMEOUT')
    })

    it('returns SCREENSHOT_PERMISSION_DENIED when stderr matches "cannot capture"', async () => {
      const err = new Error('Permission')
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(err, '', 'screencapture: cannot capture screen')
        return new EventEmitter() as ChildProcess
      })
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'screen' })

      expect(result.errorCode).toBe('SCREENSHOT_PERMISSION_DENIED')
    })

    it('returns SCREENSHOT_FAILED for unknown errors', async () => {
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(new Error('Disk full'), '', '')
        return new EventEmitter() as ChildProcess
      })
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'screen' })

      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
      expect(result.error).toBe('Disk full')
    })

    it('handles process error events', async () => {
      const procError = new Error('spawn failed')
      const child = new EventEmitter() as MockChildProcess
      child.killed = false
      // Defer the emit to the next microtask so production code can attach
      // its `child.on('error', ...)` listener first. Replaces a real 10ms
      // setTimeout that the Windows-host flake registry flagged — no timer,
      // no wall-clock dependency, no flake (#164 lens-review F[37]).
      mockExecFile.mockImplementation(() => {
        queueMicrotask(() => child.emit('error', procError))
        return child as ChildProcess
      })
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const result = await new MacScreenshotCapturer().capture({ mode: 'screen' })

      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
      expect(result.error).toBe('spawn failed')
    })
  })

  describe('temp file generation', () => {
    beforeEach(() => {
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    })

    it('generates path with prefix + timestamp + .png', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'screen' })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[args.length - 1]).toMatch(/erfana-screenshot-\d+\.png$/)
    })

    it('honours custom tmpdir', async () => {
      const custom = path.join(REAL_TMPDIR, 'custom')
      mockTmpdir.mockReturnValue(custom)
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'screen' })

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[args.length - 1]).toMatch(screenshotPathRx(custom))
    })
  })

  describe('security invariants', () => {
    beforeEach(() => {
      mockExecFile.mockImplementation((_p, _a, _o, cb) => {
        cb(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    })

    it('uses execFile with absolute binary path', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'screen' })

      expect(mockExecFile.mock.calls[0][0]).toBe('/usr/sbin/screencapture')
    })

    it('passes 30s timeout to execFile', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'screen' })

      const opts = mockExecFile.mock.calls[0][2] as { timeout: number }
      expect(opts.timeout).toBe(30_000)
    })

    it('every argv element is a known string (no user interpolation)', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      await new MacScreenshotCapturer().capture({ mode: 'window-native' })

      const args = mockExecFile.mock.calls[0][1] as string[]
      const fixed = args.slice(0, 4)
      expect(fixed).toEqual(['-x', '-o', '-i', '-w'])
      expect(args[4]).toMatch(screenshotPathRx())
    })
  })

  // Display enumeration was moved from the capturer to `sharedHelpers.listDisplays`
  // in #164 Phase 3 (lens-review F[30]). See `sharedHelpers.test.ts` for those tests.

  describe('enumerateWindowsRaw', () => {
    it('returns empty list (macOS uses native picker)', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')

      const sources = await new MacScreenshotCapturer().enumerateWindowsRaw()

      expect(sources).toEqual([])
    })
  })

  describe('getCapabilities', () => {
    it('reports native picker + native area mode (#164 round-2 F#6)', async () => {
      const { MacScreenshotCapturer } = await import('./MacScreenshotCapturer')
      expect(new MacScreenshotCapturer().getCapabilities()).toEqual({
        supported: true,
        hasNativeWindowPicker: true,
        areaCaptureMode: 'native'
      })
    })
  })
})

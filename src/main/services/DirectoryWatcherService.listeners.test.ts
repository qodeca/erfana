// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Chokidar listener registration tests for DirectoryWatcherService.
 *
 * The existing pipeline + main test files inject fake watcher state directly
 * into `watchedDirectories` and never exercise the real `chokidar.watch` path.
 * Without this file, a typo in `'change'` or accidental removal of the
 * listener at `DirectoryWatcherService.ts:265-271` would pass CI green —
 * which is what allowed the original PR #241 bug to ship.
 *
 * Closes lens-review Finding 1. Also covers Finding 7 (`.git/` filter).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture every `watcher.on(event, handler)` call so tests can inspect
// registrations and invoke captured handlers.
const onSpy = vi.fn()
const fakeWatcher = {
  on: onSpy,
  close: vi.fn(async () => {})
}

vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => fakeWatcher) },
  watch: vi.fn(() => fakeWatcher)
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

vi.mock('./SettingsService', () => ({
  settingsService: {
    getDirectoryWatchDepth: vi.fn(async () => undefined)
  }
}))

vi.mock('../utils/pathSecurity', () => ({
  isSystemDirectory: vi.fn(() => false)
}))

vi.mock('./LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

const fakeWebContents = { id: 1 } as unknown as Electron.WebContents

/**
 * Returns the captured handler for a given chokidar event name, or undefined
 * if it was not registered. Lets tests assert on registration AND invoke the
 * handler to verify routing without firing actual filesystem events.
 */
function captureHandler(event: string): ((path: string) => void) | undefined {
  const call = onSpy.mock.calls.find((c) => c[0] === event)
  return call?.[1]
}

describe('DirectoryWatcherService chokidar listener registration', () => {
  beforeEach(async () => {
    onSpy.mockClear()
    // Reset singleton state between tests so each watchDirectory call goes
    // through the real registration path rather than the already-watching
    // short-circuit at DirectoryWatcherService.ts:177.
    const { directoryWatcherService } = await import('./DirectoryWatcherService')
    const svc = directoryWatcherService as unknown as {
      watchedDirectories: Map<string, unknown>
      pendingRestarts: Map<string, NodeJS.Timeout>
      restartAttempts: Map<string, number>
    }
    for (const timeout of svc.pendingRestarts.values()) clearTimeout(timeout)
    svc.pendingRestarts.clear()
    svc.restartAttempts.clear()
    svc.watchedDirectories.clear()
  })

  it('registers handlers for add, addDir, unlink, unlinkDir, and change', async () => {
    const { directoryWatcherService } = await import('./DirectoryWatcherService')
    await directoryWatcherService.watchDirectory('/proj', fakeWebContents)

    const registeredEvents = onSpy.mock.calls.map((call) => call[0])
    expect(registeredEvents).toEqual(
      expect.arrayContaining(['add', 'addDir', 'unlink', 'unlinkDir', 'change'])
    )
  })

  it('routes a chokidar change event into queueEvent (regression guard for PR #241)', async () => {
    const { directoryWatcherService } = await import('./DirectoryWatcherService')
    const queueSpy = vi.spyOn(
      directoryWatcherService as unknown as { queueEvent: (...args: unknown[]) => void },
      'queueEvent'
    )
    await directoryWatcherService.watchDirectory('/proj', fakeWebContents)

    const changeHandler = captureHandler('change')
    expect(changeHandler).toBeDefined()
    changeHandler!('/proj/notes.md')

    expect(queueSpy).toHaveBeenCalledWith('/proj', {
      type: 'change',
      path: '/proj/notes.md'
    })
  })

  it('suppresses change events for .git/ paths (lens-review Finding 7)', async () => {
    const { directoryWatcherService } = await import('./DirectoryWatcherService')
    const queueSpy = vi.spyOn(
      directoryWatcherService as unknown as { queueEvent: (...args: unknown[]) => void },
      'queueEvent'
    )
    await directoryWatcherService.watchDirectory('/proj', fakeWebContents)

    const changeHandler = captureHandler('change')
    expect(changeHandler).toBeDefined()

    // POSIX-style path
    changeHandler!('/proj/.git/index')
    // Windows-style path
    changeHandler!('C:\\proj\\.git\\HEAD')

    expect(queueSpy).not.toHaveBeenCalled()
  })

  it('routes a non-.git change to queueEvent even when the path string contains "git" elsewhere', async () => {
    // Defensive: ensure the `.git/` filter is path-component-aware (not a bare
    // substring match on "git") so legitimate files like `usage-git.md` or a
    // `gitignore-helper.ts` still flow through.
    const { directoryWatcherService } = await import('./DirectoryWatcherService')
    const queueSpy = vi.spyOn(
      directoryWatcherService as unknown as { queueEvent: (...args: unknown[]) => void },
      'queueEvent'
    )
    await directoryWatcherService.watchDirectory('/proj', fakeWebContents)

    const changeHandler = captureHandler('change')
    changeHandler!('/proj/docs/git-status.md')

    expect(queueSpy).toHaveBeenCalledWith('/proj', {
      type: 'change',
      path: '/proj/docs/git-status.md'
    })
  })
})

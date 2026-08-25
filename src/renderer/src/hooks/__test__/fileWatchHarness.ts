// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared test harness for the {@link useFileChangeSubscription} suites.
 *
 * The hook's tests are split by concern across four files (lifecycle, degraded
 * states, deletion and recovery, watch-slot balance). All four need the same
 * environment: a fake `window.api.fileWatch` whose listeners the test drives by
 * hand, a fake `file.getStats`, and the verbatim error strings the main process
 * produces. This module owns that scaffolding so the split files stay small and
 * cannot drift apart.
 *
 * @module hooks/__test__/fileWatchHarness
 * @see useFileChangeSubscription.test.ts for the lifecycle baseline
 */

import { vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook, type RenderHookResult } from '@testing-library/react'

import {
  useFileChangeSubscription,
  type UseFileChangeSubscriptionResult
} from '../useFileChangeSubscription'

/** The path every suite watches unless it says otherwise. */
export const WATCHED_PATH = '/proj/icon.png'

/** A second path, used to prove events for other files are ignored. */
export const OTHER_PATH = '/proj/other.png'

/** Verbatim cap error from `FileWatcherService.watchFile` (the only 'limit' evidence). */
export const CAP_ERROR = 'Maximum watched files limit reached (100)'

/** A non-cap `start` failure: the atomic-save re-arm ended the watch mid-join. */
export const JOIN_ERROR = `File watch ended while joining: ${WATCHED_PATH}`

type WatchCallback = (data: { filePath: string }) => void
type WatchErrorCallback = (data: { filePath: string; error: string }) => void

/** The fake `window.api.fileWatch` bridge. */
export interface MockFileWatch {
  start: Mock
  stop: Mock
  pause: Mock
  resume: Mock
  onFileChanged: Mock
  onFileDeleted: Mock
  onFileError: Mock
}

/** How many listeners are currently registered on each watcher event. */
export interface ListenerCounts {
  changed: number
  deleted: number
  error: number
}

/** Handles returned by {@link installFileWatchHarness}. */
export interface FileWatchHarness {
  /** Fake `window.api.fileWatch` bridge. */
  fileWatch: MockFileWatch
  /** Fake `window.api.file.getStats`, the disk re-check behind a delete event. */
  getStats: Mock<(path: string) => Promise<{ size: number }>>
  /** Emits a watcher `changed` event to every subscribed listener. */
  emitChanged: (filePath: string) => void
  /** Emits a watcher `deleted` event to every subscribed listener. */
  emitDeleted: (filePath: string) => void
  /** Emits a watcher `error` event to every subscribed listener. */
  emitError: (filePath: string, error: string) => void
  /** Live listener counts, so teardown can be asserted rather than assumed. */
  listenerCounts: () => ListenerCounts
}

/**
 * Installs the shared file-watch test environment.
 *
 * Call once at module scope in a test file; it registers its own `beforeEach`
 * and `afterEach`, so every test gets a clean watcher and clean mocks. The
 * returned handles are stable across tests – capture them once and use them
 * inside `it` blocks.
 *
 * @returns The mock bridge, the watcher emitters and the listener counters
 *
 * @example
 * ```ts
 * const h = installFileWatchHarness()
 *
 * it('reports a change', async () => {
 *   const onExternalChange = vi.fn()
 *   renderSubscription(WATCHED_PATH, onExternalChange)
 *   await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())
 *
 *   h.emitChanged(WATCHED_PATH)
 *
 *   expect(onExternalChange).toHaveBeenCalledTimes(1)
 * })
 * ```
 */
export function installFileWatchHarness(): FileWatchHarness {
  let changedListeners: WatchCallback[] = []
  let deletedListeners: WatchCallback[] = []
  let errorListeners: WatchErrorCallback[] = []

  const getStats = vi.fn<(path: string) => Promise<{ size: number }>>()

  const fileWatch: MockFileWatch = {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onFileChanged: vi.fn((cb: WatchCallback) => {
      changedListeners.push(cb)
      return () => {
        changedListeners = changedListeners.filter((l) => l !== cb)
      }
    }),
    onFileDeleted: vi.fn((cb: WatchCallback) => {
      deletedListeners.push(cb)
      return () => {
        deletedListeners = deletedListeners.filter((l) => l !== cb)
      }
    }),
    onFileError: vi.fn((cb: WatchErrorCallback) => {
      errorListeners.push(cb)
      return () => {
        errorListeners = errorListeners.filter((l) => l !== cb)
      }
    })
  }

  beforeEach(() => {
    changedListeners = []
    deletedListeners = []
    errorListeners = []

    fileWatch.start.mockReset().mockResolvedValue({ success: true })
    fileWatch.stop.mockReset().mockResolvedValue({ success: true })
    fileWatch.pause.mockReset()
    fileWatch.resume.mockReset()
    fileWatch.onFileChanged.mockClear()
    fileWatch.onFileDeleted.mockClear()
    fileWatch.onFileError.mockClear()
    getStats.mockReset().mockResolvedValue({ size: 1024 })

    // NOTE: extend `window`, never `vi.stubGlobal('window', …)` – replacing the
    // window object destroys React's DOM internals.
    ;(window as unknown as { api: unknown }).api = {
      file: { getStats },
      fileWatch
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Fans an event out to a snapshot of the listeners, inside `act`. */
  const emit = <T>(listeners: ((data: T) => void)[], data: T): void => {
    act(() => {
      for (const listener of [...listeners]) listener(data)
    })
  }

  return {
    fileWatch,
    getStats,
    emitChanged: (filePath) => emit(changedListeners, { filePath }),
    emitDeleted: (filePath) => emit(deletedListeners, { filePath }),
    emitError: (filePath, error) => emit(errorListeners, { filePath, error }),
    listenerCounts: () => ({
      changed: changedListeners.length,
      deleted: deletedListeners.length,
      error: errorListeners.length
    })
  }
}

/**
 * Renders {@link useFileChangeSubscription} with the usual arguments.
 *
 * Most tests care about the watch, not about the change callback, so it
 * defaults to a throwaway spy.
 *
 * @param filePath - Path to subscribe to
 * @param onExternalChange - Change callback; defaults to a fresh spy
 * @returns The `renderHook` result for the subscription
 */
export function renderSubscription(
  filePath: string = WATCHED_PATH,
  onExternalChange: () => void = vi.fn()
): RenderHookResult<UseFileChangeSubscriptionResult, unknown> {
  return renderHook(() => useFileChangeSubscription(filePath, { onExternalChange }))
}

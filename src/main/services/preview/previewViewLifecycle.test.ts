// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * previewViewLifecycle tests (Issue #74, work item 39; design §0/§1.3).
 *
 * Focus: the `console-message` wiring. A page's error-level console output must
 * flow through `classifyConsoleMessage` and reach `onConsoleMessage` as a
 * failure input (uncaught exceptions ⇒ `script-error`, bad ES-module specifiers
 * ⇒ `unresolved-specifier`), and the listener must detach on `dispose`.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  wirePreviewLifecycle,
  type PreviewFileWatcherHandle,
  type PreviewLifecycleHooks,
  type PreviewLifecycleParams
} from './previewViewLifecycle'
import type { PreviewWebContentsHandle } from './PreviewSessionFactory'

/** A WebContents test double that records listeners keyed by event name. */
function makeWebContents(): {
  wc: PreviewWebContentsHandle
  emit: (event: string, ...args: unknown[]) => void
  hasListener: (event: string) => boolean
} {
  const listeners = new Map<string, Set<(...args: never[]) => void>>()
  const wc = {
    setWindowOpenHandler: vi.fn(),
    on: (event: string, listener: (...args: never[]) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    once: vi.fn(),
    removeListener: (event: string, listener: (...args: never[]) => void) => {
      listeners.get(event)?.delete(listener)
    }
  } as unknown as PreviewWebContentsHandle
  return {
    wc,
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) {
        ;(listener as (...a: unknown[]) => void)(...args)
      }
    },
    hasListener: (event) => (listeners.get(event)?.size ?? 0) > 0
  }
}

function makeHooks(): PreviewLifecycleHooks {
  return {
    onRenderProcessGone: vi.fn(),
    onUnresponsive: vi.fn(),
    onDidFinishLoad: vi.fn(),
    onEntryChange: vi.fn(),
    onEntryDeleted: vi.fn(),
    onForwardedShortcut: vi.fn(),
    onConsoleMessage: vi.fn()
  }
}

function makeParams(wc: PreviewWebContentsHandle): PreviewLifecycleParams {
  const watcher: PreviewFileWatcherHandle = { close: vi.fn().mockResolvedValue(undefined) }
  return {
    webContents: wc,
    entryFilePath: '/project/index.html',
    createEntryWatcher: () => watcher,
    platform: 'darwin'
  }
}

/** Electron 39 `console-message` details (level is the STRING severity). */
function consoleDetails(overrides: {
  level?: 'info' | 'warning' | 'error' | 'debug'
  message?: string
  sourceId?: string
}): { level: 'info' | 'warning' | 'error' | 'debug'; message: string; sourceId: string } {
  return {
    level: overrides.level ?? 'error',
    message: overrides.message ?? '',
    sourceId: overrides.sourceId ?? 'erfana-preview://project/index.html'
  }
}

describe('wirePreviewLifecycle console-message wiring', () => {
  it('routes an uncaught page exception to onConsoleMessage as a script-error', () => {
    const { wc, emit } = makeWebContents()
    const hooks = makeHooks()
    wirePreviewLifecycle(makeParams(wc), hooks)

    emit('console-message', consoleDetails({ message: 'Uncaught TypeError: x is not a function' }))

    expect(hooks.onConsoleMessage).toHaveBeenCalledTimes(1)
    expect(hooks.onConsoleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'script-error',
        resourceUrlOrHost: 'Uncaught TypeError: x is not a function'
      })
    )
  })

  it('routes a failed module specifier to onConsoleMessage as unresolved-specifier', () => {
    const { wc, emit } = makeWebContents()
    const hooks = makeHooks()
    wirePreviewLifecycle(makeParams(wc), hooks)

    emit(
      'console-message',
      consoleDetails({ message: 'Failed to resolve module specifier "lodash". …' })
    )

    expect(hooks.onConsoleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'unresolved-specifier', resourceUrlOrHost: 'lodash' })
    )
  })

  it('ignores non-error console levels and unclassified error messages', () => {
    const { wc, emit } = makeWebContents()
    const hooks = makeHooks()
    wirePreviewLifecycle(makeParams(wc), hooks)

    // Warning-level "Uncaught" text is below the error threshold.
    emit('console-message', consoleDetails({ level: 'warning', message: 'Uncaught noise' }))
    // Error level, but not a class Erfana surfaces.
    emit('console-message', consoleDetails({ level: 'error', message: 'plain error log' }))

    expect(hooks.onConsoleMessage).not.toHaveBeenCalled()
  })

  it('detaches the console-message listener on dispose', async () => {
    const { wc, emit, hasListener } = makeWebContents()
    const hooks = makeHooks()
    const lifecycle = wirePreviewLifecycle(makeParams(wc), hooks)

    expect(hasListener('console-message')).toBe(true)
    await lifecycle.dispose()
    expect(hasListener('console-message')).toBe(false)

    emit('console-message', consoleDetails({ message: 'Uncaught after dispose' }))
    expect(hooks.onConsoleMessage).not.toHaveBeenCalled()
  })
})

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
import { PREVIEW_PAGE_CSP_VIOLATION_CHANNEL } from './previewCspViolationBridge'

/** A WebContents test double that records listeners keyed by event name. */
/** The object the fake uses as its top-level frame identity. */
const MAIN_FRAME = { id: 'main-frame' }

function makeWebContents(): {
  wc: PreviewWebContentsHandle
  emit: (event: string, ...args: unknown[]) => void
  hasListener: (event: string) => boolean
  /** Deliver a payload on a WebContents-scoped channel, as the preload would. */
  emitIpc: (channel: string, event: unknown, payload: unknown) => void
  hasIpcListener: (channel: string) => boolean
} {
  const listeners = new Map<string, Set<(...args: never[]) => void>>()
  const ipcListeners = new Map<string, Set<(...args: never[]) => void>>()
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
    },
    // WebContents-scoped IPC, deliberately not `mainFrame.ipc`: a WebFrameMain
    // is replaced when a navigated page replaces it (sd-074b §5.3).
    mainFrame: MAIN_FRAME,
    ipc: {
      on: (channel: string, listener: (...args: never[]) => void) => {
        const set = ipcListeners.get(channel) ?? new Set()
        set.add(listener)
        ipcListeners.set(channel, set)
      },
      removeListener: (channel: string, listener: (...args: never[]) => void) => {
        ipcListeners.get(channel)?.delete(listener)
      }
    }
  } as unknown as PreviewWebContentsHandle
  return {
    wc,
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) {
        ;(listener as (...a: unknown[]) => void)(...args)
      }
    },
    hasListener: (event) => (listeners.get(event)?.size ?? 0) > 0,
    emitIpc: (channel, event, payload) => {
      for (const listener of ipcListeners.get(channel) ?? []) {
        ;(listener as (...a: unknown[]) => void)(event, payload)
      }
    },
    hasIpcListener: (channel) => (ipcListeners.get(channel)?.size ?? 0) > 0
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
    onConsoleMessage: vi.fn(),
    onCspViolation: vi.fn()
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

describe('wirePreviewLifecycle CSP-violation wiring', () => {
  // This channel is the ONLY route by which a host refused by the page's CSP
  // becomes approvable. Chromium enforces a CSP in the renderer, before the
  // request reaches `onBeforeRequest`, so the network filter — the thing that
  // raises the Approve prompt — never sees an unapproved host. Without this
  // wiring the bridge is fully unit-tested and completely disconnected, and a
  // project with an empty allowlist has no route to approving anything.

  it('routes a violation payload from the page to onCspViolation', () => {
    const { wc, emitIpc } = makeWebContents()
    const hooks = makeHooks()
    wirePreviewLifecycle(makeParams(wc), hooks)

    const payload = { blockedURI: 'https://cdn.example.com/a.js', effectiveDirective: 'script-src' }
    emitIpc(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL, { senderFrame: MAIN_FRAME }, payload)

    expect(hooks.onCspViolation).toHaveBeenCalledWith(payload)
  })

  it('ignores a violation reported by a sub-frame', () => {
    // A sub-frame does not speak for the page. Same gate as the link channel.
    //
    // The main-frame half is here on purpose. "Not called" is the state of a
    // harness where NOTHING is wired, so a sub-frame-only assertion passes
    // against code that never registered the listener at all — it would prove
    // the gate while the channel was dead. Proving the listener is live in the
    // same test is what makes the rejection mean something.
    const { wc, emitIpc } = makeWebContents()
    const hooks = makeHooks()
    wirePreviewLifecycle(makeParams(wc), hooks)
    const payload = { blockedURI: 'https://cdn.example.com/a.js', effectiveDirective: 'script-src' }

    emitIpc(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL, { senderFrame: { id: 'some-iframe' } }, payload)
    expect(hooks.onCspViolation).not.toHaveBeenCalled()

    emitIpc(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL, { senderFrame: MAIN_FRAME }, payload)
    expect(hooks.onCspViolation).toHaveBeenCalledTimes(1)
  })

  it('detaches the violation listener on dispose', async () => {
    const { wc, emitIpc, hasIpcListener } = makeWebContents()
    const hooks = makeHooks()
    const lifecycle = wirePreviewLifecycle(makeParams(wc), hooks)

    expect(hasIpcListener(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL)).toBe(true)
    await lifecycle.dispose()
    expect(hasIpcListener(PREVIEW_PAGE_CSP_VIOLATION_CHANNEL)).toBe(false)

    emitIpc(
      PREVIEW_PAGE_CSP_VIOLATION_CHANNEL,
      { senderFrame: MAIN_FRAME },
      { blockedURI: 'https://cdn.example.com/a.js', effectiveDirective: 'script-src' }
    )
    expect(hooks.onCspViolation).not.toHaveBeenCalled()
  })
})

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

// =============================================================================
// Navigation denies (sd-074b §2)
//
// These two lines are the ONLY thing stopping a previewed page from navigating
// itself. The design originally credited the CSP sandbox as a second,
// independent lock, but the sandboxed-navigation flag only prevents navigating
// OTHER browsing contexts — a top-level document under `CSP: sandbox` may still
// navigate its own. They were untested until now.
// =============================================================================

describe('wirePreviewLifecycle navigation guards', () => {
  it('cancels every same-tab navigation the page attempts', () => {
    const { wc, emit } = makeWebContents()
    wirePreviewLifecycle(makeParams(wc), makeHooks())

    const event = { preventDefault: vi.fn() }
    emit('will-navigate', event, 'https://example.com/')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-project navigation too, not just remote ones', () => {
    const { wc, emit } = makeWebContents()
    wirePreviewLifecycle(makeParams(wc), makeHooks())

    const event = { preventDefault: vi.fn() }
    emit('will-navigate', event, 'erfana-preview://token/other.html')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('denies every window-open request', () => {
    const { wc } = makeWebContents()
    wirePreviewLifecycle(makeParams(wc), makeHooks())

    const setWindowOpenHandler = wc.setWindowOpenHandler as unknown as ReturnType<typeof vi.fn>
    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1)

    const handler = setWindowOpenHandler.mock.calls[0][0] as (details: unknown) => unknown
    expect(handler({ url: 'https://example.com/', disposition: 'foreground-tab' })).toEqual({
      action: 'deny'
    })
  })

  it('stops cancelling once disposed', async () => {
    const { wc, emit, hasListener } = makeWebContents()
    const lifecycle = wirePreviewLifecycle(makeParams(wc), makeHooks())

    await lifecycle.dispose()

    expect(hasListener('will-navigate')).toBe(false)
    const event = { preventDefault: vi.fn() }
    emit('will-navigate', event, 'https://example.com/')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

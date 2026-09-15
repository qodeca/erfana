// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared harness for the `previewPageNavigator*.test.ts` files (issue #124,
 * WI-17b). The suite is split by topic (docs/windows/contributing.md
 * § "Test-file split policy"); both parts drive the real navigator over the
 * real `previewLivePage`, fed by fake Electron events in the orders spikes S15
 * and S16 measured on Electron 39.8.10.
 *
 * Plain values and builders; there is no `vi.mock()` here.
 */
import { posix } from 'node:path'
import { vi } from 'vitest'

import type { PreviewPageChange, PreviewPageTarget } from '../../../../shared/ipc/preview-types'
import { createPreviewLivePage, type PreviewLivePageDeps } from '../previewLivePage'
import { createPreviewPageNavigator, type PreviewNativeHistory } from '../previewPageNavigator'
import { createTabHistory, pushEntry, type PreviewTabHistory } from '../previewTabHistory'
import { buildPreviewUrl } from '../previewUrl'

export const TOKEN = '0123456789abcdef0123456789abcdef'
export const PANEL_ID = 'panel-A'
export const ROOT = '/proj'
export const A = '/proj/a.html'
export const B = '/proj/b.html'
export const C = '/proj/c.html'
export const urlFor = (absPath: string): string => buildPreviewUrl(TOKEN, ROOT, absPath, posix)
export const at = (filePath: string, anchor: string | null = null): PreviewPageTarget => ({
  filePath,
  anchor
})
/** A load call that neither resolves nor rejects, like `loadURL` before the commit. */
const never = (): Promise<void> => new Promise<void>(() => {})

type Listener = (...args: unknown[]) => void

export interface NavigatorHarnessOptions {
  /** The history the view opens with; a one-entry list on A by default. */
  readonly initialHistory?: PreviewTabHistory
  /** What the panel store holds before the view is built. */
  readonly stored?: PreviewTabHistory | null
  readonly initialSameDocument?: boolean
  /** The page the view shows first; the first entry's file by default. */
  readonly page?: string
  readonly native?: PreviewNativeHistory
  /**
   * Whether real input reached the view just now (QG-7 S1). `true` by default,
   * so an in-page step is pushed; `false` puts it in place of the current entry.
   */
  readonly gesture?: boolean
  /**
   * Whether taking the gesture spends it, as the freshness watch does (QG-8 T1):
   * then only the first in-page step after it – or after `setGesture(true)` – is
   * pushed. `false` by default, so a push test may take several steps.
   */
  readonly spendGesture?: boolean
}

/** The navigator of one view, its page, its panel store and the contents' events. */
export function makeHarness(options: NavigatorHarnessOptions = {}) {
  const listeners = new Map<string, Set<Listener>>()
  const contents = {
    on: (event: string, listener: Listener) => {
      listeners.set(event, (listeners.get(event) ?? new Set<Listener>()).add(listener))
    },
    removeListener: (event: string, listener: Listener) => listeners.get(event)?.delete(listener)
  }
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args)
    }
  }
  const initialHistory = options.initialHistory ?? createTabHistory(at(A))
  let stored: PreviewTabHistory | null = options.stored ?? null
  const store = {
    get: vi.fn(() => stored),
    set: vi.fn((next: PreviewTabHistory) => {
      stored = next
    })
  }
  let defunct = false
  let gesture = options.gesture ?? true
  const page = createPreviewLivePage({
    panelId: PANEL_ID,
    contents: contents as unknown as PreviewLivePageDeps['contents'],
    pageScopes: { beginPending: vi.fn(), commit: vi.fn(), dropPending: vi.fn() },
    initialPage: options.page ?? initialHistory.entries[initialHistory.index].filePath,
    urlFor,
    onOutcome: (end) => navigator.loadEnded(end),
    onInPageStep: (url) => navigator.inPageStep(url)
  })
  const emitPageChanged = vi.fn<(change: PreviewPageChange) => void>()
  const loadUrl = vi.fn<(url: string) => Promise<unknown>>(never)
  const onMoveStarted = vi.fn<() => void>()
  const navigator = createPreviewPageNavigator({
    panelId: PANEL_ID,
    page,
    navigation: {
      history: store,
      initialHistory,
      initialSameDocument: options.initialSameDocument ?? true
    },
    urlFor,
    loadUrl,
    nativeHistory: () => options.native ?? null,
    emitPageChanged,
    onMoveStarted,
    takeRecentGesture: () => {
      const taken = gesture
      if (options.spendGesture === true) {
        gesture = false
      }
      return taken
    },
    isDefunct: () => defunct
  })
  const fire = {
    didNavigate: (url: string, status = 200) => emit('did-navigate', {}, url, status, 'OK'),
    inPage: (url: string, isMainFrame = true) =>
      emit('did-navigate-in-page', {}, url, isMainFrame, 1, 1),
    stopLoading: () => emit('did-stop-loading'),
    failLoad: (url: string) => emit('did-fail-load', {}, -3, 'ERR_ABORTED', url, true, 1, 1),
    startNavigation: (url: string) => emit('did-start-navigation', { url, isMainFrame: true })
  }
  return {
    navigator,
    page,
    store,
    history: () => stored,
    emitPageChanged,
    loadUrl,
    onMoveStarted,
    fire,
    setDefunct: (value: boolean) => {
      defunct = value
    },
    setGesture: (value: boolean) => {
      gesture = value
    }
  }
}

/** On B, with Back to A. */
export const onB = (): PreviewTabHistory => pushEntry(createTabHistory(at(A)), at(B))

/** A native history over `urls`, active on `active` (the last by default). */
export function nativeOf(urls: readonly string[], active = urls.length - 1) {
  return {
    getActiveIndex: vi.fn(() => active),
    getEntryAtIndex: vi.fn((index: number) =>
      urls[index] === undefined ? null : { url: urls[index] }
    ),
    goToIndex: vi.fn<(index: number) => void>()
  }
}

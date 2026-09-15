// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared test harness for the {@link HtmlPreviewPanel} suites.
 *
 * The panel's tests are split by concern (issue #124, 500-line cap): views and
 * lifecycle in `HtmlPreviewPanel.test.tsx`, the event feed in
 * `HtmlPreviewPanel.events.test.tsx`, forwarded shortcuts in
 * `HtmlPreviewPanel.shortcuts.test.tsx`, same-tab moves in
 * `HtmlPreviewPanel.navigation.test.tsx`. They all need the same fake
 * `window.api.preview` bridge, whose listeners a test drives by hand, the same
 * dockview props and the same store resets. This module owns that scaffolding
 * so the split files cannot drift apart.
 *
 * The handles it returns are STABLE objects refilled in `beforeEach`, never
 * replaced, so a suite can destructure them once at module scope.
 *
 * Module mocks (the logger) are NOT here: `vi.mock` is hoisted per test file,
 * so each suite declares its own.
 *
 * @module HtmlPreviewPanel/__test__/panelHarness
 * @see ../../ImageViewerPanel/__test__/testUtils.tsx - the pattern this follows
 */

import { vi, beforeEach, afterEach, type Mock } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import type { HtmlPreviewPanelParams } from '../HtmlPreviewPanel'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { usePreviewTabStore } from '../../../../stores/usePreviewTabStore'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'
import { useSearchStore } from '../../../../stores/useSearchStore'
import { ErrorCode } from '../../../../../../shared/errors'
import type {
  PreviewPageChangedPayload,
  PreviewResizeHoldPayload
} from '../../../../../../shared/ipc/preview-navigation-schema'
import type {
  PreviewFailureListPayload,
  PreviewForwardedShortcut,
  PreviewAllowlistChangedPayload,
  PreviewHostBlockedPayload,
  PreviewLoadStatePayload,
  PreviewStillFramePayload,
  PreviewVisibilityAppliedPayload
} from '../../../../../../shared/ipc/preview-schema'

// NOTE: no local ResizeObserver stub. `tests/setup/setupTests.renderer.ts`
// installs one that records its callback; a second, divergent no-op here meant
// the two files silently disagreed about what an observer does.

const CONTAINER_BOX = { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }

/** Captured bridge event listeners so a test can drive main→renderer state. */
export interface Listeners {
  loadState: ((p: PreviewLoadStatePayload) => void) | null
  failures: ((p: PreviewFailureListPayload) => void) | null
  hostBlocked: ((p: PreviewHostBlockedPayload) => void) | null
  allowlist: ((p: PreviewAllowlistChangedPayload) => void) | null
  forwardedShortcut: ((p: PreviewForwardedShortcut) => void) | null
  pageChanged: ((p: PreviewPageChangedPayload) => void) | null
  /** The drag freeze's feed (issue #124, part 1 §1.5). */
  stillFrame: ((p: PreviewStillFramePayload) => void) | null
  visibilityApplied: ((p: PreviewVisibilityAppliedPayload) => void) | null
  resizeHold: ((p: PreviewResizeHoldPayload) => void) | null
}

/**
 * The fake `window.api.preview` bridge: EVERY member of the real bridge type,
 * as a mock.
 *
 * Derived from `Window['api']['preview']` on purpose (QG-8 TQ3). A hand-written
 * member list drifted silently: a method renamed or dropped in `src/preload`
 * left all five panel suites green while the app broke. Now a member the real
 * bridge no longer has, or one it gained and the fake lacks, is a type error
 * here — and the preload side pins the same list at runtime
 * (`src/preload/previewBridge.test.ts`, "exports exactly the members the
 * contract declares").
 */
export type MockPreview = {
  [Member in keyof Window['api']['preview']]: Mock
}

/** Handles returned by {@link installHtmlPreviewPanelHarness}. */
export interface HtmlPreviewPanelHarness {
  /** The listeners the panel registered on the fake bridge, by event. */
  listeners: Listeners
  /** The fake bridge; its members are fresh mocks in every test. */
  preview: MockPreview
  /** The container api's `addPanel` ("Open as source" lands here). */
  addPanel: Mock
  /**
   * Dockview props for a preview panel.
   *
   * @param filePath - The page the tab shows.
   * @param panelId - The panel id; `'preview-1'` by default.
   * @returns Props for `<HtmlPreviewPanel />`.
   */
  makeProps: (filePath: string, panelId?: string) => IDockviewPanelProps<HtmlPreviewPanelParams>
  /**
   * Makes every panel built by `makeProps` in this test active or inactive, as
   * dockview does on a tab switch: `api.isActive` is updated first, then each
   * `onDidActiveChange` listener fires (QG-11a Q16 – the active-tab gate).
   *
   * @param isActive - The tab's new active state.
   */
  activeChange: (isActive: boolean) => void
}

/**
 * Registers the per-test bridge, props and store resets for the calling suite.
 * Call once at module scope.
 *
 * @returns Stable handles, refilled before every test.
 */
export function installHtmlPreviewPanelHarness(): HtmlPreviewPanelHarness {
  const listeners: Listeners = {
    loadState: null,
    failures: null,
    hostBlocked: null,
    allowlist: null,
    forwardedShortcut: null,
    pageChanged: null,
    stillFrame: null,
    visibilityApplied: null,
    resizeHold: null
  }
  const preview = {} as MockPreview
  const addPanel = vi.fn()
  // Every api `makeProps` built this test, with the active-change listeners
  // still subscribed on it. Cleared in `beforeEach`.
  type ActiveListener = (event: { isActive: boolean }) => void
  const activeApis: Array<{ api: { isActive: boolean }; listeners: Set<ActiveListener> }> = []

  function makeProps(
    filePath: string,
    panelId = 'preview-1'
  ): IDockviewPanelProps<HtmlPreviewPanelParams> {
    const activeListeners = new Set<ActiveListener>()
    const api = {
      id: panelId,
      isVisible: true,
      isActive: true,
      title: undefined as string | undefined,
      close: vi.fn(),
      setTitle: vi.fn(),
      updateParameters: vi.fn(),
      onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidActiveChange: vi.fn((cb: ActiveListener) => {
        activeListeners.add(cb)
        return { dispose: vi.fn(() => activeListeners.delete(cb)) }
      })
    }
    activeApis.push({ api, listeners: activeListeners })
    const containerApi = {
      getPanel: vi.fn(() => undefined),
      addPanel
    }
    return { params: { filePath, panelId }, api, containerApi } as unknown as IDockviewPanelProps<HtmlPreviewPanelParams>
  }

  function activeChange(isActive: boolean): void {
    for (const entry of activeApis) {
      entry.api.isActive = isActive
      for (const cb of [...entry.listeners]) cb({ isActive })
    }
  }

  beforeEach(() => {
    activeApis.length = 0
    listeners.loadState = null
    listeners.failures = null
    listeners.hostBlocked = null
    listeners.allowlist = null
    listeners.forwardedShortcut = null
    listeners.pageChanged = null
    listeners.stillFrame = null
    listeners.visibilityApplied = null
    listeners.resizeHold = null
    addPanel.mockReset()
    addPanel.mockImplementation(() => ({ api: { setActive: vi.fn() }, group: { focus: vi.fn() } }))

    Object.assign(preview, {
      checkEligibility: vi.fn().mockResolvedValue({ eligible: true }),
      setVisibility: vi.fn(),
      open: vi.fn().mockResolvedValue({ ok: true }),
      close: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      setBounds: vi.fn(),
      find: vi.fn().mockResolvedValue(undefined),
      stopFind: vi.fn().mockResolvedValue(undefined),
      approveHost: vi.fn().mockResolvedValue({ ok: true, hosts: [] }),
      exportPdf: vi.fn().mockResolvedValue({ ok: true, path: '/out/page.pdf' }),
      onFindResult: vi.fn(() => vi.fn()),
      onLoadStateChanged: vi.fn((cb: (p: PreviewLoadStatePayload) => void) => {
        listeners.loadState = cb
        return vi.fn()
      }),
      onFailuresChanged: vi.fn((cb: (p: PreviewFailureListPayload) => void) => {
        listeners.failures = cb
        return vi.fn()
      }),
      onBackdropChanged: vi.fn(() => vi.fn()),
      onStillFrameChanged: vi.fn((cb: (p: PreviewStillFramePayload) => void) => {
        listeners.stillFrame = cb
        return vi.fn()
      }),
      onHostBlocked: vi.fn((cb: (p: PreviewHostBlockedPayload) => void) => {
        listeners.hostBlocked = cb
        return vi.fn()
      }),
      onAllowlistChanged: vi.fn((cb: (p: PreviewAllowlistChangedPayload) => void) => {
        listeners.allowlist = cb
        return vi.fn()
      }),
      onBoundsApplied: vi.fn(() => vi.fn()),
      onVisibilityApplied: vi.fn((cb: (p: PreviewVisibilityAppliedPayload) => void) => {
        listeners.visibilityApplied = cb
        return vi.fn()
      }),
      onForwardedShortcut: vi.fn((cb: (p: PreviewForwardedShortcut) => void) => {
        listeners.forwardedShortcut = cb
        return vi.fn()
      }),
      // Issue #124: a same-tab move. Driven here by the navigation suite, and in
      // EditorAreaSplitPanel.previewBoundary.test.tsx, which renders this panel
      // inside its real boundary wrapper.
      onPageChanged: vi.fn((cb: (p: PreviewPageChangedPayload) => void) => {
        listeners.pageChanged = cb
        return vi.fn()
      }),
      // Issue #124: a window-edge resize hold, driven by the drag-freeze cases.
      onResizeHold: vi.fn((cb: (p: PreviewResizeHoldPayload) => void) => {
        listeners.resizeHold = cb
        return vi.fn()
      }),
      // The link router's bridge members, for a suite that mounts the real one.
      // A move nobody scripted is "not ready", never an accidental success.
      navigate: vi
        .fn()
        .mockResolvedValue({ ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }),
      onOpenFileRequested: vi.fn(() => vi.fn()),
      // Issue #124, QG-8 U1: the keyboard route into the page. A press nobody
      // scripted is a refusal, so focus never lands anywhere by accident.
      focusPage: vi.fn().mockResolvedValue({ ok: false })
    } satisfies MockPreview & Window['api']['preview'])

    ;(window as unknown as { api: unknown }).api = { preview }

    Element.prototype.getBoundingClientRect = vi.fn(
      () => CONTAINER_BOX as DOMRect
    ) as unknown as typeof Element.prototype.getBoundingClientRect
  })

  afterEach(() => {
    cleanup()
    usePreviewStore.getState().reset()
    usePreviewTabStore.getState().reset()
    // Seeded by the published-rect cases; a leaked rect would place the next
    // test's toasts around a preview that is not in that test at all.
    usePreviewViewportStore.setState({ rects: new Map() })
    useSearchStore.getState().resetSearch()
    vi.clearAllMocks()
  })

  return { listeners, preview, addPanel, makeProps, activeChange }
}

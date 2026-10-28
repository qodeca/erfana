// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewNavigation} and {@link failedBannerNavigation}
 * (issue #124, part 3 §3.7, §3.8), with the link router stubbed. The panel-level
 * flows, with the real router and coordinator, are in
 * `HtmlPreviewPanel.navigation.test.tsx`.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview'

import { failedBannerNavigation, usePreviewNavigation, type UsePreviewNavigationOptions } from './usePreviewNavigation'
import type { PreviewFrameScheduler } from './usePreviewMoveAnnouncer'
import type { PreviewPageChangedPayload } from '../../../../../../shared/ipc/preview-navigation-schema'
import type { PreviewLinkRouter } from '../../../../services/preview/PreviewLinkRouter'
import type { PreviewMoveOutcome } from '../../../../services/preview/previewTabMove'
import {
  NO_PREVIEW_TAB,
  usePreviewTabStore,
  type PreviewTabState
} from '../../../../stores/usePreviewTabStore'

const router = vi.hoisted(() => ({ current: null as PreviewLinkRouter | null }))
vi.mock('../../../../services/preview/PreviewLinkRouter', () => ({
  getPreviewLinkRouter: () => router.current
}))

const OVERVIEW = { filePath: '/proj/overview.html', anchor: null }
const PRICING = { filePath: '/proj/pricing.html', anchor: null }

const tabWith = (partial: Partial<PreviewTabState>): PreviewTabState => ({ ...NO_PREVIEW_TAB, ...partial })

describe('failedBannerNavigation', () => {
  const moved = tabWith({
    canGoBack: true,
    backTarget: OVERVIEW,
    lastMove: { action: 'open', from: OVERVIEW, to: PRICING }
  })

  it('adds nothing outside the failed view', () => {
    expect(
      failedBannerNavigation({ view: 'normal', filePath: PRICING.filePath, tab: moved, failedPage: PRICING.filePath, ready: true })
    ).toEqual({ message: null, returnStep: null })
  })

  it('blames the move, and leads with Back, after an open onto a broken page', () => {
    expect(
      failedBannerNavigation({ view: 'failed', filePath: PRICING.filePath, tab: moved, failedPage: PRICING.filePath, ready: true })
    ).toEqual({
      message: 'pricing.html could not be shown – it may have been moved or deleted.',
      returnStep: { action: 'back', label: 'Back to overview.html', leads: true }
    })
  })

  it('offers "Return to" – a Forward – after a Back onto a broken page', () => {
    const tab = tabWith({
      canGoForward: true,
      forwardTarget: PRICING,
      lastMove: { action: 'back', from: PRICING, to: OVERVIEW }
    })
    expect(
      failedBannerNavigation({ view: 'failed', filePath: OVERVIEW.filePath, tab, failedPage: OVERVIEW.filePath, ready: true })
        .returnStep
    ).toEqual({ action: 'forward', label: 'Return to pricing.html', leads: true })
  })

  it('names the history target when the move did not know where it came from', () => {
    const tab = tabWith({ ...moved, lastMove: { action: 'open', from: null, to: PRICING } })
    expect(
      failedBannerNavigation({ view: 'failed', filePath: PRICING.filePath, tab, failedPage: PRICING.filePath, ready: true })
        .returnStep?.label
    ).toBe('Back to overview.html')
  })

  it.each([
    ['history cannot step', { ...moved, canGoBack: false }, true],
    ['no router exists', moved, false]
  ])('keeps the text but offers no button when %s', (_label, tab, ready) => {
    const result = failedBannerNavigation({ view: 'failed', filePath: PRICING.filePath, tab, failedPage: PRICING.filePath, ready })
    expect(result.message).toMatch(/could not be shown/)
    expect(result.returnStep).toBeNull()
  })

  it('does not blame a move for a later crash: Reload leads, Back follows', () => {
    expect(
      failedBannerNavigation({ view: 'failed', filePath: PRICING.filePath, tab: moved, failedPage: null, ready: true })
    ).toEqual({
      message: null,
      returnStep: { action: 'back', label: 'Back to overview.html', leads: false }
    })
  })

  it('does not blame a move that went somewhere else', () => {
    const tab = tabWith({ ...moved, lastMove: { action: 'open', from: OVERVIEW, to: { filePath: '/proj/x.html', anchor: null } } })
    expect(
      failedBannerNavigation({ view: 'failed', filePath: PRICING.filePath, tab, failedPage: PRICING.filePath, ready: true })
        .message
    ).toBeNull()
  })

  it('offers nothing for a first page that failed', () => {
    expect(
      failedBannerNavigation({ view: 'failed', filePath: PRICING.filePath, tab: NO_PREVIEW_TAB, failedPage: PRICING.filePath, ready: true })
    ).toEqual({ message: null, returnStep: null })
  })

  it('says "The page" when the tab has no file name', () => {
    const tab = tabWith({ ...moved, lastMove: { action: 'open', from: OVERVIEW, to: { filePath: '', anchor: null } } })
    expect(
      failedBannerNavigation({ view: 'failed', filePath: '', tab, failedPage: '', ready: true }).message
    ).toBe('The page could not be shown – it may have been moved or deleted.')
  })
})

describe('usePreviewNavigation', () => {
  let queue: Array<() => void> = []
  const schedule: PreviewFrameScheduler = (callback) => {
    queue.push(callback)
    return () => {
      queue = queue.filter((entry) => entry !== callback)
    }
  }
  const nextFrame = (): void => {
    const run = queue
    queue = []
    act(() => run.forEach((callback) => callback()))
  }
  const move = vi.fn<(request: unknown) => Promise<PreviewMoveOutcome>>()
  const getPanel = vi.fn()

  beforeEach(() => {
    queue = []
    move.mockReset().mockResolvedValue({ status: 'moved', target: OVERVIEW, closed: [] })
    getPanel.mockReset()
    router.current = { move, dispose: vi.fn() } as unknown as PreviewLinkRouter
    ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => 'darwin' } }
  })
  afterEach(() => {
    usePreviewTabStore.getState().reset()
    router.current = null
  })

  function renderNavigation(options: Partial<UsePreviewNavigationOptions> = {}) {
    return renderHook((props: Partial<UsePreviewNavigationOptions>) =>
      usePreviewNavigation({
        panelId: 'preview-1',
        filePath: PRICING.filePath,
        view: 'normal',
        containerApi: { getPanel } as unknown as Pick<DockviewApi, 'getPanel'>,
        schedule,
        ...options,
        ...props
      })
    , { initialProps: {} })
  }

  const setHistory = (partial: Partial<PreviewTabState>): void =>
    act(() =>
      usePreviewTabStore.getState().setHistory('preview-1', {
        canGoBack: false,
        canGoForward: false,
        backTarget: null,
        forwardTarget: null,
        generation: 1,
        ...partial
      })
    )

  const key = (overrides: Partial<React.KeyboardEvent<HTMLElement>> = {}) => {
    const preventDefault = vi.fn()
    const event = {
      type: 'keydown',
      code: 'BracketLeft',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault,
      ...overrides
    } as unknown as React.KeyboardEvent<HTMLElement>
    return { event, preventDefault }
  }

  it('does not ask the router when there is nowhere to go, or no router', async () => {
    const { result } = renderNavigation()
    await expect(result.current.step('back', 'chrome')).resolves.toBeNull()
    await expect(result.current.step('forward', 'page')).resolves.toBeNull()

    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    router.current = null
    await expect(result.current.step('back', 'chrome')).resolves.toBeNull()
    expect(move).not.toHaveBeenCalled()
  })

  it('moves the tab through the router, with who started it', async () => {
    setHistory({ canGoForward: true, forwardTarget: OVERVIEW })
    const { result } = renderNavigation()

    await act(() => result.current.step('forward', 'page'))
    expect(move).toHaveBeenCalledWith({ panelId: 'preview-1', origin: 'page', action: 'forward' })
  })

  it('takes Back and Forward keys from the chrome, and nothing else', () => {
    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    const { result } = renderNavigation()

    const back = key()
    act(() => result.current.onRootKeyDown(back.event))
    expect(back.preventDefault).toHaveBeenCalled()
    expect(move).toHaveBeenCalledWith({ panelId: 'preview-1', origin: 'chrome', action: 'back' })

    const other = key({ code: 'KeyB' })
    act(() => result.current.onRootKeyDown(other.event))
    expect(other.preventDefault).not.toHaveBeenCalled()

    const handled = key({ defaultPrevented: true })
    act(() => result.current.onRootKeyDown(handled.event))
    expect(handled.preventDefault).not.toHaveBeenCalled()
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('keeps the key even with nowhere to go, and stays silent', () => {
    const { result } = renderNavigation()
    const back = key()
    act(() => result.current.onRootKeyDown(back.event))
    expect(back.preventDefault).toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()
  })

  it('writes the link mode to the tab store', () => {
    const { result } = renderNavigation()
    act(() => result.current.controls.onLinkModeChange('same-tab'))
    expect(usePreviewTabStore.getState().getTab('preview-1').linkMode).toBe('same-tab')
    expect(result.current.controls.linkMode).toBe('same-tab')
    expect(result.current.controls.ready).toBe(true)
    expect(result.current.controls.platform).toBe('darwin')
  })

  it('ignores a second press of the return button while its move runs', async () => {
    let finish: (outcome: PreviewMoveOutcome) => void = () => {}
    move.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    const { result } = renderNavigation({ view: 'failed' })

    act(() => result.current.failedBanner.returnAction?.onAction())
    expect(result.current.failedBanner.returnAction?.isBusy).toBe(true)
    act(() => result.current.failedBanner.returnAction?.onAction())
    expect(move).toHaveBeenCalledTimes(1)

    await act(async () => finish({ status: 'refused', phase: 'check', reason: 'no-prompt' }))
    expect(result.current.failedBanner.returnAction?.isBusy).toBe(false)
  })

  it('moves no focus when the return move is refused', async () => {
    move.mockResolvedValue({ status: 'cancelled' })
    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    const { result, rerender } = renderNavigation({ view: 'failed' })

    await act(async () => result.current.failedBanner.returnAction?.onAction())
    rerender({ view: 'normal' })
    nextFrame()
    expect(getPanel).not.toHaveBeenCalled()
  })

  it('focuses Back once the band is back after a return move', async () => {
    const back = document.createElement('button')
    back.setAttribute('data-preview-nav', 'back')
    const element = document.createElement('div')
    element.appendChild(back)
    document.body.appendChild(element)
    getPanel.mockReturnValue({ view: { content: { element } } })
    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    const { result, rerender } = renderNavigation({ view: 'failed' })

    await act(async () => result.current.failedBanner.returnAction?.onAction())
    rerender({ view: 'normal' })
    nextFrame()
    expect(back).toHaveFocus()
    element.remove()
  })

  // Q24: a Back key pressed on the failed banner unmounts the banner under
  // focus, so it must take the return button's route and land focus on Back.
  it('focuses Back after a Back key pressed from the failed banner', async () => {
    const back = document.createElement('button')
    back.setAttribute('data-preview-nav', 'back')
    const element = document.createElement('div')
    element.appendChild(back)
    document.body.appendChild(element)
    getPanel.mockReturnValue({ view: { content: { element } } })
    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    const { result, rerender } = renderNavigation({ view: 'failed' })

    const keyDown = key()
    await act(async () => result.current.onRootKeyDown(keyDown.event))
    expect(keyDown.preventDefault).toHaveBeenCalled()
    expect(move).toHaveBeenCalledWith({ panelId: 'preview-1', origin: 'chrome', action: 'back' })

    rerender({ view: 'normal' })
    nextFrame()
    expect(back).toHaveFocus()
    element.remove()
  })

  it('moves no focus, and holds no announcement, when a banner Back key has nowhere to go', async () => {
    const { result, rerender } = renderNavigation({ view: 'failed' })

    const keyDown = key()
    await act(async () => result.current.onRootKeyDown(keyDown.event))
    expect(keyDown.preventDefault).toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()

    // The announcer is settled: a landed move's words still go out a frame later.
    act(() =>
      usePreviewTabStore.getState().setAnnouncement('preview-1', {
        origin: 'chrome',
        closedCount: 0,
        target: PRICING,
        focusMoved: false
      })
    )
    act(() =>
      result.current.onPageChanged({
        panelId: 'preview-1',
        ...PRICING,
        sameDocument: false,
        canGoBack: false,
        canGoForward: false,
        backTarget: null,
        forwardTarget: null,
        generation: 2,
        failed: false
      })
    )
    rerender({ view: 'normal' })
    nextFrame()
    expect(result.current.announcement).toBe('Showing pricing.html.')
    expect(getPanel).not.toHaveBeenCalled()
  })

  it('remembers a failed page and forgets the last move once one lands', () => {
    const { result } = renderNavigation({ view: 'failed' })
    act(() =>
      usePreviewTabStore.getState().setLastMove('preview-1', { action: 'open', from: OVERVIEW, to: PRICING })
    )
    setHistory({ canGoBack: true, backTarget: OVERVIEW })
    const change = (failed: boolean): PreviewPageChangedPayload => ({
      panelId: 'preview-1',
      ...PRICING,
      sameDocument: false,
      canGoBack: true,
      canGoForward: false,
      backTarget: OVERVIEW,
      forwardTarget: null,
      generation: 2,
      failed
    })

    act(() => result.current.onPageChanged(change(true)))
    expect(result.current.failedBanner.message).toMatch(/pricing\.html could not be shown/)
    expect(usePreviewTabStore.getState().getTab('preview-1').lastMove).not.toBeNull()

    act(() => result.current.onPageChanged(change(false)))
    expect(result.current.failedBanner.message).toBeNull()
    expect(usePreviewTabStore.getState().getTab('preview-1').lastMove).toBeNull()
  })
})

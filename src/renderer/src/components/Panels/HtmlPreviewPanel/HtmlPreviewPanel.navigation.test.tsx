// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Same-tab move tests for {@link HtmlPreviewPanel} (issue #124, part 3 §3.6–§3.8):
 * Back/Forward keys scoped to the panel, a find bar that closes under the
 * reader, the move-caused failed banner, and what a landed move says in the
 * panel-root polite region.
 *
 * The REAL link router and move coordinator run here (`mountPreviewLinkRouter`),
 * over a fake dockview api and the fake bridge's `navigate`, so "refused move
 * silent" is the coordinator's refusal reaching the panel, not a stub's.
 *
 * Split out of `HtmlPreviewPanel.test.tsx` by concern (500-line cap); the
 * shared fake bridge is `__test__/panelHarness.ts`.
 *
 * @see HtmlPreviewPanel.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import { HtmlPreviewPanel, type HtmlPreviewPanelParams } from './HtmlPreviewPanel'
import { ErrorCode } from '../../../../../shared/errors'
import type { PreviewPageChangedPayload } from '../../../../../shared/ipc/preview-navigation-schema'
import type { PreviewNavigateRequest } from '../../../../../shared/ipc/preview-navigation-schema'
import {
  mountPreviewLinkRouter,
  resetPreviewLinkRouter
} from '../../../services/preview/PreviewLinkRouter'
import { PREVIEW_BACK_BUTTON_SELECTOR } from '../../../services/preview/previewTabMove'
import { useProjectStore } from '../../../stores/useProjectStore'
import { usePreviewTabStore, type PreviewMoveAnnouncement } from '../../../stores/usePreviewTabStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { installHtmlPreviewPanelHarness } from './__test__/panelHarness'

// Declared per file: `vi.mock` is hoisted per test file, so the shared harness
// cannot carry it.
const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}))
vi.mock('../../../utils/logger', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: mockLogger
}))

const { listeners, preview, makeProps } = installHtmlPreviewPanelHarness()

const OVERVIEW = { filePath: '/proj/overview.html', anchor: null }
const PRICING = { filePath: '/proj/pricing.html', anchor: null }
/** Windows keys: Alt+Left is Back. The platform comes from the preload bridge. */
const ALT_LEFT = { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }

/** The fake dockview: one entry per rendered panel, the shape the coordinator reads. */
interface DockEntry {
  id: string
  params: HtmlPreviewPanelParams
  view: { contentComponent: string; content: { element: HTMLElement } }
}
const dock = new Map<string, DockEntry>()
const dockApi = {
  get panels(): DockEntry[] {
    return [...dock.values()]
  },
  getPanel: (id: string): DockEntry | undefined => dock.get(id)
}

beforeEach(() => {
  ;(window.api as unknown as { utils: unknown }).utils = { getPlatform: () => 'win32' }
  useProjectStore.setState({ dockviewApi: dockApi as never })
  mountPreviewLinkRouter({ prompt: null, closePanel: vi.fn() })
})

afterEach(() => {
  resetPreviewLinkRouter()
  useProjectStore.setState({ dockviewApi: null })
  dock.clear()
})

/** Renders a panel inside its own dock element, wired to the fake dockview. */
function renderPanel(filePath: string, panelId = 'preview-1') {
  const props = makeProps(filePath, panelId)
  const element = document.createElement('div')
  document.body.appendChild(element)
  const entry: DockEntry = {
    id: panelId,
    params: props.params,
    view: { contentComponent: 'htmlPreview', content: { element } }
  }
  dock.set(panelId, entry)
  ;(props.containerApi as unknown as { getPanel: typeof dockApi.getPanel }).getPanel =
    dockApi.getPanel
  const utils = render(<HtmlPreviewPanel {...props} />, { container: element })
  /** Dockview's `updateParameters`, done by hand: the tab now shows `next`. */
  const showPage = (next: string): void => {
    entry.params = { ...entry.params, filePath: next }
    const nextProps: IDockviewPanelProps<HtmlPreviewPanelParams> = { ...props, params: entry.params }
    utils.rerender(<HtmlPreviewPanel {...nextProps} />)
  }
  const region = within(element).getByTestId('preview-move-announcement')
  return { ...utils, element, region, showPage }
}

function changed(
  filePath: string,
  partial: Partial<PreviewPageChangedPayload> = {}
): PreviewPageChangedPayload {
  return {
    panelId: 'preview-1',
    filePath,
    anchor: null,
    sameDocument: false,
    canGoBack: false,
    canGoForward: false,
    backTarget: null,
    forwardTarget: null,
    generation: 1,
    failed: false,
    ...partial
  }
}

/** A tab on pricing.html that came from overview.html. */
function onPricingFromOverview(panelId = 'preview-1'): void {
  act(() =>
    usePreviewTabStore.getState().setHistory(panelId, {
      canGoBack: true,
      canGoForward: false,
      backTarget: OVERVIEW,
      forwardTarget: null,
      generation: 2
    })
  )
}

/** Main accepts every check and commit, for the given target. */
function acceptMovesTo(target: typeof OVERVIEW): void {
  preview.navigate.mockImplementation(async (request: PreviewNavigateRequest) => ({
    ok: true,
    target,
    generation: request.phase === 'check' ? 2 : 3
  }))
}

/** Lets two animation frames run: focus, then the text one frame after it. */
const frames = (): Promise<void> =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  )

const announcement = (): PreviewMoveAnnouncement | null =>
  usePreviewTabStore.getState().getTab('preview-1').announcement

describe('HtmlPreviewPanel – Back and Forward keys', () => {
  it('ignores a key pressed outside the panel, and takes the same key inside it', async () => {
    const { element } = renderPanel(PRICING.filePath)
    onPricingFromOverview()
    // Stands in for Monaco or the terminal: focus anywhere but this panel.
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)

    fireEvent.keyDown(outside, ALT_LEFT)
    fireEvent.keyDown(document.body, ALT_LEFT)
    expect(preview.navigate).not.toHaveBeenCalled()

    fireEvent.keyDown(within(element).getByTestId('preview-band-back'), ALT_LEFT)
    await waitFor(() =>
      expect(preview.navigate).toHaveBeenCalledWith({
        panelId: 'preview-1',
        phase: 'check',
        action: 'back',
        generation: 2
      })
    )
    outside.remove()
  })

  it("moves only the panel the key was pressed in – another preview's history stays", async () => {
    const first = renderPanel(PRICING.filePath, 'preview-1')
    renderPanel(PRICING.filePath, 'preview-2')
    onPricingFromOverview('preview-1')
    onPricingFromOverview('preview-2')

    fireEvent.keyDown(within(first.element).getByTestId('preview-band-find'), ALT_LEFT)
    await waitFor(() => expect(preview.navigate).toHaveBeenCalled())
    expect(preview.navigate.mock.calls.map(([request]) => request.panelId)).toEqual(['preview-1'])
  })

  it('keeps a Back key with nowhere to go, and asks nothing', () => {
    const { element } = renderPanel(OVERVIEW.filePath)
    const notHandled = fireEvent.keyDown(within(element).getByTestId('preview-band-back'), ALT_LEFT)

    expect(notHandled).toBe(false)
    expect(preview.navigate).not.toHaveBeenCalled()
  })

  it('routes a forwarded Back from the page, and a page-started move that closed nothing is silent', async () => {
    const { region } = renderPanel(PRICING.filePath)
    onPricingFromOverview()
    acceptMovesTo(OVERVIEW)

    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'back', accel: false }))
    await waitFor(() => expect(preview.navigate).toHaveBeenCalledTimes(2))
    act(() => listeners.pageChanged?.(changed(OVERVIEW.filePath, { canGoForward: true, forwardTarget: PRICING })))
    await frames()

    expect(region.textContent).toBe('')
    expect(announcement()).toBeNull()
  })
})

describe('HtmlPreviewPanel – a move closes a find bar the reader was in', () => {
  it('closes a focused find bar and moves focus to Back', async () => {
    const { element } = renderPanel(OVERVIEW.filePath)
    act(() => useSearchStore.getState().openSearch())
    const input = await waitFor(() => {
      const found = element.querySelector<HTMLInputElement>('.search-input')
      expect(found).not.toBeNull()
      return found as HTMLInputElement
    })
    act(() => input.focus())
    expect(input).toHaveFocus()

    act(() => listeners.pageChanged?.(changed(PRICING.filePath, { canGoBack: true, backTarget: OVERVIEW })))
    expect(useSearchStore.getState().isOpen).toBe(false)
    await waitFor(() =>
      expect(element.querySelector(PREVIEW_BACK_BUTTON_SELECTOR)).toHaveFocus()
    )
  })

  it('closes the find bar but leaves focus alone when the reader was elsewhere', async () => {
    const { element } = renderPanel(OVERVIEW.filePath)
    act(() => useSearchStore.getState().openSearch())
    await waitFor(() => expect(element.querySelector('.search-input')).not.toBeNull())
    const toggle = within(element).getByTestId('preview-band-link-mode')
    act(() => toggle.focus())

    act(() => listeners.pageChanged?.(changed(PRICING.filePath)))
    await frames()
    expect(useSearchStore.getState().isOpen).toBe(false)
    expect(toggle).toHaveFocus()
  })

  it('keeps the find bar open for a #section step on the same page', async () => {
    const { element } = renderPanel(OVERVIEW.filePath)
    act(() => useSearchStore.getState().openSearch())
    await waitFor(() => expect(element.querySelector('.search-input')).not.toBeNull())

    act(() =>
      listeners.pageChanged?.(changed(OVERVIEW.filePath, { anchor: 'pricing', sameDocument: true }))
    )
    expect(useSearchStore.getState().isOpen).toBe(true)
  })
})

describe('HtmlPreviewPanel – the failed banner after a move', () => {
  function failOnPricing(lastMoveAction: 'open' | 'back' = 'open'): void {
    act(() => {
      usePreviewTabStore.getState().setLastMove('preview-1', {
        action: lastMoveAction,
        from: OVERVIEW,
        to: PRICING
      })
      listeners.pageChanged?.(
        changed(PRICING.filePath, { failed: true, canGoBack: true, backTarget: OVERVIEW, generation: 2 })
      )
      listeners.loadState?.({ panelId: 'preview-1', state: 'failed', dropped: 0 })
    })
  }

  it('names the page the move could not show, and leads with the way back', () => {
    const { element } = renderPanel(PRICING.filePath)
    failOnPricing()

    const alert = within(element).getByRole('alert')
    expect(alert).toHaveTextContent(
      'pricing.html could not be shown – it may have been moved or deleted.'
    )
    expect(within(alert).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Back to overview.html',
      'Reload'
    ])
    expect(within(alert).getByRole('button', { name: 'Back to overview.html' })).toHaveFocus()
  })

  it('keeps the old words for a crash no move caused, with Back after Reload', () => {
    const { element } = renderPanel(PRICING.filePath)
    onPricingFromOverview()
    act(() => listeners.loadState?.({ panelId: 'preview-1', state: 'failed', dropped: 0 }))

    const alert = within(element).getByRole('alert')
    expect(alert).toHaveTextContent('The preview stopped running.')
    expect(within(alert).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Reload',
      'Back to overview.html'
    ])
    expect(within(alert).getByRole('button', { name: 'Reload' })).toHaveFocus()
  })

  it('after a banner-started move, lands focus on Back, then speaks in the region that was already there', async () => {
    const { element, region, showPage } = renderPanel(PRICING.filePath)
    failOnPricing()
    acceptMovesTo(OVERVIEW)
    expect(region.textContent).toBe('')

    // What the region held at the moment Back took focus.
    let textWhenBackFocused: string | null = null
    element.addEventListener('focusin', (event) => {
      if ((event.target as Element).matches(PREVIEW_BACK_BUTTON_SELECTOR)) {
        textWhenBackFocused = region.textContent
      }
    })

    fireEvent.click(within(element).getByRole('button', { name: 'Back to overview.html' }))
    await waitFor(() => expect(preview.navigate).toHaveBeenCalledTimes(2))

    // Main commits: the page changes, the new load starts, dockview re-renders.
    act(() => {
      listeners.pageChanged?.(
        changed(OVERVIEW.filePath, { canGoForward: true, forwardTarget: PRICING, generation: 3 })
      )
      listeners.loadState?.({ panelId: 'preview-1', state: 'loading', dropped: 0 })
    })
    showPage(OVERVIEW.filePath)

    await waitFor(() => expect(element.querySelector(PREVIEW_BACK_BUTTON_SELECTOR)).toHaveFocus())
    await waitFor(() => expect(region.textContent).toBe('Showing overview.html.'))
    expect(textWhenBackFocused).toBe('')
    // The same element: created before the move, not with its text.
    expect(within(element).getByTestId('preview-move-announcement')).toBe(region)
  })
})

describe('HtmlPreviewPanel – what a landed move says (UX spec §6)', () => {
  it.each([
    ['chrome', 0, 'Showing pricing.html.'],
    ['chrome', 1, 'Showing pricing.html. Closed the other tab that showed it.'],
    ['page', 2, 'Closed 2 other tabs that showed it.'],
    ['page', 0, '']
  ] as const)('%s-started, %i closed: "%s"', async (origin, closedCount, words) => {
    const { region } = renderPanel(OVERVIEW.filePath)
    act(() =>
      usePreviewTabStore
        .getState()
        .setAnnouncement('preview-1', { origin, closedCount, target: PRICING, focusMoved: false })
    )

    act(() => listeners.pageChanged?.(changed(PRICING.filePath)))
    await frames()
    expect(region.textContent).toBe(words)
    expect(announcement()).toBeNull()
  })

  it('speaks a Back button move: "Showing overview.html."', async () => {
    const { element, region } = renderPanel(PRICING.filePath)
    onPricingFromOverview()
    acceptMovesTo(OVERVIEW)

    fireEvent.click(within(element).getByTestId('preview-band-back'))
    await waitFor(() => expect(preview.navigate).toHaveBeenCalledTimes(2))
    act(() => listeners.pageChanged?.(changed(OVERVIEW.filePath, { canGoForward: true, forwardTarget: PRICING })))

    await waitFor(() => expect(region.textContent).toBe('Showing overview.html.'))
  })

  it('is silent for a refused move', async () => {
    const { element, region } = renderPanel(PRICING.filePath)
    onPricingFromOverview()
    preview.navigate.mockImplementation(async (request: PreviewNavigateRequest) =>
      request.phase === 'check'
        ? { ok: true, target: OVERVIEW, generation: 2 }
        : { ok: false, errorCode: ErrorCode.PREVIEW_NAV_SKIPPED }
    )

    fireEvent.click(within(element).getByTestId('preview-band-back'))
    await waitFor(() => expect(preview.navigate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(announcement()).toBeNull())
    await frames()
    expect(region.textContent).toBe('')
  })

  it('stays silent when a refused commit is followed by a #section jump', async () => {
    const { element, region } = renderPanel(PRICING.filePath)
    onPricingFromOverview()
    preview.navigate.mockImplementation(async (request: PreviewNavigateRequest) =>
      request.phase === 'check'
        ? { ok: true, target: OVERVIEW, generation: 2 }
        : { ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE }
    )
    fireEvent.click(within(element).getByTestId('preview-band-back'))
    await waitFor(() => expect(preview.navigate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(announcement()).toBeNull())

    act(() =>
      listeners.pageChanged?.(
        changed(PRICING.filePath, { anchor: 'section', sameDocument: true, canGoBack: true, backTarget: OVERVIEW })
      )
    )
    await frames()
    expect(region.textContent).toBe('')
  })

  it('clears an announcement without a word when another target lands', async () => {
    const { region } = renderPanel(PRICING.filePath)
    act(() =>
      usePreviewTabStore
        .getState()
        .setAnnouncement('preview-1', { origin: 'chrome', closedCount: 0, target: OVERVIEW, focusMoved: false })
    )

    act(() =>
      listeners.pageChanged?.(changed(PRICING.filePath, { anchor: 'section', sameDocument: true }))
    )
    await frames()
    expect(region.textContent).toBe('')
    expect(announcement()).toBeNull()
  })
})

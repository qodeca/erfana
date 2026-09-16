// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link HtmlPreviewPanel} (Issue #74, work item 71): the views and
 * the lifecycle.
 *
 * Covers the three top-level views (normal placeholder, limit-reached refusal,
 * failed banner), the toolbar's placement, open/close and resume, and the
 * published rect, driving main→renderer state through the captured bridge event
 * listeners. The native `WebContentsView` never exists in jsdom, so these
 * assert the renderer chrome only.
 *
 * Split by concern (issue #124, 500-line cap): the event feed lives in
 * `HtmlPreviewPanel.events.test.tsx`, forwarded shortcuts in
 * `HtmlPreviewPanel.shortcuts.test.tsx`, the shared fake bridge in
 * `__test__/panelHarness.ts`.
 *
 * @see HtmlPreviewPanel.tsx
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

import { HtmlPreviewPanel } from './HtmlPreviewPanel'
import { usePreviewViewportStore } from '../../../stores/usePreviewViewportStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { ErrorCode } from '../../../../../shared/errors'
import { installHtmlPreviewPanelHarness } from './__test__/panelHarness'

// The bounds hook logs its drop lines through the renderer logger, which has no
// bridge here; mocked, as in the other renderer suites, so a run stays quiet.
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

const { listeners, preview, addPanel, makeProps } = installHtmlPreviewPanelHarness()

describe('HtmlPreviewPanel', () => {
  it('opens the preview on mount with the panel id and file path', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(preview.open).toHaveBeenCalledTimes(1))
    expect(preview.open).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: 'preview-1', filePath: '/proj/page.html' })
    )
  })

  it('renders the sized placeholder in the normal state', () => {
    const { container } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    expect(container.querySelector('.html-preview-placeholder')).not.toBeNull()
  })

  it('always shows the preview toolbar beside a live preview', () => {
    // The band's PLACEMENT is now the whole of what separates Erfana's chrome
    // from an untrusted page. The "content below is not Erfana" wording and the
    // 2px accent seam were both withdrawn by owner decision when this became a
    // toolbar (docs/security.md, residual risk 8) — so this assertion is
    // deliberately about presence, not text, and it is the last one of its kind.
    // It must not become conditional on load state, failures or visibility.
    const { container } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    expect(container.querySelector('.erf-band')).not.toBeNull()
  })

  it('lets the placeholder backdrop show through the still frame', () => {
    // `capturePage` returns a PNG WITH ALPHA. A page that sets no body
    // background paints none, so those pixels come back transparent — and
    // against the hardcoded brand black the frame rendered as a dark page with
    // dark text on it: the words there, the paper gone. The placeholder beneath
    // already carries the colour main reports, which resolves to the page's own
    // paper, so the frame must not paint its own.
    const css = readFileSync(resolve(__dirname, 'HtmlPreviewPanel.css'), 'utf8')
    const rule = css.slice(
      css.indexOf('.html-preview-still-frame {'),
      css.indexOf('}', css.indexOf('.html-preview-still-frame {'))
    )

    expect(rule).toContain('background: transparent')
  })

  it('carries a Find button that opens the find bar', () => {
    // Find-in-page worked here long before it had a button — Cmd/Ctrl+F, and a
    // forwarded accelerator for when focus is inside the native view, which
    // swallows renderer keys. This pins the DISCOVERABLE route, which is the
    // only part that was missing.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    expect(useSearchStore.getState().isOpen).toBe(false)
    fireEvent.click(screen.getByTestId('preview-band-find'))
    expect(useSearchStore.getState().isOpen).toBe(true)
  })

  it('puts the page area BELOW the strip, so it cannot overlap it', () => {
    // This replaces the arithmetic guarantee that PREVIEW_CHROME_INSET_PX used to
    // give, and it is stronger: the old one held only while two numbers agreed
    // (the constant in TypeScript and `height` in the stylesheet), so a strip
    // that grew past its own reservation would be silently painted over by the
    // untrusted page. Here the strip and the page area are siblings in a flex
    // column, so "the page cannot cover the strip" is a structural fact rather
    // than a maintained coincidence — and the strip may grow to any height,
    // which is what lets the permission band open its list.
    const { container } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    const surface = container.querySelector('.html-preview-surface')
    const strip = container.querySelector('.erf-band')
    const pageArea = container.querySelector('.html-preview-page-area')
    expect(surface).not.toBeNull()
    expect(strip).not.toBeNull()
    expect(pageArea).not.toBeNull()

    // Both are direct children of the surface, strip first.
    expect(strip?.parentElement).toBe(surface)
    expect(pageArea?.parentElement).toBe(surface)
    expect(strip?.nextElementSibling).toBe(pageArea)

    // And the native view's target is inside the page area, never beside the strip.
    expect(pageArea?.querySelector('.html-preview-placeholder')).not.toBeNull()

    const css = readFileSync(resolve(__dirname, 'HtmlPreviewPanel.css'), 'utf8')
    const surfaceRule = css.slice(
      css.indexOf('.html-preview-surface {'),
      css.indexOf('}', css.indexOf('.html-preview-surface {'))
    )
    expect(surfaceRule).toContain('flex-direction: column')
  })

  it('closes the preview on unmount', () => {
    const { unmount } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    unmount()
    expect(preview.close).toHaveBeenCalledWith('preview-1')
  })

  it('shows the other-window refusal with an Open as source action', async () => {
    preview.open.mockResolvedValue({
      ok: false,
      errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED,
      holderPanelId: 'preview-other'
    })

    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    expect(
      await screen.findByText('This file is already previewed in another window.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open as source' }))
    // openFileInPanel routes an editor-kind open through the container api.
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ component: 'editor' })
    )
  })

  it('retries a resume that was superseded, instead of stranding the panel', async () => {
    // THE DEFECT. `PREVIEW_OPEN_SUPERSEDED` is deliberately not a failure — the
    // handler logs and returns without touching state. On the RESUME path that
    // left `loadState` at 'suspended' with no dep changed, so nothing re-armed:
    // the tab sat on a frozen still frame with no live view and no banner,
    // recoverable only by switching away and back or closing it. Reachable
    // whenever eviction is active and another panel's open overtakes this one.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(preview.open).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(listeners.loadState).not.toBeNull())

    // The next open (the resume) is overtaken.
    preview.open.mockResolvedValueOnce({
      ok: false,
      errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED
    })

    act(() => {
      listeners.loadState?.({ panelId: 'preview-1', state: 'suspended', dropped: 0 })
    })

    // Two more opens: the superseded resume, then the retry that re-arms it.
    await waitFor(() => expect(preview.open).toHaveBeenCalledTimes(3))
  })

  it('does not retry a resume forever', async () => {
    // The control on the retry above. A supersession can repeat — another
    // panel's open keeps winning — so the re-arm has to be bounded or the panel
    // spins reopening for as long as the tab is visible.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(preview.open).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(listeners.loadState).not.toBeNull())

    preview.open.mockResolvedValue({
      ok: false,
      errorCode: ErrorCode.PREVIEW_OPEN_SUPERSEDED
    })

    act(() => {
      listeners.loadState?.({ panelId: 'preview-1', state: 'suspended', dropped: 0 })
    })

    await waitFor(() => expect(preview.open.mock.calls.length).toBeGreaterThan(2))
    const settled = preview.open.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(preview.open.mock.calls.length).toBe(settled)
  })

  it('shows the failed banner and reloads on demand', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.loadState).not.toBeNull())
    listeners.loadState?.({ panelId: 'preview-1', state: 'failed', dropped: 0 })

    const reload = await screen.findByRole('button', { name: 'Reload' })
    fireEvent.click(reload)
    expect(preview.reload).toHaveBeenCalledWith('preview-1')
  })

  it('drops the published rect when the load fails', async () => {
    // THE DEFECT. `isLive` was `loadState !== 'idle'`, which is TRUE for
    // 'failed'. On failure the panel swaps the placeholder for a banner, so
    // `pushBounds` bails before it can update anything — but the clear effect
    // never fired either, leaving a rectangle published for a view that is not
    // there. Every later toast then dodged empty space, and on a large panel
    // `placeToastContainer` returned `blocked`, which registers the toast
    // occluder and hides EVERY live preview in the window. An actionable toast
    // never auto-dismisses, so that hide had no end.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.loadState).not.toBeNull())

    // jsdom lays nothing out, so the panel can never publish a rect of its own.
    // Seed the one a laid-out panel would have published.
    act(() => {
      usePreviewViewportStore
        .getState()
        .setRect('preview-1', { left: 0, top: 0, width: 800, height: 600 })
    })
    expect(usePreviewViewportStore.getState().rects.get('preview-1')).toBeDefined()

    act(() => {
      listeners.loadState?.({ panelId: 'preview-1', state: 'failed', dropped: 0 })
    })

    expect(usePreviewViewportStore.getState().rects.get('preview-1')).toBeUndefined()
  })

  it('keeps the published rect while the preview is healthy', async () => {
    // The control for the case above. Without it, "the rect is gone" would also
    // be satisfied by a panel that never keeps a rect at all.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.loadState).not.toBeNull())

    act(() => {
      listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 })
      usePreviewViewportStore
        .getState()
        .setRect('preview-1', { left: 0, top: 0, width: 800, height: 600 })
    })

    expect(usePreviewViewportStore.getState().rects.get('preview-1')).toBeDefined()
  })
})

describe('HtmlPreviewPanel – the drag freeze (issue #124, part 1 §1.5)', () => {
  let queued = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1
  // Inside `act`: a frame runs the bounds loop, whose push feeds the chrome gate.
  const frame = (): void =>
    act(() => {
      const due = [...queued.values()]
      queued = new Map()
      for (const callback of due) callback(0)
    })
  const stubFrames = (): void => {
    queued = new Map()
    nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      const id = nextFrameId++
      queued.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      queued.delete(id)
    })
  }
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Renders a live preview whose event feed is subscribed. */
  async function renderLive() {
    const view = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.resizeHold).not.toBeNull())
    act(() => {
      listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 })
    })
    return view
  }
  const hold = (held: boolean): void => act(() => listeners.resizeHold?.({ panelId: 'preview-1', held }))
  const applied = (visible: boolean): void =>
    act(() => listeners.visibilityApplied?.({ panelId: 'preview-1', visible }))
  const lastSettled = (): boolean =>
    preview.setBounds.mock.calls.some((call) => (call[3] as { settled?: boolean } | undefined)?.settled === true)

  it('answers the end of a window-edge hold with a settled push two frames later', async () => {
    stubFrames()
    await renderLive()

    hold(true)
    hold(false)
    frame()
    expect(lastSettled()).toBe(false)
    frame()

    expect(lastSettled()).toBe(true)
    expect(preview.setBounds.mock.calls.at(-1)?.[3]).toEqual({ settled: true })
  })

  it('drops a pending settled push when the edge moves again', async () => {
    stubFrames()
    await renderLive()

    hold(false)
    hold(true)
    frame()
    frame()

    expect(lastSettled()).toBe(false)
  })

  it('counts a held view as hidden and draws its still at the captured size, until the release', async () => {
    const { container } = await renderLive()
    const placeholder = container.querySelector('.html-preview-placeholder')
    act(() => {
      listeners.stillFrame?.({
        panelId: 'preview-1',
        dataUrl: 'data:image/png;base64,AAA',
        width: 320,
        height: 240,
        capturedAt: 1,
        cssWidth: 640,
        cssHeight: 480
      })
    })
    // `button` while the page is live on the active tab: it is the keyboard's
    // way into the page (issue #124, QG-8 U1). `img` is the hidden case.
    expect(placeholder?.getAttribute('role')).toBe('button')

    hold(true)
    expect(placeholder?.getAttribute('role')).toBe('img')
    const img = container.querySelector<HTMLImageElement>('img.html-preview-still-frame')
    expect(img?.style.width).toBe('640px')
    expect(img?.style.height).toBe('480px')

    applied(true)
    expect(placeholder?.getAttribute('role')).toBe('button')
    expect(container.querySelector('img.html-preview-still-frame')).toBeNull()
  })

  it('shows the backdrop for a stale still during a hold, through a release that stays hidden', async () => {
    const { container } = await renderLive()
    act(() => {
      listeners.stillFrame?.({
        panelId: 'preview-1',
        dataUrl: 'data:image/png;base64,AAA',
        width: 320,
        height: 240,
        capturedAt: 1,
        stale: true
      })
    })

    hold(true)
    expect(container.querySelector('img.html-preview-still-frame')).toBeNull()
    applied(false)
    expect(container.querySelector('img.html-preview-still-frame')).toBeNull()
    // Another panel's report is not this panel's release.
    act(() => listeners.visibilityApplied?.({ panelId: 'preview-2', visible: true }))
    expect(container.querySelector('img.html-preview-still-frame')).toBeNull()
  })
})

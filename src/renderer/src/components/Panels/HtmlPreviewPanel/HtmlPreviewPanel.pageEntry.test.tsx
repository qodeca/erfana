// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard route into the previewed page (issue #124, QG-8 U1).
 *
 * The page runs in a native `WebContentsView` that the renderer's tab order
 * cannot reach, so without a target of its own a keyboard-only reader can
 * neither follow a link in the page nor use any accelerator main forwards back
 * out of it (WCAG SC 2.1.1). The placeholder is that target: focusable while
 * the page is live and this tab is active, named with the way in AND the way
 * back out, and activated by Enter or Space.
 *
 * Split out of `HtmlPreviewPanel.test.tsx` by concern (issue #124, 500-line
 * cap); the shared fake bridge is `__test__/panelHarness.ts`.
 *
 * @see HtmlPreviewPanel.tsx
 * @see src/main/ipc/preview/focus-handlers.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, act, fireEvent, screen } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import { HtmlPreviewPanel, type HtmlPreviewPanelParams } from './HtmlPreviewPanel'
import { installHtmlPreviewPanelHarness } from './__test__/panelHarness'
import { ErrorCode } from '../../../../../shared/errors'
import { useOverlayOccluderStore } from '../../../stores/useOverlayOccluderStore'

// The bounds hook logs its drop lines through the renderer logger, which has no
// bridge here; mocked, as in the other renderer suites, so a run stays quiet.
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

const { listeners, preview, makeProps, activeChange } = installHtmlPreviewPanelHarness()

const PAGE = '/proj/page.html'
const LIVE_NAME = 'HTML preview of page.html – press Enter to enter the page, Escape to come back'

beforeEach(() => {
  // The harness's fake refuses by default; here main accepts.
  preview.focusPage.mockResolvedValue({ ok: true })
})

afterEach(() => {
  useOverlayOccluderStore.getState().reset()
})

/**
 * Hide the view the way the guard does – a dialog registers an occluder – and
 * let the store's microtask flush publish it. `visibilityApplied` is only main's
 * confirmation; the renderer's hidden term never reads it.
 */
async function occlude(): Promise<void> {
  await act(async () => {
    useOverlayOccluderStore.getState().register('dialog')
    await Promise.resolve()
  })
}

/** Render the panel and let the page reach `ready`, as an opened preview does. */
async function renderLive(
  props: IDockviewPanelProps<HtmlPreviewPanelParams> = makeProps(PAGE)
): Promise<HTMLElement> {
  const { container } = render(<HtmlPreviewPanel {...props} />)
  await waitFor(() => expect(listeners.loadState).not.toBeNull())
  act(() => {
    listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 })
  })
  const placeholder = container.querySelector<HTMLElement>('.html-preview-placeholder')
  expect(placeholder).not.toBeNull()
  return placeholder as HTMLElement
}

/** A panel whose tab is not the active one. */
function inactiveProps(): IDockviewPanelProps<HtmlPreviewPanelParams> {
  const props = makeProps(PAGE)
  ;(props.api as unknown as { isActive: boolean }).isActive = false
  return props
}

describe('HtmlPreviewPanel – the keyboard route into the page', () => {
  it('puts the placeholder in the tab order and names the way in and out', async () => {
    const placeholder = await renderLive()

    expect(placeholder.getAttribute('tabindex')).toBe('0')
    expect(placeholder.getAttribute('aria-label')).toBe(LIVE_NAME)

    // Reachable: a Tab press lands here, which in jsdom is "focus() works and
    // the element is the one holding focus".
    placeholder.focus()
    expect(document.activeElement).toBe(placeholder)
  })

  it('asks main for focus on Enter', async () => {
    const placeholder = await renderLive()

    // `false` = default prevented: the press means "enter the page" and nothing
    // else, so it must not carry on to a parent.
    expect(fireEvent.keyDown(placeholder, { key: 'Enter' })).toBe(false)

    expect(preview.focusPage).toHaveBeenCalledWith('preview-1')
  })

  it('asks main for focus on Space', async () => {
    const placeholder = await renderLive()

    // Default prevented, or Space would scroll the panel.
    expect(fireEvent.keyDown(placeholder, { key: ' ' })).toBe(false)

    expect(preview.focusPage).toHaveBeenCalledWith('preview-1')
  })

  it('catches a rejected focus request, so it is not an unhandled rejection', async () => {
    const placeholder = await renderLive()
    // The invoke rejects before main's handler runs when the registry's sender
    // gate refuses. Observed through `catch` itself: vitest's mock attaches its
    // own handlers to a returned promise, so an unhandled-rejection listener
    // would never fire here whether or not the hook caught it.
    const rejected = Promise.reject(new Error('Untrusted sender'))
    const caught = vi.spyOn(rejected, 'catch')
    preview.focusPage.mockReturnValueOnce(rejected)

    fireEvent.keyDown(placeholder, { key: 'Enter' })

    expect(preview.focusPage).toHaveBeenCalledWith('preview-1')
    expect(caught).toHaveBeenCalledTimes(1)
    await expect(caught.mock.results[0]?.value).resolves.toBeUndefined()
  })

  it('never moves focus into the page on its own', async () => {
    await renderLive()

    // The page takes focus on a key press and on nothing else: an open, a load
    // and a repaint must never pull focus out from under the reader.
    expect(preview.focusPage).not.toHaveBeenCalled()
  })

  it('ignores every other key', async () => {
    const placeholder = await renderLive()

    fireEvent.keyDown(placeholder, { key: 'a' })
    fireEvent.keyDown(placeholder, { key: 'Escape' })
    fireEvent.keyDown(placeholder, { key: 'Tab' })

    expect(preview.focusPage).not.toHaveBeenCalled()
  })

  it('is not a keyboard target on an inactive tab, and its keys do nothing', async () => {
    // Dockview keeps every opened panel mounted, so an ungated handler would run
    // once per open tab (CLAUDE.md, panel-scoped globals).
    const placeholder = await renderLive(inactiveProps())

    expect(placeholder.getAttribute('tabindex')).toBe('-1')
    expect(placeholder.getAttribute('aria-label')).toBe('HTML preview of page.html')

    fireEvent.keyDown(placeholder, { key: 'Enter' })

    expect(preview.focusPage).not.toHaveBeenCalled()
  })

  it('is not a keyboard target before the page is running', async () => {
    const { container } = render(<HtmlPreviewPanel {...makeProps(PAGE)} />)
    await waitFor(() => expect(listeners.loadState).not.toBeNull())

    const placeholder = container.querySelector<HTMLElement>('.html-preview-placeholder')
    expect(placeholder?.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(placeholder as HTMLElement, { key: 'Enter' })

    expect(preview.focusPage).not.toHaveBeenCalled()
  })

  it('follows the tab becoming active and inactive after mount', async () => {
    // The gate is followed through `onDidActiveChange`, not read once: a tab
    // that was in the background when the page loaded becomes the target when
    // the reader switches to it, and stops being one when they switch away.
    const placeholder = await renderLive(inactiveProps())
    expect(placeholder.getAttribute('tabindex')).toBe('-1')

    act(() => activeChange(true))

    expect(placeholder.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(placeholder, { key: 'Enter' })
    expect(preview.focusPage).toHaveBeenCalledTimes(1)

    act(() => activeChange(false))

    expect(placeholder.getAttribute('tabindex')).toBe('-1')
    fireEvent.keyDown(placeholder, { key: 'Enter' })
    expect(preview.focusPage).toHaveBeenCalledTimes(1)
  })

  // One gate per case, so neither can regress behind the other.
  it.each([
    ['the guard has hidden the view behind an overlay', occlude],
    [
      'main holds the view for a window-edge resize',
      async () => {
        act(() => listeners.resizeHold?.({ panelId: 'preview-1', held: true }))
      }
    ]
  ])('is not a keyboard target while %s', async (_label, hide) => {
    const placeholder = await renderLive()

    await hide()

    expect(placeholder.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(placeholder, { key: 'Enter' })

    expect(preview.focusPage).not.toHaveBeenCalled()
  })

  // `pageLive`'s other terms: a load state that has no view behind it, and the
  // two top-level views that replace the placeholder with a banner.
  it.each([
    {
      label: 'suspended',
      refuse: false,
      drive: () => listeners.loadState?.({ panelId: 'preview-1', state: 'suspended', dropped: 0 })
    },
    {
      label: 'failed',
      refuse: false,
      drive: () => listeners.loadState?.({ panelId: 'preview-1', state: 'failed', dropped: 0 })
    },
    {
      label: 'refused as open in another window',
      refuse: true,
      drive: () => {}
    }
  ])('offers no way in while the page is $label', async ({ refuse, drive }) => {
    if (refuse) {
      preview.open.mockResolvedValue({
        ok: false,
        errorCode: ErrorCode.PREVIEW_VIEW_LIMIT_REACHED,
        holderPanelId: 'preview-other'
      })
    }
    const { container } = render(<HtmlPreviewPanel {...makeProps(PAGE)} />)
    await waitFor(() => expect(listeners.loadState).not.toBeNull())
    // Reach `ready` first, so it is the state below – not a page that never
    // loaded – that takes the offer away.
    act(() => {
      listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 })
    })
    act(drive)
    if (refuse) {
      await screen.findByText('This file is already previewed in another window.')
    }

    expect(screen.queryByRole('button', { name: LIVE_NAME })).toBeNull()
    expect(container.querySelector('[tabindex="0"]')).toBeNull()

    // A suspended panel keeps its placeholder; the other two replace it with a
    // banner, so the press goes to the panel root instead.
    const target =
      container.querySelector<HTMLElement>('.html-preview-placeholder') ??
      (container.firstElementChild as HTMLElement)
    fireEvent.keyDown(target, { key: 'Enter' })

    expect(preview.focusPage).not.toHaveBeenCalled()
  })

  it('stays focusable from code while the view is hidden, so a dialog can restore focus', async () => {
    // Q26: a closing dialog restores focus synchronously, but the page is
    // offered again only after the occluder store's flush and a re-render. Out
    // of the tab order is right; unfocusable would drop focus onto <body>.
    const placeholder = await renderLive()
    placeholder.focus()

    await occlude()
    expect(placeholder.getAttribute('tabindex')).toBe('-1')
    placeholder.blur()
    placeholder.focus()

    expect(document.activeElement).toBe(placeholder)
  })
})

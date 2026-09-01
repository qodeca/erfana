// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link HtmlPreviewPanel} (Issue #74, work item 71).
 *
 * Covers the three top-level views (normal placeholder, limit-reached refusal,
 * failed banner) and the failure badge, driving main→renderer state through the
 * captured bridge event listeners. The native `WebContentsView` never exists in
 * jsdom, so these assert the renderer chrome only.
 *
 * @see HtmlPreviewPanel.tsx
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import { HtmlPreviewPanel, type HtmlPreviewPanelParams } from './HtmlPreviewPanel'
import { usePreviewStore } from '../../../stores/usePreviewStore'
import { usePreviewViewportStore } from '../../../stores/usePreviewViewportStore'
import { useSearchStore } from '../../../stores/useSearchStore'
import { ErrorCode } from '../../../../../shared/errors'
import type {
  PreviewFailureListPayload,
  PreviewForwardedShortcut,
  PreviewAllowlistChangedPayload,
  PreviewHostBlockedPayload,
  PreviewLoadStatePayload
} from '../../../../../shared/ipc/preview-schema'

// NOTE: no local ResizeObserver stub. `tests/setup/setupTests.renderer.ts`
// installs one that records its callback; a second, divergent no-op here meant
// the two files silently disagreed about what an observer does.

const CONTAINER_BOX = { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 }

/** Captured bridge event listeners so a test can drive main→renderer state. */
interface Listeners {
  loadState: ((p: PreviewLoadStatePayload) => void) | null
  failures: ((p: PreviewFailureListPayload) => void) | null
  hostBlocked: ((p: PreviewHostBlockedPayload) => void) | null
  allowlist: ((p: PreviewAllowlistChangedPayload) => void) | null
  forwardedShortcut: ((p: PreviewForwardedShortcut) => void) | null
}

const listeners: Listeners = {
  loadState: null,
  failures: null,
  hostBlocked: null,
  allowlist: null,
  forwardedShortcut: null
}

/** The fake `window.api.preview` bridge. */
interface MockPreview {
  open: Mock
  close: Mock
  reload: Mock
  setBounds: Mock
  find: Mock
  stopFind: Mock
  approveHost: Mock
  exportPdf: Mock
  onFindResult: Mock
  onLoadStateChanged: Mock
  onFailuresChanged: Mock
  onBackdropChanged: Mock
  onStillFrameChanged: Mock
  onHostBlocked: Mock
  onAllowlistChanged: Mock
  onBoundsApplied: Mock
  onVisibilityApplied: Mock
  onForwardedShortcut: Mock
}

let preview: MockPreview
let addPanel: Mock

function makeProps(filePath: string, panelId = 'preview-1'): IDockviewPanelProps<HtmlPreviewPanelParams> {
  const api = {
    id: panelId,
    isVisible: true,
    isActive: true,
    title: undefined as string | undefined,
    close: vi.fn(),
    setTitle: vi.fn(),
    onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const containerApi = {
    getPanel: vi.fn(() => undefined),
    addPanel
  }
  return { params: { filePath, panelId }, api, containerApi } as unknown as IDockviewPanelProps<HtmlPreviewPanelParams>
}

beforeEach(() => {
  listeners.loadState = null
  listeners.failures = null
  listeners.hostBlocked = null
  listeners.forwardedShortcut = null
  addPanel = vi.fn(() => ({ api: { setActive: vi.fn() }, group: { focus: vi.fn() } }))

  preview = {
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
    onStillFrameChanged: vi.fn(() => vi.fn()),
    onHostBlocked: vi.fn((cb: (p: PreviewHostBlockedPayload) => void) => {
      listeners.hostBlocked = cb
      return vi.fn()
    }),
    onAllowlistChanged: vi.fn((cb: (p: PreviewAllowlistChangedPayload) => void) => {
      listeners.allowlist = cb
      return vi.fn()
    }),
    onBoundsApplied: vi.fn(() => vi.fn()),
    onVisibilityApplied: vi.fn(() => vi.fn()),
    onForwardedShortcut: vi.fn((cb: (p: PreviewForwardedShortcut) => void) => {
      listeners.forwardedShortcut = cb
      return vi.fn()
    })
  }

  ;(window as unknown as { api: unknown }).api = { preview }

  Element.prototype.getBoundingClientRect = vi.fn(
    () => CONTAINER_BOX as DOMRect
  ) as unknown as typeof Element.prototype.getBoundingClientRect
})

afterEach(() => {
  cleanup()
  usePreviewStore.getState().reset()
  // Seeded by the published-rect cases; a leaked rect would place the next
  // test's toasts around a preview that is not in that test at all.
  usePreviewViewportStore.setState({ rects: new Map() })
  useSearchStore.getState().resetSearch()
  vi.clearAllMocks()
})

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

  it('always shows the "not Erfana" strip beside a live preview', () => {
    // A security control, not a label. The previewed page is untrusted, paints
    // above all sibling DOM, and now stays on screen while Erfana asks a
    // security question — so a permanently visible band of Erfana's own chrome
    // is how a reader tells a genuine prompt from one the page drew. It must not
    // be conditional on load state, failures or visibility.
    const { container } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    const strip = container.querySelector('.erf-band')
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain('not Erfana')
  })

  it('says WHICH SIDE of the strip is not Erfana', () => {
    // The wording carries the control. "Preview – not Erfana" on its own reads
    // as the strip disowning itself — but the strip IS Erfana, and the area
    // BELOW it is the untrusted page. A reader who cannot tell which side is
    // meant gets no protection from the band being there.
    const { container } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    const text = container.querySelector('.erf-band')?.textContent ?? ''
    expect(text).toContain('content below')
  })

  it('pins the strip to one unwrappable line', () => {
    // Read from the shipping stylesheet, the way Dialog.contrast.test.ts does:
    // the rule is the artefact, not a value duplicated in the test.
    //
    // The reason changed but the rule did not. It used to be that a wrapped
    // label would take a second line the FIXED 22px inset did not cover, and the
    // page would paint over it. There is no fixed inset any more — the strip is
    // in flow, so a second line would push the page down rather than be covered.
    // What is still true is that the strip is a one-line control whose text must
    // stay readable at any panel width; an ellipsis is the intended degradation,
    // a silent reflow is not. Lengthening the text is fine; letting it wrap is not.
    const css = readFileSync(resolve(__dirname, 'components/PreviewChromeBand.css'), 'utf8')
    const rule = css.slice(
      css.indexOf('.erf-band__label {'),
      css.indexOf('}', css.indexOf('.erf-band__label {'))
    )
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('overflow: hidden')
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

  it('routes failures into the store and renders no in-panel badge (AC20, §1.8)', async () => {
    // The badge lives in the tab now — the native view paints over this panel,
    // so a badge here would be invisible. The panel only feeds the store the
    // tab reads from; see HtmlPreviewTab.test.tsx for the indicator itself.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.failures).not.toBeNull())
    listeners.failures?.({
      panelId: 'preview-1',
      truncated: false,
      failures: [
        {
          id: '1',
          type: 'blocked-host',
          resourceUrlOrHost: 'cdn.example',
          reasonCode: ErrorCode.PREVIEW_HOST_NOT_APPROVABLE,
          timestamp: 1
        }
      ]
    })

    await waitFor(() =>
      expect(usePreviewStore.getState().getFailureCount('preview-1')).toBe(1)
    )
    // No badge is rendered inside the panel itself.
    expect(screen.queryByRole('button', { name: '1 preview issue' })).toBeNull()
  })

  it('records a blocked host the toast budget suppressed', async () => {
    // THE DEFECT, from the renderer's side. Host four raises no toast by design,
    // and used not to arrive at all — so it could not be listed and could not be
    // approved. It must now be recorded whatever `notify` says.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())

    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'fourth.example',
      approvable: true,
      kinds: ['image'],
      notify: false
    })

    await waitFor(() =>
      expect(usePreviewStore.getState().panels.get('preview-1')?.blockedHosts).toEqual([
        { host: 'fourth.example', kinds: ['image'], approvable: true }
      ])
    )
  })

  it('keeps the blocked-host list when the failure log is cleared', async () => {
    // Approving runs `applyApprovedHosts`, which clears the failure log and
    // reloads. A list derived from failures would empty under the reader's hands
    // precisely mid-cascade — as they are about to approve the next host.
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())

    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'cdn.example',
      approvable: true,
      kinds: ['script'],
      notify: true
    })
    await waitFor(() =>
      expect(usePreviewStore.getState().panels.get('preview-1')?.blockedHosts).toHaveLength(1)
    )

    act(() => {
      usePreviewStore.getState().clearFailures('preview-1')
    })

    expect(usePreviewStore.getState().panels.get('preview-1')?.blockedHosts).toHaveLength(1)
  })

  it('merges a repeat sighting instead of listing the host twice', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())

    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'cdn.example',
      approvable: true,
      kinds: ['style'],
      notify: true
    })
    listeners.hostBlocked?.({
      panelId: 'preview-1',
      host: 'cdn.example',
      approvable: true,
      kinds: ['style', 'script'],
      notify: false
    })

    await waitFor(() => {
      const rows = usePreviewStore.getState().panels.get('preview-1')?.blockedHosts ?? []
      expect(rows).toHaveLength(1)
      expect(rows[0].kinds).toEqual(['style', 'script'])
    })
  })

  it('ignores a blocked-host event for another panel (UX-001)', async () => {
    const toastEvents: CustomEvent[] = []
    const capture = (e: Event): void => {
      toastEvents.push(e as CustomEvent)
    }
    window.addEventListener('app:toast', capture)

    try {
      render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
      await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())
      listeners.hostBlocked?.({
        panelId: 'preview-other',
        host: 'cdn.example',
        approvable: true,
        kinds: ['script'],
        notify: true
      })
      // A microtask settle is enough; no toast must be dispatched.
      await Promise.resolve()
      expect(toastEvents.length).toBe(0)
    } finally {
      window.removeEventListener('app:toast', capture)
    }
  })

  it('exports to PDF on a forwarded Cmd/Ctrl+S (UX-003)', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.forwardedShortcut).not.toBeNull())
    listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 's', accel: true })

    await waitFor(() => expect(preview.exportPdf).toHaveBeenCalledWith('preview-1'))
  })

  it('closes the panel on a forwarded Cmd/Ctrl+W (UX-006)', async () => {
    const props = makeProps('/proj/page.html')
    render(<HtmlPreviewPanel {...props} />)

    await waitFor(() => expect(listeners.forwardedShortcut).not.toBeNull())
    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'w', accel: true }))

    expect(props.api.close).toHaveBeenCalledTimes(1)
  })

  it('opens find on a forwarded Cmd/Ctrl+F and closes it on Escape (UX-007)', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.forwardedShortcut).not.toBeNull())

    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'f', accel: true }))
    await waitFor(() => expect(useSearchStore.getState().isOpen).toBe(true))

    act(() => listeners.forwardedShortcut?.({ panelId: 'preview-1', key: 'Escape', accel: false }))
    await waitFor(() => expect(useSearchStore.getState().isOpen).toBe(false))
  })
})

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
import { useSearchStore } from '../../../stores/useSearchStore'
import { ErrorCode } from '../../../../../shared/errors'
import type {
  PreviewFailureListPayload,
  PreviewForwardedShortcut,
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
  forwardedShortcut: ((p: PreviewForwardedShortcut) => void) | null
}

const listeners: Listeners = {
  loadState: null,
  failures: null,
  hostBlocked: null,
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
    const strip = container.querySelector('.html-preview-chrome-strip')
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain('not Erfana')
  })

  it('says WHICH SIDE of the strip is not Erfana', () => {
    // The wording carries the control. "Preview – not Erfana" on its own reads
    // as the strip disowning itself — but the strip IS Erfana, and the area
    // BELOW it is the untrusted page. A reader who cannot tell which side is
    // meant gets no protection from the band being there.
    const { container } = render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)
    const text = container.querySelector('.html-preview-chrome-strip')?.textContent ?? ''
    expect(text).toContain('content below')
  })

  it('pins the strip to one unwrappable line', () => {
    // Read from the shipping stylesheet, the way Dialog.contrast.test.ts does:
    // the rule is the artefact, not a value duplicated in the test.
    //
    // Why this is not cosmetic. `PREVIEW_CHROME_INSET_PX` reserves a FIXED 22px
    // band and the native view is inset by exactly that much. A label long
    // enough to wrap would take a second line the inset does not cover, and the
    // untrusted page would paint over it — the one thing the strip exists to
    // prevent. Lengthening the text is fine; letting it wrap is not.
    const css = readFileSync(resolve(__dirname, 'HtmlPreviewPanel.css'), 'utf8')
    const rule = css.slice(
      css.indexOf('.html-preview-chrome-strip {'),
      css.indexOf('}', css.indexOf('.html-preview-chrome-strip {'))
    )
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('overflow: hidden')
    expect(rule).toContain('height: 22px')
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

  it('shows the failed banner and reloads on demand', async () => {
    render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

    await waitFor(() => expect(listeners.loadState).not.toBeNull())
    listeners.loadState?.({ panelId: 'preview-1', state: 'failed', dropped: 0 })

    const reload = await screen.findByRole('button', { name: 'Reload' })
    fireEvent.click(reload)
    expect(preview.reload).toHaveBeenCalledWith('preview-1')
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

  it('raises an approve action toast on an approvable blocked host (UX-001)', async () => {
    const toastEvents: CustomEvent[] = []
    const capture = (e: Event): void => {
      toastEvents.push(e as CustomEvent)
    }
    window.addEventListener('app:toast', capture)

    try {
      render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

      await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())
      listeners.hostBlocked?.({
        panelId: 'preview-1',
        host: 'cdn.example',
        approvable: true,
        kinds: ['script'],
        notify: true
      })

      await waitFor(() => expect(toastEvents.length).toBe(1))
      const detail = toastEvents[0].detail
      expect(detail.message).toContain('cdn.example')
      expect(detail.action?.label).toBe('Approve')

      // Activating the action approves the host; main reloads on its side.
      detail.action?.onClick()
      expect(preview.approveHost).toHaveBeenCalledWith('preview-1', 'cdn.example')
    } finally {
      window.removeEventListener('app:toast', capture)
    }
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

  it('raises a non-actionable toast on a non-approvable blocked host (UX-001)', async () => {
    const toastEvents: CustomEvent[] = []
    const capture = (e: Event): void => {
      toastEvents.push(e as CustomEvent)
    }
    window.addEventListener('app:toast', capture)

    try {
      render(<HtmlPreviewPanel {...makeProps('/proj/page.html')} />)

      await waitFor(() => expect(listeners.hostBlocked).not.toBeNull())
      listeners.hostBlocked?.({
        panelId: 'preview-1',
        host: 'evil.example',
        approvable: false,
        kinds: ['connect'],
        notify: true
      })

      await waitFor(() => expect(toastEvents.length).toBe(1))
      expect(toastEvents[0].detail.action).toBeUndefined()
      expect(preview.approveHost).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('app:toast', capture)
    }
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
      listeners.hostBlocked?.({ panelId: 'preview-other', host: 'cdn.example', approvable: true })
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

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tab identity across a same-tab move (issue #124, part 3 §3.4).
 *
 * Renders the REAL HTML preview registration wrapper – `PanelErrorBoundary`
 * around `HtmlPreviewPanel` – exactly as `EditorAreaSplitPanel` registers it,
 * and drives it through a fake preview bridge. Pins:
 * - the boundary is keyed by panel id with `resetKey = params.filePath`, so a
 *   move keeps the panel (and its native view) mounted;
 * - a crash after a move retries once and reopens the page the tab shows NOW;
 * - the tab store entry survives that remount and goes only with the panel;
 * - a `pageChanged` writes `params.filePath`, main's history and the page reset.
 *
 * `dockview` is mocked to capture the registration; dockview's own re-render
 * on `updateParameters` is pinned against the real library in
 * `HtmlPreviewTab.test.tsx`, so here the harness re-renders with the merged
 * params the way dockview does.
 *
 * @see EditorAreaSplitPanel.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { DockviewReadyEvent, IDockviewPanelProps, ISplitviewPanelProps } from 'dockview'

import type { HtmlPreviewPanelParams } from '../../Panels/HtmlPreviewPanel'
import type { PreviewPageChangedPayload } from '../../../../../shared/ipc/preview-navigation-schema'
import { TEST_IDS } from '../../../constants/testids'
import { resetPreviewLinkRouter } from '../../../services/preview/PreviewLinkRouter'
import { usePreviewStore } from '../../../stores/usePreviewStore'
import { usePreviewTabStore } from '../../../stores/usePreviewTabStore'

/** What the mocked DockviewReact received. */
const captured = vi.hoisted(() => ({
  components: undefined as Record<string, unknown> | undefined,
  onReady: undefined as ((event: DockviewReadyEvent) => void) | undefined
}))

vi.mock('dockview', () => ({
  DockviewReact: (props: {
    components: Record<string, unknown>
    onReady: (event: DockviewReadyEvent) => void
  }) => {
    captured.components = props.components
    captured.onReady = props.onReady
    return null
  }
}))

// MarkdownEditorPanel pulls in monaco-editor (unresolvable in the test env).
vi.mock('../../Panels/MarkdownEditorPanel', () => ({ MarkdownEditorPanel: () => null }))

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

/** The crash the boundary must contain: the toolbar throws when told to. */
const crash = vi.hoisted(() => ({ on: false }))
vi.mock('../../Panels/HtmlPreviewPanel/components/PreviewChromeBand', () => ({
  PreviewChromeBand: () => {
    if (crash.on) throw new Error('band exploded')
    return <div data-testid="band" />
  }
}))

import { EditorAreaSplitPanel } from './EditorAreaSplitPanel'

type Listener = (payload: unknown) => void

/** Bridge subscriptions, captured by method name. */
const listeners = new Map<string, Listener>()
let open: Mock
let close: Mock

/**
 * A fake `window.api.preview`. Every `on*` member captures its listener by
 * name and any other member is a stub, so a bridge member a later item adds
 * (`onResizeHold`, WI-11) does not break this suite.
 */
function installBridge(): void {
  open = vi.fn().mockResolvedValue({ ok: true })
  close = vi.fn().mockResolvedValue(undefined)
  const known: Record<string, unknown> = { open, close }
  const stubs = new Map<string, Mock>()
  const preview = new Proxy(known, {
    get(target, key) {
      if (typeof key !== 'string') return undefined
      if (key in target) return target[key]
      if (key.startsWith('on')) {
        return (callback: Listener) => {
          listeners.set(key, callback)
          return () => {
            if (listeners.get(key) === callback) listeners.delete(key)
          }
        }
      }
      if (!stubs.has(key)) stubs.set(key, vi.fn().mockResolvedValue(undefined))
      return stubs.get(key)
    }
  })
  ;(window as unknown as { api: unknown }).api = { preview }
}

/** Fire a main→renderer event into the panel. */
function emit(event: string, payload: unknown): void {
  act(() => {
    listeners.get(event)?.(payload)
  })
}

/** A committed page change for the tab. */
function pageChanged(overrides: Partial<PreviewPageChangedPayload> = {}): PreviewPageChangedPayload {
  return {
    panelId: 'preview-a',
    filePath: '/proj/b.html',
    anchor: null,
    sameDocument: false,
    canGoBack: true,
    canGoForward: false,
    backTarget: { filePath: '/proj/a.html', anchor: null },
    forwardTarget: null,
    generation: 2,
    failed: false,
    ...overrides
  }
}

/**
 * Mounts the registered preview wrapper for one tab. `rerender` merges params
 * the way dockview does after `updateParameters`.
 */
function mountPreview(initial: HtmlPreviewPanelParams) {
  const Wrapper = captured.components?.htmlPreview as ComponentType<
    IDockviewPanelProps<HtmlPreviewPanelParams>
  >
  let params = initial
  const api = {
    id: initial.panelId ?? 'preview-a',
    isVisible: true,
    isActive: true,
    title: undefined as string | undefined,
    setTitle: vi.fn(),
    close: vi.fn(),
    updateParameters: vi.fn(),
    onDidVisibilityChange: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const containerApi = { getPanel: vi.fn(), addPanel: vi.fn() }
  const element = () => (
    <Wrapper
      {...({ params, api, containerApi } as unknown as IDockviewPanelProps<HtmlPreviewPanelParams>)}
    />
  )
  const view = render(element())
  return {
    api,
    rerender(next: Partial<HtmlPreviewPanelParams>): void {
      params = { ...params, ...next }
      view.rerender(element())
    }
  }
}

/** Move the tab to b.html as main and dockview together would. */
function moveToB(harness: ReturnType<typeof mountPreview>): void {
  emit('onPageChanged', pageChanged())
  expect(harness.api.updateParameters).toHaveBeenCalledWith({ filePath: '/proj/b.html' })
  harness.rerender({ filePath: '/proj/b.html' })
}

beforeEach(() => {
  listeners.clear()
  crash.on = false
  installBridge()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <EditorAreaSplitPanel
      {...({ params: { setDockviewApi: vi.fn() } } as unknown as ISplitviewPanelProps)}
    />
  )
})

afterEach(() => {
  cleanup()
  resetPreviewLinkRouter()
  usePreviewStore.getState().reset()
  usePreviewTabStore.getState().reset()
  vi.restoreAllMocks()
})

describe('HTML preview boundary – keyed by panel id, reset by page', () => {
  it('keeps the panel mounted through a move: no close, no second open', async () => {
    const harness = mountPreview({ filePath: '/proj/a.html', panelId: 'preview-a' })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    moveToB(harness)
    await act(async () => {})

    expect(open).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByTestId('band')).toBeInTheDocument()
    expect(harness.api.setTitle).toHaveBeenLastCalledWith('b.html')
  })

  it('keeps B after a crash that follows a move, and retries exactly once', async () => {
    const harness = mountPreview({ filePath: '/proj/a.html', panelId: 'preview-a' })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    moveToB(harness)

    crash.on = true
    harness.rerender({})
    expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()
    // The boundary's unmount closed the view; main drops its history.
    expect(close).toHaveBeenCalledWith('preview-a')

    crash.on = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload html preview' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ panelId: 'preview-a', filePath: '/proj/b.html' })
    )
    await act(async () => {})
    expect(open).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('band')).toBeInTheDocument()
  })

  it('keeps the tab store entry through the remount', async () => {
    const harness = mountPreview({
      filePath: '/proj/a.html',
      panelId: 'preview-a',
      linkMode: 'same-tab'
    })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    moveToB(harness)
    const before = usePreviewTabStore.getState().getTab('preview-a')
    expect(before).toMatchObject({ linkMode: 'same-tab', canGoBack: true, generation: 2 })

    crash.on = true
    harness.rerender({})
    crash.on = false
    fireEvent.click(screen.getByRole('button', { name: 'Reload html preview' }))
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))

    expect(usePreviewTabStore.getState().getTab('preview-a')).toBe(before)
  })

  it('clears a stuck fallback when the tab shows another page (resetKey)', async () => {
    const harness = mountPreview({ filePath: '/proj/a.html', panelId: 'preview-a' })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    crash.on = true
    harness.rerender({})
    expect(screen.getByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeInTheDocument()

    crash.on = false
    harness.rerender({ filePath: '/proj/b.html' })

    expect(screen.queryByTestId(TEST_IDS.PANEL_ERROR_BOUNDARY)).toBeNull()
    expect(screen.getByTestId('band')).toBeInTheDocument()
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ filePath: '/proj/b.html' }))
  })

  it('treats another panel id as another tab', async () => {
    const harness = mountPreview({ filePath: '/proj/a.html', panelId: 'preview-a' })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))

    harness.rerender({ panelId: 'preview-b' })

    expect(close).toHaveBeenCalledWith('preview-a')
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ panelId: 'preview-b' }))
  })

  it('drops the tab store entry when dockview removes the panel – and not on unmount', async () => {
    let removed: ((panel: { id: string }) => void) | undefined
    const dispose = { dispose: vi.fn() }
    captured.onReady?.({
      api: {
        addPanel: vi.fn(() => ({ group: {} })),
        onDidActivePanelChange: vi.fn(() => dispose),
        onDidRemovePanel: vi.fn((listener: (panel: { id: string }) => void) => {
          removed = listener
          return dispose
        })
      }
    } as unknown as DockviewReadyEvent)

    mountPreview({ filePath: '/proj/a.html', panelId: 'preview-a', linkMode: 'same-tab' })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    cleanup()
    expect(usePreviewTabStore.getState().tabs.has('preview-a')).toBe(true)

    removed?.({ id: 'preview-a' })

    expect(usePreviewTabStore.getState().tabs.has('preview-a')).toBe(false)
  })
})

describe('a page change (preview:pageChanged)', () => {
  /** A tab on a.html with a blocked host and a failure badge. */
  async function tabOnAWithHosts() {
    const harness = mountPreview({ filePath: '/proj/a.html', panelId: 'preview-a' })
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    emit('onHostBlocked', {
      panelId: 'preview-a',
      host: 'https://cdn.example',
      kinds: ['script'],
      approvable: true,
      notify: false
    })
    return harness
  }

  it("writes main's Back and Forward state into the tab store", async () => {
    await tabOnAWithHosts()

    emit('onPageChanged', pageChanged({ canGoForward: true, generation: 7 }))

    expect(usePreviewTabStore.getState().getTab('preview-a')).toMatchObject({
      canGoBack: true,
      canGoForward: true,
      backTarget: { filePath: '/proj/a.html', anchor: null },
      generation: 7
    })
  })

  it("drops the old page's hosts on a new document but keeps main's failure snapshot", async () => {
    await tabOnAWithHosts()
    // B's snapshot, sent at the commit, can arrive before pageChanged (RS2-3).
    usePreviewStore.getState().pushFailures('preview-a', [
      {
        id: 'b-1',
        type: 'missing-local-file',
        resourceUrlOrHost: 'missing.css',
        timestamp: 1
      } as never
    ])

    emit('onPageChanged', pageChanged())

    const panel = usePreviewStore.getState().getPanel('preview-a')
    expect(panel?.blockedHosts).toEqual([])
    expect(panel?.failures.map((failure) => failure.id)).toEqual(['b-1'])
  })

  it('keeps the hosts and writes no params for a #section step (sameDocument)', async () => {
    const harness = await tabOnAWithHosts()

    emit(
      'onPageChanged',
      pageChanged({ filePath: '/proj/a.html', anchor: 'pricing', sameDocument: true })
    )

    expect(usePreviewStore.getState().getPanel('preview-a')?.blockedHosts).toHaveLength(1)
    expect(harness.api.updateParameters).not.toHaveBeenCalled()
  })

  it('writes params.filePath once, even when two events arrive before the re-render', async () => {
    const harness = await tabOnAWithHosts()

    emit('onPageChanged', pageChanged())
    emit('onPageChanged', pageChanged({ sameDocument: true, anchor: 'top' }))

    expect(harness.api.updateParameters).toHaveBeenCalledTimes(1)
  })

  it('still writes a move straight back before the re-render (A → B → A)', async () => {
    const harness = await tabOnAWithHosts()

    emit('onPageChanged', pageChanged())
    emit('onPageChanged', pageChanged({ filePath: '/proj/a.html', generation: 3 }))

    expect(harness.api.updateParameters.mock.calls).toEqual([
      [{ filePath: '/proj/b.html' }],
      [{ filePath: '/proj/a.html' }]
    ])
  })

  it("ignores another panel's page change", async () => {
    const harness = await tabOnAWithHosts()

    emit('onPageChanged', pageChanged({ panelId: 'preview-other' }))

    expect(harness.api.updateParameters).not.toHaveBeenCalled()
    expect(usePreviewTabStore.getState().getTab('preview-a').generation).toBe(0)
    expect(usePreviewStore.getState().getPanel('preview-a')?.blockedHosts).toHaveLength(1)
  })
})

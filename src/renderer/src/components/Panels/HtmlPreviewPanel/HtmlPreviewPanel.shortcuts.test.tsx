// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Forwarded-shortcut tests for {@link HtmlPreviewPanel}: Cmd/Ctrl+S, +W, +F
 * and Escape arrive from main because the native view swallows renderer keys.
 *
 * Also the group-element route: a tab switch leaves focus on dockview's group
 * element, outside the panel root, and the active preview still takes the
 * comment-mode chord and Back from there (`usePreviewGroupKeys`).
 *
 * Split out of `HtmlPreviewPanel.test.tsx` by concern (issue #124, 500-line
 * cap); the shared fake bridge is `__test__/panelHarness.ts`.
 *
 * @see HtmlPreviewPanel.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act, fireEvent, within, cleanup } from '@testing-library/react'
import type { IDockviewPanelProps } from 'dockview'

import { HtmlPreviewPanel, type HtmlPreviewPanelParams } from './HtmlPreviewPanel'
import { useSearchStore } from '../../../stores/useSearchStore'
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { usePreviewCommentStore } from '../../../stores/usePreviewCommentStore'
import { usePreviewTabStore } from '../../../stores/usePreviewTabStore'
import { useProjectStore } from '../../../stores/useProjectStore'
import {
  mountPreviewLinkRouter,
  resetPreviewLinkRouter
} from '../../../services/preview/PreviewLinkRouter'
import { installHtmlPreviewPanelHarness } from './__test__/panelHarness'
import {
  installCommentsBridge,
  type FakeCommentsBridge
} from './comments/__test-helpers__/commentTestKit'

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

const { listeners, preview, makeProps } = installHtmlPreviewPanelHarness()

describe('HtmlPreviewPanel – forwarded shortcuts', () => {
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

/** The comment-mode chord on Windows (the platform comes from the bridge). */
const CHORD = { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true }
/** Windows Back. */
const ALT_LEFT = { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }

describe('HtmlPreviewPanel – keys on the dockview group element', () => {
  let fake: FakeCommentsBridge

  beforeEach(() => {
    fake = installCommentsBridge()
    ;(window.api as unknown as { utils: unknown }).utils = { getPlatform: () => 'win32' }
    useGlobalSettingsStore.setState({
      settings: {
        comments: { authorName: 'Ada', identityNoticeSeen: true },
        htmlPreview: { comments: { enabled: true } }
      } as never
    })
  })

  afterEach(() => {
    cleanup()
    fake.uninstall()
    usePreviewCommentStore.getState().reset()
    useGlobalSettingsStore.setState({ settings: null })
    resetPreviewLinkRouter()
    useProjectStore.setState({ dockviewApi: null })
    document.querySelectorAll('[data-test-group]').forEach((node) => node.remove())
  })

  /**
   * Renders the panel the way dockview does for `renderer: 'always'`: its DOM
   * in an overlay container, and its group element a separate node that
   * `group.focus()` leaves focus on.
   */
  function renderInGroup(): {
    group: HTMLElement
    element: HTMLElement
    props: IDockviewPanelProps<HtmlPreviewPanelParams>
  } {
    const props = makeProps('/proj/page.html')
    const group = document.createElement('div')
    group.className = 'dv-groupview dv-active-group'
    group.tabIndex = -1
    group.dataset.testGroup = ''
    document.body.appendChild(group)
    Object.assign(props.api, {
      group: { element: group },
      onDidGroupChange: vi.fn(() => ({ dispose: vi.fn() }))
    })
    const element = document.createElement('div')
    element.dataset.testGroup = ''
    document.body.appendChild(element)
    ;(props.containerApi as unknown as { getPanel: (id: string) => unknown }).getPanel = (id) =>
      id === 'preview-1'
        ? {
            id,
            params: props.params,
            view: { contentComponent: 'htmlPreview', content: { element } }
          }
        : undefined
    render(<HtmlPreviewPanel {...props} />, { container: element })
    return { group, element, props }
  }

  it('toggles comment mode on the chord once the page is ready', async () => {
    const { group, element } = renderInGroup()
    act(() => listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 }))
    const modeButton = await within(element).findByTestId('preview-band-comment-mode')
    expect(modeButton.getAttribute('aria-pressed')).toBe('false')

    group.focus()
    fireEvent.keyDown(group, CHORD)

    await waitFor(() => expect(modeButton.getAttribute('aria-pressed')).toBe('true'))
    expect(fake.bridge.setMode).toHaveBeenCalledTimes(1)
    expect(fake.bridge.setMode).toHaveBeenCalledWith({
      panelId: 'preview-1',
      on: true,
      showIcons: true
    })
  })

  it('leaves the chord alone while the tab is not the active one', async () => {
    const { group, props } = renderInGroup()
    act(() => listeners.loadState?.({ panelId: 'preview-1', state: 'ready', dropped: 0 }))
    ;(props.api as unknown as { isActive: boolean }).isActive = false

    fireEvent.keyDown(group, CHORD)

    expect(fake.bridge.setMode).not.toHaveBeenCalled()
  })

  it('steps Back on the Back key', async () => {
    const dockApi = {
      get panels() {
        return []
      },
      getPanel: (): undefined => undefined
    }
    const { group, props } = renderInGroup()
    // The coordinator reads panels through the project's dockview api.
    dockApi.getPanel = props.containerApi.getPanel as never
    useProjectStore.setState({ dockviewApi: dockApi as never })
    mountPreviewLinkRouter({ prompt: null, closePanel: vi.fn() })
    act(() =>
      usePreviewTabStore.getState().setHistory('preview-1', {
        canGoBack: true,
        canGoForward: false,
        backTarget: { filePath: '/proj/overview.html', anchor: null },
        forwardTarget: null,
        generation: 2
      })
    )

    const notHandled = fireEvent.keyDown(group, ALT_LEFT)

    expect(notHandled).toBe(false)
    await waitFor(() =>
      expect(preview.navigate).toHaveBeenCalledWith({
        panelId: 'preview-1',
        phase: 'check',
        action: 'back',
        generation: 2
      })
    )
  })
})

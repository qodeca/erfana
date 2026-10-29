// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The panel's comment wiring (docs/designs/comments/html-preview-comments.md §4.2,
 * §7.3–§7.7, §10.1; R-010, R-013, R-018, R-023).
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../../shared/errors'
import type { GlobalSettings } from '../../../../../../shared/ipc/global-settings-schema'
import { useGlobalSettingsStore } from '../../../../stores/useGlobalSettingsStore'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import { usePreviewCommentStore } from '../../../../stores/usePreviewCommentStore'
import { usePreviewCoveredStore } from '../../../../stores/usePreviewCoveredStore'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(async () => true),
  openFileInPanel: vi.fn(),
  mac: false
}))
vi.mock('../../../../services/textClipboard', () => ({
  textClipboard: { writeText: mocks.writeText }
}))
vi.mock('../../../../utils/openFileInPanel', () => ({ openFileInPanel: mocks.openFileInPanel }))
vi.mock('../../../../utils/platform', () => ({ isMacOS: () => mocks.mac, isWindows: () => !mocks.mac }))

import {
  damaged,
  fileView,
  installCommentsBridge,
  menuDraft,
  newRequest,
  thread,
  type FakeCommentsBridge
} from './__test-helpers__/commentTestKit'
import { ANNOUNCE, COPY, DRAWER_COPY } from './commentCopy'
import { drawerRows } from './commentRows'
import { usePreviewComments, type PreviewComments } from './usePreviewComments'
import { resetCommentPendingWrites } from './commentPendingWrites'

const PANEL = 'preview-index'

/** A pin click: main's `icon` draft for thread t1. */
const pinDraft = () => ({
  panelId: PANEL,
  kind: 'icon' as const,
  point: { x: 1, y: 2 },
  displayPath: 'index.html',
  filePath: '/project/index.html',
  frame: false,
  fileKey: 'f1',
  threadKeys: ['t1'],
  blockKeys: []
})

/** Deliver one resize to every live `MockResizeObserver` (the test setup's). */
function resizeAll(): void {
  const { instances } = globalThis.ResizeObserver as unknown as {
    instances: Array<{ trigger: () => void }>
  }
  for (const observer of [...instances]) observer.trigger()
}

/** This tab's page is gated behind its full-width drawer. */
const isCovered = (): boolean => usePreviewCoveredStore.getState().isCovered(PANEL)

function settingsWith(patch: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    comments: { authorName: 'Ada', identityNoticeSeen: true },
    htmlPreview: { comments: { enabled: true } },
    ...patch
  } as unknown as GlobalSettings
}

interface HarnessProps {
  readonly filePath?: string
  readonly ready?: boolean
  readonly width?: number
  /** 0 with `width` 0: the tab dockview hid (`display: none`). */
  readonly height?: number
  /** dockview shows this tab (`DOCKVIEW_PANEL_VISIBLE`). */
  readonly visible?: boolean
  readonly onValue: (value: PreviewComments) => void
}

function Harness({
  filePath = '/project/index.html',
  ready = true,
  width = 1000,
  height = 600,
  visible = true,
  onValue
}: HarnessProps) {
  const pageAreaRef = useRef<HTMLDivElement>(null)
  const panelRootRef = useRef<HTMLDivElement | null>(null)
  const value = usePreviewComments({
    panelId: PANEL,
    filePath,
    ready,
    pageAreaRef,
    panelRootRef,
    containerApi: undefined,
    visible
  })
  onValue(value)
  return (
    <div
      ref={node => {
        panelRootRef.current = node
        if (node)
          node.getBoundingClientRect = () => ({ width, height, left: 0, top: 0 }) as DOMRect
      }}
      onKeyDown={value.onRootKeyDown}
      data-testid="root"
    >
      <div ref={pageAreaRef} />
    </div>
  )
}

describe('usePreviewComments', () => {
  let fake: FakeCommentsBridge
  let latest: PreviewComments
  const focusPage = vi.fn(async () => ({ ok: true }))
  const onValue = (value: PreviewComments) => {
    latest = value
  }

  beforeEach(() => {
    fake = installCommentsBridge()
    ;(window as unknown as { api: Record<string, unknown> }).api.preview = { focusPage }
    useGlobalSettingsStore.setState({ settings: settingsWith() })
    useOverlayOccluderStore.getState().reset()
    usePreviewCoveredStore.setState({ covered: new Set() })
  })
  afterEach(async () => {
    // Unmount before resetting the stores, so the reset is not a state update
    // on a mounted harness; then let any queued announcement frame run out.
    cleanup()
    await new Promise(resolve => requestAnimationFrame(resolve))
    fake.uninstall()
    usePreviewCommentStore.getState().reset()
    resetCommentPendingWrites()
    useGlobalSettingsStore.setState({ settings: null })
    vi.clearAllMocks()
  })

  it('is off without settings, with the flag off, or without a bridge', () => {
    useGlobalSettingsStore.setState({ settings: null })
    const { rerender } = render(<Harness onValue={onValue} />)
    expect(latest.enabled).toBe(false)
    act(() =>
      useGlobalSettingsStore.setState({
        settings: settingsWith({ htmlPreview: { comments: { enabled: false } } } as never)
      })
    )
    rerender(<Harness onValue={onValue} />)
    expect(latest.enabled).toBe(false)
    act(() => useGlobalSettingsStore.setState({ settings: settingsWith() }))
    rerender(<Harness onValue={onValue} />)
    expect(latest.enabled).toBe(true)
  })

  it('a menu draft opens the menu; Add comment turns it into a new-comment window', () => {
    render(<Harness onValue={onValue} />)
    const draft = menuDraft()
    act(() => fake.emitDraft(draft))
    expect(latest.layer.menu).toEqual(draft)
    act(() => latest.layer.onAddComment(draft))
    expect(latest.layer.request).toMatchObject({
      kind: 'new',
      draftToken: draft.draftToken,
      opener: 'page'
    })
  })

  it('ignores another panel’s events', () => {
    render(<Harness onValue={onValue} />)
    act(() => fake.emitDraft(menuDraft({ panelId: 'preview-other' })))
    act(() => fake.emitMode({ panelId: 'preview-other', on: true, reason: 'shortcut' }))
    act(() =>
      fake.emitChanged({ panelId: 'preview-other', counts: { open: 1, resolved: 0, attention: 0 } })
    )
    act(() => fake.emitAnchors({ panelId: 'preview-other', notVisible: ['t1'] }))
    expect(latest.layer.menu).toBeNull()
    expect(latest.toolbar.mode).toBe(false)
    expect(latest.toolbar.counts).toBeNull()
  })

  it('R-018 an open draft opens the window directly, with no menu', () => {
    render(<Harness onValue={onValue} />)
    act(() => fake.emitDraft(menuDraft({ kind: 'open' })))
    expect(latest.layer.menu).toBeNull()
    expect(latest.layer.request).toMatchObject({ kind: 'new', panelId: PANEL })
  })

  it('an open draft without a token falls back to the menu ("Can\'t comment here")', () => {
    render(<Harness onValue={onValue} />)
    act(() => fake.emitDraft(menuDraft({ kind: 'open', draftToken: undefined, target: undefined })))
    expect(latest.layer.request).toBeNull()
    expect(latest.layer.menu).not.toBeNull()
  })

  it.each([
    ['carries a valid pin draft token and its element key into the threads request', 'c'.repeat(32), 'd'.repeat(32), true],
    ['drops a malformed token', 'not-a-token', 'd'.repeat(32), false],
    ['M1 drops a draft whose element key is malformed', 'c'.repeat(32), '/project/index.html|3|p', false]
  ])('%s, and New comment switches to the new view', (_label, sent, sentKey, kept) => {
    render(<Harness onValue={onValue} />)
    act(() =>
      fake.emitDraft({
        panelId: PANEL,
        kind: 'icon',
        point: { x: 1, y: 2 },
        displayPath: 'index.html',
        filePath: '/project/index.html',
        frame: false,
        fileKey: 'f1',
        threadKeys: ['t1'],
        blockKeys: [],
        draftToken: sent,
        draftKey: sentKey,
        target: { tag: 'p', classes: [], line: 3, excerpt: '<p id="x">' }
      } as never)
    )
    const opened = latest.layer.request as { draftToken?: string; draftKey?: string }
    expect(opened.draftToken).toBe(kept ? sent : undefined)
    expect(opened.draftKey).toBe(kept ? sentKey : undefined)
    expect(latest.layer.request).toMatchObject({
      kind: 'threads',
      file: { fileKey: 'f1' },
      // A: main's own description of the element rides along for New comment.
      target: { tag: 'p', line: 3 }
    })
    const next = newRequest()
    act(() => latest.layer.onNewComment(next))
    expect(latest.layer.request).toBe(next)
  })

  it('a pin opens the threads window and reads the list', async () => {
    render(<Harness onValue={onValue} />)
    act(() =>
      fake.emitDraft({
        panelId: PANEL,
        kind: 'icon',
        point: { x: 1, y: 2 },
        displayPath: 'index.html',
        filePath: '/project/index.html',
        frame: false,
        fileKey: 'f1',
        threadKeys: ['t1'],
        blockKeys: []
      })
    )
    expect(latest.layer.request).toMatchObject({ kind: 'threads', threadKeys: ['t1'] })
    await waitFor(() => expect(fake.bridge.list).toHaveBeenCalledWith(PANEL))
  })

  it('applies counts, anchors and main’s mode changes, announcing the mode', async () => {
    render(<Harness onValue={onValue} />)
    act(() => fake.emitChanged({ panelId: PANEL, counts: { open: 2, resolved: 0, attention: 1 } }))
    act(() => fake.emitAnchors({ panelId: PANEL, notVisible: ['t2'] }))
    act(() => fake.emitMode({ panelId: PANEL, on: true, reason: 'escape' }))
    expect(latest.toolbar.counts).toEqual({ open: 2, resolved: 0, attention: 1 })
    expect(latest.layer.notVisible).toEqual(['t2'])
    expect(latest.toolbar.mode).toBe(true)
    await waitFor(() => expect(latest.layer.polite).toBe(ANNOUNCE.modeOn))
    // A list that was never read is not re-read on a change event.
    expect(fake.bridge.list).not.toHaveBeenCalled()
  })

  it('E-022 says where the page’s keyboard picker is, without touching the mode', async () => {
    render(<Harness onValue={onValue} />)
    act(() => fake.emitMode({ panelId: PANEL, on: true, reason: 'escape' }))
    await waitFor(() => expect(latest.layer.polite).toBe(ANNOUNCE.modeOn))
    act(() => fake.emitMode({ panelId: PANEL, on: false, reason: 'picker', say: 'showing', element: { tag: 'p', line: 12 } }))
    await waitFor(() => expect(latest.layer.polite).toBe('Showing p, line 12.'))
    // A picker event is not a mode change, whatever its `on` says.
    expect(latest.toolbar.mode).toBe(true)
    act(() => fake.emitMode({ panelId: PANEL, on: true, reason: 'picker', say: 'top' }))
    await waitFor(() => expect(latest.layer.polite).toBe('Top of page – no parent to select.'))
    act(() => fake.emitMode({ panelId: PANEL, on: true, reason: 'picker', say: 'no-child' }))
    await waitFor(() => expect(latest.layer.polite).toBe('No child elements.'))
  })

  describe('R-010 / R-023 mode', () => {
    it('toggles through main and announces it; a keyboard toggle hands focus to the page', async () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleMode(true))
      expect(latest.toolbar.mode).toBe(true)
      await waitFor(() =>
        expect(fake.bridge.setMode).toHaveBeenCalledWith({
          panelId: PANEL,
          on: true,
          showIcons: true
        })
      )
      await waitFor(() => expect(latest.layer.polite).toBe(ANNOUNCE.modeOn))
      expect(focusPage).toHaveBeenCalledWith(PANEL)
    })

    it('rolls back when main refuses', async () => {
      fake.bridge.setMode.mockResolvedValueOnce({
        ok: false,
        code: ErrorCode.UNKNOWN_ERROR
      } as never)
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleMode(false))
      await waitFor(() => expect(latest.layer.polite).toBe(ANNOUNCE.modeOff))
      expect(latest.toolbar.mode).toBe(false)
    })

    it('R-023 survives a same-tab navigation and the save reload', async () => {
      const { rerender } = render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleMode(false))
      await waitFor(() => expect(latest.toolbar.mode).toBe(true))
      // Save reload: the page leaves 'ready' for a moment.
      rerender(<Harness onValue={onValue} ready={false} />)
      rerender(<Harness onValue={onValue} ready />)
      expect(latest.toolbar.mode).toBe(true)
      // Same-tab move to another page of the project.
      rerender(<Harness onValue={onValue} filePath="/project/about.html" />)
      expect(latest.toolbar.mode).toBe(true)
    })

    it('a page change closes an open menu and window', () => {
      const { rerender } = render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(menuDraft()))
      rerender(<Harness onValue={onValue} filePath="/project/about.html" />)
      expect(latest.layer.menu).toBeNull()
      expect(latest.layer.request).toBeNull()
    })

    it('toggles icons with the mode kept', async () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleIcons())
      await waitFor(() =>
        expect(fake.bridge.setMode).toHaveBeenCalledWith({
          panelId: PANEL,
          on: false,
          showIcons: false
        })
      )
      expect(latest.toolbar.showIcons).toBe(false)
    })

    it('Ctrl+Alt+M on the panel toggles the mode', async () => {
      const { getByTestId } = render(<Harness onValue={onValue} />)
      fireEvent.keyDown(getByTestId('root'), { key: 'm', ctrlKey: true, altKey: true })
      await waitFor(() => expect(latest.toolbar.mode).toBe(true))
      // Not with Shift, not without Alt, and not before the page is ready.
      fireEvent.keyDown(getByTestId('root'), {
        key: 'm',
        ctrlKey: true,
        altKey: true,
        shiftKey: true
      })
      fireEvent.keyDown(getByTestId('root'), { key: 'm', ctrlKey: true })
      expect(fake.bridge.setMode).toHaveBeenCalledTimes(1)
    })

    it('M3 Windows: AltGr+M keeps typing µ, AZERTY "," is not M, and only Ctrl+Alt exactly toggles', () => {
      const { getByTestId } = render(<Harness onValue={onValue} />)
      // AltGr is Ctrl+Alt on Windows: the physical M typing µ (German layout) is the page's, not the shortcut.
      fireEvent.keyDown(getByTestId('root'), { key: 'µ', code: 'KeyM', ctrlKey: true, altKey: true })
      // AZERTY: the KeyM position types ",", which is not the M shortcut.
      fireEvent.keyDown(getByTestId('root'), { key: ',', code: 'KeyM', ctrlKey: true, altKey: true })
      // Cmd+Option is the macOS chord; an extra modifier is another chord.
      fireEvent.keyDown(getByTestId('root'), { key: 'm', code: 'KeyM', metaKey: true, altKey: true })
      fireEvent.keyDown(getByTestId('root'), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true, metaKey: true })
      expect(fake.bridge.setMode).not.toHaveBeenCalled()
    })

    it('M3 macOS: Cmd+Option on the M key toggles whatever non-ASCII character it types, never AZERTY ","', async () => {
      mocks.mac = true
      try {
        const { getByTestId } = render(<Harness onValue={onValue} />)
        fireEvent.keyDown(getByTestId('root'), { key: ',', code: 'KeyM', metaKey: true, altKey: true })
        fireEvent.keyDown(getByTestId('root'), { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
        expect(fake.bridge.setMode).not.toHaveBeenCalled()
        // Option turns M into µ (ABC) or Ķ (Polish): the physical key decides.
        fireEvent.keyDown(getByTestId('root'), { key: 'µ', code: 'KeyM', metaKey: true, altKey: true })
        await waitFor(() => expect(fake.bridge.setMode).toHaveBeenCalledTimes(1))
      } finally {
        mocks.mac = false
      }
    })

    it('ignores the shortcut while the page is not ready or a window is open', () => {
      const { getByTestId, rerender } = render(<Harness onValue={onValue} ready={false} />)
      fireEvent.keyDown(getByTestId('root'), { key: 'm', ctrlKey: true, altKey: true })
      rerender(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(menuDraft({ kind: 'open' })))
      fireEvent.keyDown(getByTestId('root'), { key: 'm', ctrlKey: true, altKey: true })
      expect(fake.bridge.setMode).not.toHaveBeenCalled()
    })
  })

  describe('drawer', () => {
    it('opens, reads the list and refreshes on a change event', async () => {
      fake.bridge.list.mockResolvedValue({ ok: true, files: [fileView({ threads: [thread(1)] })] })
      render(<Harness onValue={onValue} />)
      expect(latest.drawer).toBeNull()
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer).not.toBeNull()
      await waitFor(() => expect(latest.drawer?.list.status).toBe('ready'))
      act(() =>
        fake.emitChanged({ panelId: PANEL, counts: { open: 1, resolved: 0, attention: 0 } })
      )
      await waitFor(() => expect(fake.bridge.list).toHaveBeenCalledTimes(2))
      act(() => latest.drawer?.onRetry())
      await waitFor(() => expect(fake.bridge.list).toHaveBeenCalledTimes(3))
      act(() => latest.drawer?.onClose())
      expect(latest.drawer).toBeNull()
    })

    it('E-005 an anchor status after the list wins over the flag the list was read with', async () => {
      fake.bridge.list.mockResolvedValue({
        ok: true,
        files: [fileView({ threads: [thread(1, { notVisible: true })] })]
      })
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      await waitFor(() => expect(latest.drawer?.list.status).toBe('ready'))
      const tags = (): string[] => {
        const drawer = latest.drawer!
        const [row] = drawerRows(drawer.list.files, new Set(drawer.notVisible)).open
        return row.tags.map(tag => tag.text)
      }
      expect(tags()).toContain(DRAWER_COPY.notVisible)
      // The element is rendered again: main reports nothing hidden.
      act(() => fake.emitAnchors({ panelId: PANEL, notVisible: [] }))
      expect(tags()).not.toContain(DRAWER_COPY.notVisible)
      act(() => fake.emitAnchors({ panelId: PANEL, notVisible: ['t1'] }))
      expect(tags()).toContain(DRAWER_COPY.notVisible)
    })

    it('re-reads on a page change while open', async () => {
      const { rerender } = render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      await waitFor(() => expect(fake.bridge.list).toHaveBeenCalledTimes(1))
      rerender(<Harness onValue={onValue} filePath="/project/about.html" />)
      await waitFor(() => expect(fake.bridge.list).toHaveBeenCalledTimes(2))
    })

    it('goes full width in a narrow panel and hides its own page – through its panel gate', () => {
      render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer?.full).toBe(true)
      expect(isCovered()).toBe(true)
    })

    it('stays a side panel without hiding anything in a wide one', () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer?.full).toBe(false)
      expect(isCovered()).toBe(false)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })

    it('lifts the gate when the sheet closes, when the panel widens, and on unmount', () => {
      const { rerender, unmount } = render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(isCovered()).toBe(true)
      act(() => latest.drawer?.onClose())
      expect(isCovered()).toBe(false)
      act(() => latest.toolbar.onToggleDrawer())
      expect(isCovered()).toBe(true)
      rerender(<Harness onValue={onValue} width={900} />)
      act(() => resizeAll())
      expect(latest.drawer?.full).toBe(false)
      expect(isCovered()).toBe(false)
      rerender(<Harness onValue={onValue} width={500} />)
      act(() => resizeAll())
      expect(isCovered()).toBe(true)
      unmount()
      expect(isCovered()).toBe(false)
    })

    // Owner bug: with the drawer open on one preview tab, switching to another
    // froze the other tab on its still frame. dockview hides an inactive tab
    // with `display: none`, so the hidden root measures 0×0 – which read as
    // "narrow" – and the full-width drawer's hide was the window's GLOBAL
    // occluder, which hides every preview, the one on screen included.
    it('a tab dockview hides keeps a side drawer a side drawer, and hides no other preview', () => {
      const { rerender } = render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer?.full).toBe(false)
      rerender(<Harness onValue={onValue} width={0} height={0} />)
      act(() => resizeAll())
      expect(latest.drawer?.full).toBe(false)
      expect(isCovered()).toBe(false)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })

    it('a full-width drawer never hides the window\'s other previews – not even while its tab is hidden', () => {
      const { rerender } = render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer?.full).toBe(true)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
      rerender(<Harness onValue={onValue} width={0} height={0} />)
      act(() => resizeAll())
      // The last real width stands: the tab comes back as the sheet it left,
      // its own page still gated, so it is never shown over the sheet.
      expect(latest.drawer?.full).toBe(true)
      expect(isCovered()).toBe(true)
      expect(usePreviewCoveredStore.getState().covered).toEqual(new Set([PANEL]))
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })

    it('Show on page reveals the thread and says when it is not on screen', async () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows(
        [fileView({ threads: [thread(1, { notVisible: true })] })],
        new Set()
      ).open
      act(() => latest.drawer?.onReveal(row))
      expect(fake.bridge.reveal).toHaveBeenCalledWith(PANEL, 't1')
      await waitFor(() => expect(latest.layer.polite).toBe(DRAWER_COPY.notOnScreen))
    })

    it('Show on page closes a full-width drawer first', () => {
      render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ threads: [thread(1)] })], new Set()).open
      act(() => latest.drawer?.onReveal(row))
      expect(latest.drawer).toBeNull()
    })

    it('H3 a full-width drawer closed by Show on page hands focus natively to the page', async () => {
      render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ threads: [thread(1)] })], new Set()).open
      act(() => latest.drawer?.onReveal(row))
      await waitFor(() => expect(focusPage).toHaveBeenCalledWith(PANEL))
    })

    it('a side drawer keeps focus on its row after Show on page', async () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ threads: [thread(1)] })], new Set()).open
      act(() => latest.drawer?.onReveal(row))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      expect(focusPage).not.toHaveBeenCalled()
      expect(latest.drawer).not.toBeNull()
    })

    it('a block row has nothing to reveal and opens in source', () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ damaged: [damaged(1)] })], new Set()).attention
      act(() => latest.drawer?.onReveal(row))
      expect(fake.bridge.reveal).not.toHaveBeenCalled()
      act(() => latest.drawer?.onOpenInSource(row))
      expect(mocks.openFileInPanel).toHaveBeenCalledWith(undefined, '/project/index.html', {
        kind: 'editor',
        params: { initialLine: 41 }
      })
    })

    it('Open opens the threads window from the drawer', () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ damaged: [damaged(1)] })], new Set()).attention
      act(() => latest.drawer?.onOpen(row))
      expect(latest.layer.request).toMatchObject({
        kind: 'threads',
        blockKeys: ['b1'],
        threadKeys: [],
        opener: 'drawer',
        // M7: the file rides along, so a failed read can name it.
        file: { fileKey: 'f1', displayPath: 'index.html', frame: false }
      })
      // A block row has no element to bring into view.
      expect(fake.bridge.reveal).not.toHaveBeenCalled()
    })

    it('§19 Rev 4 Open on a thread also reveals its element behind the window – unfolding a closed <details> – and keeps the drawer', () => {
      render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ threads: [thread(1, { notVisible: true })] })], new Set()).open
      act(() => latest.drawer?.onOpen(row))
      expect(fake.bridge.reveal).toHaveBeenCalledWith(PANEL, 't1')
      expect(latest.layer.request).toMatchObject({ kind: 'threads', threadKeys: ['t1'], opener: 'drawer' })
      // Unlike Show on page, the window takes over: the drawer stays, and nothing is announced.
      expect(latest.drawer).not.toBeNull()
      expect(latest.layer.polite).toBe('')
    })

    it('the drawer icons checkbox goes through main', async () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      act(() => latest.drawer?.onShowIconsChange(false))
      await waitFor(() =>
        expect(fake.bridge.setMode).toHaveBeenCalledWith({
          panelId: PANEL,
          on: false,
          showIcons: false
        })
      )
    })
  })

  describe('R-013 window close, focus return and live-region announcements', () => {
    it('announces "Comment saved" and closes the window after an add', async () => {
      render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(menuDraft({ kind: 'open' })))
      act(() =>
        latest.layer.onWritten(
          { panelId: PANEL, op: 'add', draftToken: 'a'.repeat(32), text: '' },
          'index.html'
        )
      )
      expect(latest.layer.request).toBeNull()
      await waitFor(() => expect(latest.layer.polite).toBe('Comment saved to index.html.'))
      await waitFor(() => expect(focusPage).toHaveBeenCalledWith(PANEL))
    })

    it.each([
      [{ op: 'setStatus', status: 'resolved' }, ANNOUNCE.resolved],
      [{ op: 'setStatus', status: 'open' }, ANNOUNCE.reopened],
      [{ op: 'deleteThread' }, ANNOUNCE.deleted('index.html')],
      [{ op: 'reply', text: 'x' }, 'Comment saved to index.html.']
    ])('announces %o', async (op, text) => {
      render(<Harness onValue={onValue} />)
      act(() =>
        latest.layer.onWritten(
          {
            panelId: PANEL,
            fileKey: 'f1',
            threadKey: 't1',
            rawHash: 'a'.repeat(64),
            ...op
          } as never,
          ''
        )
      )
      await waitFor(() => expect(latest.layer.polite).toBe(text))
      expect(fake.bridge.list).toHaveBeenCalled()
    })

    it('closing the menu without choosing returns focus to the page', async () => {
      render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(menuDraft()))
      act(() => latest.layer.onMenuClose(false))
      expect(latest.layer.menu).toBeNull()
      await waitFor(() => expect(focusPage).toHaveBeenCalled())
    })

    it('H2 a window closed for "Go to tab" does not hand focus back to the page', async () => {
      render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(menuDraft({ kind: 'open' })))
      expect(latest.layer.request).not.toBeNull()
      act(() => latest.layer.onCloseWindow(false))
      expect(latest.layer.request).toBeNull()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise(resolve => requestAnimationFrame(resolve))
      expect(focusPage).not.toHaveBeenCalled()
    })

    it('a window opened from the drawer does not hand focus to the page', async () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ threads: [thread(1)] })], new Set()).open
      act(() => latest.drawer?.onOpen(row))
      act(() => latest.layer.onCloseWindow())
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      expect(focusPage).not.toHaveBeenCalled()
    })
  })

  describe('§19 Rev 4 owner test: open in source', () => {
    it('Open in source closes the window, opens the editor at the line, and leaves focus to it', async () => {
      render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(pinDraft()))
      expect(latest.layer.request).not.toBeNull()
      act(() => latest.layer.onOpenInSource('/project/index.html', 11))
      expect(latest.layer.request).toBeNull()
      expect(mocks.openFileInPanel).toHaveBeenCalledWith(undefined, '/project/index.html', {
        kind: 'editor',
        params: { initialLine: 11 }
      })
      // Not handed back to the page a frame later (H2): the editor has it.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise(resolve => requestAnimationFrame(resolve))
      expect(focusPage).not.toHaveBeenCalled()
    })

    it("the drawer's Open in source leaves the drawer open", () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      const [row] = drawerRows([fileView({ damaged: [damaged(1)] })], new Set()).attention
      act(() => latest.drawer?.onOpenInSource(row))
      expect(mocks.openFileInPanel).toHaveBeenCalled()
      expect(latest.drawer).not.toBeNull()
    })
  })

  describe('§19 Rev 4 owner test: the window belongs to its tab', () => {
    it('is not drawn while another tab is shown, and comes back with its tab', () => {
      const { rerender } = render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(pinDraft()))
      const shown = latest.layer.request
      expect(shown).not.toBeNull()
      rerender(<Harness onValue={onValue} visible={false} />)
      expect(latest.layer.request).toBeNull()
      rerender(<Harness onValue={onValue} visible />)
      // The same request: kept while hidden, never re-minted.
      expect(latest.layer.request).toBe(shown)
    })

    it('a hidden tab drops its element menu – it pointed at a page no longer on screen', async () => {
      const { rerender } = render(<Harness onValue={onValue} />)
      act(() => fake.emitDraft(menuDraft()))
      expect(latest.layer.menu).not.toBeNull()
      rerender(<Harness onValue={onValue} visible={false} />)
      expect(latest.layer.menu).toBeNull()
      rerender(<Harness onValue={onValue} visible />)
      expect(latest.layer.menu).toBeNull()
      // Dropped quietly: no native focus handed to a page that is not shown.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      expect(focusPage).not.toHaveBeenCalled()
    })
  })

  it('stores the identity with the notice marked seen', async () => {
    const updateCommentIdentity = vi.fn(async () => true)
    useGlobalSettingsStore.setState({ updateCommentIdentity })
    render(<Harness onValue={onValue} />)
    await act(async () => {
      await latest.layer.onSaveIdentity({ name: 'Ada', email: '' })
      await latest.layer.onSaveIdentity({ name: 'Ada', email: 'a@b.io' })
    })
    expect(updateCommentIdentity).toHaveBeenNthCalledWith(1, {
      authorName: 'Ada',
      authorEmail: undefined,
      identityNoticeSeen: true
    })
    expect(updateCommentIdentity).toHaveBeenNthCalledWith(2, {
      authorName: 'Ada',
      authorEmail: 'a@b.io',
      identityNoticeSeen: true
    })
  })

  it('ignores Add comment for a draft with no token', () => {
    render(<Harness onValue={onValue} />)
    act(() => latest.layer.onAddComment(menuDraft({ draftToken: undefined })))
    expect(latest.layer.request).toBeNull()
  })

  it('Pick again leaves a mode that is already on alone', async () => {
    render(<Harness onValue={onValue} />)
    act(() => latest.toolbar.onToggleMode(false))
    await waitFor(() => expect(fake.bridge.setMode).toHaveBeenCalledTimes(1))
    act(() => latest.layer.onPickAgain())
    expect(fake.bridge.setMode).toHaveBeenCalledTimes(1)
  })

  it('Pick again closes the window and turns comment mode on', async () => {
    render(<Harness onValue={onValue} />)
    act(() => fake.emitDraft(menuDraft({ kind: 'open' })))
    act(() => latest.layer.onPickAgain())
    expect(latest.layer.request).toBeNull()
    await waitFor(() => expect(latest.toolbar.mode).toBe(true))
  })

  it('copies raw text and reports a failed copy assertively', async () => {
    render(<Harness onValue={onValue} />)
    act(() => latest.layer.onCopyRaw('raw'))
    await waitFor(() => expect(latest.layer.polite).toBe(COPY.rawCopied))
    mocks.writeText.mockResolvedValueOnce(false)
    act(() => latest.layer.onCopyRaw('raw'))
    await waitFor(() => expect(latest.layer.assertive).toBe("Couldn't copy the raw text."))
  })

  it('saves through the gateway and measures the page area', async () => {
    render(<Harness onValue={onValue} />)
    await act(async () => {
      await latest.layer.onSave({
        panelId: PANEL,
        op: 'add',
        draftToken: 'a'.repeat(32),
        text: 'x'
      })
    })
    expect(fake.bridge.save).toHaveBeenCalled()
    expect(latest.layer.getArea()).toMatchObject({ width: expect.any(Number) })
    act(() => latest.layer.onRefresh())
    await waitFor(() => expect(fake.bridge.list).toHaveBeenCalled())
  })
})

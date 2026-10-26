// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The panel's comment wiring (docs/designs/html-preview-comments.md §4.2,
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

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(async () => true),
  openFileInPanel: vi.fn()
}))
vi.mock('../../../../services/textClipboard', () => ({
  textClipboard: { writeText: mocks.writeText }
}))
vi.mock('../../../../utils/openFileInPanel', () => ({ openFileInPanel: mocks.openFileInPanel }))
vi.mock('../../../../utils/platform', () => ({ isMacOS: () => false, isWindows: () => true }))

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

const PANEL = 'preview-index'

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
  readonly onValue: (value: PreviewComments) => void
}

function Harness({
  filePath = '/project/index.html',
  ready = true,
  width = 1000,
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
    containerApi: undefined
  })
  onValue(value)
  return (
    <div
      ref={node => {
        panelRootRef.current = node
        if (node)
          node.getBoundingClientRect = () => ({ width, height: 600, left: 0, top: 0 }) as DOMRect
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
  })
  afterEach(async () => {
    // Unmount before resetting the stores, so the reset is not a state update
    // on a mounted harness; then let any queued announcement frame run out.
    cleanup()
    await new Promise(resolve => requestAnimationFrame(resolve))
    fake.uninstall()
    usePreviewCommentStore.getState().reset()
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
    ['carries a valid pin draft token into the threads request', 'c'.repeat(32), 'c'.repeat(32)],
    ['drops a malformed one', 'not-a-token', undefined]
  ])('%s, and New comment switches to the new view', (_label, sent, kept) => {
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
        target: { tag: 'p', classes: [], line: 3, excerpt: '<p id="x">' }
      } as never)
    )
    expect(latest.layer.request).toMatchObject({
      kind: 'threads',
      draftToken: kept,
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
    act(() => fake.emitMode({ panelId: PANEL, on: false, reason: 'picker', say: 'showing', label: 'p#team-copy' }))
    await waitFor(() => expect(latest.layer.polite).toBe('Showing p#team-copy.'))
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

    it('L14 the physical M stands in only for a non-ASCII typed key (µ), never for AZERTY ","', async () => {
      const { getByTestId } = render(<Harness onValue={onValue} />)
      // AZERTY: the KeyM position types ",", which is not the M shortcut.
      fireEvent.keyDown(getByTestId('root'), { key: ',', code: 'KeyM', ctrlKey: true, altKey: true })
      expect(fake.bridge.setMode).not.toHaveBeenCalled()
      // AltGr / Option turn M into µ: the physical key decides.
      fireEvent.keyDown(getByTestId('root'), {
        key: 'µ',
        code: 'KeyM',
        ctrlKey: true,
        altKey: true
      })
      await waitFor(() => expect(fake.bridge.setMode).toHaveBeenCalledTimes(1))
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

    it('goes full width and occludes the page in a narrow panel', () => {
      render(<Harness onValue={onValue} width={500} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer?.full).toBe(true)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
    })

    it('stays a side panel without occluding in a wide one', () => {
      render(<Harness onValue={onValue} />)
      act(() => latest.toolbar.onToggleDrawer())
      expect(latest.drawer?.full).toBe(false)
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

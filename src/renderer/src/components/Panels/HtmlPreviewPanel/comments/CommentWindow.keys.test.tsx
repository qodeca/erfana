// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's first focus and its save key, per platform
 * (docs/designs/html-preview-comments.md §10.4, §19 "Rev 4 – owner test:
 * comment window focus and save key"; R-003, R-013).
 *
 * The owner's report: the window opened without the keyboard in its field, and
 * Cmd/Ctrl+Enter did not save. The native half (the page held OS focus) is
 * main's – `commentEmit.ts` focuses the host before the draft event; this file
 * pins the renderer half: focus lands in the field (or the identity step's
 * first field) with no click, typing goes there, and the platform's
 * Cmd/Ctrl+Enter saves the new comment, a reply and an edit exactly once.
 *
 * Split from `CommentWindow.test.tsx`: the platform mock is module-wide.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentFileView, CommentSaveResult } from '../../../../../../shared/ipc/preview-comment-schema'
import { commentDrafts, INITIAL_PANEL_COMMENT_STATE } from '../../../../stores/usePreviewCommentStore'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import type { CommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'

const mocks = vi.hoisted(() => ({ mac: false }))
vi.mock('../../../../utils/platform', () => ({ isMacOS: () => mocks.mac, isWindows: () => !mocks.mac }))

const guard = vi.hoisted(() => ({ current: null as unknown as CommentDirtyGuard }))
vi.mock('../../../../hooks/useCommentDirtyGuard', () => ({
  useCommentDirtyGuard: () => guard.current
}))

import { fileView, newRequest, thread, threadsRequest } from './__test-helpers__/commentTestKit'
import { COPY, IDENTITY_COPY } from './commentCopy'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { resetCommentPendingWrites } from './commentPendingWrites'

const AREA = { left: 0, top: 0, width: 1000, height: 700 }

function setup(patch: Partial<CommentWindowProps> = {}) {
  const props: CommentWindowProps = {
    request: newRequest(),
    list: INITIAL_PANEL_COMMENT_STATE.list,
    identity: { authorName: 'Ada Lovelace', authorEmail: '', identityNoticeSeen: true },
    notVisible: [],
    getArea: () => AREA,
    now: () => new Date(2026, 9, 26, 12, 0),
    locale: 'en-GB',
    onClose: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave: vi.fn(async (): Promise<CommentSaveResult> => ({ ok: true, threadKey: 't1' })),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn(),
    ...patch
  }
  return { props, ...render(<CommentWindow {...props} />) }
}

const field = () => screen.getByTestId('comment-new-field') as HTMLTextAreaElement
const fieldFocused = () => waitFor(() => expect(field()).toHaveFocus())
/** A save that never answers: the window stays "Saving…". */
const neverAnswers = () => vi.fn(() => new Promise<CommentSaveResult>(() => {}))
const ready = (files: CommentFileView[]) => ({ status: 'ready' as const, files, generation: 1 })

/** The platform's save chord, as user-event spells it. */
const PLATFORMS = [
  { name: 'Windows / Linux', mac: false, chord: '{Control>}{Enter}{/Control}', label: 'Ctrl+Enter', aria: 'Control+Enter' },
  { name: 'macOS', mac: true, chord: '{Meta>}{Enter}{/Meta}', label: 'Cmd+Enter', aria: 'Meta+Enter' }
] as const

describe('CommentWindow – first focus and the save key (§19 Rev 4 owner test)', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    mocks.mac = false
    useOverlayOccluderStore.getState().reset()
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    guard.current = {
      state: 'clean',
      justSaved: false,
      cleared: null,
      goToTab: vi.fn(),
      save: vi.fn(async () => true),
      holdForWrite: vi.fn(() => vi.fn())
    }
  })
  afterEach(() => {
    cleanup()
    portalRoot.remove()
    commentDrafts.reset()
    resetCommentPendingWrites()
  })

  describe('first focus', () => {
    it('a new comment: typing goes into the field with no click', async () => {
      const user = userEvent.setup()
      setup()
      await fieldFocused()
      await user.keyboard('Straight in')
      expect(field()).toHaveValue('Straight in')
    })

    it('the first comment: the identity step takes the keys in Name, then hands over to the field', async () => {
      const user = userEvent.setup()
      const { props } = setup({ identity: { authorName: '', identityNoticeSeen: false } })
      expect(screen.getByRole('dialog', { name: IDENTITY_COPY.title })).toBeVisible()
      const name = screen.getByTestId('comment-identity-name')
      await waitFor(() => expect(name).toHaveFocus())
      await user.keyboard('Grace Hopper')
      expect(name).toHaveValue('Grace Hopper')
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(props.onSaveIdentity).toHaveBeenCalledWith(expect.objectContaining({ name: 'Grace Hopper' }))
    })
  })

  describe.each(PLATFORMS)('$name', ({ mac, chord, label, aria }) => {
    beforeEach(() => {
      mocks.mac = mac
    })

    it(`Save names ${label}, and ${label} saves the new comment once`, async () => {
      const user = userEvent.setup()
      const { props } = setup()
      expect(screen.getByTestId('comment-save')).toHaveAttribute('title', `${COPY.save} (${label})`)
      expect(screen.getByTestId('comment-save')).toHaveAttribute('aria-keyshortcuts', aria)
      await fieldFocused()
      await user.keyboard('Shorter, please')
      await user.keyboard(chord)
      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
      expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'add', text: 'Shorter, please' }))
    })

    it(`${label} again while the save is pending sends no second save`, async () => {
      const user = userEvent.setup()
      const { props } = setup({ onSave: neverAnswers() })
      await fieldFocused()
      await user.keyboard('Once')
      await user.keyboard(chord)
      await waitFor(() => expect(screen.getByTestId('comment-save')).toHaveTextContent(COPY.saving))
      await user.keyboard(chord)
      await user.keyboard(chord)
      expect(props.onSave).toHaveBeenCalledTimes(1)
    })

    it(`${label} with Save blocked – no text, or unsaved changes in the source tab – sends nothing`, async () => {
      const user = userEvent.setup()
      const { props, unmount } = setup()
      await fieldFocused()
      await user.keyboard(chord)
      expect(props.onSave).not.toHaveBeenCalled()
      expect(screen.getByText(COPY.emptyError)).toBeVisible()
      unmount()

      guard.current = { ...guard.current, state: 'dirty' }
      const blocked = setup()
      await fieldFocused()
      await user.keyboard('Blocked')
      expect(screen.getByTestId('comment-save')).toHaveAttribute('aria-disabled', 'true')
      await user.keyboard(chord)
      expect(blocked.props.onSave).not.toHaveBeenCalled()
      expect(field()).toHaveValue('Blocked')
    })

    it(`${label} sends a reply once, however often it is pressed while pending`, async () => {
      const user = userEvent.setup()
      const { props } = setup({
        request: threadsRequest(),
        list: ready([fileView({ threads: [thread(1)] })]),
        onSave: neverAnswers()
      })
      await waitFor(() => expect(screen.getByTestId('comment-window-title')).toHaveFocus())
      await user.type(screen.getByTestId('comment-reply-field'), 'Agreed')
      await user.keyboard(chord)
      await user.keyboard(chord)
      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'reply', text: 'Agreed' }))
    })

    it(`${label} saves an edit, focus already in the edit field`, async () => {
      const user = userEvent.setup()
      const { props } = setup({
        request: threadsRequest(),
        list: ready([fileView({ threads: [thread(1)] })]),
        onSave: neverAnswers()
      })
      await user.click(screen.getByTestId('comment-message-actions'))
      await user.click(screen.getByRole('menuitem', { name: COPY.edit }))
      await waitFor(() => expect(screen.getByTestId('comment-edit-field')).toHaveFocus())
      await user.keyboard('{End}!')
      await user.keyboard(chord)
      await user.keyboard(chord)
      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'editMessage', text: 'Message 1!' }))
    })
  })

  describe('one press is one save attempt', () => {
    it('a held key auto-repeating Enter does not save again', async () => {
      const { props } = setup()
      await fieldFocused()
      fireEvent.change(field(), { target: { value: 'Held' } })
      fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true, repeat: true })
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('Enter confirming an IME composition is not a save', async () => {
      const { props } = setup()
      await fieldFocused()
      fireEvent.change(field(), { target: { value: '漢字' } })
      fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true, isComposing: true })
      expect(props.onSave).not.toHaveBeenCalled()
      // The same chord, not composing, saves.
      fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    })

    it('a plain Enter stays a new line on either platform', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await fieldFocused()
      await user.keyboard('a{Enter}b')
      expect(field()).toHaveValue('a\nb')
      expect(props.onSave).not.toHaveBeenCalled()
    })
  })
})

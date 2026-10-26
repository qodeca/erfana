// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's new-comment and identity views
 * (docs/designs/html-preview-comments.md §10.4, §10.7; R-003, R-007, R-008,
 * R-013, R-017, R-019, R-022, R-024).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../../shared/errors'
import type { CommentSaveResult } from '../../../../../../shared/ipc/preview-comment-schema'
import type { CommentIdentitySettings } from '../../../../../../shared/ipc/global-settings-schema'
import {
  commentDrafts,
  INITIAL_PANEL_COMMENT_STATE
} from '../../../../stores/usePreviewCommentStore'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import type { CommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'

const guard = vi.hoisted(() => ({
  current: {
    state: 'clean',
    justSaved: false,
    cleared: null,
    goToTab: () => {},
    save: async () => true,
    holdForWrite: () => () => {}
  } as CommentDirtyGuard
}))
vi.mock('../../../../hooks/useCommentDirtyGuard', () => ({
  useCommentDirtyGuard: () => guard.current
}))

import { newRequest } from './__test-helpers__/commentTestKit'
import { COPY, IDENTITY_COPY, unsavedConflictText } from './commentCopy'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { draftKeyOf } from './commentWindowTypes'

const IDENTITY: CommentIdentitySettings = {
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  identityNoticeSeen: true
}
const AREA = { left: 0, top: 0, width: 1000, height: 700 }

function setup(patch: Partial<CommentWindowProps> = {}) {
  const props: CommentWindowProps = {
    request: newRequest(),
    list: INITIAL_PANEL_COMMENT_STATE.list,
    identity: IDENTITY,
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
  const view = render(<CommentWindow {...props} />)
  return { props, ...view }
}

const field = () => screen.getByTestId('comment-new-field') as HTMLTextAreaElement
const saveButton = () => screen.getByTestId('comment-save')

describe('CommentWindow – new comment', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
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
    portalRoot.remove()
    commentDrafts.reset()
  })

  describe('R-013 dialog role, focus and context line', () => {
    it('is a labelled dialog with the element and file on its context line', () => {
      setup()
      const dialog = screen.getByRole('dialog', { name: COPY.newComment })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(within(dialog).getByText('button#buy.cta.primary · index.html, line 12')).toBeVisible()
      expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'new')
    })

    it('puts focus in the comment field', async () => {
      setup()
      await waitFor(() => expect(field()).toHaveFocus())
    })

    it('registers the dialog occluder and releases it on close', () => {
      const { unmount } = setup()
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      unmount()
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })

    it('tags the overlay so it paints nothing', () => {
      setup()
      expect(document.querySelector('.dialog-overlay')).toHaveClass('erf-comment-layer')
    })

    it('anchors itself once placed', () => {
      setup()
      expect(screen.getByTestId('comment-window').style.visibility).not.toBe('hidden')
    })

    it('stays hidden until the page area can be measured', () => {
      setup({ getArea: () => null })
      expect(screen.getByTestId('comment-window').style.visibility).toBe('hidden')
    })

    it('notes a script-built element and a frame file', () => {
      const request = newRequest()
      setup({
        request: {
          ...request,
          target: { ...request.target, runtime: { tag: 'li' } },
          file: { ...request.file, frame: true, displayPath: 'child.html' }
        }
      })
      expect(screen.getByText('li · child.html, line 12')).toBeVisible()
      expect(screen.getByText('Added by a script – saved before <button id="buy">.')).toBeVisible()
    })

    it('notes the file of a frame', () => {
      const request = newRequest()
      setup({
        request: { ...request, file: { ...request.file, frame: true, displayPath: 'child.html' } }
      })
      expect(screen.getByText('Saved in child.html.')).toBeVisible()
    })
  })

  describe('R-003 save, keyboard, drafts and errors', () => {
    it('blocks Save for empty and whitespace-only text', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
      await user.type(field(), '   ')
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
      await user.click(saveButton())
      expect(props.onSave).not.toHaveBeenCalled()
      expect(screen.getByText(COPY.emptyError)).toBeVisible()
      expect(field()).toHaveAttribute('aria-invalid', 'true')
    })

    it('saves with Ctrl+Enter, sending the trimmed text and the draft token', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.type(field(), '  Make it bigger  ')
      expect(saveButton()).not.toHaveAttribute('aria-disabled')
      await user.keyboard('{Control>}{Enter}{/Control}')
      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith({
          panelId: 'preview-index',
          op: 'add',
          draftToken: newRequest().draftToken,
          text: 'Make it bigger'
        })
      )
      expect(props.onWritten).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'add' }),
        'index.html'
      )
      expect(commentDrafts.get(draftKeyOf(newRequest()))).toBe('')
    })

    it('saves with Cmd+Enter too', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.type(field(), 'Hi')
      await user.keyboard('{Meta>}{Enter}{/Meta}')
      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
    })

    it('a plain Enter is a new line, not a save', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.type(field(), 'a{Enter}b')
      expect(field().value).toBe('a\nb')
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('holds the source tab autosave for the write and releases it after', async () => {
      const user = userEvent.setup()
      const release = vi.fn()
      guard.current = { ...guard.current, holdForWrite: vi.fn(() => release) }
      setup()
      await user.type(field(), 'Hi')
      await user.click(saveButton())
      await waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    })

    it('Esc closes and keeps the draft; reopening shows "Draft restored"', async () => {
      const user = userEvent.setup()
      const first = setup()
      await user.type(field(), 'Half a thought')
      await user.keyboard('{Escape}')
      expect(first.props.onClose).toHaveBeenCalled()
      first.unmount()

      setup()
      expect(field().value).toBe('Half a thought')
      expect(screen.getByText(COPY.draftRestored)).toBeVisible()
    })

    it('shows Saving… and stays busy while the write is in flight', async () => {
      const user = userEvent.setup()
      let answer: (r: CommentSaveResult) => void = () => {}
      const onSave = vi.fn(() => new Promise<CommentSaveResult>(resolve => (answer = resolve)))
      setup({ onSave })
      await user.type(field(), 'Hi')
      await user.click(saveButton())
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
      expect(saveButton()).toHaveTextContent(COPY.saving)
      // A second click while busy sends nothing.
      await user.click(saveButton())
      expect(onSave).toHaveBeenCalledTimes(1)
      await act(async () => answer({ ok: true, threadKey: 't1' }))
    })

    it('counts characters, warns near the limit and refuses over it', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(field())
      await user.paste('a'.repeat(3_600))
      expect(screen.getByText('3600 / 4000')).toHaveClass('erf-comment-counter--near')
      await user.paste('a'.repeat(401))
      expect(screen.getByText('4001 / 4000')).toHaveClass('erf-comment-counter--over')
      expect(
        screen.getByText('Comments can be up to 4,000 characters. This one is 4,001.')
      ).toBeVisible()
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    })

    it.each([
      ErrorCode.COMMENT_FILE_READ_ONLY,
      ErrorCode.COMMENT_LIMIT,
      ErrorCode.COMMENT_WRITE_FAILED,
      ErrorCode.COMMENT_PATH_REFUSED
    ])('keeps the text after %s and shows the error', async code => {
      const user = userEvent.setup()
      const { props } = setup({ onSave: vi.fn(async () => ({ ok: false as const, code })) })
      await user.type(field(), 'Keep me')
      await user.click(saveButton())
      expect(await screen.findByTestId('comment-save-error')).toBeVisible()
      expect(field().value).toBe('Keep me')
      expect(props.onWritten).not.toHaveBeenCalled()
      // A banner error leaves Save usable for another try.
      expect(saveButton()).not.toHaveAttribute('aria-disabled')
    })

    it('shows the generic error when the gateway refuses', async () => {
      const user = userEvent.setup()
      setup({ onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.UNKNOWN_ERROR })) })
      await user.type(field(), 'x')
      await user.click(saveButton())
      expect(
        await screen.findByText("Couldn't save the comment. Your text is still here – try again.", {
          selector: '.erf-comment-banner__text'
        })
      ).toBeVisible()
      // H1: and spoken from inside the modal subtree.
      await waitFor(() =>
        expect(screen.getByTestId('comment-window-alert')).toHaveTextContent(
          "Couldn't save the comment."
        )
      )
    })

    it('B: a save still being written is news, not an error – and offers no second Save', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_SAVE_PENDING }))
      })
      await user.type(field(), 'Slow disk')
      await user.click(saveButton())
      const banner = await screen.findByTestId('comment-save-error')
      expect(banner).toHaveClass('erf-comment-banner--info')
      expect(banner).toHaveTextContent(
        'Still saving to index.html. Your comment appears here once it is written – no need to save again.'
      )
      expect(banner).not.toHaveTextContent('{file}')
      expect(screen.queryByTestId('comment-save')).toBeNull()
      expect(screen.getByTestId('comment-close')).toBeVisible()
      expect(field().value).toBe('Slow disk')
    })

    it('H1 speaks the unsaved-source refusal too', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_UNSAVED_SOURCE }))
      })
      await user.type(field(), 'x')
      await user.click(saveButton())
      await waitFor(() =>
        expect(screen.getByTestId('comment-window-alert')).toHaveTextContent(
          'index.html has unsaved changes in another tab.'
        )
      )
    })
  })

  describe('R-022 file gone and draft expired keep the text', () => {
    it('file gone: the text stays, Save gives way to Close', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_FILE_GONE }))
      })
      await user.type(field(), 'Precious')
      await user.click(saveButton())
      expect(
        await screen.findByText('index.html no longer exists. Copy your text before closing.')
      ).toBeVisible()
      expect(field().value).toBe('Precious')
      expect(screen.queryByTestId('comment-save')).toBeNull()
      await user.click(screen.getByTestId('comment-close'))
      expect(props.onClose).toHaveBeenCalled()
      expect(commentDrafts.get(draftKeyOf(newRequest()))).toBe('Precious')
    })

    it('draft expired: Pick again, with the text kept for the next window', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_DRAFT_EXPIRED }))
      })
      await user.type(field(), 'Still here')
      await user.click(saveButton())
      await user.click(await screen.findByRole('button', { name: COPY.pickAgain }))
      expect(props.onPickAgain).toHaveBeenCalled()
      expect(field().value).toBe('Still here')
      expect(screen.queryByTestId('comment-save')).toBeNull()
      expect(screen.getByTestId('comment-cancel')).toBeVisible()
      expect(commentDrafts.get(draftKeyOf(newRequest()))).toBe('Still here')
    })

    it('target moved: the window says to pick again and offers Close', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_TARGET_MOVED }))
      })
      await user.type(field(), 'x')
      await user.click(saveButton())
      expect(await screen.findByTestId('comment-close')).toBeVisible()
    })
  })

  describe('R-007 unsaved-source banner and R-024 conflict variant', () => {
    it('blocks Save while the source tab has unsaved changes and offers Go to tab and Save', async () => {
      const user = userEvent.setup()
      guard.current = { ...guard.current, state: 'dirty' }
      const { props } = setup()
      const banner = screen.getByTestId('comment-unsaved-banner')
      expect(within(banner).getByText(COPY.unsavedTitle)).toBeVisible()
      await user.type(field(), 'x')
      expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
      await user.click(saveButton())
      expect(props.onSave).not.toHaveBeenCalled()
      await user.click(within(banner).getByRole('button', { name: 'Save index.html' }))
      expect(guard.current.save).toHaveBeenCalled()
      // H2: Go to tab closes the window first, without handing focus back
      // to the page – the editor takes it.
      await user.click(within(banner).getByRole('button', { name: COPY.goToTab }))
      expect(props.onClose).toHaveBeenCalledWith(false)
      expect(guard.current.goToTab).toHaveBeenCalled()
    })

    it('clears once the tab is saved, and says so out loud', async () => {
      guard.current = { ...guard.current, state: 'clean', justSaved: true, cleared: 'saved' }
      setup()
      expect(screen.queryByTestId('comment-unsaved-banner')).toBeNull()
      expect(screen.getByTestId('comment-unsaved-cleared')).toHaveTextContent(COPY.unsavedCleared)
      await waitFor(() =>
        expect(screen.getByTestId('comment-window-alert')).toHaveTextContent(COPY.unsavedCleared)
      )
    })

    it('L11 a tab made clean without our save gets the neutral line, not "Saved."', () => {
      guard.current = { ...guard.current, state: 'clean', justSaved: true, cleared: 'clean' }
      setup()
      expect(screen.getByTestId('comment-unsaved-cleared')).toHaveTextContent(COPY.unsavedGone)
    })

    it('R-024 a tab in conflict offers Go to tab only, and is worded for it (L11)', () => {
      guard.current = { ...guard.current, state: 'conflict' }
      setup()
      const banner = screen.getByTestId('comment-unsaved-banner')
      expect(within(banner).getByRole('button', { name: COPY.goToTab })).toBeVisible()
      expect(within(banner).queryByTestId('comment-unsaved-save')).toBeNull()
      expect(banner).toHaveTextContent(unsavedConflictText('index.html'))
    })

    it('shows the banner when main refuses for an unsaved source the feed had not reported', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_UNSAVED_SOURCE }))
      })
      await user.type(field(), 'x')
      await user.click(saveButton())
      expect(await screen.findByTestId('comment-unsaved-banner')).toBeVisible()
      expect(field().value).toBe('x')
    })
  })

  describe('R-008 identity step only when the name is unset', () => {
    it.each([
      ['no identity at all', null],
      ['no name', { identityNoticeSeen: true } as CommentIdentitySettings]
    ])('asks first when there is %s', (_label, identity) => {
      setup({ identity })
      expect(screen.getByRole('dialog', { name: IDENTITY_COPY.title })).toBeVisible()
      expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'identity')
      expect(screen.queryByTestId('comment-new-field')).toBeNull()
    })

    it('shows the §10.7 notice as the dialog description', () => {
      setup({ identity: null })
      const dialog = screen.getByRole('dialog')
      const notice = screen.getByText(IDENTITY_COPY.notice)
      expect(dialog).toHaveAttribute('aria-describedby', notice.id)
      expect(screen.getByText(IDENTITY_COPY.nameHint)).toBeVisible()
      expect(screen.getByText(IDENTITY_COPY.emailHint)).toBeVisible()
    })

    it('focuses the name field', async () => {
      setup({ identity: null })
      await waitFor(() => expect(screen.getByTestId('comment-identity-name')).toHaveFocus())
    })

    it('requires a name and validates the email', async () => {
      const user = userEvent.setup()
      const { props } = setup({ identity: null })
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(screen.getByText(IDENTITY_COPY.nameRequired)).toBeVisible()
      expect(screen.getByTestId('comment-identity-name')).toHaveFocus()
      await user.type(screen.getByTestId('comment-identity-name'), 'Ada')
      await user.type(screen.getByTestId('comment-identity-email'), 'not-an-email')
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(screen.getByText(IDENTITY_COPY.emailInvalid)).toBeVisible()
      expect(screen.getByTestId('comment-identity-email')).toHaveFocus()
      expect(props.onSaveIdentity).not.toHaveBeenCalled()
    })

    it('stores the trimmed identity, then moves on to the comment field', async () => {
      const user = userEvent.setup()
      const { props, rerender } = setup({ identity: null })
      await user.type(screen.getByTestId('comment-identity-name'), '  Ada  ')
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(props.onSaveIdentity).toHaveBeenCalledWith({ name: 'Ada', email: '' })
      rerender(
        <CommentWindow {...props} identity={{ authorName: 'Ada', identityNoticeSeen: true }} />
      )
      expect(await screen.findByTestId('comment-new-field')).toHaveFocus()
      expect(screen.getByTestId('comment-identity-line')).toHaveTextContent('Commenting as Ada')
    })

    it('stores the identity once however often Continue is pressed', async () => {
      const user = userEvent.setup()
      let answer: (ok: boolean) => void = () => {}
      const onSaveIdentity = vi.fn(() => new Promise<boolean>(resolve => (answer = resolve)))
      setup({ identity: null, onSaveIdentity })
      await user.type(screen.getByTestId('comment-identity-name'), 'Ada')
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(screen.getByTestId('comment-identity-continue')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      await user.click(screen.getByTestId('comment-identity-continue'))
      expect(onSaveIdentity).toHaveBeenCalledTimes(1)
      await act(async () => answer(true))
    })

    it('says so when the identity could not be stored', async () => {
      const user = userEvent.setup()
      setup({ identity: null, onSaveIdentity: vi.fn(async () => false) })
      // The live region exists, empty, before there is anything to say.
      const region = screen.getByTestId('comment-identity-error')
      expect(region).toHaveAttribute('aria-live', 'assertive')
      expect(region).toBeEmptyDOMElement()
      await user.type(screen.getByTestId('comment-identity-name'), 'Ada')
      await user.click(screen.getByTestId('comment-identity-continue'))
      await waitFor(() => expect(region).toHaveTextContent("Couldn't save your name. Try again."))
      expect(screen.getByTestId('comment-identity-error')).toBe(region)
    })

    it('Cancel aborts', async () => {
      const user = userEvent.setup()
      const { props } = setup({ identity: null })
      await user.click(screen.getByTestId('comment-identity-cancel'))
      expect(props.onClose).toHaveBeenCalled()
      expect(props.onSaveIdentity).not.toHaveBeenCalled()
    })

    it('goes back to the identity step when main says the name is missing', async () => {
      const user = userEvent.setup()
      setup({
        onSave: vi.fn(async () => ({
          ok: false as const,
          code: ErrorCode.COMMENT_IDENTITY_REQUIRED
        }))
      })
      await user.type(field(), 'x')
      await user.click(saveButton())
      expect(await screen.findByTestId('comment-identity-name')).toBeVisible()
    })
  })

  describe('R-019 a name preset in Settings still sees the notice once', () => {
    it('shows the notice pre-filled when it has not been seen', () => {
      setup({
        identity: { authorName: 'Preset', authorEmail: 'p@example.com', identityNoticeSeen: false }
      })
      expect(screen.getByText(IDENTITY_COPY.notice)).toBeVisible()
      expect(screen.getByTestId('comment-identity-name')).toHaveValue('Preset')
      expect(screen.getByTestId('comment-identity-email')).toHaveValue('p@example.com')
    })

    it('never shows it again once seen', () => {
      setup({ identity: { authorName: 'Preset', identityNoticeSeen: true } })
      expect(screen.queryByText(IDENTITY_COPY.notice)).toBeNull()
    })
  })

  describe('Change identity inline', () => {
    it('edits the name without leaving the window', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByRole('button', { name: COPY.change }))
      const name = screen.getByTestId('comment-identity-edit-name')
      expect(name).toHaveFocus()
      await user.clear(name)
      await user.type(name, 'Grace')
      await user.click(screen.getByRole('button', { name: COPY.saveChanges }))
      expect(props.onSaveIdentity).toHaveBeenCalledWith({ name: 'Grace', email: 'ada@example.com' })
      await waitFor(() => expect(field()).toHaveFocus())
    })

    it('cancels the edit', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByRole('button', { name: COPY.change }))
      await user.click(
        within(screen.getByRole('group', { name: 'Change who is commenting' })).getByRole(
          'button',
          { name: COPY.cancel }
        )
      )
      expect(screen.getByTestId('comment-identity-line')).toBeVisible()
      // M4: focus goes back to the Change button it came from.
      await waitFor(() => expect(screen.getByTestId('comment-identity-change')).toHaveFocus())
    })

    it('M6 Esc backs out of the identity editor first, keeping the comment text', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await waitFor(() => expect(field()).toHaveFocus())
      await user.type(field(), 'Keep me')
      await user.click(screen.getByTestId('comment-identity-change'))
      await user.keyboard('{Escape}')
      expect(props.onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('comment-identity-line')).toBeVisible()
      await waitFor(() => expect(screen.getByTestId('comment-identity-change')).toHaveFocus())
      expect(field().value).toBe('Keep me')
      await user.keyboard('{Escape}')
      expect(props.onClose).toHaveBeenCalled()
    })
  })

  describe('R-017 bidi tokens visible and dir="auto"', () => {
    it('shows an override in the reviewer name as a token and types the field auto-direction', () => {
      setup({
        identity: { authorName: `Ada${String.fromCodePoint(0x202e)}x`, identityNoticeSeen: true }
      })
      expect(screen.getByTestId('comment-control-token')).toHaveTextContent('⟨U+202E⟩')
      expect(field()).toHaveAttribute('dir', 'auto')
    })
  })
})

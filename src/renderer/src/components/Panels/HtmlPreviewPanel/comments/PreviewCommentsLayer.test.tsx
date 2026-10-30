// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The element menu and the live regions (docs/designs/comments/html-preview-comments.md
 * §10.3, §10.9; R-001, R-002, R-013).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_PANEL_COMMENT_STATE } from '../../../../stores/usePreviewCommentStore'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import { menuDraft, newRequest, threadsRequest } from './__test-helpers__/commentTestKit'
import { COPY, IDENTITY_COPY } from '../../../Comments/commentCopy'
import { MD_SURFACE_COPY, SELECTION_COPY } from '../../../Comments/commentCopyWords'
import { PreviewCommentsLayer, type PreviewCommentsLayerProps } from './PreviewCommentsLayer'

function setup(patch: Partial<PreviewCommentsLayerProps> = {}) {
  const props: PreviewCommentsLayerProps = {
    menu: null,
    request: null,
    list: INITIAL_PANEL_COMMENT_STATE.list,
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    notVisible: [],
    polite: '',
    assertive: '',
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    onMenuClose: vi.fn(),
    onAddComment: vi.fn(),
    onCloseWindow: vi.fn(),
    onNewComment: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave: vi.fn(async () => ({ ok: true as const, threadKey: 't1' })),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn(),
    ...patch
  }
  return { props, ...render(<PreviewCommentsLayer {...props} />) }
}

describe('PreviewCommentsLayer', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => portalRoot.remove())

  describe('R-001 the menu holds only "Add comment"', () => {
    it('shows one item, focused, in a menu named Element', () => {
      setup({ menu: menuDraft() })
      const menu = screen.getByRole('menu', { name: COPY.menuLabel })
      const items = screen.getAllByRole('menuitem')
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent(COPY.addComment)
      expect(menu).toHaveAttribute('data-testid', 'comment-context-menu')
    })

    it('Enter adds a comment and the menu reports it was chosen', async () => {
      const user = userEvent.setup()
      const draft = menuDraft()
      const { props } = setup({ menu: draft })
      screen.getByTestId('comment-menu-add').focus()
      await user.keyboard('{Enter}')
      expect(props.onAddComment).toHaveBeenCalledWith(draft)
      expect(props.onMenuClose).toHaveBeenCalledWith(true)
    })

    it('arrows keep focus on the only item', async () => {
      const user = userEvent.setup()
      setup({ menu: menuDraft() })
      const item = screen.getByTestId('comment-menu-add')
      item.focus()
      await user.keyboard('{ArrowDown}')
      expect(item).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(item).toHaveFocus()
    })

    it('Esc closes without choosing', async () => {
      const user = userEvent.setup()
      const { props } = setup({ menu: menuDraft() })
      screen.getByTestId('comment-menu-add').focus()
      await user.keyboard('{Escape}')
      expect(props.onMenuClose).toHaveBeenCalledWith(false)
      expect(props.onAddComment).not.toHaveBeenCalled()
    })

  })

  describe('C-19 024-FR-027 a disabled item keeps its action name and shows its reason line (HTML)', () => {
    const NO_DRAFT = { draftToken: undefined, draftKey: undefined, target: undefined }
    const CONFLICTS = 'index.html has unresolved git conflicts. Resolve them first.'
    const WORDS = { selection: true as const }

    /** Every item: its label, disabled, named from its label and described by its visible reason line. */
    function expectDisabledWithReason(labels: readonly string[], reason: string): void {
      const items = screen.getAllByRole('menuitem')
      expect(items.map(item => item.querySelector('.context-menu-label')?.textContent ?? item.textContent)).toEqual(labels)
      items.forEach((item, i) => {
        expect(item).toHaveAttribute('aria-disabled', 'true')
        expect(item).toHaveAccessibleName(labels[i])
        expect(item).toHaveAccessibleDescription(reason)
        expect(item).toHaveTextContent(reason)
      })
    }

    it('M-05 outside comment mode on a read-only file: "Comment on element", disabled, with the reason main named', async () => {
      const user = userEvent.setup()
      const { props } = setup({ menu: menuDraft({ ...NO_DRAFT, reason: 'conflict-markers' }), mode: false })
      expect(screen.getByRole('menu', { name: COPY.menuLabel })).toBeVisible()
      expectDisabledWithReason([MD_SURFACE_COPY.commentOn('element')], CONFLICTS)
      await user.click(screen.getAllByRole('menuitem')[0])
      expect(props.onAddComment).not.toHaveBeenCalled()
    })

    it('M-06 outside comment mode on a selection in a read-only file: both selection items, each disabled with its own reason line', async () => {
      const user = userEvent.setup()
      const { props } = setup({ menu: menuDraft({ ...NO_DRAFT, ...WORDS, reason: 'unterminated-block' }), mode: false })
      expect(screen.getByRole('menu', { name: SELECTION_COPY.menuLabel })).toBeVisible()
      const reason = "A comment in index.html has no end, so Erfana won't add comments. Fix it in the source."
      expectDisabledWithReason([SELECTION_COPY.commentOnSelection, SELECTION_COPY.commentOnWhole('element')], reason)
      // Two items, two reason lines – never one shared element.
      const [first, second] = screen.getAllByRole('menuitem')
      expect(first.getAttribute('aria-describedby')).not.toBe(second.getAttribute('aria-describedby'))
      for (const item of [first, second]) await user.click(item)
      expect(props.onAddComment).not.toHaveBeenCalled()
    })

    it('M-08 a part of the page that cannot hold a comment: the row\'s items for a writable file, disabled, in either mode', () => {
      for (const mode of [false, true]) {
        const { unmount } = setup({ menu: menuDraft({ ...NO_DRAFT, kind: mode ? 'open' : 'menu', reason: 'not-commentable' }), mode })
        // Changed expectation under 024-FR-006 § 4 (was "This part of the page can't hold a comment.").
        expectDisabledWithReason([mode ? COPY.addComment : MD_SURFACE_COPY.commentOn('element')], "This part of the preview can't hold a comment.")
        unmount()
      }
      // A main that sent no reason reads the same.
      setup({ menu: menuDraft({ ...NO_DRAFT, ...WORDS }), mode: true })
      expectDisabledWithReason(
        [SELECTION_COPY.commentOnSelection, SELECTION_COPY.commentOnWhole('element')],
        "This part of the preview can't hold a comment."
      )
    })

    it('M-10 comments unavailable for this file: the row\'s items, each disabled with "Comments are unavailable for this file: {reason}."', async () => {
      const user = userEvent.setup()
      // Even a draft main minted is not offered: nothing could be read.
      const { props, unmount } = setup({ menu: menuDraft(), mode: false, unavailable: 'too-large' })
      expectDisabledWithReason([MD_SURFACE_COPY.commentOn('element')], 'Comments are unavailable for this file: file too large.')
      await user.click(screen.getAllByRole('menuitem')[0])
      expect(props.onAddComment).not.toHaveBeenCalled()
      unmount()
      setup({ menu: menuDraft({ ...NO_DRAFT, ...WORDS, reason: 'encoding' }), mode: false, unavailable: 'overlay-removed' })
      expectDisabledWithReason(
        [SELECTION_COPY.commentOnSelection, SELECTION_COPY.commentOnWhole('element')],
        "Comments are unavailable for this file: the page keeps removing Erfana's overlay."
      )
    })

    it('a writable file keeps every item enabled, with no reason line', () => {
      setup({ menu: menuDraft(), mode: false, unavailable: null })
      const [item] = screen.getAllByRole('menuitem')
      expect(item).not.toHaveAttribute('aria-disabled')
      expect(item).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('OD-01 024-AC-004 the menu matrix in the HTML Preview', () => {
    const WORDS = { text: 'We ship the beta to ten customers', start: 20, end: 33, cut: false }

    it('OD-01 outside comment mode the one item is "Comment on element" (M-01)', async () => {
      const user = userEvent.setup()
      const draft = menuDraft()
      const { props } = setup({ menu: draft, mode: false })
      expect(screen.getByRole('menu', { name: COPY.menuLabel })).toBeVisible()
      const items = screen.getAllByRole('menuitem')
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent(MD_SURFACE_COPY.commentOn('element'))
      await user.click(items[0])
      expect(props.onAddComment).toHaveBeenCalledWith(draft)
    })

    it('M-03 in comment mode without a selection the one item is "Add comment", on the picked element', async () => {
      const user = userEvent.setup()
      const draft = menuDraft()
      const { props } = setup({ menu: draft, mode: true })
      expect(screen.getByRole('menu', { name: COPY.menuLabel })).toBeVisible()
      const items = screen.getAllByRole('menuitem')
      expect(items.map(item => item.textContent)).toEqual([COPY.addComment])
      expect(items[0]).not.toHaveAttribute('aria-disabled')
      await user.click(items[0])
      expect(props.onAddComment).toHaveBeenCalledWith(draft)
      expect(props.onMenuClose).toHaveBeenCalledWith(true)
    })

    it('024-AC-004 C-07 (HTML) on a selection: "Comment on selection" then "Comment on the whole element", in a menu named Selection (M-02, M-04)', async () => {
      const user = userEvent.setup()
      const draft = menuDraft({ selection: true, words: WORDS })
      for (const mode of [false, true]) {
        const { props, unmount } = setup({ menu: draft, mode })
        expect(screen.getByRole('menu', { name: SELECTION_COPY.menuLabel })).toBeVisible()
        const items = screen.getAllByRole('menuitem')
        expect(items.map(item => item.textContent)).toEqual([
          SELECTION_COPY.commentOnSelection,
          SELECTION_COPY.commentOnWhole('element')
        ])
        await user.click(items[0])
        expect(props.onAddComment).toHaveBeenCalledWith(draft, 'words')
        unmount()
      }
      const { props } = setup({ menu: draft, mode: false })
      await user.click(screen.getByRole('menuitem', { name: SELECTION_COPY.commentOnWhole('element') }))
      expect(props.onAddComment).toHaveBeenCalledWith(draft)
    })
  })

  describe('R-002 occluder', () => {
    it('is registered while the menu is open and released on close and unmount', () => {
      const { rerender, props, unmount } = setup({ menu: menuDraft() })
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      rerender(<PreviewCommentsLayer {...props} menu={null} />)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
      rerender(<PreviewCommentsLayer {...props} menu={menuDraft()} />)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      unmount()
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })

    it('is held by the comment window too', () => {
      const { rerender, props } = setup({ request: newRequest() })
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)
      rerender(<PreviewCommentsLayer {...props} request={null} />)
      expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
    })
  })

  it('R-013 carries the polite and assertive live regions', () => {
    setup({ polite: 'Comment saved to index.html.', assertive: "Couldn't copy the raw text." })
    expect(screen.getByTestId('comment-announce')).toHaveTextContent('Comment saved to index.html.')
    expect(screen.getByTestId('comment-announce')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('comment-alert')).toHaveAttribute('aria-live', 'assertive')
  })

  it('opens the comment window for a request, keyed by draft', () => {
    setup({ request: newRequest() })
    expect(screen.getByTestId('comment-window')).toBeVisible()
  })

  it('C-04 (HTML) the first comment shows the one notice for both previews; once seen in either preview it is not shown again', () => {
    const { unmount } = setup({ request: newRequest(), identity: { authorName: 'Ada', identityNoticeSeen: false } })
    const dialog = screen.getByRole('dialog', { name: IDENTITY_COPY.title })
    expect(dialog).toHaveTextContent(IDENTITY_COPY.notice)
    // The notice is about files, not pages, and names the HTML-only risk as an extra.
    expect(IDENTITY_COPY.notice).toMatch(/^Erfana writes your name – and your email, if you add one – into the file next to each comment\./)
    expect(IDENTITY_COPY.notice).toMatch(/In HTML files, scripts on previewed pages can read them too\./)
    unmount()
    // `identityNoticeSeen` is one global flag: a first comment in the Markdown Preview sets it for this preview too.
    setup({ request: newRequest(), identity: { authorName: 'Ada', identityNoticeSeen: true } })
    expect(screen.queryByText(IDENTITY_COPY.notice)).toBeNull()
    expect(screen.queryByTestId('comment-identity-name')).toBeNull()
  })

  it('opens the threads window for a pin', () => {
    setup({ request: threadsRequest(), list: { status: 'loading', files: [] } })
    expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'threads')
  })
})

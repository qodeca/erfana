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
import { COPY } from '../../../Comments/commentCopy'
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

    it('shows a disabled "Can\'t comment here" when there is no draft', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        menu: menuDraft({ draftToken: undefined, draftKey: undefined, target: undefined })
      })
      const item = screen.getByRole('menuitem', { name: COPY.cantCommentHere })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      await user.click(item)
      expect(props.onAddComment).not.toHaveBeenCalled()
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

  it('opens the threads window for a pin', () => {
    setup({ request: threadsRequest(), list: { status: 'loading', files: [] } })
    expect(screen.getByTestId('comment-window')).toHaveAttribute('data-view', 'threads')
  })
})

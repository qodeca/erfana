// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's v2 new-comment states, in both previews
 * (comments-v2 C-14, C-19, C-21, C-03; spec 024 state table W-01, W-02,
 * W-07, W-08, W-10, 024-FR-004 words dropped).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentDirtyGuard } from '../../hooks/useCommentDirtyGuard'
import { commentDrafts, INITIAL_PANEL_COMMENT_STATE } from '../../stores/usePreviewCommentStore'

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
vi.mock('../../hooks/useCommentDirtyGuard', () => ({
  useCommentDirtyGuard: () => guard.current
}))

import { newRequest } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { carriedDrafts } from './commentCarriedDrafts'
import { MARKDOWN_COPY, MARKDOWN_WORDS, SELECTION_COPY } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { resetCommentPendingWrites } from './commentPendingWrites'
import { WINDOW_COPY } from './commentWindowCopy'
import { draftKeyOf, type CommentWindowRequest } from './commentWindowTypes'
import { CommentWordsContext } from './commentWords'

type NewRequest = Extract<CommentWindowRequest, { kind: 'new' }>

function setup(patch: Partial<CommentWindowProps> = {}, markdown = false) {
  const props: CommentWindowProps = {
    request: newRequest(),
    list: INITIAL_PANEL_COMMENT_STATE.list,
    identity: { authorName: 'Ada Lovelace', authorEmail: 'ada@example.com', identityNoticeSeen: true },
    notVisible: [],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
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
  const tree = <CommentWindow {...props} />
  const view = render(markdown ? <CommentWordsContext.Provider value={MARKDOWN_WORDS}>{tree}</CommentWordsContext.Provider> : tree)
  return { props, ...view }
}

/** A Markdown paragraph request in `notes.md`. */
function mdRequest(patch: Partial<NewRequest> = {}): NewRequest {
  const base = newRequest()
  return newRequest({
    target: { ...base.target, tag: 'p', elementId: undefined, classes: [], line: 3 },
    file: { ...base.file, displayPath: 'notes.md', filePath: '/project/notes.md' },
    ...patch
  })
}

const field = () => screen.getByTestId('comment-new-field') as HTMLTextAreaElement
const saveButton = () => screen.getByTestId('comment-save')
const fieldFocused = () => waitFor(() => expect(field()).toHaveFocus())

describe('CommentWindow – v2 new comment', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => {
    portalRoot.remove()
    commentDrafts.reset()
    resetCommentPendingWrites()
  })

  // ---- C-14 drafts travel (W-01, W-02) ----
  it('C-14 W-01 a moved target keeps the text; Pick again carries it to the next window', async () => {
    const user = userEvent.setup()
    const { props, unmount } = setup({
      onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_TARGET_MOVED }))
    })
    await fieldFocused()
    await user.type(field(), 'Make it bigger')
    await user.click(saveButton())
    expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(WINDOW_COPY.moved('element'))
    expect(screen.queryByTestId('comment-save')).toBeNull()
    await user.click(screen.getByTestId('comment-pick-again'))
    expect(props.onPickAgain).toHaveBeenCalled()
    expect(carriedDrafts.peek('preview-index')).toBe('Make it bigger')
    unmount()

    // W-02: the next window in the panel – a different element – takes the text and says so.
    setup({ request: newRequest({ draftKey: 'e'.repeat(32) }) })
    expect(field()).toHaveValue('Make it bigger')
    expect(screen.getByTestId('comment-carried')).toHaveTextContent(WINDOW_COPY.carried)
    expect(carriedDrafts.peek('preview-index')).toBeNull()
  })

  it('C-14 W-02 a window with text of its own keeps it, and the carried text is dropped', () => {
    commentDrafts.set(draftKeyOf(newRequest()), 'Mine already')
    carriedDrafts.put('preview-index', 'Carried')
    setup()
    expect(field()).toHaveValue('Mine already')
    expect(screen.queryByTestId('comment-carried')).toBeNull()
    expect(carriedDrafts.peek('preview-index')).toBeNull()
  })

  it('C-14 a carried draft belongs to its panel only', () => {
    carriedDrafts.put('preview-other', 'Elsewhere')
    setup()
    expect(field()).toHaveValue('')
    expect(carriedDrafts.peek('preview-other')).toBe('Elsewhere')
  })

  // ---- C-19 ----
  it('C-19 (Markdown) a file at the block limit says so and keeps the text, Save still there', async () => {
    const user = userEvent.setup()
    setup(
      {
        request: mdRequest(),
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_LIMIT, reason: 'too-many-blocks' as const }))
      },
      true
    )
    await fieldFocused()
    await user.type(field(), 'One more')
    await user.click(saveButton())
    expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(WINDOW_COPY.tooManyBlocks('notes.md'))
    expect(field()).toHaveValue('One more')
    expect(saveButton()).toBeInTheDocument()
  })

  it('C-19 W-07 a render-check refusal offers Comment on the whole parent and carries the text', async () => {
    const user = userEvent.setup()
    const onRetarget = vi.fn()
    setup(
      {
        request: mdRequest({ parentTag: 'ul', target: { ...mdRequest().target, tag: 'li' } }),
        onRetarget,
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_RENDER_CHANGED, reason: 'render-changed' as const }))
      },
      true
    )
    await fieldFocused()
    await user.type(field(), 'Reword this')
    await user.click(saveButton())
    const retarget = await screen.findByTestId('comment-retarget')
    expect(retarget).toHaveTextContent('Comment on the whole list')
    await user.click(retarget)
    expect(onRetarget).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new', parentTag: 'ul' }))
    expect(carriedDrafts.peek('preview-index')).toBe('Reword this')
  })

  it('C-19 W-07 with no parent there is nothing to re-target to', async () => {
    const user = userEvent.setup()
    setup(
      {
        request: mdRequest(),
        onRetarget: vi.fn(),
        onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_RENDER_CHANGED }))
      },
      true
    )
    await fieldFocused()
    await user.type(field(), 'x')
    await user.click(saveButton())
    expect(await screen.findByTestId('comment-save-error')).toHaveTextContent('comment on a nearby paragraph')
    expect(screen.queryByTestId('comment-retarget')).toBeNull()
  })

  // ---- W-08 ----
  it('W-08 (Markdown) a pick already known to be generated is refused before typing, Save blocked', () => {
    setup({ request: mdRequest({ refused: 'generated-region' }) }, true)
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    expect(saveButton()).toHaveAccessibleDescription(MARKDOWN_COPY.generated)
  })

  // ---- 024-FR-004 words dropped ----
  it('024-FR-004 words dropped by main: the window says so after the save, and Close closes it', async () => {
    const user = userEvent.setup()
    const { props } = setup(
      { request: mdRequest(), onSave: vi.fn(async () => ({ ok: true as const, threadKey: 't1', wordsDropped: true as const })) },
      true
    )
    await fieldFocused()
    await user.type(field(), 'On these words')
    await user.click(saveButton())
    expect(await screen.findByTestId('comment-words-dropped')).toHaveTextContent(SELECTION_COPY.wordsDropped('paragraph', 'notes.md'))
    expect(props.onRefresh).toHaveBeenCalled()
    expect(props.onWritten).not.toHaveBeenCalled()
    const close = screen.getByTestId('comment-close')
    await waitFor(() => expect(close).toHaveFocus())
    await user.click(close)
    expect(props.onWritten).toHaveBeenCalled()
  })

  // ---- C-21 ----
  it('C-21 an empty Save is blocked and says what is missing; typing unblocks it', async () => {
    const user = userEvent.setup()
    setup()
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    expect(saveButton()).toHaveAccessibleDescription(WINDOW_COPY.writeCommentFirst)
    await fieldFocused()
    await user.type(field(), 'Fine')
    expect(saveButton()).not.toHaveAttribute('aria-disabled')
  })

  it('C-21 an unsaved source blocks Save with its own reason', () => {
    guard.current = { ...guard.current, state: 'dirty' }
    try {
      setup()
      expect(saveButton()).toHaveAccessibleDescription(WINDOW_COPY.saveFileFirst('index.html'))
    } finally {
      guard.current = { ...guard.current, state: 'clean' }
    }
  })

  it('C-21 a save in flight is busy, not blocked', async () => {
    const user = userEvent.setup()
    let answer: (r: CommentSaveResult) => void = () => {}
    setup({ onSave: vi.fn(() => new Promise<CommentSaveResult>(r => (answer = r))) })
    await fieldFocused()
    await user.type(field(), 'Saving')
    await user.click(saveButton())
    expect(saveButton()).toHaveAttribute('aria-busy', 'true')
    expect(saveButton()).not.toHaveAccessibleDescription(WINDOW_COPY.writeCommentFirst)
    answer({ ok: true, threadKey: 't1' })
  })

  // ---- C-03 (window) ----
  it('C-03 (window) a new comment on a Markdown heading is titled with its text', () => {
    const base = mdRequest()
    setup({ request: mdRequest({ target: { ...base.target, tag: 'h2' }, words: { text: 'Next steps', start: 0, end: 0, cut: false } }) }, true)
    expect(screen.getByTestId('comment-window-title')).toHaveTextContent('New comment on H2 heading “Next steps”')
  })
})

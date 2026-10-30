// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment window's thread states and stepping, in both previews
 * (comments-v2 C-05, C-06, C-13, C-14, C-19, C-21, C-03, OD-05; spec 024
 * state table S-02 – S-05, S-07 – S-09, F-01, W-03 – W-05, W-11).
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentFileView, CommentSaveResult } from '../../../../shared/ipc/preview-comment-schema'
import { commentDrafts, type CommentListState } from '../../stores/usePreviewCommentStore'
import {
  damaged,
  fileView,
  message,
  thread,
  threadsRequest
} from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { COPY } from './commentCopy'
import { MARKDOWN_WORDS } from './commentCopyWords'
import { CommentWindow, type CommentWindowProps } from './CommentWindow'
import { resetCommentPendingWrites } from './commentPendingWrites'
import { useDrawerFilterState } from './commentDrawerFilter'
import { stepOpenWindow } from './commentStepKeys'
import { WINDOW_COPY } from './commentWindowCopy'
import { CommentWordsContext } from './commentWords'

const ready = (files: CommentFileView[], generation = 1): CommentListState => ({ status: 'ready', files, generation })
const ok = async (): Promise<CommentSaveResult> => ({ ok: true, threadKey: 't1' })

function propsOf(patch: Partial<CommentWindowProps>): CommentWindowProps {
  return {
    request: threadsRequest(),
    list: ready([fileView({ threads: [thread(1)] })]),
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    notVisible: [],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    now: () => new Date(2026, 9, 26, 12, 0),
    locale: 'en-GB',
    onClose: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave: vi.fn(ok),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn(),
    ...patch
  }
}

/** The window in the HTML Preview (modal), or – `markdown` – in the Markdown Preview (docked, C-18). */
function setup(patch: Partial<CommentWindowProps> = {}, markdown = false) {
  const props = propsOf(patch)
  const wrap = (p: CommentWindowProps) =>
    markdown ? (
      <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
        <CommentWindow {...p} />
      </CommentWordsContext.Provider>
    ) : (
      <CommentWindow {...p} />
    )
  const view = render(wrap(props))
  return { props, ...view, rerenderWith: (next: Partial<CommentWindowProps>) => view.rerender(wrap({ ...props, ...next })) }
}

const three = () => fileView({ threads: [thread(1), thread(2), thread(3)] })

describe('CommentWindow – v2 thread states', () => {
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

  // ---- C-05 not found (S-05) ----
  it('C-05 (HTML) a lost element keeps Reply and Resolve, and Resolve leads with the first focus', async () => {
    setup({ list: ready([fileView({ threads: [thread(1, { attached: false, quote: 'Buy now' })] })]) })
    expect(screen.getByTestId('comment-not-found')).toHaveTextContent(WINDOW_COPY.notFound('element', 'index.html'))
    expect(screen.getByTestId('comment-not-found-quote')).toHaveTextContent('Buy now')
    expect(screen.getByTestId('comment-comment-line')).toHaveTextContent('The comment itself is on line 11 of index.html.')
    expect(screen.getByTestId('comment-reply-field')).toBeInTheDocument()
    const resolve = screen.getByTestId('comment-resolve')
    expect(resolve).toHaveClass('dialog-btn-primary')
    await waitFor(() => expect(resolve).toHaveFocus())
  })

  it('C-05 (Markdown) the sentence names the kind, and the context line says not found', () => {
    setup({ list: ready([fileView({ displayPath: 'notes.md', threads: [thread(1, { tag: 'p', attached: false })] })]) }, true)
    const banner = screen.getByTestId('comment-not-found')
    expect(banner).toHaveTextContent(WINDOW_COPY.notFound('paragraph', 'notes.md'))
    expect(banner).not.toHaveTextContent(/element/)
    expect(screen.getByText('paragraph, not found · notes.md')).toBeInTheDocument()
    expect(screen.getByTestId('comment-resolve')).toHaveClass('dialog-btn-primary')
  })

  it('S-02 an open, attached thread has no state note and Resolve stays secondary', () => {
    setup()
    expect(screen.queryByTestId('comment-not-found')).toBeNull()
    expect(screen.queryByTestId('comment-changed')).toBeNull()
    expect(screen.getByTestId('comment-resolve')).toHaveClass('dialog-btn-secondary')
  })

  // ---- C-06 changed (S-03, S-04) ----
  it('C-06 (HTML) a changed target shows Was and Now, and Resolve leads', () => {
    setup({ list: ready([fileView({ threads: [thread(1, { change: { state: 'changed', was: 'Buy now', now: 'Buy today' } })] })]) })
    const status = screen.getByTestId('comment-changed')
    expect(status).toHaveTextContent(WINDOW_COPY.changed)
    expect(within(status).getByTestId('comment-was')).toHaveTextContent('WasBuy now')
    expect(within(status).getByTestId('comment-now')).toHaveTextContent('NowBuy today')
    expect(screen.getByTestId('comment-resolve')).toHaveClass('dialog-btn-primary')
  })

  it('C-06 words changed with nothing left says the words are gone and shows Was only', () => {
    setup({ list: ready([fileView({ threads: [thread(1, { change: { state: 'words', was: 'cheap seats' } })] })]) })
    expect(screen.getByTestId('comment-changed')).toHaveTextContent(WINDOW_COPY.wordsGone('element'))
    expect(screen.getByTestId('comment-was')).toHaveTextContent('cheap seats')
    expect(screen.queryByTestId('comment-now')).toBeNull()
  })

  it('C-06 S-04 words changed between kept ends shows what is there now', () => {
    setup({ list: ready([fileView({ threads: [thread(1, { change: { state: 'words', was: 'cheap seats', now: 'good seats' } })] })]) })
    expect(screen.getByTestId('comment-changed')).toHaveTextContent(WINDOW_COPY.changed)
    expect(screen.getByTestId('comment-now')).toHaveTextContent('good seats')
  })

  it('C-21 (Markdown) the Was and Now boxes use the preview serif class; HTML does not', () => {
    const list = ready([fileView({ displayPath: 'notes.md', threads: [thread(1, { tag: 'p', change: { state: 'changed', was: 'a', now: 'b' } })] })])
    const { unmount } = setup({ list }, true)
    expect(screen.getByTestId('comment-was').querySelector('.erf-comment-words--md')).not.toBeNull()
    unmount()
    setup({ list })
    expect(screen.getByTestId('comment-was').querySelector('.erf-comment-words--md')).toBeNull()
  })

  // ---- C-03 (window) ----
  it('C-03 (window) a Markdown heading thread is titled with its text', () => {
    setup({ list: ready([fileView({ displayPath: 'notes.md', threads: [thread(1, { tag: 'h2', quote: 'Next steps' })] })]) }, true)
    expect(screen.getByTestId('comment-window-title')).toHaveTextContent('Comment on H2 heading “Next steps”')
  })

  // ---- C-19 ----
  it('C-19 a resolved thread offers Reopen', () => {
    setup({ list: ready([fileView({ threads: [thread(1, { status: 'resolved' })] })]) })
    expect(screen.getByTestId('comment-reopen')).toHaveTextContent(COPY.reopen)
    expect(COPY.reopen).toBe('Reopen')
  })

  it('C-19 a refused reply at the reply limit names the limit and keeps the text', async () => {
    const user = userEvent.setup()
    setup({ onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_LIMIT, reason: 'replies' as const })) })
    await user.type(screen.getByTestId('comment-reply-field'), 'One more')
    await user.click(screen.getByTestId('comment-reply'))
    expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(WINDOW_COPY.replies)
    expect(screen.getByTestId('comment-reply-field')).toHaveValue('One more')
  })

  it('C-19 an out-of-date window says to open the comment again and reads the list again', async () => {
    const user = userEvent.setup()
    const { props } = setup({ onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_KEY_INVALID })) })
    await user.click(screen.getByTestId('comment-resolve'))
    expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(WINDOW_COPY.keyInvalid)
    expect(props.onRefresh).toHaveBeenCalled()
  })

  // ---- C-21 ----
  it('C-21 an empty reply is blocked: aria-disabled, and it says what is missing', () => {
    setup()
    const reply = screen.getByTestId('comment-reply')
    expect(reply).toHaveAttribute('aria-disabled', 'true')
    expect(reply).not.toHaveAttribute('aria-busy')
    expect(reply).toHaveAccessibleDescription(WINDOW_COPY.writeReplyFirst)
  })

  it('C-21 a reply being written is busy, not blocked', async () => {
    const user = userEvent.setup()
    let answer: (r: CommentSaveResult) => void = () => {}
    setup({ onSave: vi.fn(() => new Promise<CommentSaveResult>(r => (answer = r))) })
    await user.type(screen.getByTestId('comment-reply-field'), 'Agreed')
    await user.click(screen.getByTestId('comment-reply'))
    const reply = screen.getByTestId('comment-reply')
    expect(reply).toHaveAttribute('aria-busy', 'true')
    expect(reply).not.toHaveAccessibleDescription(WINDOW_COPY.writeReplyFirst)
    await act(async () => answer({ ok: true, threadKey: 't1' }))
  })
})

describe('CommentWindow – state table S-07 – S-09 and F-01', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => {
    portalRoot.remove()
    commentDrafts.reset()
  })

  const blockRequest = (key: string) => threadsRequest({ threadKeys: [], blockKeys: [key] })
  const primaries = () => document.querySelectorAll('.dialog-btn-primary')

  it('S-07 (Markdown) a damaged comment: the warning sentence, read-only raw text, Copy raw text, Open in source, Delete damaged comment…, and no main button', () => {
    setup({ request: blockRequest('b1'), list: ready([fileView({ damaged: [damaged(1)] })]) }, true)
    const view = screen.getByTestId('comment-damaged')
    expect(view).toHaveTextContent("Erfana can't read this comment, so it won't change it. Fix it in the source, or delete it.")
    expect(view.querySelector('.erf-comment-banner--warning')).not.toBeNull()
    expect(screen.getByTestId('comment-damaged-raw')).toHaveTextContent('<!-- erfana:comment {not json -->')
    expect(within(view).getByRole('button', { name: COPY.copyRaw })).toBeVisible()
    expect(within(view).getByRole('button', { name: COPY.openInSource })).toBeVisible()
    expect(screen.getByTestId('comment-delete-block')).toHaveTextContent('Delete damaged comment…')
    // Rebuild from data… only for readable-mismatch / id-mismatch with valid @data (OD-05).
    expect(screen.queryByTestId('comment-rebuild')).toBeNull()
    expect(primaries()).toHaveLength(0)
  })

  it('S-07 (HTML) a damaged comment has the same parts – raw text, Copy raw text, Open in source, Delete – and no main button; none to delete in a read-only file', () => {
    const { unmount } = setup({ request: blockRequest('b1'), list: ready([fileView({ damaged: [damaged(1)] })]) })
    const view = screen.getByTestId('comment-damaged')
    // The state table's sentence, never "comment block".
    expect(view).toHaveTextContent("Erfana can't read this comment, so it won't change it. Fix it in the source, or delete it.")
    expect(view).not.toHaveTextContent(/comment block/)
    expect(view.querySelector('.erf-comment-banner--warning')).not.toBeNull()
    expect(within(view).getByRole('button', { name: COPY.copyRaw })).toBeVisible()
    expect(within(view).getByRole('button', { name: COPY.openInSource })).toBeVisible()
    expect(screen.getByTestId('comment-delete-block')).toBeVisible()
    expect(primaries()).toHaveLength(0)
    unmount()
    setup({ request: blockRequest('b1'), list: ready([fileView({ writable: false, damaged: [damaged(1)] })]) })
    expect(screen.queryByTestId('comment-delete-block')).toBeNull()
  })

  it('S-08 (Markdown) damaged by a merge: the conflict sentence, no Rebuild, no main button; no Delete in a read-only file', () => {
    // Even with data main could rebuild from, a conflict is fixed in the source.
    const rebuild = { lines: [{ file: '- status: open', data: '- status: resolved' }] }
    setup(
      {
        request: blockRequest('b1'),
        list: ready([fileView({ writable: false, damaged: [damaged(1, { reason: 'conflict-marker', rebuild })] })])
      },
      true
    )
    expect(screen.getByTestId('comment-damaged')).toHaveTextContent('This comment contains git conflict markers. Resolve the conflict in the source.')
    expect(screen.queryByTestId('comment-rebuild')).toBeNull()
    expect(screen.queryByTestId('comment-delete-block')).toBeNull()
    expect(primaries()).toHaveLength(0)
  })

  it('S-08 (HTML, Markdown) damaged by a merge in a writable file (no complete conflict hunk): the conflict sentence, Delete offered, still no Rebuild', () => {
    const rebuild = { lines: [{ file: '- status: open', data: '- status: resolved' }] }
    for (const markdown of [false, true]) {
      const { unmount } = setup(
        { request: blockRequest('b1'), list: ready([fileView({ writable: true, damaged: [damaged(1, { reason: 'conflict-marker', rebuild })] })]) },
        markdown
      )
      expect(screen.getByTestId('comment-damaged')).toHaveTextContent('This comment contains git conflict markers. Resolve the conflict in the source.')
      expect(screen.getByTestId('comment-delete-block')).toBeVisible()
      expect(screen.queryByTestId('comment-rebuild')).toBeNull()
      expect(primaries()).toHaveLength(0)
      unmount()
    }
  })

  it('S-09 (HTML, Markdown) the newer-format sentence is the state table\'s, word for word', () => {
    for (const markdown of [false, true]) {
      const { unmount } = setup(
        { request: blockRequest('n1'), list: ready([fileView({ newer: [{ blockKey: 'n1', version: 2, line: 70 }] })]) },
        markdown
      )
      expect(screen.getByTestId('comment-newer')).toHaveTextContent('A newer version of Erfana wrote this comment, so it is read-only here.')
      unmount()
    }
  })

  it('S-09 a newer-format comment is shown read-only with an info banner titled "Newer format – read-only", no actions that change it and no main button', () => {
    for (const markdown of [false, true]) {
      const { unmount } = setup(
        { request: blockRequest('n1'), list: ready([fileView({ newer: [{ blockKey: 'n1', version: 2, line: 70 }] })]) },
        markdown
      )
      const view = screen.getByTestId('comment-newer')
      expect(view).toHaveAccessibleName('Newer format – read-only')
      expect(view.querySelector('.erf-comment-banner--info')).not.toBeNull()
      expect(view).toHaveTextContent(/^.*A newer version of Erfana wrote this comment/)
      expect(screen.queryByTestId('comment-delete-block')).toBeNull()
      expect(screen.queryByTestId('comment-rebuild')).toBeNull()
      expect(screen.queryByTestId('comment-reply-field')).toBeNull()
      expect(primaries()).toHaveLength(0)
      unmount()
    }
  })

  it('F-01 (HTML, Markdown) a writable file adds nothing over the comment state: no reason, no band, Reply and Resolve usable', () => {
    for (const markdown of [false, true]) {
      const { unmount } = setup({ list: ready([fileView({ writable: true, threads: [thread(1)] })]) }, markdown)
      expect(screen.queryByTestId('comment-read-only')).toBeNull()
      expect(screen.getByTestId('comment-reply-field')).toBeEnabled()
      expect(screen.getByRole('button', { name: COPY.resolve })).not.toHaveAttribute('aria-disabled')
      unmount()
    }
  })
})

describe('CommentWindow – v2 stepping (C-13)', () => {
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

  it('C-13 the stepper counts the open comments and steps with ‹ ›, revealing each target', async () => {
    const user = userEvent.setup()
    const { props } = setup({ list: ready([three()]), onReveal: vi.fn() })
    expect(screen.getByTestId('comment-stepper')).toHaveTextContent('1 of 3')
    await user.click(screen.getByTestId('comment-step-next'))
    expect(props.onReveal).toHaveBeenCalledWith('t2')
    expect(screen.getByTestId('comment-stepper')).toHaveTextContent('2 of 3')
    // The live region clears, then speaks on the next tick, so a repeat is spoken again.
    await waitFor(() =>
      expect(screen.getByTestId('comment-window-polite')).toHaveTextContent('Comment 2 of 3, on element, line 12.')
    )
    await waitFor(() => expect(screen.getByTestId('comment-window-title')).toHaveFocus())
    await user.click(screen.getByTestId('comment-step-previous'))
    expect(props.onReveal).toHaveBeenLastCalledWith('t1')
  })

  it('C-13 Alt+F9 steps forward and Alt+Shift+F9 back, wrapping', () => {
    const { props } = setup({ list: ready([three()]), onReveal: vi.fn() })
    const win = screen.getByTestId('comment-window')
    fireEvent.keyDown(win, { key: 'F9', code: 'F9', altKey: true, shiftKey: true })
    expect(props.onReveal).toHaveBeenLastCalledWith('t3')
    fireEvent.keyDown(win, { key: 'F9', code: 'F9', altKey: true })
    expect(props.onReveal).toHaveBeenLastCalledWith('t1')
    fireEvent.keyDown(win, { key: 'F9', code: 'F9' })
    expect(props.onReveal).toHaveBeenCalledTimes(2)
  })

  it('024-AC-019 C-13 the stepper steps within the drawer filter: Resolved walks the resolved comments', async () => {
    const user = userEvent.setup()
    const drawer = renderHook(() => useDrawerFilterState('drawer-1'))
    act(() => drawer.result.current[1]('resolved'))
    const list = ready([fileView({ threads: [thread(1, { status: 'resolved' }), thread(2), thread(3, { status: 'resolved' })] })])
    const { props } = setup({ list, onReveal: vi.fn(), drawerId: 'drawer-1' })
    expect(screen.getByTestId('comment-stepper')).toHaveTextContent('1 of 2')
    await user.click(screen.getByTestId('comment-step-next'))
    expect(props.onReveal).toHaveBeenCalledWith('t3')
    await waitFor(() =>
      expect(screen.getByTestId('comment-window-polite')).toHaveTextContent('Comment 2 of 2, on element, line 13.')
    )
    drawer.unmount()
  })

  it('024-AC-019 C-13 with the drawer shut the stepper walks the open comments (the default filter)', () => {
    setup({ list: ready([three()]), drawerId: 'drawer-shut' })
    expect(screen.getByTestId('comment-stepper')).toHaveTextContent('1 of 3')
  })

  it('024-AC-019 C-13 an Alt+F9 from the preview steps the open window', async () => {
    const { props } = setup({ list: ready([three()]), onReveal: vi.fn(), drawerId: 'drawer-2' })
    act(() => {
      expect(stepOpenWindow('drawer-2', 'next')).toBe(true)
    })
    expect(props.onReveal).toHaveBeenLastCalledWith('t2')
  })

  it('C-13 one open comment shows no stepper', () => {
    setup()
    expect(screen.queryByTestId('comment-stepper')).toBeNull()
    expect(screen.queryByTestId('comment-resolve-next')).toBeNull()
  })

  it('C-13 Resolve and next resolves the shown comment in one write, then steps on', async () => {
    const user = userEvent.setup()
    const { props } = setup({ list: ready([three()]), onReveal: vi.fn() })
    await user.click(screen.getByTestId('comment-resolve-next'))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'setStatus', status: 'resolved', threadKey: 't1' }))
    await waitFor(() => expect(props.onReveal).toHaveBeenCalledWith('t2'))
  })

  it('C-13 a refused Resolve and next stays on the comment and says why', async () => {
    const user = userEvent.setup()
    const { props } = setup({
      list: ready([three()]),
      onReveal: vi.fn(),
      onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_KEY_INVALID }))
    })
    await user.click(screen.getByTestId('comment-resolve-next'))
    expect(await screen.findByTestId('comment-save-error')).toBeInTheDocument()
    expect(props.onReveal).not.toHaveBeenCalled()
  })

  it('C-13 Reply and resolve sends one reply that resolves the thread', async () => {
    const user = userEvent.setup()
    const { props } = setup()
    expect(screen.queryByTestId('comment-reply-resolve')).toBeNull()
    await user.type(screen.getByTestId('comment-reply-field'), 'Done')
    await user.click(screen.getByTestId('comment-reply-resolve'))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'reply', text: 'Done', resolve: true }))
    expect(props.onSave).toHaveBeenCalledTimes(1)
  })

  it('C-13 the head keeps New comment and Open in source under More actions', async () => {
    const user = userEvent.setup()
    setup({ list: ready([three()]) })
    await user.click(screen.getByTestId('comment-more-actions'))
    expect(await screen.findByText(COPY.openInSource)).toBeInTheDocument()
  })

  it('W-11 once every comment is resolved the window says so and Close takes focus', async () => {
    const { rerenderWith } = setup({ list: ready([three()]) })
    // The window's own first focus lands on a timer: the list changes after it, as in use.
    await waitFor(() => expect(screen.getByTestId('comment-window-title')).toHaveFocus())
    const resolved = { status: 'resolved' as const }
    rerenderWith({
      list: ready([fileView({ threads: [thread(1, resolved), thread(2, resolved), thread(3, resolved)] })], 2)
    })
    expect(await screen.findByTestId('comment-all-done')).toHaveTextContent(WINDOW_COPY.allDone)
    expect(screen.queryByTestId('comment-stepper')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('comment-close')).toHaveFocus())
  })
})

describe('CommentWindow – v2 the file changed under the window (C-14)', () => {
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

  it('C-14 W-03 a thread changed outside the window says Updated and marks the new replies', () => {
    const { rerenderWith } = setup()
    expect(screen.queryByTestId('comment-updated')).toBeNull()
    const changed = thread(1, { rawHash: 'f'.repeat(64), messages: [message(1), message(5)] })
    rerenderWith({ list: ready([fileView({ threads: [changed] })], 2) })
    expect(screen.getByTestId('comment-updated')).toHaveTextContent(WINDOW_COPY.updated('index.html'))
    expect(screen.getByTestId('comment-new-since')).toHaveTextContent(WINDOW_COPY.newSince)
  })

  it('C-14 W-03 a write from this window is not news', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = setup()
    await user.type(screen.getByTestId('comment-reply-field'), 'Mine')
    await user.click(screen.getByTestId('comment-reply'))
    const mine = thread(1, { rawHash: 'f'.repeat(64), messages: [message(1), message(5, { text: 'Mine' })] })
    rerenderWith({ list: ready([fileView({ threads: [mine] })], 2) })
    expect(screen.queryByTestId('comment-updated')).toBeNull()
    expect(screen.queryByTestId('comment-new-since')).toBeNull()
  })

  it('C-14 W-04 removed outside Erfana while open: the window stays, read-only, with Copy text', async () => {
    const user = userEvent.setup()
    const { props, rerenderWith } = setup()
    await user.type(screen.getByTestId('comment-reply-field'), 'Half a reply')
    rerenderWith({ list: ready([fileView({ threads: [] })], 2) })
    expect(screen.getByTestId('comment-removed')).toHaveTextContent(WINDOW_COPY.removed('index.html'))
    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('comment-resolve')).toBeNull()
    await user.click(screen.getByTestId('comment-copy-text'))
    expect(props.onCopyRaw).toHaveBeenCalledWith('Half a reply')
  })

  it('C-14 W-04 with no typed reply Copy text copies the thread', async () => {
    const user = userEvent.setup()
    const { props, rerenderWith } = setup()
    rerenderWith({ list: ready([fileView({ threads: [] })], 2) })
    await user.click(screen.getByTestId('comment-copy-text'))
    expect(props.onCopyRaw).toHaveBeenCalledWith('Message 1')
  })

  it('C-14 W-05 a reply refused because the thread changed keeps the text and reads the list again', async () => {
    const user = userEvent.setup()
    const { props } = setup({ onSave: vi.fn(async () => ({ ok: false as const, code: ErrorCode.COMMENT_BLOCK_CHANGED })) })
    await user.type(screen.getByTestId('comment-reply-field'), 'Keep me')
    await user.click(screen.getByTestId('comment-reply'))
    expect(await screen.findByTestId('comment-save-error')).toHaveTextContent(WINDOW_COPY.blockChangedReply('index.html'))
    expect(screen.getByTestId('comment-reply-field')).toHaveValue('Keep me')
    expect(props.onRefresh).toHaveBeenCalled()
  })
})

describe('CommentWindow – v2 Rebuild from data (OD-05)', () => {
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

  const request = threadsRequest({ threadKeys: [], blockKeys: ['b1'] })
  const lines = [{ file: '- **Ada** wrote: Buy nwo', data: '- **Ada** wrote: Buy now' }]

  it('OD-05 a damaged block with valid data offers Rebuild, shows file against data, and rebuilds', async () => {
    const user = userEvent.setup()
    const block = damaged(1, { reason: 'readable-mismatch', rebuild: { lines } })
    const { props } = setup({ request, list: ready([fileView({ damaged: [block] })]) })
    await user.click(screen.getByTestId('comment-rebuild'))
    const confirm = screen.getByTestId('comment-rebuild-confirm')
    expect(confirm).toHaveTextContent(WINDOW_COPY.rebuildIntro)
    expect(confirm).toHaveTextContent('Buy nwo')
    expect(confirm).toHaveTextContent('Buy now')
    await user.click(screen.getByTestId('comment-rebuild-run'))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'rebuildBlock', blockKey: 'b1', fileKey: 'f1' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.not.objectContaining({ status: expect.anything() }))
  })

  it('C-14 W-04 a damaged block this window deleted closes the window – it was never removed outside Erfana', async () => {
    const user = userEvent.setup()
    const { props, rerenderWith } = setup({ request, list: ready([fileView({ damaged: [damaged(1)] })]) })
    await user.click(screen.getByTestId('comment-delete-block'))
    await user.click(screen.getByTestId('comment-delete-block-confirm'))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'deleteBlock', blockKey: 'b1' })))
    rerenderWith({ request, list: ready([fileView({ damaged: [] })], 2) })
    expect(screen.queryByTestId('comment-removed')).toBeNull()
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('OD-05 when only the status line differs, the choice is Keep open or Mark resolved', async () => {
    const user = userEvent.setup()
    const block = damaged(1, { reason: 'readable-mismatch', rebuild: { lines, claims: 'resolved' } })
    const { props } = setup({ request, list: ready([fileView({ damaged: [block] })]) })
    await user.click(screen.getByTestId('comment-rebuild'))
    expect(screen.queryByTestId('comment-rebuild-run')).toBeNull()
    await user.click(screen.getByTestId('comment-rebuild-mark-resolved'))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ op: 'rebuildBlock', status: 'resolved' }))
  })

  it('OD-05 no Rebuild without valid data, or in a read-only file', () => {
    const { unmount } = setup({ request, list: ready([fileView({ damaged: [damaged(1)] })]) })
    expect(screen.queryByTestId('comment-rebuild')).toBeNull()
    unmount()
    const block = damaged(1, { reason: 'readable-mismatch', rebuild: { lines } })
    setup({ request, list: ready([fileView({ writable: false, damaged: [block] })]) })
    expect(screen.queryByTestId('comment-rebuild')).toBeNull()
  })
})

describe('CommentWindow – v2 docked in the Markdown Preview (C-18)', () => {
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

  const mdList = () => ready([fileView({ displayPath: 'notes.md', threads: [thread(1, { tag: 'p' })] })])

  it('C-18 (Markdown) the window is a non-modal dialog: no aria-modal, an outside click keeps it', async () => {
    const user = userEvent.setup()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { props } = setup({ list: mdList() }, true)
    const win = screen.getByRole('dialog')
    expect(win).not.toHaveAttribute('aria-modal')
    expect(win).toHaveClass('erf-comment-window--docked')
    await user.click(outside)
    expect(props.onClose).not.toHaveBeenCalled()
    outside.remove()
  })

  it('C-18 (Markdown) Esc closes the docked window', async () => {
    const { props } = setup({ list: mdList() }, true)
    await waitFor(() => expect(screen.getByTestId('comment-window-title')).toHaveFocus())
    fireEvent.keyDown(screen.getByTestId('comment-window-title'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('C-18 (Markdown) F6 moves focus between the window and the preview', async () => {
    const preview = document.createElement('div')
    preview.tabIndex = 0
    document.body.appendChild(preview)
    setup({ list: mdList(), dock: { anchor: () => null, preview: () => preview } }, true)
    const title = screen.getByTestId('comment-window-title')
    await waitFor(() => expect(title).toHaveFocus())
    fireEvent.keyDown(title, { key: 'F6' })
    expect(preview).toHaveFocus()
    fireEvent.keyDown(preview, { key: 'F6' })
    expect(title).toHaveFocus()
    preview.remove()
  })

  it('C-18 (Markdown) inside dockview (`contain: layout`) the docked window is placed in the grid box, not the viewport', () => {
    const leftOf = () => Number.parseFloat(screen.getByTestId('comment-window').style.left)
    const first = setup({ list: mdList() }, true)
    const inViewport = leftOf()
    first.unmount()
    // The probe is the box `position: fixed` resolves against: dockview's grid, 477px in from the viewport.
    const real = HTMLElement.prototype.getBoundingClientRect
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'comment-window-frame' ? new DOMRect(477, 20, 900, 700) : real.call(this)
    })
    try {
      setup({ list: mdList() }, true)
      expect(screen.getByTestId('comment-window')).toHaveAttribute('data-placement', 'float')
      expect(leftOf()).toBe(inViewport - 477)
    } finally {
      spy.mockRestore()
    }
  })

  it('C-18 (HTML) the window stays modal over the still page', () => {
    setup()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `.txt` conformance preview, renderer half (spec 024 024-FR-002,
 * 024-AC-002; architecture note 001 § 3).
 *
 * The shared renderer overlay host, driven by the `.txt` adapter alone: the
 * paragraphs the preview draws are the targets, a pick is described in the
 * `.txt` kind's terms, main's placements come back to the right paragraph,
 * and comment mode, the window and the save run unchanged. The comment
 * source is mocked – the main half
 * (`src/main/services/comments/__conformance__/txt/`) runs the real flow.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentFileView, CommentThreadView } from '../../../../../../shared/ipc/comment-common-schema'
import type { FileCommentSaveRequest, ThreadPlacement } from '../../../../../../shared/ipc/file-comment-schema'
import { TEST_IDS } from '../../../../constants/testids'
import { useGlobalSettingsStore } from '../../../../stores/useGlobalSettingsStore'
import { commentDrafts, usePreviewCommentStore } from '../../../../stores/usePreviewCommentStore'
import { useProjectStore } from '../../../../stores/useProjectStore'
import { globalSettings } from '../../../../test-utils/globalSettings'
import { DialogProvider } from '../../../Dialog'
import { ToastProvider } from '../../../Toast/ToastContext'
import type { RendererCommentSource } from '../../overlay/useCommentOverlayHost'
import { TXT_FILE_PATH, TxtCommentsPreview } from './TxtCommentsPreview'
import { createTxtAdapter } from './txtAdapter'

const TEXT = 'Intro paragraph.\n\nThe release ships on Friday.\nIt needs a date.\n\nLast paragraph.\n'
const DRAFT_TOKEN = '0123456789abcdef0123456789abcdef'

function thread(key: string, line: number): CommentThreadView {
  return {
    threadKey: key,
    rawHash: 'a'.repeat(64),
    status: 'open',
    line,
    tag: 'p',
    classes: [],
    attached: true,
    notVisible: false,
    messages: [{ id: 'm1', by: { name: 'Test Reviewer' }, at: '2026-10-30T12:00:00Z', text: `Comment ${key}` }]
  }
}

function fileView(threads: CommentThreadView[]): CommentFileView {
  return { fileKey: 'file-key', displayPath: 'notes.txt', filePath: TXT_FILE_PATH, frame: false, writable: true, threads, damaged: [], newer: [] }
}

/** A mocked `fileCommentGateway`, bound to the panel and file. */
function mockSource(threads: CommentThreadView[] = [], placements: ThreadPlacement[] = []) {
  return {
    list: vi.fn(async () => ({ ok: true as const, file: fileView(threads), placements })),
    openDraft: vi.fn(async () => ({ ok: true as const, draftToken: DRAFT_TOKEN })),
    save: vi.fn(async (_request: FileCommentSaveRequest) => ({ ok: true as const, threadKey: 'new-thread' })),
    onChanged: vi.fn(() => () => {})
  } satisfies RendererCommentSource
}

function renderPreview(source: RendererCommentSource) {
  return render(
    <ToastProvider>
      <DialogProvider>
        <TxtCommentsPreview text={TEXT} source={source} />
      </DialogProvider>
    </ToastProvider>
  )
}

const paragraph = (line: number): HTMLElement => document.querySelector<HTMLElement>(`p[data-line-start="${line}"]`)!

beforeEach(() => {
  Element.prototype.scrollIntoView ??= vi.fn()
  usePreviewCommentStore.getState().reset()
  commentDrafts.reset()
  useProjectStore.setState({ dirtyPanelIds: new Set<string>(), dockviewApi: null })
  useGlobalSettingsStore.setState({
    settings: globalSettings({ comments: { authorName: 'Test Reviewer', identityNoticeSeen: true } }),
    isLoading: false,
    error: null,
    isInitialized: true,
    wasCorruptionRecovered: false
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('024-AC-002 the .txt test preview plugs into the shared renderer host', () => {
  it('024-AC-002 the .txt adapter names each drawn paragraph by its first line, and describes a pick as the .txt kind locates it', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p data-line-start="1">Intro.</p><p data-line-start="3">The release  ships.</p>'
    const adapter = createTxtAdapter(() => root)
    const [first, second] = adapter.targetsInOrder()
    expect(adapter.targetsInOrder().map(adapter.lineOf)).toEqual([1, 3])
    expect(adapter.targetAt(second.firstChild)).toBe(second)
    expect(adapter.targetAt(document.body)).toBeNull()
    expect(adapter.parentOf(first)).toBeNull()
    expect(adapter.childOf(first)).toBeNull()
    expect(adapter.describe(second)).toEqual({ lineStart: 3, lineEnd: 3, tag: 'p', ordinal: 1, quote: { exact: 'The release ships.', prefix: '', suffix: '' } })
    expect(adapter.attach({ threadKey: 'k', line: 3, tag: 'p' })).toBe(second)
    expect(adapter.attach({ threadKey: 'k', line: 2, tag: 'p' })).toBeNull()
    expect(adapter.canComment(first)).toEqual({ ok: true })
  })

  it('024-AC-002 the host lists the file and draws an icon on the paragraph main placed the thread on', async () => {
    // jsdom has no layout: give every box a size, so the shared pin layout can place the icon.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
    const source = mockSource([thread('t1', 3)], [{ threadKey: 't1', line: 3, tag: 'p' }])
    renderPreview(source)
    await waitFor(() => expect(source.list).toHaveBeenCalled())
    const icon = await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)
    expect(icon.getAttribute('aria-label')).toMatch(/line 3/)
    expect(paragraph(3)).toHaveAttribute('aria-details', icon.id)
    expect(paragraph(1)).not.toHaveAttribute('aria-details')
  })

  it('024-AC-002 in comment mode a click on a paragraph opens the window, and the save sends the .txt pick', async () => {
    const user = userEvent.setup()
    const source = mockSource()
    renderPreview(source)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE))
    expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)).toHaveAttribute('aria-pressed', 'true')
    await user.click(paragraph(3))
    const dialog = await screen.findByRole('dialog', { name: 'New comment on paragraph' })
    expect(within(dialog).getByText('notes.txt, line 3')).toBeVisible()
    await user.type(screen.getByTestId('comment-new-field'), 'Which Friday?')
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(source.save).toHaveBeenCalledTimes(1))
    expect(source.save.mock.calls[0][0]).toMatchObject({
      op: 'add',
      draftToken: DRAFT_TOKEN,
      text: 'Which Friday?',
      target: { lineStart: 3, lineEnd: 3, tag: 'p', ordinal: 1, quote: { exact: 'The release ships on Friday. It needs a date.' } }
    })
    await waitFor(() => expect(screen.queryByTestId('comment-window')).toBeNull())
  })

  it('024-AC-002 Esc leaves comment mode, and a click then belongs to the page again', async () => {
    const user = userEvent.setup()
    const source = mockSource()
    renderPreview(source)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE))
    await user.hover(paragraph(1))
    expect(screen.getByTestId(TEST_IDS.COMMENT_HOST_OUTLINE)).toBeInTheDocument()
    paragraph(1).closest<HTMLElement>('.txt-preview')!.focus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_OUTLINE)).toBeNull()
    await user.click(paragraph(1))
    expect(source.openDraft).not.toHaveBeenCalled()
  })
})

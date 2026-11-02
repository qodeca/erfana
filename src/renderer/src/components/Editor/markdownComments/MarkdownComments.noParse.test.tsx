// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments – the renderer never parses the file (spec 024
 * architecture note 001 § 8 C19, Q3; state table W-08).
 *
 * Opening a new comment used to run the Markdown index (a full remark parse)
 * on the renderer's main thread to learn whether the pick sits in a generated
 * START/END region – seconds on a 1 MB file, and again after every save,
 * because the adapter is rebuilt with each new text. The refusal is now main's
 * answer to the draft the window opens with: `file-comment:openDraft` carries
 * the pick, and main checks it against the parse it already runs in its
 * worker. `mdIndex` is wrapped here only to count its calls.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import { indexMarkdown } from '../../../../../shared/markdownComments/mdIndex'
import { TEST_IDS } from '../../../constants/testids'
import { MARKDOWN_WORDS } from '../../Comments/commentCopyWords'
import { DRAFT_TOKEN, FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, type FileCommentsMock } from './__test-utils__/harness'

vi.mock('../../../../../shared/markdownComments/mdIndex', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../../shared/markdownComments/mdIndex')>()
  return { ...actual, indexMarkdown: vi.fn(actual.indexMarkdown) }
})

// No generated region at all: only main's answer can refuse this paragraph.
const DOC = ['# Plan', '', 'We ship the beta on Friday.', ''].join('\n')

const paragraph = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content p[data-line-start="3"]')!

describe('Markdown Preview comments – no renderer parse for the W-08 refusal (§ 8 C19)', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    resetStores()
    api = installApi(fileView())
    setSettings()
    vi.mocked(indexMarkdown).mockClear()
  })
  afterEach(() => {
    portalRoot.remove()
    vi.restoreAllMocks()
  })

  async function openNewComment(): Promise<HTMLElement> {
    const user = userEvent.setup()
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE))
    await user.click(paragraph())
    return screen.findByRole('dialog', { name: 'New comment on paragraph' })
  }

  it('024-AC-024 C-19 (Markdown) W-08 opening a new comment sends the pick with the draft request and never runs the Markdown index in the renderer', async () => {
    await openNewComment()
    expect(api.openDraft).toHaveBeenCalledWith({
      panelId: PANEL_ID,
      filePath: FILE_PATH,
      target: expect.objectContaining({ lineStart: 3, tag: 'p', ordinal: 1 })
    })
    expect(indexMarkdown).not.toHaveBeenCalled()
  })

  it('024-AC-031 C-19 (Markdown) W-08 the window opens with the refusal main\'s draft answer carries, and Save sends nothing', async () => {
    api.openDraft.mockResolvedValue({ ok: true, draftToken: DRAFT_TOKEN, refused: 'generated-region' })
    const dialog = await openNewComment()
    expect(dialog).toHaveTextContent(MARKDOWN_WORDS.saveFailure(ErrorCode.COMMENT_TARGET_MOVED, 'notes.md', 'p', 'generated-region').text)
    const user = userEvent.setup()
    await user.type(await screen.findByTestId('comment-new-field'), 'Edit the generator')
    await user.click(screen.getByTestId('comment-save'))
    expect(api.save).not.toHaveBeenCalled()
  })

  it('024-AC-031 C-19 (Markdown) W-08 a draft answer without a refusal opens a writable window', async () => {
    const dialog = await openNewComment()
    expect(dialog).not.toHaveTextContent(MARKDOWN_WORDS.saveFailure(ErrorCode.COMMENT_TARGET_MOVED, 'notes.md', 'p', 'generated-region').text)
    const user = userEvent.setup()
    await user.type(await screen.findByTestId('comment-new-field'), 'Looks good')
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown host's wiring of the comment window and of the marks it draws
 * into the content (spec 024 commit 14): the dock (C-18), the reveal of a
 * stepped-to thread (C-13), the parent retarget and the known refusal
 * (C-19.3, W-07, W-08), the draft keep-alive (C-14.2), words dropped said
 * once (024-FR-004), the Changed state on icons and words (C-06), and
 * `aria-details` (C-11) – the real preview, host and window, with only the
 * bridge mocked.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { CHANGE_MARK_COPY, MARKDOWN_WORDS, SELECTION_COPY } from '../../Comments/commentCopyWords'
import { COMMENT_CHANGED_HIGHLIGHT, COMMENT_HIGHLIGHT } from '../../Comments/overlay/commentHighlights'
import { DRAFT_REFRESH_MS } from '../../Comments/overlay/hostWindow'
import { DRAFT_TOKEN, FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

const DOC = [
  '# Plan',
  '',
  'We ship the beta to ten customers by Friday.',
  '',
  '- Run the load test against staging.',
  '- two',
  '',
  '<!-- START toc -->',
  '',
  'Generated line.',
  '',
  '<!-- END toc -->',
  ''
].join('\n')

const WORDS: ThreadPlacement = { threadKey: 'w1', line: 3, tag: 'p', sel: { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' } }
const ON_ITEM: ThreadPlacement = { threadKey: 't1', line: 6, tag: 'li' }

const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const scroller = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview')!
const paragraph = (line = 3): HTMLElement => content().querySelector<HTMLElement>(`p[data-line-start="${line}"]`)!
const listItem = (line: number): HTMLElement => content().querySelector<HTMLElement>(`li[data-line-start="${line}"]`)!
const modeTool = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
const polite = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_ANNOUNCE)

/** Every element is drawn; every box is the pane's, except `away`, which sits below it (the pane is 600 × 400). */
function boxesWith(away: () => Element | null): void {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this === away() ? new DOMRect(0, 900, 600, 20) : new DOMRect(0, 0, 600, 400)
  })
}

describe('Markdown Preview comments – the window and the content marks', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement
  let unregister: () => void

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    resetStores()
    api = installApi(fileView([thread('t1', 6, 'li'), thread('w1', 3, 'p')]), [ON_ITEM, WORDS])
    setSettings()
    const panel = { id: PANEL_ID, params: { filePath: FILE_PATH }, view: { contentComponent: 'editor' }, api: { setActive: vi.fn() } }
    unregister = editorSaveRegistry.register(PANEL_ID, { save: vi.fn(async () => true), hasConflict: () => false, holdAutosave: vi.fn(() => () => {}) })
    useProjectStore.setState({
      dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi,
      dirtyPanelIds: new Set()
    })
  })
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    portalRoot.remove()
    unregister()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function ready(): Promise<void> {
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)).toHaveAccessibleName(/^2 comments/))
  }

  async function newCommentOn(user: ReturnType<typeof userEvent.setup>, target: HTMLElement, name: string | RegExp): Promise<HTMLElement> {
    await user.click(modeTool())
    await user.click(target)
    return screen.findByRole('dialog', { name })
  }

  describe('C-18 (Markdown) the docked window', () => {
    it('C-18 (Markdown) a new comment follows the picked block: scrolled out of the pane, it folds to the edge tab, which brings the block back', async () => {
      const user = userEvent.setup()
      await ready()
      await newCommentOn(user, listItem(5), 'New comment on list item')
      boxesWith(() => listItem(5))
      fireEvent(window, new Event('resize'))
      const tab = await screen.findByTestId(TEST_IDS.COMMENT_EDGE_TAB)
      const scrolled = vi.spyOn(listItem(5), 'scrollIntoView')
      await user.click(tab)
      expect(scrolled).toHaveBeenCalled()
    })

    it("C-18 (Markdown) a thread's window follows the thread's block, and F6 moves between the window and the preview", async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      await user.click(listItem(6))
      const dialog = await screen.findByRole('dialog', { name: 'Comment on list item' })
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
      await user.keyboard('{F6}')
      expect(scroller()).toHaveFocus()
      await user.keyboard('{F6}')
      expect(dialog.contains(document.activeElement)).toBe(true)
      boxesWith(() => listItem(6))
      fireEvent(window, new Event('resize'))
      expect(await screen.findByTestId(TEST_IDS.COMMENT_EDGE_TAB)).toBeVisible()
    })
  })

  it('C-13 (Markdown) stepping to the next comment brings its block into view', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(modeTool())
    await user.click(listItem(6))
    await screen.findByRole('dialog', { name: 'Comment on list item' })
    const revealed = vi.spyOn(paragraph(), 'scrollIntoView')
    const next = screen.queryByTestId(TEST_IDS.COMMENT_STEP_NEXT) ?? screen.getByTestId(TEST_IDS.COMMENT_STEP_PREVIOUS)
    await user.click(next)
    await waitFor(() => expect(revealed).toHaveBeenCalled())
  })

  describe('C-13 (Markdown) the step keys with focus in the preview', () => {
    const altF9 = (shift = false): void => {
      fireEvent.keyDown(scroller(), { key: 'F9', code: 'F9', altKey: true, shiftKey: shift })
    }

    it('024-AC-019 C-13 (Markdown) Alt+F9 in the preview opens the first open comment, brings its block into view and says where it landed', async () => {
      await ready()
      const revealed = vi.spyOn(listItem(6), 'scrollIntoView')
      scroller().focus()
      altF9()
      await screen.findByRole('dialog', { name: 'Comment on list item' })
      expect(revealed).toHaveBeenCalled()
      await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_STEP_LIVE)).toHaveTextContent('Comment 1 of 2, on list item, line 6.'))
    })

    it('024-AC-019 C-13 (Markdown) with the window open, Alt+F9 and Alt+Shift+F9 in the preview step the window itself', async () => {
      await ready()
      altF9(true)
      await screen.findByRole('dialog', { name: 'Comment on paragraph' })
      altF9()
      await screen.findByRole('dialog', { name: 'Comment on list item' })
      await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_WINDOW_POLITE)).toHaveTextContent('Comment 1 of 2, on list item, line 6.'))
    })

    it('024-AC-019 C-13 (Markdown) any other F9 press is left to the preview', async () => {
      await ready()
      fireEvent.keyDown(scroller(), { key: 'F9', code: 'F9' })
      fireEvent.keyDown(scroller(), { key: 'F9', code: 'F9', altKey: true, ctrlKey: true })
      await act(async () => {})
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('C-19 (Markdown) refusals the window can act on', () => {
    it('C-19 (Markdown) W-07 a render-check refusal offers the whole list, which opens a new comment on it', async () => {
      const user = userEvent.setup()
      api.save.mockResolvedValueOnce({ ok: false, code: ErrorCode.COMMENT_RENDER_CHANGED, reason: 'render-changed' } as never)
      await ready()
      await newCommentOn(user, listItem(5), 'New comment on list item')
      await user.type(await screen.findByTestId('comment-new-field'), 'Too narrow')
      await user.click(screen.getByTestId('comment-save'))
      await user.click(await screen.findByRole('button', { name: /Comment on the whole list/ }))
      expect(await screen.findByRole('dialog', { name: 'New comment on list' })).toBeVisible()
      expect(api.openDraft).toHaveBeenCalledTimes(2)
    })

    it('C-19 (Markdown) W-08 a block inside a generated region opens with the refusal and Save blocked, before anything is typed', async () => {
      const user = userEvent.setup()
      await ready()
      const dialog = await newCommentOn(user, paragraph(10), 'New comment on paragraph')
      expect(dialog).toHaveTextContent(MARKDOWN_WORDS.saveFailure(ErrorCode.COMMENT_TARGET_MOVED, 'notes.md', 'p', 'generated-region').text)
      await user.type(await screen.findByTestId('comment-new-field'), 'Edit the generator')
      await user.click(screen.getByTestId('comment-save'))
      expect(api.save).not.toHaveBeenCalled()
    })
  })

  it('C-14 (Markdown) a window left open past the draft lifetime saves with a renewed draft, not an expired one', async () => {
    const user = userEvent.setup()
    const renewed = 'f'.repeat(32)
    await ready()
    await newCommentOn(user, listItem(5), 'New comment on list item')
    await user.type(await screen.findByTestId('comment-new-field'), 'Still here')
    api.openDraft.mockResolvedValue({ ok: true, draftToken: renewed })
    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start + DRAFT_REFRESH_MS * 3)
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0][0]).toMatchObject({ op: 'add', draftToken: renewed })
    expect(renewed).not.toBe(DRAFT_TOKEN)
  })

  it('024-FR-004 (Markdown) words main dropped are said by the window, and the host does not say them again', async () => {
    const user = userEvent.setup()
    api.save.mockResolvedValue({ ok: true, threadKey: 'saved', wordsDropped: true } as never)
    await ready()
    const range = document.createRange()
    const text = paragraph().firstChild!
    range.setStart(text, 9)
    range.setEnd(text, 13)
    window.getSelection()!.addRange(range)
    fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    api.list.mockResolvedValue({ ok: true, file: fileView([thread('saved', 3, 'p')]), placements: [{ threadKey: 'saved', line: 3, tag: 'p' }] })
    await user.type(await screen.findByTestId('comment-new-field'), 'Which beta?')
    await user.click(screen.getByTestId('comment-save'))
    // D-16: the Markdown window says the HTML window's sentence, with the target's kind.
    const shown = SELECTION_COPY.wordsNotInFile('paragraph', 'notes.md')
    const dropped = SELECTION_COPY.wordsDropped('paragraph', 'notes.md')
    await waitFor(() => expect(document.body).toHaveTextContent(shown))
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1))
    await act(async () => {})
    expect(polite()).not.toHaveTextContent(dropped)
    expect(polite()).not.toHaveTextContent(shown)
  })

  describe('C-06 (Markdown) the Changed state on the page', () => {
    const changed = { state: 'changed' as const, was: 'Run the load test.', now: 'two' }

    it('C-06 (Markdown) a Changed thread notches its icon and says so in its name', async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
      api.list.mockResolvedValue({ ok: true, file: fileView([thread('t1', 6, 'li', { change: changed }), thread('w1', 3, 'p')]), placements: [ON_ITEM, WORDS] })
      await ready()
      const icons = await screen.findAllByTestId(TEST_IDS.COMMENT_HOST_ICON)
      const item = icons.find(icon => icon.getAttribute('aria-label')?.includes('list item'))!
      const words = icons.find(icon => icon.getAttribute('aria-label')?.includes('paragraph'))!
      expect(item).toHaveAccessibleName(CHANGE_MARK_COPY.iconName(1, 'list item', 6, 1))
      expect(item).toHaveClass('erf-comment-host__icon--changed')
      expect(words).not.toHaveClass('erf-comment-host__icon--changed')
    })

    it("C-06 (Markdown) a Changed selection comment's words wear the dashed changed mark", async () => {
      const set = vi.fn()
      class FakeHighlight {
        readonly ranges: Range[]
        priority = 0
        constructor(...ranges: Range[]) {
          this.ranges = ranges
        }
      }
      vi.stubGlobal('Highlight', FakeHighlight)
      vi.stubGlobal('CSS', { highlights: { set, delete: vi.fn() } })
      const wordsChanged = { state: 'changed' as const, was: 'We ship the beta.', now: 'We ship the beta to ten customers by Friday.' }
      api.list.mockResolvedValue({ ok: true, file: fileView([thread('t1', 6, 'li'), thread('w1', 3, 'p', { change: wordsChanged })]), placements: [ON_ITEM, WORDS] })
      await ready()
      const paintedAs = (name: string): string[] =>
        ((set.mock.calls.filter(([painted]) => painted === name).at(-1)?.[1] as FakeHighlight | undefined)?.ranges ?? []).map(r => r.toString())
      await waitFor(() => expect(paintedAs(COMMENT_CHANGED_HIGHLIGHT)).toEqual(['ten customers']))
      expect(paintedAs(COMMENT_HIGHLIGHT)).toEqual([])
      const css = (await import('node:fs')).readFileSync(
        (await import('node:path')).resolve(__dirname, '../../Comments/overlay/CommentOverlayLayer.css'),
        'utf8'
      )
      expect(css).toMatch(/::highlight\(erf-comment-changed\) \{\s*text-decoration-style: dashed;/)
    })
  })

  describe('C-11 (Markdown) aria-details', () => {
    it('C-11 (Markdown) aria-details points each commented block at its icon, and goes when the icons are hidden', async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
      const user = userEvent.setup()
      await ready()
      const icons = await screen.findAllByTestId(TEST_IDS.COMMENT_HOST_ICON)
      const item = icons.find(icon => icon.getAttribute('aria-label')?.includes('list item'))!
      await waitFor(() => expect(listItem(6).getAttribute('aria-details')).toBe(item.id))
      expect(item.id).not.toBe('')
      expect(document.getElementById(paragraph().getAttribute('aria-details')!)).toHaveAttribute('data-testid', TEST_IDS.COMMENT_HOST_ICON)
      expect(listItem(5).hasAttribute('aria-details')).toBe(false)
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      await user.click(await screen.findByRole('checkbox', { name: 'Show comment icons and underlines' }))
      await waitFor(() => expect(listItem(6).hasAttribute('aria-details')).toBe(false))
      expect(content().querySelector('[data-erf-comment-details]')).toBeNull()
    })

    it('024-AC-032 (Markdown) a copy of commented content carries no comment attribute', async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
      await ready()
      await waitFor(() => expect(listItem(6).hasAttribute('aria-details')).toBe(true))
      const range = document.createRange()
      range.selectNodeContents(content())
      window.getSelection()!.addRange(range)
      const data = new Map<string, string>()
      const event = new Event('copy', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } })
      content().dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(data.get('text/html')).toContain('Run the load test')
      expect(data.get('text/html')).not.toMatch(/aria-details|data-erf-comment|tabindex/)
    })
  })
})

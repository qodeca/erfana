// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selection comments in the Markdown Preview (spec 024 commit 14,
 * 024-FR-004, 024-AC-005): the real preview, host, menu and window, with
 * only the bridge mocked. A selection is set on the rendered DOM the way a
 * drag leaves it.
 *
 * Menu-matrix rows covered here (024-AC-035): M-12, M-14, M-16, M-19, M-21.
 * Also the Markdown focus model's selection steps (C-08.2, C-08.5) and the
 * owner decisions that hold in this preview (OD-02, OD-03, OD-08).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEL_EXACT_MAX_CHARS } from '../../../../../shared/comments/anchorSel'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { MARKDOWN_COPY, SELECTION_COPY, markdownReadOnlyReasonText } from '../../Comments/commentCopyWords'
import { COMMENT_HIGHLIGHT, COMMENT_HIGHLIGHT_PRIORITY } from '../../Comments/overlay/commentHighlights'
import { SELECTION_BUTTON_DELAY_MS } from '../../Comments/overlay/useSelectionComments'
import * as COPY_MODULE from '../../Comments/commentCopy'
import * as WORDS_MODULE from '../../Comments/commentCopyWords'
import { FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

const LONG = `Long ${'words to review '.repeat(16)}end.`
const DOC = [
  '---',
  'title: Notes',
  '---',
  '# Plan',
  '',
  'We ship the beta to ten customers by Friday.',
  '',
  '- Run the load test against staging.',
  '- two',
  '',
  LONG,
  '',
  'Second paragraph here.',
  ''
].join('\n')

const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const block = (selector: string): HTMLElement => content().querySelector<HTMLElement>(selector)!
const paragraph = (): HTMLElement => block('p[data-line-start="6"]')
const modeTool = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
const polite = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_ANNOUNCE)

/** The boundary point `offset` characters into `el`'s text. */
function point(el: Node, offset: number): [Node, number] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = (node as Text).data.length
    if (left <= length) return [node, left]
    left -= length
  }
  throw new Error('offset past the text')
}

/** Select from `from` characters into `start` to `to` characters into `end` (default: the same element). */
function select(start: HTMLElement, from: number, to: number, end: HTMLElement = start): void {
  const range = document.createRange()
  range.setStart(...point(start, from))
  range.setEnd(...point(end, to))
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Select the first occurrence of `words` in `el`. */
function selectWords(el: HTMLElement, words: string): void {
  const at = el.textContent!.indexOf(words)
  select(el, at, at + words.length)
}

function itemsOf(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole('menuitem')
    .map(el => el.querySelector('.context-menu-label')?.textContent ?? el.textContent ?? '')
}

describe('Markdown Preview selection comments (024-AC-005)', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement
  let unregister: () => void

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    // jsdom has no layout for ranges; the preview's own mouse-up reads one.
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    resetStores()
    api = installApi(fileView([thread('t1', 9, 'li')]), [{ threadKey: 't1', line: 9, tag: 'li' }])
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
  }

  async function saveTyped(user: ReturnType<typeof userEvent.setup>, text: string): Promise<Record<string, unknown>> {
    await user.type(await screen.findByTestId('comment-new-field'), text)
    await user.click(screen.getByTestId('comment-save'))
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    return api.save.mock.calls[0][0] as Record<string, unknown>
  }

  it('024-AC-005 (a) M-12: three words, right-click, Comment on selection saves them as anchor.sel on the paragraph', async () => {
    const user = userEvent.setup()
    await ready()
    selectWords(paragraph(), 'ten customers by')
    fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu', { name: SELECTION_COPY.menuLabel })
    const items = itemsOf(menu)
    expect(items.slice(0, 2)).toEqual([SELECTION_COPY.commentOnSelection, SELECTION_COPY.commentOnWhole('paragraph')])
    expect(items.at(-1)).toBe('Copy selection')
    expect(items.length).toBeGreaterThan(3)

    await user.click(screen.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    expect(await screen.findByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible()
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS)).toHaveTextContent(SELECTION_COPY.result('ten customers by'))
    const saved = await saveTyped(user, 'Say which ten')
    expect(saved).toMatchObject({
      target: { lineStart: 6, tag: 'p' },
      sel: { exact: 'ten customers by', prefix: 'We ship the beta to ', suffix: ' Friday.' }
    })
  })

  it('024-AC-005 (b) M-14: in comment mode a drag selects words in a list item instead of picking; the menu offers the comment items only', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(modeTool())
    const item = block('li[data-line-start="8"]')
    fireEvent.mouseDown(item, { button: 0, clientX: 10, clientY: 10 })
    selectWords(item, 'load test')
    fireEvent.mouseUp(item, { button: 0, clientX: 80, clientY: 10 })
    fireEvent.click(item, { button: 0, clientX: 80, clientY: 10 })
    expect(screen.queryByTestId('comment-window')).toBeNull()

    fireEvent.contextMenu(item, { clientX: 10, clientY: 10 })
    const menu = await screen.findByTestId(TEST_IDS.COMMENT_CONTEXT_MENU)
    expect(itemsOf(menu)).toEqual([SELECTION_COPY.commentOnSelection, SELECTION_COPY.commentOnWhole('list item')])
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    const saved = await saveTyped(user, 'Which staging?')
    expect(saved).toMatchObject({ target: { lineStart: 8, tag: 'li' }, sel: { exact: 'load test' } })
  })

  it('024-AC-005 (c): a click on a heading in comment mode picks it, with no words', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(modeTool())
    await user.click(block('h1'))
    const saved = await saveTyped(user, 'Rename')
    expect(saved).toMatchObject({ target: { tag: 'h1' } })
    expect(saved).not.toHaveProperty('sel')
  })

  it('024-AC-005 (d): 250 selected characters are cut at 200, and the notice shows outside the quote', async () => {
    const user = userEvent.setup()
    await ready()
    const long = block('p[data-line-start="11"]')
    select(long, 0, 250)
    fireEvent.contextMenu(long, { clientX: 10, clientY: 10 })
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    const notice = await screen.findByText(SELECTION_COPY.cut(SEL_EXACT_MAX_CHARS))
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS)).not.toContainElement(notice)
    const saved = await saveTyped(user, 'Too long')
    expect([...(saved.sel as { exact: string }).exact].length).toBeLessThanOrEqual(SEL_EXACT_MAX_CHARS)
  })

  it('024-AC-005 (e): with the keyboard only, Narrow to words chooses words in the field and saves them', async () => {
    const user = userEvent.setup()
    await ready()
    await user.click(modeTool())
    await user.click(paragraph())
    await screen.findByRole('dialog', { name: 'New comment on paragraph' })
    const toggle = screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    const field = screen.getByRole('textbox', { name: SELECTION_COPY.narrowLabel('paragraph', 6) })
    expect(field).toHaveAttribute('readonly')
    expect(field).toHaveValue('We ship the beta to ten customers by Friday.')
    act(() => {
      ;(field as HTMLTextAreaElement).setSelectionRange(8, 16)
      fireEvent.select(field)
    })
    expect(screen.getByTestId(TEST_IDS.COMMENT_NARROW_RESULT)).toHaveTextContent(SELECTION_COPY.result('the beta'))
    const saved = await saveTyped(user, 'Name it')
    expect(saved).toMatchObject({ sel: { exact: 'the beta', prefix: 'We ship ', suffix: ' to ten customers by Friday.' } })
  })

  it('024-AC-005 (f) M-19 M-21: a selection in the frontmatter offers Comment on selection disabled with its reason, and nothing is written', async () => {
    const user = userEvent.setup()
    await ready()
    const frontmatter = block('.frontmatter-wrapper, .frontmatter-error-wrapper')
    select(frontmatter, 0, 5)
    fireEvent.contextMenu(frontmatter, { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu', { name: SELECTION_COPY.menuLabel })
    const items = itemsOf(menu)
    expect(items[0]).toBe(SELECTION_COPY.commentOnSelection)
    expect(items).not.toContain(SELECTION_COPY.commentOnWhole('frontmatter'))
    expect(items.at(-1)).toBe('Copy selection')
    const item = screen.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION)
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleDescription(MARKDOWN_COPY.frontmatter)
    await user.click(item)
    expect(screen.queryByTestId('comment-window')).toBeNull()
    await user.keyboard('{Escape}')

    await user.click(modeTool())
    select(frontmatter, 0, 5)
    fireEvent.contextMenu(frontmatter, { clientX: 10, clientY: 10 })
    const inMode = await screen.findByTestId(TEST_IDS.COMMENT_CONTEXT_MENU)
    expect(itemsOf(inMode)).toEqual([SELECTION_COPY.commentOnSelection])
    expect(within(inMode).getByTestId(TEST_IDS.COMMENT_MENU_SELECTION)).toHaveAttribute('aria-disabled', 'true')
    expect(api.openDraft).not.toHaveBeenCalled()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('024-AC-005 (g) M-16: in a read-only file both selection items are disabled with the reason', async () => {
    api.list.mockResolvedValue({ ok: true, file: fileView([], { writable: false, readOnlyReason: 'link' }), placements: [] })
    await ready()
    await waitFor(() => expect(modeTool()).toHaveAttribute('aria-disabled', 'true'))
    selectWords(paragraph(), 'beta')
    fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
    const reason = markdownReadOnlyReasonText('link', 'notes.md')
    for (const id of [TEST_IDS.COMMENT_MENU_SELECTION, TEST_IDS.COMMENT_MENU_WHOLE]) {
      const item = await screen.findByTestId(id)
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveAccessibleDescription(reason)
    }
    expect(api.openDraft).not.toHaveBeenCalled()
  })

  it('024-AC-005 (h): a drag from the end of one paragraph into the next saves on the first, with the cut notice', async () => {
    const user = userEvent.setup()
    await ready()
    const first = paragraph()
    const next = block('li[data-line-start="8"]')
    select(first, first.textContent!.indexOf('by Friday'), 3, next)
    fireEvent.contextMenu(first, { clientX: 10, clientY: 10 })
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    expect(await screen.findByText(SELECTION_COPY.crossed('paragraph'))).toBeVisible()
    const saved = await saveTyped(user, 'Date')
    expect(saved).toMatchObject({ target: { lineStart: 6, tag: 'p' }, sel: { exact: 'by Friday.' } })
  })

  it('024-AC-005 (i): a selection of only spaces is refused as words – the menu is about the block', async () => {
    await ready()
    const text = paragraph().textContent!
    const space = text.indexOf(' ')
    select(paragraph(), space, space + 1)
    fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
    expect(await screen.findByTestId(TEST_IDS.COMMENT_MENU_COMMENT_ON)).toHaveTextContent('Comment on paragraph')
    expect(screen.queryByTestId(TEST_IDS.COMMENT_MENU_SELECTION)).toBeNull()
  })

  it('024-AC-005: a selection equal to the whole paragraph saves a comment on the paragraph, without anchor.sel', async () => {
    const user = userEvent.setup()
    await ready()
    select(paragraph(), 0, paragraph().textContent!.length)
    fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    expect(screen.queryByTestId(TEST_IDS.COMMENT_WORDS)).toBeNull()
    const saved = await saveTyped(user, 'All of it')
    expect(saved).not.toHaveProperty('sel')
  })

  it('024-AC-005: words main did not keep are said after the save', async () => {
    const user = userEvent.setup()
    api.save.mockResolvedValue({ ok: true, threadKey: 'saved' })
    await ready()
    selectWords(paragraph(), 'beta')
    fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_MENU_SELECTION))
    api.list.mockResolvedValue({ ok: true, file: fileView([thread('saved', 6, 'p')]), placements: [{ threadKey: 'saved', line: 6, tag: 'p' }] })
    await saveTyped(user, 'Which beta?')
    await waitFor(() => expect(polite()).toHaveTextContent(SELECTION_COPY.wordsDropped('paragraph', 'notes.md')))
  })

  it('024-AC-005: the words of an open selection comment are marked while they are found; a resolved one is not', async () => {
    api.list.mockResolvedValue({
      ok: true,
      file: fileView([thread('w1', 6, 'p'), thread('w2', 13, 'p', { status: 'resolved' })]),
      placements: [
        { threadKey: 'w1', line: 6, tag: 'p', sel: { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' } },
        { threadKey: 'w2', line: 13, tag: 'p', sel: { exact: 'Second', prefix: '', suffix: ' paragraph' } }
      ]
    })
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
    await ready()
    await waitFor(() => {
      const [name, highlight] = set.mock.calls.at(-1) ?? []
      expect(name).toBe(COMMENT_HIGHLIGHT)
      expect((highlight as FakeHighlight).ranges.map(range => range.toString())).toEqual(['ten customers'])
      expect((highlight as FakeHighlight).priority).toBe(COMMENT_HIGHLIGHT_PRIORITY)
    })
    // Nothing is added to the rendered content: the mark is paint only (024-FR-024).
    expect(paragraph().childElementCount).toBe(0)
  })

  it('024-AC-005 (C-16, Markdown half): a Comment button shows after a selection, takes no focus, and opens the window on the words', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(100, 200, 80, 20)] as unknown as DOMRectList)
    const user = userEvent.setup()
    await ready()
    selectWords(paragraph(), 'beta')
    fireEvent.mouseUp(paragraph(), { button: 0 })
    const button = await screen.findByTestId(TEST_IDS.COMMENT_SELECTION_BUTTON, {}, { timeout: SELECTION_BUTTON_DELAY_MS * 10 })
    expect(button).toHaveAccessibleName(SELECTION_COPY.button)
    expect(button).toHaveAttribute('tabindex', '-1')
    expect(button).toHaveClass('erf-comment-select-btn--above')
    await user.click(button)
    expect(await screen.findByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible()
    expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS)).toHaveTextContent(SELECTION_COPY.result('beta'))
  })
})

describe('comments-v2 owner decisions and the Markdown focus model', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    resetStores()
    api = installApi(fileView([thread('t1', 6, 'p')]), [
      { threadKey: 't1', line: 6, tag: 'p', sel: { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' } }
    ])
    setSettings()
  })
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    portalRoot.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('C-08 turning comment mode on from the keyboard focuses the block holding the selection; outside the mode Shift+F10 opens the menu at the selection', async () => {
    const user = userEvent.setup()
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(40, 120, 60, 18)] as unknown as DOMRectList)
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    const item = block('li[data-line-start="8"]')
    act(() => item.closest<HTMLElement>('.markdown-preview')!.focus())
    selectWords(item, 'load test')
    // C-08.5: the menu opens at the selection's last line and is about the words.
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(await screen.findByRole('menu', { name: SELECTION_COPY.menuLabel })).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    selectWords(item, 'load test')
    // C-08.2: the mode shortcut moves focus to the block that holds the selection, not the first block in view.
    await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
    expect(modeTool()).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(item).toHaveFocus())
    expect(item).toHaveAttribute('tabindex', '-1')
  })

  it('OD-03 nothing at all in the Markdown editor and split views: no tools, icons, marks, count or menu items', () => {
    const set = vi.fn()
    vi.stubGlobal('Highlight', class {
      priority = 0
    })
    vi.stubGlobal('CSS', { highlights: { set, delete: vi.fn() } })
    const view = render(<Harness content={DOC} viewMode="editor" />)
    for (const mode of ['editor', 'split'] as const) {
      view.rerender(<Harness content={DOC} viewMode={mode} />)
      expect(screen.queryByTestId(TEST_IDS.COMMENT_TOOL_MODE)).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_TOOL_LIST)).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_OVERLAY)).toBeNull()
      expect(screen.queryByTestId(TEST_IDS.COMMENT_HOST_ICON)).toBeNull()
    }
    expect(set).not.toHaveBeenCalled()
    expect(api.list).not.toHaveBeenCalled()
  })

  it('OD-02 no comment surface hands comments to an agent: no Ask agent item, button or string in the window, the drawer or the comment words of either preview', async () => {
    const user = userEvent.setup()
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    const strings = JSON.stringify([COPY_MODULE, WORDS_MODULE])
    expect(strings).not.toMatch(/ask (the |an )?agent|send to (the )?(agent|terminal)/i)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
    await user.click(await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_ROW_OPEN))
    const surfaces = [screen.getByTestId(TEST_IDS.COMMENT_DRAWER), await screen.findByTestId('comment-window')]
    for (const surface of surfaces) {
      expect(within(surface).queryAllByRole('button').map(b => b.textContent ?? '').join('|')).not.toMatch(/agent/i)
    }
  })

  it('OD-08 the comment view is this file only: the list asks for the open file, and the drawer shows its comments and no other file', async () => {
    const user = userEvent.setup()
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    for (const [request] of api.list.mock.calls as Array<[{ filePath: string }]>) expect(request.filePath).toBe(FILE_PATH)
    await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
    const drawer = await screen.findByTestId(TEST_IDS.COMMENT_DRAWER)
    expect(within(drawer).getAllByTestId(TEST_IDS.COMMENT_DRAWER_ROW_OPEN)).toHaveLength(1)
    expect(drawer.textContent).not.toMatch(/project|all files/i)
  })
})

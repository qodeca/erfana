// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Preview comments after comments-v2 (spec 024 commit 14): the
 * Markdown halves of C-07, C-10, C-11, C-12, C-16, C-17 and C-22, and the
 * host's wiring of C-15, C-20 and OD-06 – the real preview, host, drawer and
 * window, with only the bridge mocked.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { COMMENT_LIST_COPY, MARKDOWN_COPY, MD_SPOKEN_COPY, SELECTION_COPY } from '../../Comments/commentCopyWords'
import { COMMENT_ACTIVE_HIGHLIGHT, COMMENT_HIGHLIGHT } from '../../Comments/overlay/commentHighlights'
import { SELECTION_BUTTON_DELAY_MS } from '../../Comments/overlay/useSelectionComments'
import { FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

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
  'Second paragraph here.',
  ''
].join('\n')

const WORDS: ThreadPlacement = { threadKey: 'w1', line: 6, tag: 'p', sel: { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' } }
const ON_ITEM: ThreadPlacement = { threadKey: 't1', line: 9, tag: 'li' }

const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const paragraph = (): HTMLElement => content().querySelector<HTMLElement>('p[data-line-start="6"]')!
const listItem = (line: number): HTMLElement => content().querySelector<HTMLElement>(`li[data-line-start="${line}"]`)!
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

/** Select the first occurrence of `words` in `el`. */
function selectWords(el: HTMLElement, words: string): void {
  const at = el.textContent!.indexOf(words)
  const range = document.createRange()
  range.setStart(...point(el, at))
  range.setEnd(...point(el, at + words.length))
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Chromium's caret-from-point, answering `offset` characters into `el` for any point. */
function caretAt(el: HTMLElement, offset: number): void {
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      const range = document.createRange()
      range.setStart(...point(el, offset))
      return range
    }
  })
}

/** A plain left click at one point: no drag, no selection. */
function plainClick(el: HTMLElement): void {
  fireEvent.mouseDown(el, { button: 0, clientX: 20, clientY: 20 })
  fireEvent.click(el, { button: 0, clientX: 20, clientY: 20 })
}

describe('Markdown Preview comments – comments-v2', () => {
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
    api = installApi(fileView([thread('t1', 9, 'li'), thread('w1', 6, 'p')]), [ON_ITEM, WORDS])
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
    delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint
    portalRoot.remove()
    unregister()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function ready(): Promise<void> {
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)).toHaveAccessibleName('2 comments'))
  }

  describe('C-22 (Markdown) a commented target opens its threads', () => {
    it('C-22 (Markdown) clicking a commented list item in comment mode opens its threads, not a blank new comment', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      await user.click(listItem(9))
      expect(await screen.findByRole('dialog', { name: 'Comment on list item' })).toBeVisible()
      expect(api.openDraft).not.toHaveBeenCalled()
    })

    it('C-22 (Markdown) a target with no open thread still opens a new comment, and Add comment in the menu is always a new thread', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      await user.click(listItem(8))
      expect(await screen.findByRole('dialog', { name: 'New comment on list item' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.contextMenu(listItem(9), { clientX: 10, clientY: 10 })
      await user.click(await screen.findByTestId(TEST_IDS.COMMENT_MENU_ADD))
      expect(await screen.findByRole('dialog', { name: 'New comment on list item' })).toBeVisible()
    })

    it('C-22 (Markdown) Enter on a commented target picked by keyboard opens its threads', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      act(() => listItem(9).focus())
      // The picker moves from the focused block: Shift+Tab then Tab lands on the item again.
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      await waitFor(() => expect(content().querySelector('h1')).toHaveFocus())
      for (let i = 0; i < 4; i += 1) await user.keyboard('{Tab}')
      expect(listItem(9)).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(await screen.findByRole('dialog', { name: 'Comment on list item' })).toBeVisible()
    })
  })

  describe('C-17 (Markdown) clicking a mark', () => {
    it('C-17 (Markdown) a plain click on commented words opens that thread, outside comment mode', async () => {
      await ready()
      caretAt(paragraph(), paragraph().textContent!.indexOf('customers'))
      plainClick(paragraph())
      expect(await screen.findByRole('dialog', { name: 'Comment on paragraph' })).toBeVisible()
      expect(api.openDraft).not.toHaveBeenCalled()
    })

    it('C-17 (Markdown) in comment mode a click on the words opens that thread only', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(modeTool())
      caretAt(paragraph(), paragraph().textContent!.indexOf('ten'))
      plainClick(paragraph())
      expect(await screen.findByRole('dialog', { name: 'Comment on paragraph' })).toBeVisible()
    })

    it('C-17 (Markdown) a click beside the words, or a drag over them, opens nothing', async () => {
      await ready()
      caretAt(paragraph(), 2)
      plainClick(paragraph())
      caretAt(paragraph(), paragraph().textContent!.indexOf('customers'))
      fireEvent.mouseDown(paragraph(), { button: 0, clientX: 0, clientY: 20 })
      fireEvent.click(paragraph(), { button: 0, clientX: 80, clientY: 20 })
      await act(async () => {})
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it("C-17 (Markdown) the open thread's words wear the active mark; hovering an icon raises its words", async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
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
      const user = userEvent.setup()
      await ready()
      const paintedAs = (name: string): string[] =>
        ((set.mock.calls.filter(([painted]) => painted === name).at(-1)?.[1] as FakeHighlight | undefined)?.ranges ?? []).map(r => r.toString())
      await waitFor(() => expect(paintedAs(COMMENT_HIGHLIGHT)).toEqual(['ten customers']))
      const icons = screen.getAllByTestId(TEST_IDS.COMMENT_HOST_ICON)
      const wordsIcon = icons.find(icon => icon.getAttribute('aria-label')?.includes('paragraph'))!
      fireEvent.mouseEnter(wordsIcon)
      await waitFor(() => expect(paintedAs(COMMENT_ACTIVE_HIGHLIGHT)).toEqual(['ten customers']))
      fireEvent.mouseLeave(wordsIcon)
      await user.click(wordsIcon)
      await screen.findByRole('dialog', { name: 'Comment on paragraph' })
      await waitFor(() => expect(paintedAs(COMMENT_ACTIVE_HIGHLIGHT)).toEqual(['ten customers']))
    })
  })

  describe('C-10 (Markdown) the spoken target', () => {
    it('C-10 (Markdown) keyboard entry says the mode and the first target in one sentence, then kind, line, words and comments', async () => {
      const user = userEvent.setup()
      await ready()
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      await waitFor(() =>
        expect(polite()).toHaveTextContent(MD_SPOKEN_COPY.modeOnAt(MD_SPOKEN_COPY.target('H1 heading', 4, 'Plan', 0)) + MD_SPOKEN_COPY.hint)
      )
      await user.keyboard('{Tab}')
      await waitFor(() =>
        expect(polite()).toHaveTextContent(
          MD_SPOKEN_COPY.target('paragraph', 6, 'We ship the beta to ten customers by Friday.', 1) + MD_SPOKEN_COPY.hint
        )
      )
      // The list, then its first item: past the third step the keys are no longer added.
      await user.keyboard('{Tab}{Tab}{Tab}')
      expect(listItem(9)).toHaveFocus()
      await waitFor(() => expect(polite().textContent).toBe(MD_SPOKEN_COPY.target('list item', 9, 'two', 1)))
      expect(polite().textContent).toBe('List item, line 9: “two”. 1 comment.')
    })

    it('C-10 (Markdown) Tab past either end of the preview says so', async () => {
      const user = userEvent.setup()
      await ready()
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      await waitFor(() => expect(content().querySelector('h1')).toHaveFocus())
      await user.keyboard('{Shift>}{Tab}{/Shift}')
      await waitFor(() => expect(polite()).toHaveTextContent(MD_SPOKEN_COPY.first))
      for (let i = 0; i < 5; i += 1) await user.keyboard('{Tab}')
      await waitFor(() => expect(polite()).toHaveTextContent('Paragraph, line 11: “Second paragraph here.”.'))
      await user.keyboard('{Tab}')
      await waitFor(() => expect(polite()).toHaveTextContent(MD_SPOKEN_COPY.last))
    })
  })

  describe('C-11 (Markdown) icons are real buttons', () => {
    it('C-11 (Markdown) an icon is a named button outside the Tab order, pressed with Enter or Space', async () => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
      const user = userEvent.setup()
      await ready()
      const icon = screen.getAllByTestId(TEST_IDS.COMMENT_HOST_ICON).find(el => el.getAttribute('aria-label')?.includes('list item'))!
      expect(icon.tagName).toBe('BUTTON')
      expect(icon).toHaveAttribute('type', 'button')
      expect(icon).toHaveAttribute('tabindex', '-1')
      expect(icon).toHaveAccessibleName('1 comment on list item, line 9. Open.')
      act(() => icon.focus())
      await user.keyboard('{Enter}')
      expect(await screen.findByRole('dialog', { name: 'Comment on list item' })).toBeVisible()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      act(() => icon.focus())
      await user.keyboard(' ')
      expect(await screen.findByRole('dialog', { name: 'Comment on list item' })).toBeVisible()
    })
  })

  describe('C-12 (Markdown) one comment mark', () => {
    const css = readFileSync(resolve(__dirname, '../../Comments/overlay/CommentOverlayLayer.css'), 'utf8')
    const tokens = readFileSync(resolve(__dirname, '../../../styles/design-tokens.css'), 'utf8')
    /** The last rule for `selector` outside the forced-colours block: the one that decides its look. */
    const rule = (selector: string): string => {
      const at = css.slice(0, css.indexOf('@media (forced-colors: active)')).lastIndexOf(`${selector} {`)
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
    }

    it('C-12 (Markdown) the mark is the shared fill and bar, never the selection colour and never the link colour', () => {
      const mark = css.slice(css.indexOf('::highlight(erf-comment),'), css.indexOf('}', css.indexOf('::highlight(erf-comment),')))
      expect(mark).toContain('var(--color-comment-mark)')
      expect(mark).toContain('var(--comment-mark-bar-width) var(--color-comment-mark-bar)')
      expect(mark).toContain('text-decoration-skip-ink: none')
      expect(mark).not.toMatch(/--color-bg-selected|--color-link/)
      expect(tokens).toMatch(/--color-comment-mark: color-mix\(in srgb, var\(--color-accent-primary\) 35%, transparent\)/)
    })

    it('C-12 (Markdown) the selection keeps its own look, and the open thread doubles the bar instead of a stronger fill', () => {
      expect(rule('.markdown-preview-content ::selection')).toContain('var(--color-bg-selected)')
      const active = rule('::highlight(erf-comment-active)')
      expect(active).toContain('text-decoration-style: double')
      expect(active).not.toContain('background-color')
    })

    it('C-12 (Markdown) forced colours: the mark is Mark and MarkText with a CanvasText bar, Highlight stays the selection', () => {
      const forced = css.slice(css.indexOf('@media (forced-colors: active)'))
      expect(forced).toMatch(/::highlight\(erf-comment\),\s*::highlight\(erf-comment-active\) \{\s*background-color: Mark;\s*color: MarkText;\s*text-decoration-color: CanvasText;/)
      expect(forced).toMatch(/::selection \{\s*background-color: Highlight;/)
    })
  })

  describe('C-16 (Markdown) selection and the toggle', () => {
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
      vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(100, 200, 80, 20)] as unknown as DOMRectList)
    })

    it('C-16 (Markdown) turning the mode on with words selected only turns it on, shows the Comment button and says so', async () => {
      await ready()
      selectWords(paragraph(), 'beta')
      fireEvent.click(modeTool())
      expect(modeTool()).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await screen.findByTestId(TEST_IDS.COMMENT_SELECTION_BUTTON)).toHaveAccessibleName(SELECTION_COPY.button)
      await waitFor(() => expect(polite()).toHaveTextContent(MD_SPOKEN_COPY.modeOnSelected))
    })

    it('C-16 (Markdown) from the keyboard, Enter then comments on the selected words', async () => {
      await ready()
      selectWords(paragraph(), 'beta')
      // Raw key events: user-event moves the document selection with focus, which a browser does not do
      // for a block that is not editable.
      fireEvent.keyDown(document.body, { key: 'm', code: 'KeyM', ctrlKey: true, altKey: true })
      await waitFor(() => expect(paragraph()).toHaveFocus())
      await waitFor(() => expect(polite()).toHaveTextContent(MD_SPOKEN_COPY.modeOnSelected))
      // jsdom drops the selection when a block takes focus; a browser keeps it. Put it back as a browser has it.
      selectWords(paragraph(), 'beta')
      fireEvent.keyDown(paragraph(), { key: 'Enter' })
      expect(await screen.findByRole('dialog', { name: 'New comment on paragraph' })).toBeVisible()
      expect(screen.getByTestId(TEST_IDS.COMMENT_WORDS)).toHaveTextContent('beta')
    })

    it('C-16 (Markdown) the visible Comment button after a drag, parallel menu items, and mode copy that teaches selection', async () => {
      const user = userEvent.setup()
      await ready()
      selectWords(paragraph(), 'beta')
      fireEvent.mouseUp(paragraph(), { button: 0 })
      expect(await screen.findByTestId(TEST_IDS.COMMENT_SELECTION_BUTTON, {}, { timeout: SELECTION_BUTTON_DELAY_MS * 10 })).toBeVisible()
      fireEvent.contextMenu(paragraph(), { clientX: 10, clientY: 10 })
      const menu = await screen.findByRole('menu', { name: SELECTION_COPY.menuLabel })
      const items = within(menu).getAllByRole('menuitem').map(el => el.querySelector('.context-menu-label')?.textContent ?? el.textContent)
      expect(items.slice(0, 2)).toEqual([SELECTION_COPY.commentOnSelection, SELECTION_COPY.commentOnWhole('paragraph')])
      await user.keyboard('{Escape}')
      window.getSelection()?.removeAllRanges()
      fireEvent.click(modeTool(), { detail: 1 })
      await waitFor(() => expect(polite()).toHaveTextContent(MARKDOWN_COPY.modeOn))
      expect(modeTool().title).toContain('click a paragraph or select text')
      // The empty drawer teaches both gestures too.
      api.list.mockResolvedValue({ ok: true, file: fileView([]), placements: [] })
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      expect(await screen.findByText(MARKDOWN_COPY.drawerNone)).toBeVisible()
    })
  })

  describe('C-07 (Markdown) Narrow to words by keyboard', () => {
    it('C-07 (Markdown) the keyboard route is complete: pick, Enter, Narrow to words, select, Save with the words', async () => {
      const user = userEvent.setup()
      api = installApi(fileView([]), [])
      render(<Harness content={DOC} />)
      await waitFor(() => expect(api.list).toHaveBeenCalled())
      await user.keyboard('{Control>}{Alt>}m{/Alt}{/Control}')
      await waitFor(() => expect(content().querySelector('h1')).toHaveFocus())
      await user.keyboard('{Tab}{Enter}')
      await screen.findByRole('dialog', { name: 'New comment on paragraph' })
      const toggle = screen.getByTestId(TEST_IDS.COMMENT_NARROW_TOGGLE)
      act(() => toggle.focus())
      await user.keyboard('{Enter}')
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const field = screen.getByRole('textbox', { name: SELECTION_COPY.narrowLabel('paragraph', 6) })
      act(() => {
        ;(field as HTMLTextAreaElement).focus()
        ;(field as HTMLTextAreaElement).setSelectionRange(20, 33)
        fireEvent.select(field)
      })
      expect(screen.getByTestId(TEST_IDS.COMMENT_NARROW_RESULT)).toHaveTextContent(SELECTION_COPY.result('ten customers'))
      await user.type(screen.getByTestId('comment-new-field'), 'Which ten?')
      act(() => screen.getByTestId('comment-save').focus())
      await user.keyboard('{Enter}')
      await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
      expect(api.save.mock.calls[0][0]).toMatchObject({ sel: { exact: 'ten customers' } })
    })
  })

  describe('C-15 / C-20 the Markdown toolbar and OD-06 in the host', () => {
    it('C-20 (Markdown) the toolbar has Comment mode and the labelled count only; the drawer has the icons checkbox', async () => {
      const user = userEvent.setup()
      await ready()
      const toolbar = screen.getByTestId('harness-toolbar')
      expect(within(toolbar).getAllByRole('button')).toHaveLength(2)
      expect(screen.queryByTestId(TEST_IDS.COMMENT_TOOL_ICONS)).toBeNull()
      const count = screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)
      expect(count).toHaveTextContent('2 comments')
      await user.click(count)
      expect(count).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('checkbox', { name: COMMENT_LIST_COPY.showIcons })).toBeChecked()
    })

    it('C-15 (Markdown) a damaged comment is the ▲ counter on the count and a Can\'t edit row', async () => {
      const user = userEvent.setup()
      api.list.mockResolvedValue({
        ok: true,
        file: fileView([thread('t1', 9, 'li')], {
          damaged: [{ blockKey: 'b1', rawHash: 'b'.repeat(64), reason: 'bad-json', line: 30, raw: '<!-- erfana:comment x -->' }]
        }),
        placements: [ON_ITEM]
      })
      render(<Harness content={DOC} />)
      const count = screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)
      await waitFor(() => expect(count).toHaveAccessibleName('1 comment, 1 damaged'))
      expect(count.querySelector('.erf-counter--attention')).toHaveTextContent('1')
      await user.click(count)
      expect(await screen.findByTestId(TEST_IDS.COMMENT_FILTER_CANT_EDIT)).toHaveTextContent("Can't edit 1")
    })

    it('OD-06 (Markdown) open comments removed outside Erfana are noted in the drawer, session only', async () => {
      const user = userEvent.setup()
      await ready()
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      expect(screen.queryByTestId(TEST_IDS.COMMENT_DRAWER_REMOVED)).toBeNull()
      api.list.mockResolvedValue({ ok: true, file: fileView([thread('w1', 6, 'p')]), placements: [WORDS] })
      act(() => api.emitChanged())
      const note = await screen.findByTestId(TEST_IDS.COMMENT_DRAWER_REMOVED)
      expect(note).toHaveTextContent('1 open comment was removed from notes.md outside Erfana.')
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_DRAWER_REMOVED_SHOW))
      expect(screen.getByRole('list', { name: COMMENT_LIST_COPY.removedList })).toHaveTextContent('Comment t1')
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_DRAWER_REMOVED_DISMISS))
      expect(screen.queryByTestId(TEST_IDS.COMMENT_DRAWER_REMOVED)).toBeNull()
    })
  })
})

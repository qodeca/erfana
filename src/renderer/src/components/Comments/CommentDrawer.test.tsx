// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comments drawer (docs/designs/comments/html-preview-comments.md §10.5; R-009,
 * R-020; comments-v2 C-03, C-10, C-15, C-20, OD-04, OD-06).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentFileView } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import { damaged, fileView, message, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { resolveFocusReturnTarget } from '../Dialog/BaseDialog'
import { COPY, DRAWER_COPY, unreadFilesText } from './commentCopy'
import { COMMENT_LIST_COPY, MARKDOWN_COPY, MARKDOWN_WORDS } from './commentCopyWords'
import { CommentWordsContext } from './commentWords'
import {
  CommentDrawer,
  DRAWER_ROW_ESTIMATE_PX,
  VIRTUALISE_ABOVE,
  type CommentDrawerProps
} from './CommentDrawer'

const ready = (files: CommentFileView[]): CommentListState => ({ status: 'ready', files })

function setup(patch: Partial<CommentDrawerProps> = {}) {
  const props: CommentDrawerProps = {
    id: 'drawer-1',
    list: ready([
      fileView({
        threads: [
          thread(1, { messages: [message(1), message(2)] }),
          thread(2, { notVisible: true }),
          thread(3, { status: 'resolved' }),
          thread(4, { attached: false })
        ],
        damaged: [damaged(1)],
        newer: [{ blockKey: 'n1', version: 2, line: 70 }]
      })
    ]),
    notVisible: [],
    showIcons: true,
    full: false,
    pageFile: 'index.html',
    now: () => new Date(2026, 9, 26, 12, 0),
    locale: 'en-GB',
    onClose: vi.fn(),
    onShowIconsChange: vi.fn(),
    onReveal: vi.fn(),
    onOpenInSource: vi.fn(),
    onOpen: vi.fn(),
    onRetry: vi.fn(),
    ...patch
  }
  return { props, ...render(<CommentDrawer {...props} />) }
}

const rows = () => screen.getAllByTestId('comment-drawer-row')

describe('CommentDrawer', () => {
  describe('R-009 filters, counts, order and states', () => {
    it('is a labelled region that focuses its close button', async () => {
      setup()
      expect(screen.getByRole('complementary', { name: DRAWER_COPY.title })).toHaveAttribute(
        'id',
        'drawer-1'
      )
      await waitFor(() => expect(screen.getByTestId('comment-drawer-close')).toHaveFocus())
    })

    // Changed expectation under OD-04 (was "Open 2" and "Needs attention 3"): a not-found thread is Open.
    it('OD-04 counts each filter – Open, Resolved, Can\'t edit – and starts on Open, in file order', () => {
      setup()
      expect(screen.getByTestId('comment-filter-open')).toHaveTextContent('Open 3')
      expect(screen.getByTestId('comment-filter-resolved')).toHaveTextContent('Resolved 1')
      expect(screen.getByTestId('comment-filter-cant-edit')).toHaveTextContent("Can't edit 2")
      expect(screen.getByTestId('comment-filter-open')).toHaveAttribute('aria-checked', 'true')
      expect(rows()).toHaveLength(3)
      expect(within(rows()[0]).getByText('1 reply')).toBeVisible()
      expect(
        screen.getByText('index.html', { selector: '.erf-comment-drawer__file' })
      ).toBeVisible()
    })

    it('tags a hidden element "Not visible now"', () => {
      setup()
      expect(within(rows()[1]).getByTestId('comment-drawer-tag')).toHaveTextContent(
        DRAWER_COPY.notVisible
      )
    })

    it('switches filters with a click and with the arrow keys', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByTestId('comment-filter-resolved'))
      expect(rows()).toHaveLength(1)
      expect(screen.getByTestId('comment-filter-resolved')).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      // OD-04: the third cell is Can't edit (was Needs attention with 3 rows).
      expect(screen.getByTestId('comment-filter-cant-edit')).toHaveAttribute('aria-checked', 'true')
      expect(rows()).toHaveLength(2)
      await user.keyboard('{ArrowRight}')
      expect(screen.getByTestId('comment-filter-open')).toHaveAttribute('aria-checked', 'true')
      await user.keyboard('{ArrowLeft}')
      expect(screen.getByTestId('comment-filter-cant-edit')).toHaveAttribute('aria-checked', 'true')
      await user.keyboard('{a}')
      expect(screen.getByTestId('comment-filter-cant-edit')).toHaveAttribute('aria-checked', 'true')
    })

    it('row main action is Show on page; Open is the second Tab stop', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      const [first] = rows()
      const main = within(first).getByTestId('comment-drawer-row-main')
      const open = within(first).getByTestId('comment-drawer-row-open')
      expect(main).toHaveAttribute('title', COPY.showOnPage)
      expect(main).toHaveAttribute('tabindex', '0')
      expect(open).toHaveAttribute('tabindex', '0')
      expect(open).toHaveAccessibleName('Open comments on button.cta')
      // Only the active row is in the tab order.
      expect(within(rows()[1]).getByTestId('comment-drawer-row-main')).toHaveAttribute(
        'tabindex',
        '-1'
      )
      main.focus()
      await user.tab()
      expect(open).toHaveFocus()
      await user.click(main)
      expect(props.onReveal).toHaveBeenCalledWith(expect.objectContaining({ threadKey: 't1' }))
      await user.click(open)
      expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ threadKey: 't1' }))
    })

    it('moves between rows with the arrow keys, Home and End', async () => {
      const user = userEvent.setup()
      setup({ list: ready([fileView({ threads: [thread(1), thread(2), thread(3)] })]) })
      const mains = () => screen.getAllByTestId('comment-drawer-row-main')
      mains()[0].focus()
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(mains()[1]).toHaveFocus())
      await user.keyboard('{End}')
      await waitFor(() => expect(mains()[2]).toHaveFocus())
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(mains()[2]).toHaveFocus())
      await user.keyboard('{Home}')
      await waitFor(() => expect(mains()[0]).toHaveFocus())
      await user.keyboard('{ArrowUp}')
      await waitFor(() => expect(mains()[0]).toHaveFocus())
      await user.keyboard('{x}')
      expect(mains()[0]).toHaveFocus()
    })

    it('says so while loading', () => {
      setup({ list: { status: 'loading', files: [] } })
      expect(screen.getByRole('status')).toHaveTextContent(DRAWER_COPY.loading)
    })

    it('shows a read error with Try again', async () => {
      const user = userEvent.setup()
      const { props } = setup({
        list: { status: 'error', files: [], code: ErrorCode.UNKNOWN_ERROR }
      })
      expect(screen.getByTestId('comment-drawer-error')).toHaveTextContent(
        "Couldn't read comments from index.html."
      )
      await user.click(screen.getByRole('button', { name: COPY.tryAgain }))
      expect(props.onRetry).toHaveBeenCalled()
    })

    it('has an empty state for the file and for each filter', async () => {
      const user = userEvent.setup()
      const { unmount } = setup({ list: ready([fileView()]) })
      expect(screen.getByText(DRAWER_COPY.none)).toBeVisible()
      unmount()
      setup({ list: ready([fileView({ threads: [thread(1, { status: 'resolved' })] })]) })
      expect(screen.getByText(DRAWER_COPY.emptyOpen)).toBeVisible()
      // OD-04, R-09: the third cell's empty state (was "Nothing needs attention.").
      await user.click(screen.getByTestId('comment-filter-cant-edit'))
      expect(screen.getByText(COMMENT_LIST_COPY.emptyCantEdit)).toBeVisible()
      await user.click(screen.getByTestId('comment-filter-resolved'))
      expect(rows()).toHaveLength(1)
    })

    it('shows the empty resolved state', async () => {
      const user = userEvent.setup()
      setup({ list: ready([fileView({ threads: [thread(1)] })]) })
      await user.click(screen.getByTestId('comment-filter-resolved'))
      expect(screen.getByText(DRAWER_COPY.emptyResolved)).toBeVisible()
    })

    it('toggles the comment icons', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-drawer-show-icons'))
      expect(props.onShowIconsChange).toHaveBeenCalledWith(false)
    })

    it('closes', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-drawer-close'))
      expect(props.onClose).toHaveBeenCalled()
    })

    it(`renders every row as plain flow up to ${VIRTUALISE_ABOVE}`, () => {
      const threads = Array.from({ length: VIRTUALISE_ABOVE }, (_, i) => thread(i))
      setup({ list: ready([fileView({ threads })]) })
      expect(rows()).toHaveLength(VIRTUALISE_ABOVE)
      expect(screen.getByTestId('comment-drawer-list')).not.toHaveClass(
        'erf-comment-list--windowed'
      )
      expect(rows()[0]).not.toHaveAttribute('aria-setsize')
    })

    it('has a full-width mode for narrow panels', () => {
      setup({ full: true })
      expect(screen.getByTestId('comment-drawer')).toHaveClass('erf-comment-drawer--full')
    })

    it('§19 Rev 4 says above the list how many files it left out, and nothing when it left none out', () => {
      const { unmount } = setup({ list: { ...ready([fileView({ threads: [thread(1)] })]), unread: 2 } })
      const note = screen.getByTestId('comment-drawer-unread')
      expect(note).toHaveTextContent(unreadFilesText(2))
      expect(note).toHaveTextContent('2 files')
      // Above the scrolling list, so it stays in view.
      expect(screen.getByTestId('comment-drawer').querySelector('.erf-comment-drawer__scroll')?.contains(note)).toBe(false)
      expect(rows()).toHaveLength(1)
      unmount()
      setup()
      expect(screen.queryByTestId('comment-drawer-unread')).toBeNull()
    })
  })

  describe('R-009 virtualisation at 1,000 rows', () => {
    const VIEWPORT_PX = 600
    // The most rows a 600px viewport can need: the screenful, the overscan on
    // both sides, and the pinned active row – far below 1,000.
    const ROW_BOUND = Math.ceil(VIEWPORT_PX / DRAWER_ROW_ESTIMATE_PX) + 2 * 8 + 2
    const thousand = () =>
      ready([fileView({ threads: Array.from({ length: 1_000 }, (_, i) => thread(i)) })])

    // jsdom lays nothing out: give the scroll container a height, the rows a
    // height and the container the scrollTo a browser has.
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('erf-comment-drawer__scroll')
            ? VIEWPORT_PX
            : (clientHeight?.get?.call(this) ?? 0)
        }
      })
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('erf-comment-row')
            ? DRAWER_ROW_ESTIMATE_PX
            : (offsetHeight?.get?.call(this) ?? 0)
        }
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
          if (!this.classList.contains('erf-comment-drawer__scroll')) return 0
          return (
            parseFloat(
              this.querySelector<HTMLElement>('.erf-comment-list')?.style.blockSize ?? '0'
            ) || 0
          )
        }
      })
      HTMLElement.prototype.scrollTo = function scrollTo(
        this: HTMLElement,
        options?: ScrollToOptions | number
      ) {
        if (typeof options === 'object' && options.top !== undefined) this.scrollTop = options.top
        // A browser fires `scroll` asynchronously, never inside the call.
        setTimeout(() => this.dispatchEvent(new Event('scroll')), 0)
      } as HTMLElement['scrollTo']
    })
    afterEach(() => {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
      if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
    })

    const scroller = () => document.querySelector<HTMLElement>('.erf-comment-drawer__scroll')!
    const mains = () => screen.getAllByTestId('comment-drawer-row-main')
    const mainAt = (index: number) =>
      document.querySelector<HTMLElement>(`[data-row-main][data-row-index="${index}"]`)

    it('keeps the DOM row count bounded and sizes the list for every row', () => {
      setup({ list: thousand() })
      const list = screen.getByTestId('comment-drawer-list')
      expect(list).toHaveClass('erf-comment-list--windowed')
      expect(rows().length).toBeGreaterThan(0)
      expect(rows().length).toBeLessThanOrEqual(ROW_BOUND)
      expect(list.style.blockSize).toBe(`${1_000 * DRAWER_ROW_ESTIMATE_PX}px`)
      // Each mounted row still tells a screen reader where it is in the whole list.
      expect(rows()[0]).toHaveAttribute('aria-setsize', '1000')
      expect(rows()[0]).toHaveAttribute('aria-posinset', '1')
    })

    it('one Tab stop: End scrolls the last row in and focuses it, with the DOM still bounded', async () => {
      const user = userEvent.setup()
      setup({ list: thousand() })
      mains()[0].focus()
      await user.keyboard('{End}')
      await waitFor(() => expect(mainAt(999)).toHaveFocus())
      // The virtualizer scrolls the row in on the next frame.
      await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0))
      await waitFor(() => expect(mainAt(990)).not.toBeNull())
      expect(mainAt(999)).toHaveAttribute('tabindex', '0')
      expect(mains().filter(m => m.tabIndex === 0)).toHaveLength(1)
      expect(rows().length).toBeLessThanOrEqual(ROW_BOUND)
      await user.keyboard('{Home}')
      await waitFor(() => expect(mainAt(0)).toHaveFocus())
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(mainAt(1)).toHaveFocus())
      await user.keyboard('{ArrowUp}')
      await waitFor(() => expect(mainAt(0)).toHaveFocus())
    })

    it('focus survives scrolling the active row out of view', async () => {
      const user = userEvent.setup()
      const { props } = setup({ list: thousand() })
      mains()[0].focus()
      scroller().scrollTo({ top: 40_000 })
      // The rows around the new scroll position are mounted…
      await waitFor(() => expect(mainAt(530)).not.toBeNull())
      // …and the active row is still there, focused, and still the Tab stop.
      expect(mainAt(0)).toHaveFocus()
      expect(rows().length).toBeLessThanOrEqual(ROW_BOUND)
      // Arrow keys go on from it, and Tab reaches its Open.
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(mainAt(1)).toHaveFocus())
      await user.tab()
      expect(document.activeElement).toHaveAccessibleName('Open comments on button.cta')
      await user.keyboard('{Enter}')
      expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ threadKey: 't1' }))
    })

    it('Enter on a windowed row is Show on page, focus staying in the list', async () => {
      const user = userEvent.setup()
      const { props } = setup({ list: thousand() })
      mains()[0].focus()
      await user.keyboard('{Enter}')
      expect(props.onReveal).toHaveBeenCalledWith(expect.objectContaining({ threadKey: 't0' }))
      expect(mainAt(0)).toHaveFocus()
    })

    it('never pulls focus back from outside the drawer', async () => {
      setup({ list: thousand() })
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      // Focus has already left (a toast's button, the editor) when a late key
      // event for the list arrives: the move happens, focus does not follow.
      outside.focus()
      act(() => {
        mains()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      })
      await waitFor(() => expect(mainAt(999)).toHaveAttribute('tabindex', '0'))
      expect(outside).toHaveFocus()
      outside.remove()
    })
  })

  describe('R-020 tags and actions per row kind', () => {
    // Changed expectation under OD-04 (was "tags Element not found, Damaged and Newer format separately",
    // all three under Needs attention).
    it('OD-04 Not found is a neutral Open row; Damaged (▲ counter) and Newer format are Can\'t edit; all open in source', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      const notFound = rows()[2]
      const notFoundTag = within(notFound).getByTestId('comment-drawer-tag')
      expect(notFoundTag).toHaveTextContent(DRAWER_COPY.notFound)
      expect(notFoundTag).toHaveClass('erf-comment-tag')
      expect(notFoundTag).not.toHaveClass('erf-counter--attention')
      expect(within(notFound).getByTestId('comment-drawer-row-main')).toHaveAttribute('title', COPY.openInSource)
      await user.click(screen.getByTestId('comment-filter-cant-edit'))
      const tags = rows().map(r => within(r).getByTestId('comment-drawer-tag'))
      expect(tags.map(tag => tag.textContent)).toEqual([DRAWER_COPY.damaged, COPY.newerTag])
      expect(tags[0]).toHaveClass('erf-counter', 'erf-counter--attention')
      expect(tags[1]).not.toHaveClass('erf-counter--attention')
      const mains = screen.getAllByTestId('comment-drawer-row-main')
      expect(mains.every(m => m.title === COPY.openInSource)).toBe(true)
      await user.click(mains[0])
      expect(props.onOpenInSource).toHaveBeenCalledWith(
        expect.objectContaining({ blockKey: 'b1', line: 41 })
      )
      expect(props.onReveal).not.toHaveBeenCalled()
    })
  })

  describe('C-15 the three-cell filter and the sort menu', () => {
    // The shared ContextMenu portals into #portal-root, as the app's index.html provides.
    let portalRoot: HTMLDivElement
    beforeEach(() => {
      portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    })
    afterEach(() => portalRoot.remove())

    it('C-15 the filter is three equal cells with no visible "Show"; Show names the group', () => {
      setup()
      const group = screen.getByRole('radiogroup', { name: COMMENT_LIST_COPY.filterGroup })
      expect(within(group).getAllByRole('radio')).toHaveLength(3)
      expect(group).not.toHaveTextContent(/^Show/)
      expect(screen.queryByText(DRAWER_COPY.show, { selector: 'span' })).toBeNull()
      expect(within(group).getByRole('radio', { name: "Can't edit 2" })).toBeVisible()
      const css = readFileSync(resolve(__dirname, 'CommentDrawer.css'), 'utf8')
      expect(css).toMatch(/\.erf-comment-filter \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
    })

    it('C-15 a damaged tag is never amber text: the ▲ counter replaces the warning-tinted tag', () => {
      const css = readFileSync(resolve(__dirname, 'CommentDrawer.css'), 'utf8')
      expect(css).not.toMatch(/\.erf-comment-tag--attention\s*\{/)
    })

    it('C-15 the sort menu orders the rows: file order, changed first, latest activity', async () => {
      const user = userEvent.setup()
      setup({
        list: ready([
          fileView({
            threads: [
              thread(1, { messages: [message(1, { at: '2026-10-01T10:00:00Z' })] }),
              thread(2, { messages: [message(2, { at: '2026-10-03T10:00:00Z' })], change: { state: 'changed', was: 'Old' } }),
              thread(3, { messages: [message(3, { at: '2026-10-09T10:00:00Z' })] })
            ]
          })
        ])
      })
      const excerpts = () => rows().map(r => r.querySelector('.erf-comment-row__excerpt')?.textContent)
      const sort = screen.getByTestId('comment-drawer-sort')
      expect(sort).toHaveTextContent('Sort: File order')
      expect(sort).toHaveAttribute('aria-haspopup', 'menu')
      expect(excerpts()).toEqual(['Message 1', 'Message 2', 'Message 3'])
      await user.click(sort)
      expect(sort).toHaveAttribute('aria-expanded', 'true')
      const menu = screen.getByRole('menu', { name: COMMENT_LIST_COPY.sortMenu })
      expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
        'File order',
        'Changed first',
        'Latest activity'
      ])
      await user.click(within(menu).getByRole('menuitem', { name: 'Changed first' }))
      expect(sort).toHaveTextContent('Sort: Changed first')
      expect(excerpts()).toEqual(['Message 2', 'Message 1', 'Message 3'])
      expect(within(rows()[0]).getByTestId('comment-drawer-tag')).toHaveTextContent(COMMENT_LIST_COPY.changedTag)
      await user.click(sort)
      await user.click(screen.getByRole('menuitem', { name: 'Latest activity' }))
      expect(excerpts()).toEqual(['Message 3', 'Message 2', 'Message 1'])
    })
  })

  describe('C-20 the icons toggle lives in the drawer', () => {
    it('C-20 the checkbox says it shows icons and underlines', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      const box = screen.getByRole('checkbox', { name: COMMENT_LIST_COPY.showIcons })
      expect(box).toBeChecked()
      await user.click(box)
      expect(props.onShowIconsChange).toHaveBeenCalledWith(false)
    })
  })

  describe('OD-06 comments removed outside Erfana', () => {
    const removed = [
      { threadKey: 'r1', text: 'Fix the date', author: 'Ada Lovelace', label: 'p.lede' },
      { threadKey: 'r2', text: 'Shorter title', author: 'Grace Hopper', label: 'h1' }
    ]

    it('OD-06 no note when nothing was removed', () => {
      setup()
      expect(screen.queryByTestId('comment-drawer-removed')).toBeNull()
    })

    it('OD-06 an info note above the list, Show unfolds a read-only list with Copy text, Dismiss hides it', async () => {
      const user = userEvent.setup()
      const onDismissRemoved = vi.fn()
      const onCopyText = vi.fn()
      setup({ removed, onDismissRemoved, onCopyText })
      const note = screen.getByTestId('comment-drawer-removed')
      expect(note).toHaveTextContent('2 open comments were removed from index.html outside Erfana.')
      expect(note).toHaveClass('erf-comment-banner--info')
      expect(screen.getByTestId('comment-drawer').querySelector('.erf-comment-drawer__scroll')?.contains(note)).toBe(false)
      const show = screen.getByTestId('comment-drawer-removed-show')
      expect(show).toHaveAttribute('aria-expanded', 'false')
      await user.click(show)
      expect(show).toHaveAttribute('aria-expanded', 'true')
      expect(show).toHaveTextContent(COMMENT_LIST_COPY.removedHide)
      const list = screen.getByRole('list', { name: COMMENT_LIST_COPY.removedList })
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
      expect(list).toHaveTextContent('Fix the date')
      expect(list).toHaveTextContent('Grace Hopper · h1')
      // Read-only: nothing in it edits; Copy text is the one action per comment.
      expect(within(list).queryByRole('textbox')).toBeNull()
      await user.click(within(list).getByRole('button', { name: 'Copy text, Grace Hopper' }))
      expect(onCopyText).toHaveBeenCalledWith('Shorter title')
      await user.click(screen.getByTestId('comment-drawer-removed-dismiss'))
      expect(onDismissRemoved).toHaveBeenCalled()
    })

    it('OD-06 one removed comment reads in the singular', () => {
      setup({ removed: removed.slice(0, 1) })
      expect(screen.getByTestId('comment-drawer-removed')).toHaveTextContent(
        '1 open comment was removed from index.html outside Erfana.'
      )
    })
  })

  describe('C-03 (drawer) one noun system in Markdown', () => {
    it('C-03 (drawer) Markdown rows say the kind and line, Show in preview, and no element, page or block', () => {
      render(
        <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
          <CommentDrawer
            {...setup().props}
            id="drawer-md"
            pageFile="notes.md"
            list={ready([
              fileView({
                displayPath: 'notes.md',
                threads: [thread(1, { tag: 'li', classes: [], line: 14 }), thread(2, { tag: 'p', classes: [], line: 20, attached: false })],
                damaged: [damaged(1)]
              })
            ])}
          />
        </CommentWordsContext.Provider>
      )
      const drawer = screen.getAllByTestId('comment-drawer').find(el => el.id === 'drawer-md')!
      const mdRows = within(drawer).getAllByTestId('comment-drawer-row')
      expect(within(mdRows[0]).getByText('List item · line 14')).toBeVisible()
      expect(within(mdRows[0]).getByTestId('comment-drawer-row-main')).toHaveAttribute('title', MARKDOWN_COPY.showInPreview)
      expect(within(mdRows[1]).getByTestId('comment-drawer-tag')).toHaveTextContent(MARKDOWN_COPY.notFoundTag)
      const said = [
        drawer.textContent ?? '',
        ...within(drawer)
          .getAllByRole('button')
          .map(button => button.getAttribute('aria-label') ?? button.getAttribute('title') ?? '')
      ].join(' ')
      expect(said).not.toMatch(/\belements?\b|\bpages?\b|\bblocks?\b/i)
    })
  })

  describe('round 3: description, focus return, Esc, ids, tokens', () => {
    // Changed expectation under C-10 (was "M8 a row describes what Enter does, the excerpt, …" with the action
    // first and the excerpt in the description): the excerpt is the row's name, the description starts with its target.
    it('C-10 a row is named by its first message and described by its target, replies, who and when, tags and action', () => {
      setup()
      const main = within(rows()[0]).getByTestId('comment-drawer-row-main')
      expect(main).not.toHaveAttribute('aria-keyshortcuts')
      expect(main).toHaveAccessibleName('Message 1')
      const description = main.getAttribute('aria-describedby')?.split(' ') ?? []
      const text = description.map(id => document.getElementById(id)?.textContent ?? '')
      expect(text[0]).toBe('on button.cta')
      expect(text).toContain('1 reply')
      expect(text.at(-1)).toBe(COPY.showOnPage)
      // A row with no replies points at no reply count.
      const second = within(rows()[1]).getByTestId('comment-drawer-row-main')
      expect(second.getAttribute('aria-describedby')?.split(' ')).toHaveLength(4)
    })

    it('C-10 a damaged row has no message, so its label names it', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByTestId('comment-filter-cant-edit'))
      expect(within(rows()[0]).getByTestId('comment-drawer-row-main')).toHaveAccessibleName('index.html, line 41')
    })

    it('M5 the drawer is a focus-return region that hands focus to its first control', () => {
      setup()
      const aside = screen.getByTestId('comment-drawer')
      expect(aside).toHaveAttribute('data-focus-return')
      expect(resolveFocusReturnTarget(null, aside)).toBe(screen.getByTestId('comment-drawer-close'))
    })

    it('L13 Esc closes a full-width drawer, and only a full-width one', async () => {
      const user = userEvent.setup()
      const side = setup()
      within(rows()[0]).getByTestId('comment-drawer-row-main').focus()
      await user.keyboard('{Escape}')
      expect(side.props.onClose).not.toHaveBeenCalled()
      side.unmount()
      const { props } = setup({ full: true })
      within(rows()[0]).getByTestId('comment-drawer-row-main').focus()
      await user.keyboard('{Escape}')
      expect(props.onClose).toHaveBeenCalledTimes(1)
    })

    it('L15 two drawers listing the same file use different row ids', () => {
      render(
        <>
          <CommentDrawer {...setup().props} id="drawer-2" />
        </>
      )
      const ids = screen
        .getAllByTestId('comment-drawer-row-main')
        .map(main => main.getAttribute('aria-labelledby'))
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('S-L-B the file heading shows a control in the file name as a token', () => {
      const rlo = String.fromCodePoint(0x202e)
      setup({ list: ready([fileView({ displayPath: `lmth.${rlo}index.html`, threads: [thread(1)] })]) })
      const heading = document.querySelector('.erf-comment-drawer__file')!
      expect(heading.textContent).toBe('lmth.⟨U+202E⟩index.html')
      expect(within(heading as HTMLElement).getByTestId('comment-control-token')).toBeVisible()
    })

    it('M9 a label with a control shows a token, in the text and in Open\'s name', () => {
      const rlo = String.fromCodePoint(0x202e)
      setup({ list: ready([fileView({ threads: [thread(1, { elementId: `buy${rlo}` })] })]) })
      const open = within(rows()[0]).getByTestId('comment-drawer-row-open')
      expect(open.getAttribute('aria-label')).not.toContain(rlo)
      expect(open.getAttribute('aria-label')).toContain('\u27e8U+202E\u27e9')
      expect(within(rows()[0]).getByTestId('comment-control-token')).toBeVisible()
    })
  })
})

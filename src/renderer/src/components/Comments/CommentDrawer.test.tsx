// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comments drawer (docs/designs/comments/html-preview-comments.md §10.5; R-009,
 * R-020).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import type { CommentFileView } from '../../../../shared/ipc/preview-comment-schema'
import type { CommentListState } from '../../stores/usePreviewCommentStore'
import { damaged, fileView, message, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { resolveFocusReturnTarget } from '../Dialog/BaseDialog'
import { COPY, DRAWER_COPY, unreadFilesText } from './commentCopy'
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

    it('counts each filter and starts on Open, in file order', () => {
      setup()
      expect(screen.getByTestId('comment-filter-open')).toHaveTextContent('Open 2')
      expect(screen.getByTestId('comment-filter-resolved')).toHaveTextContent('Resolved 1')
      expect(screen.getByTestId('comment-filter-attention')).toHaveTextContent('Needs attention 3')
      expect(screen.getByTestId('comment-filter-open')).toHaveAttribute('aria-checked', 'true')
      expect(rows()).toHaveLength(2)
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
      expect(screen.getByTestId('comment-filter-attention')).toHaveAttribute('aria-checked', 'true')
      expect(rows()).toHaveLength(3)
      await user.keyboard('{ArrowRight}')
      expect(screen.getByTestId('comment-filter-open')).toHaveAttribute('aria-checked', 'true')
      await user.keyboard('{ArrowLeft}')
      expect(screen.getByTestId('comment-filter-attention')).toHaveAttribute('aria-checked', 'true')
      await user.keyboard('{a}')
      expect(screen.getByTestId('comment-filter-attention')).toHaveAttribute('aria-checked', 'true')
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
      await user.click(screen.getByTestId('comment-filter-attention'))
      expect(screen.getByText(DRAWER_COPY.emptyAttention)).toBeVisible()
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
    it('tags Element not found, Damaged and Newer format separately and opens them in source', async () => {
      const user = userEvent.setup()
      const { props } = setup()
      await user.click(screen.getByTestId('comment-filter-attention'))
      const tags = rows().map(r => within(r).getByTestId('comment-drawer-tag').textContent)
      expect(tags).toEqual([DRAWER_COPY.notFound, DRAWER_COPY.damaged, COPY.newerTag])
      const mains = screen.getAllByTestId('comment-drawer-row-main')
      expect(mains.every(m => m.title === COPY.openInSource)).toBe(true)
      await user.click(mains[1])
      expect(props.onOpenInSource).toHaveBeenCalledWith(
        expect.objectContaining({ blockKey: 'b1', line: 41 })
      )
      expect(props.onReveal).not.toHaveBeenCalled()
    })
  })

  describe('round 3: description, focus return, Esc, ids, tokens', () => {
    it('M8 a row describes what Enter does, the excerpt, the replies, who and when, and its tags', () => {
      setup()
      const main = within(rows()[0]).getByTestId('comment-drawer-row-main')
      expect(main).not.toHaveAttribute('aria-keyshortcuts')
      const description = main.getAttribute('aria-describedby')?.split(' ') ?? []
      const text = description.map(id => document.getElementById(id)?.textContent ?? '')
      expect(text[0]).toBe(COPY.showOnPage)
      expect(text).toContain('1 reply')
      expect(text.join(' ')).toContain('Message 1')
      // A row with no replies points at no reply count.
      const second = within(rows()[1]).getByTestId('comment-drawer-row-main')
      expect(second.getAttribute('aria-describedby')?.split(' ')).toHaveLength(4)
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

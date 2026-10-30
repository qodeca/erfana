// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's comment icons and the states drawn on the content
 * (spec 024 state table § 4, S-01, S-02, S-05, S-07; comments-v2 C-05, C-17,
 * R-16; differences table D-12, D-13) – the real preview, host, drawer and
 * window, with only the bridge mocked.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { DRAWER_COPY } from '../../Comments/commentCopy'
import { MD_SURFACE_COPY } from '../../Comments/commentCopyWords'
import { COMMENT_ACTIVE_HIGHLIGHT } from '../../Comments/overlay/commentHighlights'
import { PIN_BUBBLE_PATH } from '../../Comments/overlay/CommentOverlayLayer'
import { FILE_PATH, Harness, PANEL_ID, RAW_HASH, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

const DOC = [
  '# Plan',
  '',
  'We ship the beta to ten customers by Friday.',
  '',
  'Second paragraph.',
  '',
  'Third paragraph.',
  '',
  '- one',
  '- two',
  '',
  '<details><summary>More</summary>',
  '',
  'Hidden paragraph.',
  '',
  '</details>',
  ''
].join('\n')

const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const block = (tag: string, line: number): HTMLElement => content().querySelector<HTMLElement>(`${tag}[data-line-start="${line}"]`)!
const pane = (): HTMLElement => screen.getByTestId('harness-pane')
const icons = (): HTMLElement[] => screen.queryAllByTestId(TEST_IDS.COMMENT_HOST_ICON)
const iconNamed = (name: string): HTMLElement => icons().find(icon => icon.getAttribute('aria-label') === name)!

/** Each block a row of its own, `ROW_PX` per source line; the pane and everything else 600 × 400. */
const ROW_PX = 22
function boxesByLine(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const line = Number.parseInt(this.getAttribute('data-line-start') ?? '', 10)
    return Number.isNaN(line) ? new DOMRect(0, 0, 600, 400) : new DOMRect(0, line * ROW_PX, 500, ROW_PX - 4)
  })
}

/** Every box the pane's: every icon starts on one spot, one crowded row. */
function oneRow(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400))
}

function placementsFor(...entries: Array<[string, number, string]>): ThreadPlacement[] {
  return entries.map(([threadKey, line, tag]) => ({ threadKey, line, tag }))
}

describe('Markdown Preview comments – icons and states on the content', () => {
  let api: FileCommentsMock
  let portalRoot: HTMLDivElement
  let unregister: () => void

  function list(file: CommentFileView, placements: ThreadPlacement[]): void {
    api.list.mockResolvedValue({ ok: true, file, placements })
  }

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    Element.prototype.scrollIntoView ??= vi.fn()
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
    resetStores()
    api = installApi()
    setSettings()
    const panel = { id: PANEL_ID, params: { filePath: FILE_PATH }, view: { contentComponent: 'editor' }, api: { setActive: vi.fn() } }
    unregister = editorSaveRegistry.register(PANEL_ID, { save: vi.fn(async () => true), hasConflict: () => false, holdAutosave: vi.fn(() => () => {}) })
    useProjectStore.setState({
      dockviewApi: { panels: [panel], getPanel: (id: string) => (id === PANEL_ID ? panel : undefined) } as unknown as DockviewApi,
      dirtyPanelIds: new Set()
    })
  })
  afterEach(() => {
    portalRoot.remove()
    unregister()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function ready(): Promise<void> {
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST)).toHaveAccessibleName(/comment/))
  }

  describe('S-01 (Markdown) the icon look', () => {
    it('S-01 (Markdown) an icon is the HTML bubble: two text lines for one comment, the number for 2–9, "9+" from 10', async () => {
      boxesByLine()
      const ten = Array.from({ length: 10 }, (_, i) => `n${i}`)
      list(
        fileView([thread('a', 3, 'p'), thread('b1', 5, 'p'), thread('b2', 5, 'p'), ...ten.map(key => thread(key, 7, 'p'))]),
        placementsFor(['a', 3, 'p'], ['b1', 5, 'p'], ['b2', 5, 'p'], ...ten.map((key): [string, number, string] => [key, 7, 'p']))
      )
      await ready()
      await waitFor(() => expect(icons()).toHaveLength(3))
      const one = iconNamed(MD_SURFACE_COPY.iconName(1, 'paragraph', 3))
      expect(one.querySelector('path')).toHaveAttribute('d', PIN_BUBBLE_PATH)
      expect(one.querySelectorAll('.erf-comment-host__pin-line')).toHaveLength(2)
      expect(one.querySelector('.erf-comment-host__count')).toBeNull()
      expect(iconNamed(MD_SURFACE_COPY.iconName(2, 'paragraph', 5)).querySelector('.erf-comment-host__count')).toHaveAttribute('data-text', '2')
      const many = iconNamed(MD_SURFACE_COPY.iconName(10, 'paragraph', 7))
      expect(many.querySelector('.erf-comment-host__count')).toHaveAttribute('data-text', '9+')
      // The count is generated content, never a text node a copy or Find could meet (E-022).
      expect(many.textContent).toBe('')
    })

    it("S-01 (Markdown) the bubble is the HTML pin's own outline", () => {
      const preload = readFileSync(resolve(__dirname, '../../../../../preload/previewPageComments/constants.ts'), 'utf8')
      expect(preload).toContain(`export const PIN_PATH = '${PIN_BUBBLE_PATH}'`)
    })
  })

  describe('S-07 (Markdown) the warning icon', () => {
    it("S-07 (Markdown) a damaged comment puts the warning icon, an ink '!', on the block after it – one icon per target", async () => {
      boxesByLine()
      const damaged = { blockKey: 'd1', rawHash: RAW_HASH, reason: 'bad-json' as const, line: 4, raw: '<!-- erfana:comment v1 broken -->' }
      list(fileView([thread('b1', 5, 'p')], { damaged: [damaged] }), placementsFor(['b1', 5, 'p']))
      await ready()
      await waitFor(() => expect(icons()).toHaveLength(1))
      const [icon] = icons()
      expect(icon).toHaveAccessibleName(MD_SURFACE_COPY.damagedName('paragraph', 5))
      expect(icon).toHaveClass('erf-comment-host__icon--damaged')
      expect(icon).not.toHaveClass('erf-comment-host__icon--changed')
      expect(icon.querySelector('.erf-comment-host__count')).toHaveAttribute('data-text', '!')
      await userEvent.setup().click(icon)
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('<!-- erfana:comment v1 broken -->')
    })

    it('S-07 (Markdown) the warning icon is the warning fill with ink', () => {
      const css = readFileSync(resolve(__dirname, '../../Comments/overlay/CommentOverlayLayer.css'), 'utf8')
      expect(css).toMatch(/\.erf-comment-host__icon--damaged \.erf-comment-host__pin-body \{\s*fill: var\(--color-warning\);/)
      expect(css).toMatch(/\.erf-comment-host__count \{[^}]*color: var\(--color-brand-black\);/)
    })
  })

  describe('S-05 (Markdown) the not-found ghost', () => {
    it("C-05 (Markdown) a not-found comment gets a dashed ghost at its place between two blocks, a button named for its line that opens it", async () => {
      boxesByLine()
      list(
        fileView([thread('a', 3, 'p'), thread('gone', 4, 'p', { attached: false }), thread('old', 6, 'p', { attached: false, status: 'resolved' })]),
        placementsFor(['a', 3, 'p'])
      )
      await ready()
      const ghost = await screen.findByTestId(TEST_IDS.COMMENT_HOST_GHOST)
      expect(screen.getAllByTestId(TEST_IDS.COMMENT_HOST_GHOST)).toHaveLength(1)
      expect(ghost.tagName).toBe('BUTTON')
      expect(ghost).toHaveAttribute('tabindex', '-1')
      expect(ghost).toHaveAccessibleName(MD_SURFACE_COPY.ghostName(4))
      expect(ghost).toHaveClass('erf-comment-host__ghost')
      expect(ghost.querySelector('svg')).toBeNull()
      // Centred on the gap between the paragraph on line 3 and the one on line 5, in the right margin.
      const gap = (3 * ROW_PX + ROW_PX - 4 + 5 * ROW_PX) / 2
      expect(Number.parseFloat(ghost.style.top) + Number.parseFloat(ghost.style.height) / 2).toBeCloseTo(gap, 5)
      expect(Number.parseFloat(ghost.style.left)).toBeGreaterThan(Number.parseFloat(iconNamed(MD_SURFACE_COPY.iconName(1, 'paragraph', 3)).style.left) - 1)
      await userEvent.setup().click(ghost)
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Comment gone')
    })
  })

  describe('C-17 (Markdown) the row cap and the stack icon', () => {
    it('C-17 (Markdown) a crowded row keeps 3 icons and merges the rest into a "+2" stack named for its comments, which opens them all', async () => {
      oneRow()
      const targets: Array<[string, number, string]> = [['h', 1, 'h1'], ['p3', 3, 'p'], ['p5', 5, 'p'], ['p7', 7, 'p'], ['li9', 9, 'li']]
      list(fileView(targets.map(([key, line, tag]) => thread(key, line, tag))), placementsFor(...targets))
      await ready()
      await waitFor(() => expect(icons()).toHaveLength(4))
      const stack = icons().find(icon => icon.classList.contains('erf-comment-host__icon--stack'))!
      expect(stack).toHaveAccessibleName(MD_SURFACE_COPY.stackName(2))
      expect(stack).toHaveAccessibleName('2 more comments in this row. Open.')
      expect(stack.querySelector('.erf-comment-host__count')).toHaveAttribute('data-text', '+2')
      // Icons never overlap: three steps of the shared rule, the stack one further left.
      const lefts = icons().map(icon => Number.parseFloat(icon.style.left))
      expect(new Set(lefts).size).toBe(4)
      // The merged targets point at the stack (C-11).
      expect(block('p', 7).getAttribute('aria-details')).toBe(stack.id)
      expect(block('li', 9).getAttribute('aria-details')).toBe(stack.id)
      await userEvent.setup().click(stack)
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent('Comment p7')
      expect(dialog).toHaveTextContent('Comment li9')
      expect(dialog).not.toHaveTextContent('Comment p3')
    })
  })

  describe('C-17 (Markdown) linked hover', () => {
    it('C-17 (Markdown) the pointer on marked words: its icon in the hover look, the active fill, a pointer and "Comment by {name} – click to open"', async () => {
      boxesByLine()
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
      const words: ThreadPlacement = { threadKey: 'w1', line: 3, tag: 'p', sel: { exact: 'ten customers', prefix: 'beta to ', suffix: ' by' } }
      list(fileView([thread('w1', 3, 'p', { messages: [{ id: 'm1', by: { name: 'Anna Kowalska' }, at: '2026-10-29T10:00:00Z', text: 'Which?' }] })]), [words])
      await ready()
      const paintedAs = (name: string): string[] =>
        ((set.mock.calls.filter(([painted]) => painted === name).at(-1)?.[1] as FakeHighlight | undefined)?.ranges ?? []).map(r => r.toString())
      await waitFor(() => expect(icons()).toHaveLength(1))
      const [icon] = icons()
      const text = block('p', 3).firstChild!
      const caret = document.createRange()
      caret.setStart(text, (text.textContent ?? '').indexOf('ten') + 2)
      ;(document as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint = () => caret
      try {
        fireEvent.mouseMove(block('p', 3), { clientX: 120, clientY: 70 })
        await waitFor(() => expect(icon).toHaveClass('erf-comment-host__icon--hover'))
        expect(pane()).toHaveAttribute('title', MD_SURFACE_COPY.markTitle('Anna Kowalska'))
        expect(pane()).toHaveAttribute('title', 'Comment by Anna Kowalska – click to open')
        expect(pane()).toHaveClass('erf-comment-host-pane--mark')
        await waitFor(() => expect(paintedAs(COMMENT_ACTIVE_HIGHLIGHT)).toEqual(['ten customers']))
        fireEvent.mouseLeave(content())
        await waitFor(() => expect(icon).not.toHaveClass('erf-comment-host__icon--hover'))
        expect(pane()).not.toHaveAttribute('title')
        expect(pane()).not.toHaveClass('erf-comment-host-pane--mark')
      } finally {
        delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint
      }
    })

    it('C-17 (Markdown) the pane over marked words shows a pointer', () => {
      const css = readFileSync(resolve(__dirname, '../../Comments/overlay/CommentOverlayLayer.css'), 'utf8')
      expect(css).toMatch(/\.erf-comment-host-pane--mark \* \{\s*cursor: pointer;/)
    })
  })

  describe('S-02 (Markdown) not visible now', () => {
    it('S-02 (Markdown) a comment inside a collapsed section is "Not visible now" in the drawer until the section opens', async () => {
      boxesByLine()
      list(fileView([thread('a', 3, 'p'), thread('hid', 14, 'p')]), placementsFor(['a', 3, 'p'], ['hid', 14, 'p']))
      await ready()
      const user = userEvent.setup()
      await user.click(screen.getByTestId(TEST_IDS.COMMENT_TOOL_LIST))
      const drawer = await screen.findByTestId(TEST_IDS.COMMENT_DRAWER)
      await waitFor(() => expect(within(drawer).getAllByText(DRAWER_COPY.notVisible)).toHaveLength(1))
      const details = content().querySelector('details')!
      expect(details.contains(block('p', 14))).toBe(true)
      act(() => {
        details.open = true
        details.dispatchEvent(new Event('toggle'))
      })
      await waitFor(() => expect(within(drawer).queryByText(DRAWER_COPY.notVisible)).toBeNull())
      act(() => {
        details.open = false
        details.dispatchEvent(new Event('toggle'))
      })
      await waitFor(() => expect(within(drawer).getAllByText(DRAWER_COPY.notVisible)).toHaveLength(1))
    })
  })
})

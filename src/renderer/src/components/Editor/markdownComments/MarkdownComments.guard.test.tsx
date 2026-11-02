// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What comment mode keeps from the Markdown Preview's own content, and what
 * it must not take from Erfana (spec 024 024-AC-001, 024-FR-004, D-06;
 * `Comments/overlay/contentGuard.ts`): the real preview and host, with only
 * the bridge mocked. The shared overlay suite pins the gestures
 * (`MarkdownComments.overlay.conformance.test.tsx`); these cases pin the
 * preview's own handlers and Erfana's listeners around it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DockviewApi } from 'dockview'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorSaveRegistry } from '../../../services/editorSaveRegistry'
import { useProjectStore } from '../../../stores/useProjectStore'
import { TEST_IDS } from '../../../constants/testids'
import { MARKDOWN_WORDS, MD_SURFACE_COPY } from '../../Comments/commentCopyWords'
import { TABINDEX_MARKER } from '../../Comments/overlay/commentContentAttrs'
import { SELECTION_BUTTON_DELAY_MS } from '../../Comments/overlay/useSelectionComments'
import { FILE_PATH, Harness, PANEL_ID, fileView, installApi, resetStores, setSettings, thread, type FileCommentsMock } from './__test-utils__/harness'

const SITE = 'https://example.com/'
const DOC = ['# Plan', '', `Read [the brief](${SITE}) first.`, '', '- Freeze the API.', '- Run the load test.', ''].join('\n')

const modeTool = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_TOOL_MODE)
const content = (): HTMLElement => document.querySelector<HTMLElement>('.markdown-preview-content')!
const paragraph = (): HTMLElement => content().querySelector<HTMLElement>('p[data-line-start="3"]')!
const link = (): HTMLElement => content().querySelector<HTMLElement>(`a[href="${SITE}"]`)!

/** A middle click as Chromium sends it: press, release, `auxclick`. */
function middleClick(el: Element): void {
  fireEvent.pointerDown(el, { button: 1, buttons: 4 })
  fireEvent.mouseDown(el, { button: 1, buttons: 4 })
  fireEvent.pointerUp(el, { button: 1 })
  fireEvent.mouseUp(el, { button: 1 })
  fireEvent(el, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
}

describe('comment mode and the Markdown Preview’s own listeners (024-AC-001)', () => {
  let api: FileCommentsMock
  let openExternal: ReturnType<typeof vi.fn>
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
    api = installApi(fileView([thread('t1', 5, 'ul', { runtime: { tag: 'li', path: 'li:nth-of-type(1)' } })]), [
      { threadKey: 't1', line: 5, tag: 'li' }
    ])
    openExternal = vi.fn(async () => {})
    Object.defineProperty(window, 'electron', { value: { shell: { openExternal } }, writable: true, configurable: true })
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
  })

  async function ready(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    render(<Harness content={DOC} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    return user
  }

  it('OVL-G-11: a middle click on a link follows it outside comment mode, and never in it (MarkdownPreview onAuxClick)', async () => {
    const user = await ready()
    middleClick(link())
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(SITE))
    openExternal.mockClear()

    await user.click(modeTool())
    const aux = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    middleClick(link())
    fireEvent(link(), aux)
    expect(aux.defaultPrevented).toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
    expect(screen.queryByTestId('comment-window')).toBeNull()
  })

  it('024-FR-004: in comment mode a drag that selects words still shows the Comment button (Erfana’s mouse-up runs)', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(100, 200, 80, 20)] as unknown as DOMRectList)
    const user = await ready()
    await user.click(modeTool())
    const text = paragraph().firstChild!
    fireEvent.mouseDown(paragraph(), { button: 0, clientX: 10, clientY: 10 })
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 4)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    fireEvent.mouseUp(paragraph(), { button: 0, clientX: 80, clientY: 10 })
    expect(await screen.findByTestId(TEST_IDS.COMMENT_SELECTION_BUTTON, {}, { timeout: SELECTION_BUTTON_DELAY_MS * 10 })).toBeVisible()
  })

  it('OVL-G-01 / D-06: a pointer pick is the pick – the block takes the host’s tabindex and focus, and gets it back when the window closes', async () => {
    const user = await ready()
    await user.click(modeTool())
    await user.click(paragraph())
    expect(paragraph()).toHaveAttribute(TABINDEX_MARKER)
    const field = await screen.findByTestId('comment-new-field')
    await waitFor(() => expect(field).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('comment-window')).toBeNull())
    expect(paragraph()).toHaveFocus()
  })

  it('024-AC-003 (Markdown) a comment on list item 1 is labelled as the list item – its icon names the item, not the list', async () => {
    // jsdom has no layout: every block gets a box, so its icon has room.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300))
    await ready()
    const icon = await screen.findByTestId(TEST_IDS.COMMENT_HOST_ICON)
    expect(icon).toHaveAccessibleName(MD_SURFACE_COPY.iconName(1, MARKDOWN_WORDS.noun('li'), 5))
    expect(icon).toHaveAccessibleName('1 comment on list item, line 5. Open.')
  })
})

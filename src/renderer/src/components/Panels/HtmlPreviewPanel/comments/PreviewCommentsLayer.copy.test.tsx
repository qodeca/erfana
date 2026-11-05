// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Copy selection in the HTML preview's right-click menu (#463): the Markdown
 * Preview's label, icon and hint, last in the menu after a separator, disabled
 * (never hidden) without a selection, and focus back to the page after it ran.
 *
 * Its own file because the platform mock hoists to module scope
 * (docs/windows/contributing.md § Test-file split policy).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INITIAL_PANEL_COMMENT_STATE } from '../../../../stores/usePreviewCommentStore'
import { useOverlayOccluderStore } from '../../../../stores/useOverlayOccluderStore'
import { isMacOS } from '../../../../utils/platform'
import { TEST_IDS } from '../../../../constants/testids'
import { SELECTION_COPY } from '../../../Comments/commentCopyWords'
import { menuDraft } from './__test-helpers__/commentTestKit'
import { PreviewCommentsLayer, type PreviewCommentsLayerProps } from './PreviewCommentsLayer'

vi.mock('../../../../utils/platform', () => ({ isMacOS: vi.fn(), isWindows: vi.fn() }))

const WORDS = { text: 'We ship the beta to ten customers', start: 20, end: 33, cut: false }

function setup(patch: Partial<PreviewCommentsLayerProps> = {}) {
  const props: PreviewCommentsLayerProps = {
    menu: menuDraft(),
    request: null,
    list: INITIAL_PANEL_COMMENT_STATE.list,
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    notVisible: [],
    polite: '',
    assertive: '',
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    onMenuClose: vi.fn(),
    onAddComment: vi.fn(),
    onCopySelection: vi.fn(),
    onCloseWindow: vi.fn(),
    onNewComment: vi.fn(),
    onSaveIdentity: vi.fn(async () => true),
    onSave: vi.fn(async () => ({ ok: true as const, threadKey: 't1' })),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn(),
    ...patch
  }
  return { props, ...render(<PreviewCommentsLayer {...props} />) }
}

const copyItem = (): HTMLElement => screen.getByRole('menuitem', { name: 'Copy selection' })

describe('PreviewCommentsLayer – Copy selection (#463)', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isMacOS).mockReturnValue(false)
    useOverlayOccluderStore.getState().reset()
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => portalRoot.remove())

  it('on a selection: last, after a separator, enabled, with the Markdown Preview test id', () => {
    setup({ menu: menuDraft({ selection: true, words: WORDS }), mode: false })
    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.querySelector('.context-menu-label')?.textContent)).toEqual([
      SELECTION_COPY.commentOnSelection,
      SELECTION_COPY.commentOnWhole('section'),
      'Copy selection'
    ])
    expect(copyItem()).not.toHaveAttribute('aria-disabled')
    expect(copyItem()).toHaveAttribute('data-testid', TEST_IDS.CONTEXT_MENU_ITEM_COPY)
    expect(screen.getAllByRole('separator')).toHaveLength(1)
    // The separator sits between the comment items and Copy.
    const order = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"], [role="separator"]'))
    expect(order.map(node => node.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'separator', 'menuitem'])
  })

  it('shows Ctrl+C on Windows and Linux, and exposes it as aria-keyshortcuts', () => {
    setup({ menu: menuDraft({ selection: true, words: WORDS }) })
    expect(copyItem()).toHaveTextContent('Copy selectionCtrl+C')
    expect(copyItem()).toHaveAttribute('aria-keyshortcuts', 'Control+C')
  })

  it('shows ⌘C on macOS', () => {
    vi.mocked(isMacOS).mockReturnValue(true)
    setup({ menu: menuDraft({ selection: true, words: WORDS }) })
    expect(copyItem()).toHaveTextContent('Copy selection⌘C')
    expect(copyItem()).toHaveAttribute('aria-keyshortcuts', 'Meta+C')
  })

  it.each([
    ['outside comment mode', false],
    ['in comment mode', true]
  ])('without a selection, %s: shown, disabled, and inert', async (_name, mode) => {
    const user = userEvent.setup()
    const { props } = setup({ menu: menuDraft(), mode })
    expect(copyItem()).toHaveAttribute('aria-disabled', 'true')
    await user.click(copyItem())
    expect(props.onCopySelection).not.toHaveBeenCalled()
  })

  it.each([
    ['outside comment mode', false],
    ['in comment mode', true]
  ])('on a selection, %s: a click copies once, and the menu closes with focus back to the page', async (_name, mode) => {
    const user = userEvent.setup()
    const { props } = setup({ menu: menuDraft({ selection: true, words: WORDS }), mode })
    await user.click(copyItem())
    expect(props.onCopySelection).toHaveBeenCalledTimes(1)
    expect(props.onAddComment).not.toHaveBeenCalled()
    // `false`: nothing opened in its place, so the page takes focus back.
    expect(props.onMenuClose).toHaveBeenCalledWith(false)
  })

  it('from the keyboard: Up from the first item wraps to Copy selection, and Enter copies', async () => {
    const user = userEvent.setup()
    const { props } = setup({ menu: menuDraft({ selection: true, words: WORDS }) })
    screen.getByTestId(TEST_IDS.COMMENT_MENU_SELECTION).focus()
    await user.keyboard('{ArrowUp}')
    expect(copyItem()).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(props.onCopySelection).toHaveBeenCalledTimes(1)
    expect(props.onAddComment).not.toHaveBeenCalled()
  })

  it('stays enabled when comments are unavailable for the file: copying does not depend on them (M-10)', () => {
    const NO_DRAFT = { draftToken: undefined, draftKey: undefined, target: undefined }
    setup({ menu: menuDraft({ ...NO_DRAFT, selection: true, reason: 'encoding' }), mode: false, unavailable: 'too-large' })
    expect(screen.getByRole('menuitem', { name: SELECTION_COPY.commentOnSelection })).toHaveAttribute('aria-disabled', 'true')
    expect(copyItem()).not.toHaveAttribute('aria-disabled')
    expect(copyItem()).not.toHaveAttribute('aria-describedby')
  })

  it('is disabled when the host gave no copy action', () => {
    setup({ menu: menuDraft({ selection: true, words: WORDS }), onCopySelection: undefined })
    expect(copyItem()).toHaveAttribute('aria-disabled', 'true')
  })
})

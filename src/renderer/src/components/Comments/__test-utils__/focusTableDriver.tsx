// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The {@link FocusTableDriver} over one preview's way of mounting the comment
 * window (`shared/comments/__conformance__/overlay.suite.ts`). The stage is the
 * smallest panel that has every opener: a toolbar, a drawer that is a
 * focus-return region, a preview with a target, and an editor. Each preview's
 * conformance test mocks `useCommentDirtyGuard` to the `guard` it passes in.
 */
import { useEffect, useState } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import type { CommentSaveRequest } from '../../../../../shared/ipc/preview-comment-schema'
import type { FocusClose, FocusHome, FocusOpener, FocusTableDriver } from '../../../../../shared/comments/__conformance__/overlayDriver'
import type { CommentDirtyGuard } from '../../../hooks/useCommentDirtyGuard'
import { commentDrafts, type CommentListState } from '../../../stores/usePreviewCommentStore'
import { fileView, newRequest, thread, threadsRequest } from '../../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { resetCommentPendingWrites } from '../commentPendingWrites'
import type { CommentWindowRequest } from '../commentWindowTypes'
import { TEST_IDS } from '../../../constants/testids'
import type { WindowRulesHost } from './windowRulesDriver'

const ROW = 'stage-drawer-row'
const DRAWER_CLOSE = 'stage-drawer-close'
const DRAWER = 'stage-drawer'
const TOOL = 'stage-toolbar-tool'
const PREVIEW = 'stage-preview'
const TARGET = 'stage-target'
const EDITOR = 'stage-editor'

const listWith = (generation: number, threads: readonly number[]): CommentListState => ({
  status: 'ready',
  files: [fileView({ threads: threads.map(seed => thread(seed)) })],
  generation
})

/** The request `close` needs: a new comment to save, a thread that turns out gone, else a thread. */
function requestFor(opener: FocusOpener, close: FocusClose): CommentWindowRequest {
  const from = opener === 'drawer-row' || opener === 'gone-row' || opener === 'toolbar' ? 'drawer' : 'page'
  if (close === 'saved') return newRequest({ opener: from })
  return threadsRequest({ opener: from, listAfter: 1, threadKeys: [close === 'thread-gone' ? 't9' : 't1'] })
}

/** What the driver does to the stage from outside. */
interface StageControl {
  open: (request: CommentWindowRequest) => void
  removeRow: () => void
  removeTarget: () => void
  refreshList: () => void
}

interface StageProps {
  readonly host: WindowRulesHost
  readonly editor: 'clean' | 'dirty'
  readonly controlRef: { current: StageControl | null }
  readonly onPageFocus: () => void
}

/** A panel with every opener, and the window as the preview draws it. */
function Stage({ host, editor, controlRef, onPageFocus }: StageProps): React.JSX.Element {
  const [request, setRequest] = useState<CommentWindowRequest | null>(null)
  const [rowThere, setRowThere] = useState(true)
  const [targetThere, setTargetThere] = useState(true)
  const [list, setList] = useState(() => listWith(1, [1]))
  useEffect(() => {
    controlRef.current = {
      open: setRequest,
      removeRow: () => setRowThere(false),
      removeTarget: () => setTargetThere(false),
      refreshList: () => setList(listWith(2, [1]))
    }
  }, [controlRef])
  const close = (returnFocus = true): void => {
    if (request !== null && host.closeFocusesPage?.(request, returnFocus) === true) onPageFocus()
    setRequest(null)
  }
  const onWritten = (save: CommentSaveRequest): void => {
    if (save.op === 'add') close()
  }
  const [stable] = useState(() => ({
    notVisible: [] as readonly string[],
    identity: { authorName: 'Ada', identityNoticeSeen: true },
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn(),
    onSaveIdentity: async () => true,
    onSave: async () => ({ ok: true as const, threadKey: 't1' })
  }))
  return (
    <>
      <button type="button" data-testid={TOOL}>
        Tool
      </button>
      <aside data-focus-return data-testid={DRAWER}>
        <button type="button" data-testid={DRAWER_CLOSE}>
          Close the drawer
        </button>
        {rowThere && (
          <button type="button" data-testid={ROW}>
            Row
          </button>
        )}
      </aside>
      <div tabIndex={0} data-testid={PREVIEW}>
        {targetThere && (
          <p tabIndex={-1} data-testid={TARGET}>
            Target
          </p>
        )}
      </div>
      <textarea aria-label="Editor" data-testid={EDITOR} />
      {request !== null && host.mount({ ...stable, request, list, onClose: close, onWritten }, editor, () => document.querySelector<HTMLElement>(`[data-testid="${PREVIEW}"]`))}
    </>
  )
}

/** The element `opener` means; `null` for no opener at all, or one that left the document. */
function openerElement(opener: FocusOpener): HTMLElement | null {
  if (opener === 'nothing') return null
  if (opener === 'drawer-row' || opener === 'gone-row') return screen.queryByTestId(ROW)
  return screen.queryByTestId(opener === 'toolbar' ? TOOL : TARGET)
}

/**
 * The driver for one preview.
 *
 * @param host - The preview's mount.
 * @param guard - What the test file's `useCommentDirtyGuard` mock answers with.
 * @returns A fresh driver.
 */
export function focusTableDriver(host: WindowRulesHost, guard: { current: CommentDirtyGuard }): FocusTableDriver {
  const user = userEvent.setup()
  const controlRef: { current: StageControl | null } = { current: null }
  let pageFocused = false
  let openedFrom: FocusOpener = 'nothing'
  const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
  const win = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_WINDOW)
  return {
    async open(opener, close) {
      openedFrom = opener
      const editor = close === 'go-to-tab' ? 'dirty' : 'clean'
      guard.current = {
        state: editor,
        justSaved: false,
        cleared: null,
        goToTab: () => screen.getByTestId(EDITOR).focus(),
        save: async () => true,
        holdForWrite: () => () => {}
      }
      render(<Stage host={host} editor={editor} controlRef={controlRef} onPageFocus={() => (pageFocused = true)} />)
      openerElement(opener)?.focus()
      act(() => controlRef.current?.open(requestFor(opener, close)))
      await waitFor(() => expect(win().contains(document.activeElement)).toBe(true))
      act(() => {
        if (opener === 'gone-row') controlRef.current?.removeRow()
        if (opener === 'gone-target') controlRef.current?.removeTarget()
      })
    },
    async close(close) {
      if (close === 'escape') await user.keyboard('{Escape}')
      if (close === 'close-button') {
        screen.getByTestId(TEST_IDS.COMMENT_WINDOW_CLOSE).focus()
        await user.keyboard('{Enter}')
      }
      if (close === 'saved') {
        screen.getByTestId(TEST_IDS.COMMENT_NEW_FIELD).focus()
        await user.keyboard('A note')
        await user.keyboard('{Control>}{Enter}{/Control}')
      }
      if (close === 'thread-gone') act(() => controlRef.current?.refreshList())
      if (close === 'go-to-tab') {
        screen.getByTestId(TEST_IDS.COMMENT_UNSAVED_GO_TO_TAB).focus()
        await user.keyboard('{Enter}')
      }
      await waitFor(() => expect(screen.queryByTestId(TEST_IDS.COMMENT_WINDOW)).toBeNull())
      await settled()
    },
    home(): FocusHome {
      const active = document.activeElement
      if (active === screen.getByTestId(EDITOR)) return 'editor'
      if (pageFocused) return 'preview'
      if (active === null || active === document.body) return 'body'
      if (active === openerElement(openedFrom)) return active.closest(`[data-testid="${PREVIEW}"]`) === null ? 'opener' : 'preview'
      if (screen.getByTestId(DRAWER).contains(active)) return 'drawer'
      return screen.getByTestId(PREVIEW).contains(active) ? 'preview' : 'body'
    },
    dispose() {
      cleanup()
      commentDrafts.reset()
      resetCommentPendingWrites()
    }
  }
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The {@link WindowRulesDriver} over one preview's way of mounting the comment
 * window (`shared/comments/__conformance__/overlay.suite.ts`). Each preview's
 * conformance test hands it a `mount`, and mocks `useCommentDirtyGuard` to the
 * `guard` it passes in, because the dirty state is an editor tab the fixture
 * does not have.
 */
import { useState, type ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import type { CommentSaveRequest, CommentSaveResult } from '../../../../../shared/ipc/preview-comment-schema'
import type { CommentIdentitySettings } from '../../../../../shared/ipc/global-settings-schema'
import type { WindowFocus, WindowRulesDriver, WindowRulesSetup } from '../../../../../shared/comments/__conformance__/overlayDriver'
import type { CommentDirtyGuard } from '../../../hooks/useCommentDirtyGuard'
import { commentDrafts, type CommentListState } from '../../../stores/usePreviewCommentStore'
import { fileView, thread, threadsRequest } from '../../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { resetCommentPendingWrites } from '../commentPendingWrites'
import type { CommentWindowProps } from '../CommentWindow'
import type { IdentityFormData } from '../commentSchemas'
import { TEST_IDS } from '../../../constants/testids'

/** What every host's window is given. */
export type WindowRulesProps = Pick<
  CommentWindowProps,
  'request' | 'list' | 'identity' | 'notVisible' | 'getArea' | 'onClose' | 'onSaveIdentity' | 'onSave' | 'onWritten' | 'onRefresh' | 'onPickAgain' | 'onOpenInSource' | 'onCopyRaw'
>

/** One preview, for {@link windowRulesDriver}. */
export interface WindowRulesHost {
  readonly host: string
  readonly seesOtherWindows: boolean
  /**
   * Draw the window the way the preview does; `editor` is what its host knows
   * of the file, `preview` what a docked window hands focus to.
   */
  readonly mount: (props: WindowRulesProps, editor: 'clean' | 'dirty' | 'conflict', preview?: () => HTMLElement | null) => ReactNode
  /** The host's own close: `true` when it hands native focus to the page. Absent: focus stays in this document. */
  readonly closeFocusesPage?: (request: WindowRulesProps['request'], returnFocus: boolean) => boolean
}

const FILE_NAME = 'index.html'
const CHANGED = { change: { state: 'changed', was: 'Buy now', now: 'Buy today' } } as const

/** The list a setup opens on. */
function listOf(setup: WindowRulesSetup): CommentListState {
  const threads = (setup.threads ?? ['open']).map((state, i) => thread(i + 1, state === 'changed' ? CHANGED : {}))
  return { status: 'ready', files: [fileView({ threads, ...(setup.readOnly === true ? { writable: false } : {}) })], generation: 1 }
}
const IDENTITIES: Readonly<Record<WindowRulesSetup['identity'], CommentIdentitySettings | null>> = {
  none: null,
  'notice-unseen': { authorName: 'Ada', identityNoticeSeen: false },
  ready: { authorName: 'Ada', identityNoticeSeen: true }
}

/** The window, holding the identity as the settings store would. */
function Stage({ host, setup, onSave }: { readonly host: WindowRulesHost; readonly setup: WindowRulesSetup; readonly onSave: CommentWindowProps['onSave'] }): React.JSX.Element {
  const [identity, setIdentity] = useState(IDENTITIES[setup.identity])
  const saveIdentity = async (data: IdentityFormData): Promise<boolean> => {
    setIdentity({ authorName: data.name, identityNoticeSeen: true })
    return true
  }
  const [props] = useState(() => ({
    request: threadsRequest({ listAfter: 1 }),
    list: listOf(setup),
    notVisible: [] as readonly string[],
    getArea: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    onClose: vi.fn(),
    onWritten: vi.fn(),
    onRefresh: vi.fn(),
    onPickAgain: vi.fn(),
    onOpenInSource: vi.fn(),
    onCopyRaw: vi.fn()
  }))
  return <>{host.mount({ ...props, identity, onSaveIdentity: saveIdentity, onSave }, setup.editor ?? 'clean')}</>
}

/** What holds focus in the window now. */
function focusedInWindow(): WindowFocus {
  const active = document.activeElement
  if (active === win()) return 'window'
  const names: ReadonlyArray<readonly [string, WindowFocus]> = [
    [TEST_IDS.COMMENT_WINDOW_TITLE, 'title'],
    [TEST_IDS.COMMENT_RESOLVE, 'resolve'],
    [TEST_IDS.COMMENT_RESOLVE_NEXT, 'resolve-next']
  ]
  return names.find(([id]) => active?.getAttribute('data-testid') === id)?.[1] ?? 'other'
}

const win = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_WINDOW)
const reply = (): HTMLTextAreaElement | null => screen.queryByTestId<HTMLTextAreaElement>(TEST_IDS.COMMENT_REPLY_FIELD)
const banner = (): HTMLElement | null =>
  screen.queryByTestId(TEST_IDS.COMMENT_READ_ONLY) ?? screen.queryByTestId(TEST_IDS.COMMENT_SAVE_ERROR)

/**
 * The driver for one preview.
 *
 * @param host - The preview's mount.
 * @param guard - What the test file's `useCommentDirtyGuard` mock answers with.
 * @returns A fresh driver.
 */
export function windowRulesDriver(host: WindowRulesHost, guard: { current: CommentDirtyGuard }): WindowRulesDriver {
  const user = userEvent.setup()
  const writes: string[] = []
  let editorSaves = 0
  const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
  return {
    host: host.host,
    seesOtherWindows: host.seesOtherWindows,
    fileName: FILE_NAME,
    async open(setup) {
      const state = setup.editor ?? 'clean'
      guard.current = {
        state,
        justSaved: false,
        cleared: null,
        goToTab: () => {},
        save: async () => {
          editorSaves += 1
          return true
        },
        holdForWrite: () => () => {}
      }
      const onSave = async (save: CommentSaveRequest): Promise<CommentSaveResult> => {
        if (setup.refusedUnsaved === true) return { ok: false, code: ErrorCode.COMMENT_UNSAVED_SOURCE }
        writes.push(save.op)
        return { ok: true, threadKey: 't1' }
      }
      render(<Stage host={host} setup={setup} onSave={onSave} />)
      await waitFor(() => expect(win().contains(document.activeElement)).toBe(true))
    },
    view: () => win().getAttribute('data-view') ?? '',
    async replyByKeys(text) {
      const field = reply()
      if (field === null) throw new Error('no reply field')
      field.focus()
      await user.keyboard(text)
      await user.keyboard('{Control>}{Enter}{/Control}')
      await settled()
    },
    async resolveByKeys() {
      screen.getByTestId(TEST_IDS.COMMENT_RESOLVE).focus()
      await user.keyboard('{Enter}')
      await settled()
    },
    async continueByKeys(name) {
      const field = screen.getByTestId(TEST_IDS.COMMENT_IDENTITY_NAME)
      await waitFor(() => expect(document.activeElement).toBe(field))
      await user.keyboard(name)
      const go = screen.getByTestId(TEST_IDS.COMMENT_IDENTITY_CONTINUE)
      go.focus()
      await user.keyboard('{Enter}')
      await waitFor(() => expect(win().getAttribute('data-view')).toBe('threads'))
      await settled()
    },
    async pressEscape() {
      await user.keyboard('{Escape}')
      await settled()
    },
    writes: () => writes,
    replyText: () => reply()?.value ?? null,
    bannerButtons() {
      const shown = banner()
      return shown === null ? [] : within(shown).queryAllByRole('button').map(button => button.textContent ?? '')
    },
    bannerText: () => banner()?.textContent ?? '',
    async saveFromBannerByKeys() {
      screen.getByTestId(TEST_IDS.COMMENT_UNSAVED_SAVE).focus()
      await user.keyboard('{Enter}')
      await settled()
    },
    editorSaves: () => editorSaves,
    focusInWindow: () => win().contains(document.activeElement),
    focused: focusedInWindow,
    async stepByKeys() {
      await user.keyboard('{Alt>}[F9]{/Alt}')
      await settled()
    },
    dispose() {
      cleanup()
      commentDrafts.reset()
      resetCommentPendingWrites()
    }
  }
}

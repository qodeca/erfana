// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The {@link DrawerBulkDriver} over the shared drawer, in one preview's words
 * (`shared/comments/__conformance__/drawerBulk.suite.ts`). Main is a fake that
 * applies a request to the list the way a landed write would, and refuses the
 * file a setup names. The preview's conformance test mocks
 * `useCommentDirtyGuard` to the `guard` it passes in.
 */
import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'
import { ErrorCode } from '../../../../../shared/errors'
import type { DrawerBulkDriver, DrawerBulkSetup, BulkThreadState, SentBulk } from '../../../../../shared/comments/__conformance__/drawerBulk.suite'
import type { CommentBulkRequest, CommentBulkResult, CommentBulkSettled, CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import type { CommentDirtyGuard } from '../../../hooks/useCommentDirtyGuard'
import { TEST_IDS } from '../../../constants/testids'
import type { CommentListState } from '../../../stores/usePreviewCommentStore'
import { fileView, hex, thread } from '../../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import type { CommentWords } from '../commentCopyWords'
import { CommentDrawer } from '../CommentDrawer'
import { CommentWordsContext } from '../commentWords'
import { useDrawerFilterState } from '../commentDrawerFilter'

const PATCH: Readonly<Record<BulkThreadState, Parameters<typeof thread>[1]>> = {
  open: {},
  changed: { change: { state: 'changed', was: 'Buy now', now: 'Buy today' } },
  words: { change: { state: 'words', was: 'old words', now: 'new words' } },
  'not-found': { attached: false },
  resolved: { status: 'resolved' }
}

const DRAWER_ID = 'bulk-drawer'
const NOW = (): Date => new Date('2026-11-01T10:00:00Z')

/** The list a setup opens on; each thread remembers its state in `first message's text`. */
function filesOf(setup: DrawerBulkSetup): CommentFileView[] {
  let seed = 0
  return setup.files.map((states, at) =>
    fileView({
      fileKey: hex(0xf00 + at, 32),
      displayPath: at === 0 ? 'index.html' : `part-${at}.html`,
      frame: at > 0,
      writable: setup.readOnly !== true,
      threads: states.map(state => {
        seed += 1
        const shown = thread(seed, PATCH[state])
        return { ...shown, messages: [{ ...shown.messages[0], text: state }] }
      })
    })
  )
}

interface Fake {
  readonly sent: SentBulk[]
  readonly turnOn: () => void
  /** The drawer's listener for main's late endings. */
  settled: Set<(event: CommentBulkSettled) => void>
  /** The file main answered "still saving" for. */
  pendingKey?: string
}

/** The drawer, with main's fake answers landing in the list it shows. */
function Stage({ setup, words, fake }: { readonly setup: DrawerBulkSetup; readonly words: CommentWords; readonly fake: Fake }): React.JSX.Element {
  const [files, setFiles] = useState(() => filesOf(setup))
  const [, setFilter] = useDrawerFilterState(DRAWER_ID)
  const [opened] = useState(() => {
    if (setup.filter !== undefined) setFilter(setup.filter)
    return true
  })
  const [identity, setIdentity] = useState(setup.identity === 'none' ? null : { authorName: 'Ada', identityNoticeSeen: true })
  const list: CommentListState = { status: 'ready', files, generation: 1 }
  const run = async (request: Omit<CommentBulkRequest, 'panelId'>): Promise<CommentBulkResult> => {
    const textOf = (fileKey: string, threadKey: string): string => files.find(f => f.fileKey === fileKey)?.threads.find(t => t.threadKey === threadKey)?.messages[0].text ?? '?'
    fake.sent.push({ change: request.change, threads: request.files.map(file => file.threads.map(t => textOf(file.fileKey, t.threadKey))) })
    const results = request.files.map((file): Extract<CommentBulkResult, { ok: true }>['files'][number] => {
      const place = files.findIndex(f => f.fileKey === file.fileKey)
      if (place === setup.refuseFile) return { fileKey: file.fileKey, ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' }
      if (place === setup.changedFile) return { fileKey: file.fileKey, ok: true, done: file.threads.length, changedDuringSave: true }
      if (place === setup.pendingFile) {
        fake.pendingKey = file.fileKey
        return { fileKey: file.fileKey, ok: false, code: ErrorCode.COMMENT_SAVE_PENDING }
      }
      return { fileKey: file.fileKey, ok: true, done: file.threads.length }
    })
    const done = new Set(results.filter(r => r.ok).map(r => r.fileKey))
    const named = new Set(request.files.flatMap(file => file.threads.map(t => t.threadKey)))
    setFiles(current => current.map(file => (done.has(file.fileKey) ? { ...file, threads: file.threads.filter(t => !named.has(t.threadKey)) } : file)))
    return { ok: true, files: results }
  }
  return (
    <CommentWordsContext.Provider value={words}>
      {opened && (
        <CommentDrawer
          id={DRAWER_ID}
          list={list}
          notVisible={[]}
          showIcons
          full={false}
          pageFile="index.html"
          now={NOW}
          onClose={() => {}}
          onShowIconsChange={() => {}}
          onReveal={() => {}}
          onOpenInSource={() => {}}
          onOpen={() => {}}
          onRetry={() => {}}
          onTurnOnMode={setup.canTurnOnMode === true ? fake.turnOn : undefined}
          bulk={{
            run,
            onSettled: listener => {
              fake.settled.add(listener)
              return () => fake.settled.delete(listener)
            },
            identity,
            onSaveIdentity: async data => {
              setIdentity({ authorName: data.name, identityNoticeSeen: true })
              return true
            }
          }}
        />
      )}
    </CommentWordsContext.Provider>
  )
}

/**
 * The driver for one preview.
 *
 * @param words - The preview's words.
 * @param guard - What the test file's `useCommentDirtyGuard` mock answers with.
 * @returns A fresh driver.
 */
export function drawerBulkDriver(words: CommentWords, guard: { current: CommentDirtyGuard }): DrawerBulkDriver {
  const user = userEvent.setup()
  let turnedOn = 0
  const fake: Fake = {
    sent: [],
    settled: new Set(),
    turnOn: () => {
      turnedOn += 1
    }
  }
  const settled = (): Promise<void> => act(async () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))))
  const press = async (testId: string): Promise<void> => {
    screen.getByTestId(testId).focus()
    await user.keyboard('{Enter}')
    await settled()
  }
  return {
    async open(setup) {
      guard.current = { state: setup.editor ?? 'clean', justSaved: false, cleared: null, goToTab: () => {}, save: async () => true, holdForWrite: () => () => {} }
      render(<Stage setup={setup} words={words} fake={fake} />)
      await settled()
    },
    action: () => screen.queryByTestId(TEST_IDS.COMMENT_BULK_ACTION)?.textContent ?? null,
    pausedText: () => screen.queryByTestId(TEST_IDS.COMMENT_BULK_PAUSED)?.textContent ?? null,
    openReview: () => press(TEST_IDS.COMMENT_BULK_ACTION),
    reviewed: () =>
      screen.queryAllByTestId(TEST_IDS.COMMENT_BULK_ITEM).map(item => item.querySelector('.erf-comment-bulk__excerpt')?.textContent ?? ''),
    wasNow: () =>
      screen.queryAllByTestId(TEST_IDS.COMMENT_BULK_ITEM).map(item =>
        [...item.querySelectorAll('.erf-comment-wasnow__item')].map(box => [...box.children].map(part => part.textContent).join(' ')).join(' ')
      ),
    focused() {
      const at = document.activeElement
      const is = (id: string): boolean => at === screen.queryByTestId(id)
      if (is(TEST_IDS.COMMENT_BULK_CANCEL)) return 'cancel'
      if (is(TEST_IDS.COMMENT_BULK_CONFIRM)) return 'confirm'
      if (is(TEST_IDS.COMMENT_BULK_ACTION)) return 'action'
      return is(TEST_IDS.COMMENT_DRAWER_CLOSE) ? 'close' : 'other'
    },
    cancelByKeys: () => press(TEST_IDS.COMMENT_BULK_CANCEL),
    async escape() {
      await user.keyboard('{Escape}')
      await settled()
    },
    confirmByKeys: () => press(TEST_IDS.COMMENT_BULK_CONFIRM),
    asksName: () => screen.queryByTestId(TEST_IDS.COMMENT_IDENTITY_NAME) !== null,
    async answerName(name) {
      const field = screen.getByTestId(TEST_IDS.COMMENT_IDENTITY_NAME)
      await waitFor(() => expect(document.activeElement).toBe(field))
      await user.keyboard(name)
      await press(TEST_IDS.COMMENT_IDENTITY_CONTINUE)
    },
    sent: () => fake.sent,
    outcome: () => {
      const shown = screen.queryByTestId(TEST_IDS.COMMENT_BULK_OUTCOME)
      return shown === null ? null : within(shown).getByText(/./).textContent
    },
    async settleLate(ending) {
      const fileKey = fake.pendingKey as string
      const event: CommentBulkSettled =
        ending === 'landed' ? { panelId: 'p', fileKey, ok: true } : { panelId: 'p', fileKey, ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' }
      await act(async () => {
        for (const listener of fake.settled) listener(event)
      })
    },
    turnOnMode: () => screen.queryByTestId(TEST_IDS.COMMENT_DRAWER_TURN_ON_MODE)?.textContent ?? null,
    turnOnModeByKeys: () => press(TEST_IDS.COMMENT_DRAWER_TURN_ON_MODE),
    modeTurnedOn: () => turnedOn,
    dispose: () => cleanup()
  }
}

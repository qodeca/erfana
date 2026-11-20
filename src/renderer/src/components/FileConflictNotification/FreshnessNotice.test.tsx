// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The one-notice presenter (#478 plan S13, § 3.6): priority across stacked
 * states, the copy and actions per reason, the read-only wording (F33), the
 * status region that only the active panel speaks through (F13), and focus
 * that never moves.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FreshnessState } from '../../../../shared/freshness/freshnessTypes'
import { FRESHNESS_LIMITS } from '../../../../shared/freshness/timingProfiles'
import { IMAGE_READ_MAX_BYTES } from '../../../../shared/ipc/file-image-schema'
import { FreshnessNotice } from './FreshnessNotice'
import {
  FRESHNESS_NOTICE_COPY,
  FRESHNESS_NOTICE_TEST_IDS,
  NOTICE_BUTTON_COPY,
  NOTICE_SIZE_LIMIT_MB,
  formatMegabytes,
  selectNotice,
  type NoticeInput
} from './freshnessNoticeCopy'
import { TEST_IDS } from '../../constants/testids'

const ACTIVE = { kind: 'active', live: 'full' } as const
const FRESH = { kind: 'fresh' } as const
const state = (partial: Partial<FreshnessState>): FreshnessState => ({ watch: ACTIVE, content: FRESH, ...partial })
const input = (s: FreshnessState, extra: Partial<NoticeInput> = {}): NoticeInput => ({
  state: s,
  fileName: 'a.md',
  tab: 'editor',
  ...extra
})

describe('selectNotice – priority (one notice per panel)', () => {
  it.each([
    ['deleted outranks a conflict-free stopped watch', state({ content: { kind: 'deleted' }, watch: { kind: 'stopped', reason: 'restart-failed' } }), 'deleted'],
    ['conflict outranks a queued watch', state({ content: { kind: 'changed', mode: 'held' }, watch: { kind: 'queued' } }), 'conflict'],
    ['content unavailable outranks a stopped watch', state({ content: { kind: 'unavailable', reason: 'binary' }, watch: { kind: 'stopped', reason: 'watcher-error' } }), 'unavailable'],
    ['stopped outranks nothing below it', state({ watch: { kind: 'stopped', reason: 'watcher-error' } }), 'stopped'],
    ['queued alone', state({ watch: { kind: 'queued' } }), 'queued'],
    ['limited alone', state({ watch: { kind: 'active', live: 'limited' } }), 'limited']
  ])('%s', (_label, s, kind) => {
    expect(selectNotice(input(s))?.kind).toBe(kind)
  })

  it('nothing to say for a fresh, followed tab, a deferred change, or a closed project', () => {
    expect(selectNotice(input(state({})))).toBeNull()
    expect(selectNotice(input(state({ content: { kind: 'changed', mode: 'deferred' } })))).toBeNull()
    expect(selectNotice(input(state({ watch: { kind: 'stopped', reason: 'project-closed' } })))).toBeNull()
  })

  it('a dismissed limited notice stays hidden for the tab (F35)', () => {
    expect(selectNotice(input(state({ watch: { kind: 'active', live: 'limited' } }), { limitedDismissed: true }))).toBeNull()
  })
})

describe('selectNotice – copy and actions per reason', () => {
  it('deleted: Restore file and Close tab in the editor (F14); Close tab only in the image viewer', () => {
    const editor = selectNotice(input(state({ content: { kind: 'deleted' } })))
    expect(editor).toMatchObject({ message: 'a.md was deleted, renamed or moved on disk.', actions: ['restore', 'close'] })
    expect(selectNotice(input(state({ content: { kind: 'deleted' } }), { tab: 'image' }))?.actions).toEqual(['close'])
  })

  it('conflict after an aborted autosave says Not saved (F16)', () => {
    const notice = selectNotice(input(state({ content: { kind: 'changed', mode: 'held', notSaved: true } })))
    expect(notice?.message).toBe(FRESHNESS_NOTICE_COPY.notSaved('a.md'))
    expect(notice?.notSaved).toBe(true)
  })

  it.each(['too-large', 'binary', 'unsupported-encoding', 'unreadable'] as const)(
    'unavailable(%s) in the editor says the tab is read-only (F33); the image viewer does not',
    (reason) => {
      const s = state({ content: { kind: 'unavailable', reason } })
      expect(selectNotice(input(s))?.message).toContain(FRESHNESS_NOTICE_COPY.readOnlyTail.trim())
      expect(selectNotice(input(s, { tab: 'image' }))?.message).not.toContain('read-only')
    }
  )

  it('too large names the size and the limit per tab kind, and Reload tries again (Q2)', () => {
    const s = state({ content: { kind: 'unavailable', reason: 'too-large' } })
    const editor = selectNotice(input(s, { tooLargeSize: 12.5 * 1024 * 1024 }))
    expect(editor?.message).toContain('a.md is too large to show here (12.5 MB; limit 10 MB).')
    expect(editor?.actions).toEqual(['reload'])
    expect(selectNotice(input(s, { tab: 'image' }))?.message).toContain('(limit 50 MB)')
  })

  it('binary and other encodings have no Reload: they update on the next change', () => {
    for (const reason of ['binary', 'unsupported-encoding'] as const) {
      expect(selectNotice(input(state({ content: { kind: 'unavailable', reason } })))?.actions).toEqual([])
    }
    expect(selectNotice(input(state({ content: { kind: 'unavailable', reason: 'unreadable' } })))?.actions).toEqual(['reload'])
  })

  it('a read refused as outside the project says so, not that the file is locked (G6)', () => {
    const notice = selectNotice(input(state({ content: { kind: 'unavailable', reason: 'outside-project' } })))
    expect(notice?.message).toContain(FRESHNESS_NOTICE_COPY.outside('a.md'))
    expect(notice?.message).not.toContain('locked')
    expect(notice?.actions).toEqual(['reload'])
  })

  it('stopped watch: the reason decides the words; Reload always', () => {
    expect(selectNotice(input(state({ watch: { kind: 'stopped', reason: 'restart-failed' } }))))
      .toMatchObject({ message: FRESHNESS_NOTICE_COPY.stopped('a.md'), actions: ['reload'], testId: FRESHNESS_NOTICE_TEST_IDS.stopped })
    expect(selectNotice(input(state({ watch: { kind: 'stopped', reason: 'outside-project' } })))?.message)
      .toBe(FRESHNESS_NOTICE_COPY.outside('a.md'))
    expect(selectNotice(input(state({ watch: { kind: 'stopped', reason: 'unsupported' } })))?.message)
      .toBe(FRESHNESS_NOTICE_COPY.unsupported('a.md'))
  })

  it('the watch-limit notice is info, says the plan copy, and has no Reload (F32)', () => {
    expect(selectNotice(input(state({ watch: { kind: 'queued' } })))).toMatchObject({
      severity: 'info',
      message:
        'Too many files are open to follow this one live. It updates when you switch to it, and follows live again when a slot frees.',
      actions: []
    })
  })

  it('formats megabytes with one decimal, whole numbers without', () => {
    expect(formatMegabytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatMegabytes(10.25 * 1024 * 1024)).toBe('10.3 MB')
  })

  it('rounds the size up, so a file just over the limit never reads as the limit (U6)', () => {
    expect(formatMegabytes(10 * 1024 * 1024 + 1)).toBe('10.1 MB')
    expect(formatMegabytes(10.04 * 1024 * 1024)).toBe('10.1 MB')
    const s = state({ content: { kind: 'unavailable', reason: 'too-large' } })
    expect(selectNotice(input(s, { tooLargeSize: 10 * 1024 * 1024 + 1 }))?.message).toContain(
      'a.md is too large to show here (10.1 MB; limit 10 MB).'
    )
  })

  it('states the limits the reads enforce, not a second copy (U6)', () => {
    expect(NOTICE_SIZE_LIMIT_MB).toEqual({
      editor: FRESHNESS_LIMITS.editorTextMaxBytes / (1024 * 1024),
      image: IMAGE_READ_MAX_BYTES / (1024 * 1024)
    })
  })
})

describe('FreshnessNotice', () => {
  const renderNotice = (s: FreshnessState, props: { isActive?: boolean; handlers?: Record<string, () => void> } = {}) => {
    const notice = selectNotice(input(s))
    return render(
      <FreshnessNotice notice={notice} fileName="a.md" handlers={props.handlers ?? {}} isActive={props.isActive ?? true} />
    )
  }

  it('renders one notice for stacked states', () => {
    renderNotice(state({ content: { kind: 'deleted' }, watch: { kind: 'queued' } }))
    expect(screen.getByTestId(FRESHNESS_NOTICE_TEST_IDS.deleted)).toBeInTheDocument()
    expect(screen.queryByTestId(FRESHNESS_NOTICE_TEST_IDS.queued)).not.toBeInTheDocument()
  })

  it('the status region is always mounted, speaks the notice while active, and is silent in a background panel', () => {
    const { rerender } = renderNotice(state({}))
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')
    const queued = selectNotice(input(state({ watch: { kind: 'queued' } })))
    rerender(<FreshnessNotice notice={queued} fileName="a.md" handlers={{}} isActive={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('')
    rerender(<FreshnessNotice notice={queued} fileName="a.md" handlers={{}} isActive />)
    expect(screen.getByRole('status')).toHaveTextContent(FRESHNESS_NOTICE_COPY.queued)
    // The visible notice itself is no second live region
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deleted: Restore file and Close tab call their handlers with no arguments', async () => {
    const restore = vi.fn()
    const close = vi.fn()
    renderNotice(state({ content: { kind: 'deleted' } }), { handlers: { restore, close } })
    await userEvent.click(screen.getByRole('button', { name: NOTICE_BUTTON_COPY.restore }))
    await userEvent.click(screen.getByRole('button', { name: NOTICE_BUTTON_COPY.close }))
    expect(restore).toHaveBeenCalledWith()
    expect(close).toHaveBeenCalledWith()
  })

  it('the conflict entry is the conflict bar, with all three actions', async () => {
    const handlers = { 'reload-from-disk': vi.fn(), 'keep-local': vi.fn(), 'dismiss-conflict': vi.fn() }
    renderNotice(state({ content: { kind: 'changed', mode: 'held' } }), { handlers })
    await userEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_RELOAD))
    await userEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_KEEP))
    await userEvent.click(screen.getByTestId(TEST_IDS.FILE_CONFLICT_BTN_DISMISS))
    expect(handlers['reload-from-disk']).toHaveBeenCalledWith()
    expect(handlers['keep-local']).toHaveBeenCalledTimes(1)
    expect(handlers['dismiss-conflict']).toHaveBeenCalledTimes(1)
  })

  it('limited: Dismiss hides it through its handler', async () => {
    const dismiss = vi.fn()
    renderNotice(state({ watch: { kind: 'active', live: 'limited' } }), { handlers: { 'dismiss-limited': dismiss } })
    await userEvent.click(screen.getByRole('button', { name: NOTICE_BUTTON_COPY.dismiss }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('stopped: Reload keeps the #464 test ids', () => {
    renderNotice(state({ watch: { kind: 'stopped', reason: 'watcher-error' } }), { handlers: { reload: vi.fn() } })
    expect(screen.getByTestId(FRESHNESS_NOTICE_TEST_IDS.stopped)).toBeInTheDocument()
    expect(screen.getByTestId(FRESHNESS_NOTICE_TEST_IDS.reload)).toBeInTheDocument()
  })

  it('an action with no handler is not shown', () => {
    renderNotice(state({ content: { kind: 'deleted' } }), { handlers: { close: vi.fn() } })
    expect(screen.queryByRole('button', { name: NOTICE_BUTTON_COPY.restore })).not.toBeInTheDocument()
  })

  it('focus stays where it was when a notice appears', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { rerender } = renderNotice(state({}))
    const notice = selectNotice(input(state({ watch: { kind: 'stopped', reason: 'watcher-error' } })))
    rerender(<FreshnessNotice notice={notice} fileName="a.md" handlers={{ reload: vi.fn() }} isActive />)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

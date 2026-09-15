// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The move coordinator holds a dirty editor's autosave while it asks (issue
 * #124, QG-11a Q2).
 *
 * Autosave fires 2 s after the last keystroke, and the prompt can only appear
 * within those 2 s, so without a hold the timer wrote the edits while the
 * dialog was open and "Don't save" was never honoured. Pinned: every dirty
 * editor is held before the prompt resolves; every ending that leaves those
 * tabs open releases each hold exactly once, so their edits still reach disk;
 * a move that closes them does not release, so nothing re-arms a write.
 * Split from `previewTabMove.test.ts`, which is at the 500-line cap.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../shared/errors'
import type { PreviewNavigateRequest } from '../../../../shared/ipc/preview-navigation-schema'
import type { PreviewNavigateResult } from '../../../../shared/ipc/preview-types'
import {
  createPreviewTabMove,
  type PreviewMovePromptAnswer,
  type PreviewMoveRequest,
  type PreviewTabMoveDeps
} from './previewTabMove'

const T = 'preview-t'
const A = '/proj/site/overview.html'
const B = '/proj/site/pricing.html'
const DIRTY = ['editor-b', 'editor-b-2']
const OPEN_B: PreviewMoveRequest = { panelId: T, origin: 'page', action: 'open', filePath: B, anchor: null }

interface SetupOptions {
  answer: PreviewMovePromptAnswer
  conflict?: boolean
  saveResult?: boolean
  commit?: PreviewNavigateResult
}

function setup(options: SetupOptions) {
  const panels = [
    { id: T, params: { filePath: A }, view: { contentComponent: 'htmlPreview' } },
    { id: 'editor-b', params: { filePath: B }, view: { contentComponent: 'editor' } },
    { id: 'editor-b-2', params: { filePath: B }, view: { contentComponent: 'editor' } }
  ]
  const releases = new Map(DIRTY.map((id) => [id, vi.fn()]))
  let resolvePrompt!: (answer: PreviewMovePromptAnswer) => void
  const deps = {
    getDockviewApi: () => ({ panels, getPanel: (id: string) => panels.find((p) => p.id === id) }),
    navigate: vi.fn(
      async (request: PreviewNavigateRequest): Promise<PreviewNavigateResult> =>
        request.phase === 'commit' && options.commit
          ? options.commit
          : { ok: true, target: { filePath: B, anchor: null }, generation: 2 }
    ),
    closePanel: vi.fn(),
    isDirty: (id: string) => DIRTY.includes(id),
    hasConflict: () => options.conflict === true,
    save: vi.fn(async () => options.saveResult ?? true),
    holdAutosave: vi.fn((id: string) => releases.get(id) as () => void),
    prompt: vi.fn(() => new Promise<PreviewMovePromptAnswer>((resolve) => (resolvePrompt = resolve))),
    focusBack: vi.fn(),
    showToast: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    // A fake store slice, so this file shares no state with the main suite.
    tabs: {
      getTab: () => ({ generation: 1, backTarget: null, forwardTarget: null }),
      setHistory: vi.fn(),
      setAnnouncement: vi.fn(),
      setLastMove: vi.fn()
    }
  }
  const coordinator = createPreviewTabMove(deps as unknown as PreviewTabMoveDeps)

  /** Runs the move up to the open prompt, then answers it. */
  const moveAnswering = async () => {
    const outcome = coordinator.move(OPEN_B)
    await vi.waitFor(() => expect(deps.prompt).toHaveBeenCalledTimes(1))
    resolvePrompt(options.answer)
    return outcome
  }
  return { coordinator, deps, releases, moveAnswering, resolvePrompt: () => resolvePrompt }
}

/** Each dirty editor's release was called exactly `times` times. */
function expectReleased(releases: Map<string, ReturnType<typeof vi.fn>>, times: number): void {
  for (const id of DIRTY) expect(releases.get(id), id).toHaveBeenCalledTimes(times)
}

// `pathsEqual` reads the platform through the preload bridge.
beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => 'darwin' } }
})

afterAll(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('createPreviewTabMove – autosave is held while the prompt is open', () => {
  it('(a) holds every dirty editor before the prompt resolves', async () => {
    const { coordinator, deps, releases, resolvePrompt } = setup({ answer: 'cancel' })

    const outcome = coordinator.move(OPEN_B)
    await vi.waitFor(() => expect(deps.prompt).toHaveBeenCalledTimes(1))

    expect(deps.holdAutosave.mock.calls.map(([id]) => id)).toEqual(DIRTY)
    expectReleased(releases, 0)
    resolvePrompt()('cancel')
    await expect(outcome).resolves.toEqual({ status: 'cancelled' })
  })

  it('(b) Cancel releases each hold exactly once', async () => {
    const { moveAnswering, releases } = setup({ answer: 'cancel' })

    await expect(moveAnswering()).resolves.toEqual({ status: 'cancelled' })

    expectReleased(releases, 1)
  })

  it('(c) Don\'t save with the commit accepted closes the tabs and releases nothing', async () => {
    const { moveAnswering, deps, releases } = setup({ answer: 'discard' })

    await expect(moveAnswering()).resolves.toMatchObject({ status: 'moved' })

    expect(deps.closePanel).toHaveBeenCalledWith('editor-b')
    expect(deps.closePanel).toHaveBeenCalledWith('editor-b-2')
    expect(deps.save).not.toHaveBeenCalled()
    expect(deps.holdAutosave).toHaveBeenCalledTimes(DIRTY.length)
    expectReleased(releases, 0)
  })

  it('(d) Save with a failed write releases each hold', async () => {
    const { moveAnswering, deps, releases } = setup({ answer: 'save', saveResult: false })

    await expect(moveAnswering()).resolves.toEqual({ status: 'save-failed' })

    expect(deps.closePanel).not.toHaveBeenCalled()
    expectReleased(releases, 1)
  })

  it('(e) Don\'t save with the commit refused releases each hold', async () => {
    const { moveAnswering, deps, releases } = setup({
      answer: 'discard',
      commit: { ok: false, errorCode: ErrorCode.PREVIEW_NAV_SKIPPED }
    })

    await expect(moveAnswering()).resolves.toMatchObject({ status: 'refused', phase: 'commit' })

    expect(deps.closePanel).not.toHaveBeenCalled()
    expectReleased(releases, 1)
  })

  it('(f) the conflict variant answered save is a Cancel, and releases each hold', async () => {
    const { moveAnswering, deps, releases } = setup({ answer: 'save', conflict: true })

    await expect(moveAnswering()).resolves.toEqual({ status: 'cancelled' })

    expect(deps.save).not.toHaveBeenCalled()
    expectReleased(releases, 1)
  })

  it('a throw after the prompt releases each hold', async () => {
    const { moveAnswering, deps, releases } = setup({ answer: 'discard' })
    deps.tabs.setLastMove.mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(moveAnswering()).resolves.toEqual({ status: 'failed' })

    expectReleased(releases, 1)
  })
})

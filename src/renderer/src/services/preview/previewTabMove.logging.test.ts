// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Log lines of the same-tab move coordinator name a tab by its digest (issue
 * #124, QG-7 S3).
 *
 * A preview's panel id is derived from the page's absolute path, so it carries
 * the user's name and folders. Pinned: the busy line and a refusal line carry
 * `stablePathDigest(panelId)`, and neither the id nor a path reaches the log;
 * an unexpected throw logs only the error's name, never its message (Q22).
 * Split from `previewTabMove.test.ts`, which is at the 500-line cap.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../shared/errors'
import type { PreviewNavigateRequest } from '../../../../shared/ipc/preview-navigation-schema'
import type { PreviewNavigateResult } from '../../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../utils/fileUtils'
import { createPreviewTabMove, type PreviewMoveRequest, type PreviewTabMoveDeps } from './previewTabMove'

/** A path-derived id, as `openFileInPanel` mints one – readable, so never logged. */
const T = 'preview-users-jane-client-site-overview-html'
const A = '/Users/jane/client/site/overview.html'
const B = '/Users/jane/client/site/pricing.html'
const OPEN_B: PreviewMoveRequest = { panelId: T, origin: 'page', action: 'open', filePath: B, anchor: null }

function setup(
  answer: (request: PreviewNavigateRequest) => Promise<PreviewNavigateResult>,
  getTab = () => ({ generation: 1, backTarget: null, forwardTarget: null })
) {
  const panels = [{ id: T, params: { filePath: A }, view: { contentComponent: 'htmlPreview' } }]
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps = {
    getDockviewApi: () => ({ panels, getPanel: (id: string) => panels.find((p) => p.id === id) }),
    navigate: vi.fn(answer),
    closePanel: vi.fn(),
    isDirty: () => false,
    hasConflict: () => false,
    save: vi.fn(async () => true),
    holdAutosave: vi.fn(() => vi.fn()),
    prompt: null,
    focusBack: vi.fn(),
    showToast: vi.fn(),
    logger,
    // A fake store slice, so this file shares no state with the main suite.
    tabs: {
      getTab,
      setHistory: vi.fn(),
      setAnnouncement: vi.fn(),
      setLastMove: vi.fn()
    }
  }
  const coordinator = createPreviewTabMove(deps as unknown as PreviewTabMoveDeps)
  /** Everything the logger was given, as one string. */
  const logged = () => JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls])
  return { coordinator, logger, logged }
}

// `pathsEqual` reads the platform through the preload bridge.
beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => 'darwin' } }
})

afterAll(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('createPreviewTabMove – log lines carry the digest, never the id', () => {
  it('the busy line', async () => {
    let release!: (result: PreviewNavigateResult) => void
    const { coordinator, logger, logged } = setup((request) =>
      request.phase === 'check'
        ? new Promise((resolve) => (release = resolve))
        : Promise.resolve({ ok: true, target: { filePath: B, anchor: null }, generation: 2 })
    )

    const first = coordinator.move(OPEN_B)
    await expect(coordinator.move(OPEN_B)).resolves.toEqual({ status: 'ignored', reason: 'busy' })
    release({ ok: true, target: { filePath: B, anchor: null }, generation: 2 })
    await expect(first).resolves.toMatchObject({ status: 'moved' })

    expect(logger.info).toHaveBeenCalledWith('Preview move ignored: this tab is already moving', {
      panelId: stablePathDigest(T),
      action: 'open'
    })
    expect(logged()).not.toContain(T)
    expect(logged()).not.toContain('jane')
  })

  it('a refusal line', async () => {
    const { coordinator, logger, logged } = setup(async () => ({
      ok: false,
      errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
    }))

    await expect(coordinator.move(OPEN_B)).resolves.toMatchObject({ status: 'refused' })

    expect(logger.info).toHaveBeenCalledWith('Preview move refused', {
      panelId: stablePathDigest(T),
      action: 'open',
      phase: 'check',
      errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
    })
    expect(logged()).not.toContain(T)
    expect(logged()).not.toContain('jane')
  })

  it('an unexpected throw logs its name only – never the Error, whose message may hold a path', async () => {
    const { coordinator, logger, logged } = setup(async () => {
      throw new Error('unused')
    }, () => {
      throw new TypeError(`ENOENT: ${B}`)
    })

    await expect(coordinator.move(OPEN_B)).resolves.toEqual({ status: 'failed' })

    expect(logger.error).toHaveBeenCalledWith('Preview move failed', undefined, {
      panelId: stablePathDigest(T),
      action: 'open',
      error: 'TypeError'
    })
    expect(logged()).not.toContain(T)
    expect(logged()).not.toContain('jane')
  })
})

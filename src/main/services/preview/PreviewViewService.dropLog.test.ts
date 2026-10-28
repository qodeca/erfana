// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Drop point M4 through the service (issue #124, WI-5, P1-AC1; part 1 §1.2): a
 * bounds push for a panel with no live view. A push that races the panel's
 * open is expected and logs at info; one after its view was installed – and is
 * gone again – logs at warn. The live view is a stand-in: M4 is decided before
 * any view is reached, and the stand-in reads none of the per-view
 * collaborators. Split from `PreviewViewService.test.ts`, which is not grown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Every stand-in live view built, in order. */
const views = vi.hoisted(() => [] as Array<{ setBounds: (...args: unknown[]) => void }>)

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('./PreviewLiveView', () => ({
  PreviewLiveView: class {
    readonly panelId: string
    readonly projectPath: string
    readonly setBounds = vi.fn()
    readonly setZoomLevel = vi.fn()
    readonly setVisibility = vi.fn()
    readonly load = vi.fn(() => Promise.resolve())
    readonly teardown = vi.fn(() => Promise.resolve())

    constructor(params: { panelId: string; projectPath: string }) {
      this.panelId = params.panelId
      this.projectPath = params.projectPath
      views.push(this)
    }
  }
}))

import { logger } from '../LoggingService'
import { BOUNDS_DROP_MESSAGE } from '../../../shared/dropReporter'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import type { PreviewFailureEmit } from './PreviewFailureLog'
import { createPreviewFailureLog } from './PreviewFailureLog'
import type { PreviewSession, PreviewSessionLike, PreviewViewHandle } from './PreviewSessionFactory'
import { NO_VIEW_DROP_REASON } from './previewBoundsDropLog'
import {
  PreviewViewService,
  type PreviewViewDeps,
  type PreviewWindowLike
} from './PreviewViewService'

const PANEL = 'preview-a'
const OTHER_PANEL = 'preview-b'
const RECT = { x: 0, y: 0, width: 400, height: 300 }
/** {@link RECT} as a drop line carries it. */
const LOGGED_RECT = { x: 0, y: 0, w: 400, h: 300 }
const REQUEST = { panelId: PANEL, filePath: '/proj/a.html', bounds: RECT }
const WINDOW_ID = 1
const WINDOW = {
  id: WINDOW_ID,
  isDestroyed: () => false,
  contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 })
} as unknown as PreviewWindowLike

/** A built session; the stand-in view never touches it. */
function fakeSession(): PreviewSession {
  return {
    view: {
      webContents: { isDestroyed: () => false, destroy: vi.fn() }
    } as unknown as PreviewViewHandle,
    session: {} as PreviewSessionLike,
    token: 'deadbeefdeadbeefdeadbeefdeadbeef',
    realRoot: '/proj',
    partition: 'erfana-preview-test',
    teardown: vi.fn(),
    release: vi.fn(() => Promise.resolve())
  }
}

/** The service on fakes, with a hand-driven clock and sessions it can hold back. */
function makeHarness() {
  let clock = 0
  const create = vi.fn(() => Promise.resolve(fakeSession()))
  // Only what the service itself reads; the per-view collaborators go to the
  // stand-in live view, which ignores them.
  const deps = {
    sessionFactory: { create, forgetRecycled: vi.fn() },
    registry: { rebuildCsp: vi.fn(), revoke: vi.fn() },
    emit: { allowlistChanged: vi.fn(), loadStateChanged: vi.fn(), failuresChanged: vi.fn() },
    createFailureLog: (onEmit: PreviewFailureEmit) => createPreviewFailureLog({ onEmit }),
    getProjectPath: () => '/proj',
    getAllowedHosts: () => [],
    getZoomFactor: () => 1,
    now: () => clock
  } as unknown as PreviewViewDeps
  return {
    service: new PreviewViewService(deps),
    advance: (ms: number): void => {
      clock += ms
    },
    /** Hold the next session build until `release()`, so a push can race the open. */
    holdNextSession: (): { release: () => void } => {
      let release!: () => void
      create.mockImplementationOnce(
        () =>
          new Promise<PreviewSession>((resolve) => {
            release = () => resolve(fakeSession())
          })
      )
      return { release: () => release() }
    }
  }
}

/** Every info and warn line written so far, in the order written. */
function lines(): Array<{ level: 'info' | 'warn'; context: Record<string, unknown> | undefined }> {
  const { info, warn } = vi.mocked(logger)
  const written = [
    ...info.mock.calls.map(([message, context], i) => ({
      order: info.mock.invocationCallOrder[i],
      message,
      line: { level: 'info' as const, context }
    })),
    ...warn.mock.calls.map(([message, context], i) => ({
      order: warn.mock.invocationCallOrder[i],
      message,
      line: { level: 'warn' as const, context }
    }))
  ]
  expect(written.every(({ message }) => message === BOUNDS_DROP_MESSAGE)).toBe(true)
  return written.sort((a, b) => a.order - b.order).map(({ line }) => line)
}

/** The context of an M4 line for {@link PANEL}. */
function noViewLine(reason: string, seq: number): Record<string, unknown> {
  return { source: 'main', reason, panelId: stablePathDigest(PANEL), seq, rect: LOGGED_RECT }
}

beforeEach(() => {
  vi.clearAllMocks()
  views.length = 0
})

describe('PreviewViewService – M4, a push for a panel with no live view', () => {
  it('logs a push that races the open at info, then hands pushes to the installed view', async () => {
    const h = makeHarness()
    const session = h.holdNextSession()
    const opening = h.service.open(REQUEST, WINDOW)

    h.service.setBounds(PANEL, RECT, 1)
    expect(lines()).toEqual([
      { level: 'info', context: noViewLine(NO_VIEW_DROP_REASON.beforeInstall, 1) }
    ])

    session.release()
    await expect(opening).resolves.toEqual({ ok: true })
    h.service.setBounds(PANEL, RECT, 2, true)

    expect(views[0].setBounds).toHaveBeenCalledWith(RECT, 2, true)
    expect(lines()).toHaveLength(1)
  })

  it('logs a push after the installed view is gone at warn, even right after an info line', async () => {
    const h = makeHarness()
    const session = h.holdNextSession()
    const opening = h.service.open(REQUEST, WINDOW)
    h.service.setBounds(PANEL, RECT, 1)
    session.release()
    await opening

    // The view goes; the renderer's panel does not know yet.
    await h.service.destroyAll('test')
    h.service.setBounds(PANEL, RECT, 2)

    expect(lines()).toEqual([
      { level: 'info', context: noViewLine(NO_VIEW_DROP_REASON.beforeInstall, 1) },
      { level: 'warn', context: noViewLine(NO_VIEW_DROP_REASON.afterInstall, 2) }
    ])
  })

  it('caps repeats per panel, and panels do not share a cap', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST, WINDOW)
    await h.service.destroyAll('test')

    h.service.setBounds(PANEL, RECT, 1)
    h.service.setBounds(PANEL, RECT, 2)
    h.service.setBounds(OTHER_PANEL, RECT, 1)
    h.advance(PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS)
    h.service.setBounds(PANEL, RECT, 3)

    expect(lines().map((line) => line.context)).toEqual([
      noViewLine(NO_VIEW_DROP_REASON.afterInstall, 1),
      {
        ...noViewLine(NO_VIEW_DROP_REASON.beforeInstall, 1),
        panelId: stablePathDigest(OTHER_PANEL)
      },
      { ...noViewLine(NO_VIEW_DROP_REASON.afterInstall, 3), suppressed: 1 }
    ])
  })

  it('starts a fresh trail at info when the panel closes', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST, WINDOW)

    await h.service.close(PANEL)
    h.service.setBounds(PANEL, RECT, 1)

    expect(lines()).toEqual([
      { level: 'info', context: noViewLine(NO_VIEW_DROP_REASON.beforeInstall, 1) }
    ])
  })

  it('starts a fresh trail at info when the panel opens again', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST, WINDOW)
    await h.service.destroyAll('test')
    h.service.setBounds(PANEL, RECT, 1)

    const session = h.holdNextSession()
    const reopening = h.service.open(REQUEST, WINDOW)
    h.service.setBounds(PANEL, RECT, 2)
    session.release()
    await reopening

    // Inside one window, and still written: the reopen started a new trail.
    expect(lines()).toEqual([
      { level: 'warn', context: noViewLine(NO_VIEW_DROP_REASON.afterInstall, 1) },
      { level: 'info', context: noViewLine(NO_VIEW_DROP_REASON.beforeInstall, 2) }
    ])
  })

  it('forgets the panels of a window that closed', async () => {
    const h = makeHarness()
    await h.service.open(REQUEST, WINDOW)

    await h.service.closeWindow(WINDOW_ID)
    h.service.setBounds(PANEL, RECT, 1)

    expect(lines()).toEqual([
      { level: 'info', context: noViewLine(NO_VIEW_DROP_REASON.beforeInstall, 1) }
    ])
  })
})

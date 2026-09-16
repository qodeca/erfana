// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for one live view's bounds and main's bounds drop log (issue #124,
 * WI-5, P1-AC1; part 1 §1.2).
 *
 * A page that ends up over Erfana's own chrome must leave a trail naming the
 * step that dropped the update. These pin one line per drop point with its
 * fields – M5–M8 and M10 here, plus the reporter factory and the service's M4
 * memory from `previewBoundsDropLog.ts` – the rate cap on repeats, and that
 * logging changed nothing the view does with a push.
 *
 * @see previewLiveBounds.ts
 * @see previewBoundsDropLog.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { logger } from '../LoggingService'
import { BOUNDS_DROP_MESSAGE } from '../../../shared/dropReporter'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import type { PreviewBounds } from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import {
  LIVE_BOUNDS_DROP_REASON,
  NO_VIEW_DROP_REASON,
  createMainDropReporter,
  createNoViewDropLog
} from './previewBoundsDropLog'
import { createPreviewLiveBounds } from './previewLiveBounds'
import type { PreviewLiveViewDeps } from './previewLiveTypes'

const PANEL = 'preview-a'
/** {@link PANEL} as a drop line carries it. */
const LOGGED_PANEL = stablePathDigest(PANEL)
const WINDOW_MS = PREVIEW_LIMITS.BOUNDS_DROP_LOG_WINDOW_MS
const CONTENT = { x: 0, y: 0, width: 800, height: 600 }
const RECT: PreviewBounds = { x: 10, y: 20, width: 300, height: 200 }
/** {@link RECT} as a drop line carries it. */
const LOGGED_RECT = { x: 10, y: 20, w: 300, h: 200 }

/** One line written to the main logger. */
interface Line {
  level: 'info' | 'warn' | 'error'
  message: string
  context: Record<string, unknown> | undefined
  error?: Error
}

/** Every info, warn and error line written so far, in the order written. */
function lines(): Line[] {
  const { info, warn, error } = vi.mocked(logger)
  const written = [
    ...info.mock.calls.map(([message, context], i) => ({
      order: info.mock.invocationCallOrder[i],
      line: { level: 'info' as const, message, context }
    })),
    ...warn.mock.calls.map(([message, context], i) => ({
      order: warn.mock.invocationCallOrder[i],
      line: { level: 'warn' as const, message, context }
    })),
    ...error.mock.calls.map(([message, cause, context], i) => ({
      order: error.mock.invocationCallOrder[i],
      line: { level: 'error' as const, message, context, error: cause }
    }))
  ]
  return written.sort((a, b) => a.order - b.order).map(({ line }) => line)
}

/** A drop line of this module, as `lines()` returns it. */
function dropLine(level: Line['level'], context: Record<string, unknown>): Line {
  return { level, message: BOUNDS_DROP_MESSAGE, context: { source: 'main', panelId: LOGGED_PANEL, ...context } }
}

/** Let a resolved confirmation's continuation run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface SetupOptions {
  /** The zoom the view is sized with, whatever window the dep is handed. */
  zoom?: number
  /** The host window's own zoom; defaults to `zoom`. */
  hostZoom?: () => number
  /** The zoom dep itself; defaults to one that returns `zoom`. */
  readZoom?: PreviewLiveViewDeps['getZoomFactor']
}

/** One live view's bounds on fakes, a hand-driven clock and held repaints. */
function setup(options: SetupOptions = {}) {
  let clock = 0
  let defunct = false
  const zoom = options.zoom ?? 1
  const repaints: Array<(height: unknown) => void> = []
  const setBounds = vi.fn<(rect: PreviewBounds) => void>()
  const boundsApplied = vi.fn<(panelId: string, seq: number) => void>()
  const host = {
    getContentBounds: () => CONTENT,
    webContents: { getZoomFactor: options.hostZoom ?? (() => zoom) }
  }
  const bounds = createPreviewLiveBounds({
    panelId: PANEL,
    view: { setBounds },
    window: host,
    contents: {
      executeJavaScriptInIsolatedWorld: () =>
        new Promise((resolve) => {
          repaints.push(resolve)
        })
    },
    emit: { boundsApplied },
    getZoomFactor: options.readZoom ?? (() => zoom),
    isDefunct: () => defunct,
    now: () => clock
  })
  return {
    bounds,
    host,
    setBounds,
    boundsApplied,
    advance: (ms: number): void => {
      clock += ms
    },
    setDefunct: (value: boolean): void => {
      defunct = value
    },
    /** The page answers the oldest confirmation still waiting. */
    repaint: async (): Promise<void> => {
      repaints.shift()?.(CONTENT.height)
      await settle()
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPreviewLiveBounds – a push that is not dropped', () => {
  it('applies a fresh push in DIPs, remembers it, and logs nothing', () => {
    const h = setup({ zoom: 2 })

    h.bounds.apply(RECT, 1, false)

    const dip = { x: 20, y: 40, width: 600, height: 400 }
    expect(h.setBounds).toHaveBeenCalledWith(dip)
    expect(h.bounds.lastRect()).toEqual(dip)
    expect(lines()).toEqual([])
  })

  it('sizes the view with the zoom it reads from its own host window (C3)', () => {
    const readZoom = vi.fn<PreviewLiveViewDeps['getZoomFactor']>((window) =>
      window.webContents.getZoomFactor()
    )
    const h = setup({ hostZoom: () => 2, readZoom })

    h.bounds.apply(RECT, 1, false)

    expect(readZoom).toHaveBeenCalledWith(h.host)
    expect(h.setBounds).toHaveBeenCalledWith({ x: 20, y: 40, width: 600, height: 400 })
    expect(lines()).toEqual([])
  })

  it('confirms a push that asked for it once the page has repainted', async () => {
    const h = setup()

    h.bounds.apply(RECT, 1, true)
    expect(h.boundsApplied).not.toHaveBeenCalled()
    await h.repaint()

    expect(h.boundsApplied).toHaveBeenCalledWith(PANEL, 1)
    expect(lines()).toEqual([])
  })

  it('places the construction-time rect without a sequence number', () => {
    const h = setup()

    h.bounds.place(RECT)
    // A first push with seq 0 is still fresh: placing spent no seq.
    h.bounds.apply(RECT, 0, false)

    expect(h.setBounds).toHaveBeenCalledTimes(2)
    expect(lines()).toEqual([])
  })
})

describe('createPreviewLiveBounds – drop points', () => {
  it('M5: drops a push for a defunct view at info, before any seq was accepted', () => {
    const h = setup()
    h.setDefunct(true)

    h.bounds.apply(RECT, 3, false)

    expect(h.setBounds).not.toHaveBeenCalled()
    expect(lines()).toEqual([
      dropLine('info', { reason: LIVE_BOUNDS_DROP_REASON.viewDefunct, seq: 3, rect: LOGGED_RECT })
    ])
  })

  it('M5: names the last accepted seq once there is one', () => {
    const h = setup()
    h.bounds.apply(RECT, 1, false)
    h.setDefunct(true)

    h.bounds.apply(RECT, 2, false)

    expect(lines()).toEqual([
      dropLine('info', {
        reason: LIVE_BOUNDS_DROP_REASON.viewDefunct,
        seq: 2,
        lastSeq: 1,
        rect: LOGGED_RECT
      })
    ])
  })

  it('M6: drops a stale push at warn, naming both sequence numbers', () => {
    const h = setup()
    h.bounds.apply(RECT, 5, false)

    h.bounds.apply({ ...RECT, x: 99 }, 4, false)

    expect(h.setBounds).toHaveBeenCalledTimes(1)
    expect(lines()).toEqual([
      dropLine('warn', {
        reason: LIVE_BOUNDS_DROP_REASON.staleSeq,
        seq: 4,
        lastSeq: 5,
        rect: { ...LOGGED_RECT, x: 99 }
      })
    ])
  })

  it('M7: drops a rect that clamps to nothing at warn, rounded, and still spends its seq', () => {
    const h = setup()
    h.bounds.apply(RECT, 1, false)

    h.bounds.apply({ x: 900.4, y: 0, width: 100.6, height: 100 }, 2, false)
    // The seq was spent, so the same seq again is stale (behaviour unchanged).
    h.bounds.apply(RECT, 2, false)

    expect(h.setBounds).toHaveBeenCalledTimes(1)
    expect(h.bounds.lastRect()).toEqual(RECT)
    expect(lines()).toEqual([
      dropLine('warn', {
        reason: LIVE_BOUNDS_DROP_REASON.clampedEmpty,
        seq: 2,
        lastSeq: 1,
        rect: { x: 900, y: 0, w: 101, h: 100 }
      }),
      dropLine('warn', {
        reason: LIVE_BOUNDS_DROP_REASON.staleSeq,
        seq: 2,
        lastSeq: 2,
        rect: LOGGED_RECT
      })
    ])
  })

  it('M7: logs a construction-time rect that clamps to nothing, with no seq', () => {
    const h = setup()

    h.bounds.place({ x: 0, y: 700, width: 100, height: 100 })

    expect(h.setBounds).not.toHaveBeenCalled()
    expect(h.bounds.lastRect()).toBeNull()
    expect(lines()).toEqual([
      dropLine('warn', {
        reason: LIVE_BOUNDS_DROP_REASON.clampedEmpty,
        rect: { x: 0, y: 700, w: 100, h: 100 }
      })
    ])
  })

  it('M8: logs a confirmation a newer push overtook, and confirms only the newer one', async () => {
    const h = setup()
    h.bounds.apply(RECT, 1, true)
    h.bounds.apply({ ...RECT, y: 40 }, 2, true)

    await h.repaint()
    expect(h.boundsApplied).not.toHaveBeenCalled()
    await h.repaint()

    expect(h.boundsApplied).toHaveBeenCalledTimes(1)
    expect(h.boundsApplied).toHaveBeenCalledWith(PANEL, 2)
    expect(lines()).toEqual([
      dropLine('info', { reason: LIVE_BOUNDS_DROP_REASON.ackSuperseded, seq: 1, lastSeq: 2 })
    ])
  })

  it('M5: logs a confirmation that finds the view defunct, and confirms nothing', async () => {
    const h = setup()
    h.bounds.apply(RECT, 1, true)
    h.setDefunct(true)

    await h.repaint()

    expect(h.boundsApplied).not.toHaveBeenCalled()
    expect(lines()).toEqual([
      dropLine('info', { reason: LIVE_BOUNDS_DROP_REASON.viewDefunct, seq: 1, lastSeq: 1 })
    ])
  })

  // M10 is a tripwire after C3 (WI-9): only a zoom dep that ignores its host –
  // `setup`'s default against a different `hostZoom` – can trip it.
  it('M10: warns when the zoom used is not the host window’s, and still applies the rect', () => {
    const h = setup({ zoom: 1, hostZoom: () => 1.25 })

    h.bounds.apply(RECT, 1, false)

    expect(h.setBounds).toHaveBeenCalledWith(RECT)
    expect(lines()).toEqual([
      dropLine('warn', { reason: LIVE_BOUNDS_DROP_REASON.zoomMismatch, seq: 1, rect: LOGGED_RECT })
    ])
  })

  it('M10: checks the construction-time placement too, with no seq', () => {
    const h = setup({ zoom: 1.5, hostZoom: () => 1 })

    h.bounds.place(RECT)

    expect(h.setBounds).toHaveBeenCalledTimes(1)
    expect(lines()).toEqual([
      dropLine('warn', { reason: LIVE_BOUNDS_DROP_REASON.zoomMismatch, rect: LOGGED_RECT })
    ])
  })

  it.each([
    ['the zooms match', { zoom: 1.25 }],
    [
      'the host page is gone',
      {
        hostZoom: (): number => {
          throw new Error('Object has been destroyed')
        }
      }
    ]
  ] satisfies Array<[string, SetupOptions]>)('M10: logs nothing when %s', (_case, options) => {
    const h = setup(options)

    h.bounds.apply(RECT, 1, false)

    expect(h.setBounds).toHaveBeenCalledTimes(1)
    expect(lines()).toEqual([])
  })
})

describe('createPreviewLiveBounds – the rate cap', () => {
  it('writes the first drop of a reason, then one per window carrying the swallowed count', () => {
    const h = setup()
    h.bounds.apply(RECT, 5, false)

    h.bounds.apply(RECT, 1, false)
    h.bounds.apply(RECT, 2, false)
    h.bounds.apply(RECT, 3, false)
    h.advance(WINDOW_MS)
    h.bounds.apply(RECT, 4, false)

    expect(lines().map((line) => line.context)).toEqual([
      expect.objectContaining({ reason: LIVE_BOUNDS_DROP_REASON.staleSeq, seq: 1 }),
      expect.objectContaining({ reason: LIVE_BOUNDS_DROP_REASON.staleSeq, seq: 4, suppressed: 2 })
    ])
  })

  it('gives every reason its own first line inside one window', () => {
    const h = setup()
    h.bounds.apply(RECT, 5, false)
    h.bounds.apply(RECT, 1, false)

    h.setDefunct(true)
    h.bounds.apply(RECT, 6, false)

    expect(lines().map((line) => line.context?.reason)).toEqual([
      LIVE_BOUNDS_DROP_REASON.staleSeq,
      LIVE_BOUNDS_DROP_REASON.viewDefunct
    ])
  })
})

describe('createMainDropReporter', () => {
  it('writes an error line with the error in hand', () => {
    const failure = new Error('boom')
    const drops = createMainDropReporter({ now: () => 0, errorOf: () => failure })

    drops.report({ reason: 'handler-threw', level: 'error', panelId: PANEL })

    expect(lines()).toEqual([
      { ...dropLine('error', { reason: 'handler-threw' }), error: failure }
    ])
  })

  it('runs on its own clock when none is given', () => {
    const drops = createMainDropReporter()

    drops.report({ reason: 'stale-seq', level: 'warn' })
    drops.report({ reason: 'stale-seq', level: 'warn' })

    expect(lines()).toEqual([
      { level: 'warn', message: BOUNDS_DROP_MESSAGE, context: { source: 'main', reason: 'stale-seq' } }
    ])
  })
})

describe('createNoViewDropLog (M4)', () => {
  /** A no-view log on a hand-driven clock. */
  function noView() {
    let clock = 0
    return {
      log: createNoViewDropLog(() => clock),
      advance: (ms: number): void => {
        clock += ms
      }
    }
  }

  it('logs a push before the panel’s view is installed at info', () => {
    const { log } = noView()

    log.report(PANEL, RECT, 1)

    expect(lines()).toEqual([
      dropLine('info', { reason: NO_VIEW_DROP_REASON.beforeInstall, seq: 1, rect: LOGGED_RECT })
    ])
  })

  it('logs a push after the view was installed at warn, even right after an info line', () => {
    const { log } = noView()
    log.report(PANEL, RECT, 1)

    log.installed(PANEL)
    log.report(PANEL, RECT, 2)

    expect(lines()).toEqual([
      dropLine('info', { reason: NO_VIEW_DROP_REASON.beforeInstall, seq: 1, rect: LOGGED_RECT }),
      dropLine('warn', { reason: NO_VIEW_DROP_REASON.afterInstall, seq: 2, rect: LOGGED_RECT })
    ])
  })

  it('starts a forgotten panel on a fresh trail, at info', () => {
    const { log } = noView()
    log.installed(PANEL)
    log.report(PANEL, RECT, 1)
    log.report(PANEL, RECT, 2)

    log.forget(PANEL)
    log.report(PANEL, RECT, 3)

    expect(lines().map((line) => [line.level, line.context?.seq])).toEqual([
      ['warn', 1],
      ['info', 3]
    ])
  })

  it('keeps one scope per panel', () => {
    const { log, advance } = noView()
    log.report(PANEL, RECT, 1)
    log.report(PANEL, RECT, 2)
    log.report('preview-b', RECT, 1)
    advance(WINDOW_MS)
    log.report(PANEL, RECT, 3)

    expect(lines().map((line) => line.context)).toEqual([
      expect.objectContaining({ panelId: LOGGED_PANEL, seq: 1 }),
      expect.objectContaining({ panelId: stablePathDigest('preview-b'), seq: 1 }),
      expect.objectContaining({ panelId: LOGGED_PANEL, seq: 3, suppressed: 1 })
    ])
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the bounded teardown of one live preview view (issue #124, WI-1;
 * QG-8 TQ1 — the module had no cover at all).
 *
 * The contract these pin: every step is isolated, so a step that throws or
 * overruns `PREVIEW.TEARDOWN_STEP_TIMEOUT_MS` is logged and every LATER step
 * still runs; the page is destroyed whatever happened before it; the cage is
 * detached only after the page is dead, and the partition handed back only
 * after a clean detach. Log lines carry a DIGESTED panel id and the error's
 * name (plus `code`), never its message and never a path (QG-7 S3).
 *
 * @see previewLiveTeardown.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import type { PreviewViewHandle } from './PreviewSessionFactory'
import {
  teardownLiveView,
  unwindConstruction,
  type PreviewLiveTeardownParts,
  type PreviewTeardownStep
} from './previewLiveTeardown'

/** A path-shaped panel id, so a leaked raw id is visible in an assertion. */
const PANEL_ID = 'preview-/Users/reader/Secret Project/page.html'
const DIGEST = stablePathDigest(PANEL_ID)

interface WcMock {
  isDestroyed: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}

function makeWc(overrides: Partial<WcMock> = {}): WcMock {
  return {
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
    ...overrides
  }
}

interface Parts {
  parts: PreviewLiveTeardownParts
  wc: WcMock
  removeChildView: ReturnType<typeof vi.fn>
  onClosing: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
}

function makeParts(
  collaborators: readonly PreviewTeardownStep[],
  overrides: {
    mode?: PreviewLiveTeardownParts['mode']
    windowDestroyed?: boolean
    wc?: WcMock
    detach?: ReturnType<typeof vi.fn>
    release?: ReturnType<typeof vi.fn>
  } = {}
): Parts {
  const wc = overrides.wc ?? makeWc()
  const removeChildView = vi.fn()
  const onClosing = vi.fn()
  const detach = overrides.detach ?? vi.fn()
  const release = overrides.release ?? vi.fn(async () => {})
  const view = { webContents: wc } as unknown as PreviewViewHandle

  return {
    wc,
    removeChildView,
    onClosing,
    detach,
    release,
    parts: {
      panelId: PANEL_ID,
      mode: overrides.mode ?? 'immediate',
      window: {
        isDestroyed: () => overrides.windowDestroyed === true,
        contentView: {
          removeChildView
        } as unknown as PreviewLiveTeardownParts['window']['contentView']
      },
      view,
      wc,
      collaborators,
      onClosing,
      detach,
      release
    }
  }
}

/** The warn calls whose message starts with `prefix`. */
function warnsMatching(prefix: string): [string, Record<string, unknown>][] {
  return vi.mocked(logger.warn).mock.calls.filter(call => String(call[0]).startsWith(prefix)) as [
    string,
    Record<string, unknown>
  ][]
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('teardownLiveView: step isolation', () => {
  it('runs every later step after a middle step throws, destroys the page, logs once', async () => {
    const order: string[] = []
    const boom = new Error('open /Users/reader/Secret Project/page.html failed')
    boom.name = 'StepError'
    const { parts, wc, removeChildView } = makeParts([
      { label: 'first', run: () => void order.push('first') },
      {
        label: 'second',
        run: () => {
          order.push('second')
          throw boom
        }
      },
      { label: 'third', run: () => void order.push('third') }
    ])

    await teardownLiveView(parts)

    expect(order).toEqual(['first', 'second', 'third'])
    expect(removeChildView).toHaveBeenCalledTimes(1)
    expect(wc.destroy).toHaveBeenCalledTimes(1)

    const warns = warnsMatching('Preview teardown step failed')
    expect(warns).toHaveLength(1)
    expect(warns[0][1]).toEqual({ panelId: DIGEST, step: 'second', error: 'StepError' })
    // The digest, never the readable id, and never the error's message.
    expect(JSON.stringify(warns[0][1])).not.toContain('Secret Project')
    expect(JSON.stringify(warns[0][1])).not.toContain(boom.message)
  })

  it("carries an errno error's `code` and nothing else", async () => {
    const errno = Object.assign(new Error('EBUSY: /Users/reader/x'), { code: 'EBUSY' })
    const { parts } = makeParts([
      {
        label: 'purge',
        run: () => {
          throw errno
        }
      }
    ])

    await teardownLiveView(parts)

    expect(warnsMatching('Preview teardown step failed')[0][1]).toEqual({
      panelId: DIGEST,
      step: 'purge',
      error: 'Error',
      code: 'EBUSY'
    })
  })

  it('names the type when a step throws a non-Error', async () => {
    const { parts } = makeParts([
      {
        label: 'odd',
        run: () => {
          throw 'a string'
        }
      }
    ])

    await teardownLiveView(parts)

    expect(warnsMatching('Preview teardown step failed')[0][1]).toEqual({
      panelId: DIGEST,
      step: 'odd',
      error: 'string'
    })
  })

  it('skips removeChildView when the window is already gone', async () => {
    const { parts, removeChildView, wc } = makeParts([], { windowDestroyed: true })

    await teardownLiveView(parts)

    expect(removeChildView).not.toHaveBeenCalled()
    expect(wc.destroy).toHaveBeenCalledTimes(1)
  })

  it('logs and continues when leaving the window throws on a LIVE window', async () => {
    const order: string[] = []
    const { parts, removeChildView, wc } = makeParts([
      { label: 'after', run: () => void order.push('after') }
    ])
    removeChildView.mockImplementation(() => {
      throw new Error('detached already')
    })

    await teardownLiveView(parts)

    expect(order).toEqual(['after'])
    expect(wc.destroy).toHaveBeenCalledTimes(1)
    expect(warnsMatching('Preview teardown step failed')[0][1]).toMatchObject({
      step: 'removeChildView'
    })
  })

  it('leaves an already-destroyed page alone in immediate mode', async () => {
    const wc = makeWc({ isDestroyed: vi.fn(() => true) })
    const { parts } = makeParts([], { wc })

    await teardownLiveView(parts)

    expect(wc.destroy).not.toHaveBeenCalled()
  })
})

describe('teardownLiveView: an async step that overruns', () => {
  it('logs a timeout and still destroys the page and runs the later steps', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const { parts, wc } = makeParts([
      { label: 'storageSeal.purge', runAsync: () => new Promise<void>(() => {}) },
      { label: 'after', run: () => void order.push('after') }
    ])

    const done = teardownLiveView(parts)
    await vi.advanceTimersByTimeAsync(PREVIEW.TEARDOWN_STEP_TIMEOUT_MS)
    await done

    expect(order).toEqual(['after'])
    expect(wc.destroy).toHaveBeenCalledTimes(1)
    expect(warnsMatching('Preview teardown step failed')[0][1]).toEqual({
      panelId: DIGEST,
      step: 'storageSeal.purge',
      error: 'TimeoutError'
    })
  })

  it('awaits an async step that settles in time and logs nothing', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const { parts } = makeParts([
      {
        label: 'lifecycle.dispose',
        runAsync: async () => {
          await Promise.resolve()
          order.push('lifecycle')
        }
      },
      { label: 'after', run: () => void order.push('after') }
    ])

    await teardownLiveView(parts)

    expect(order).toEqual(['lifecycle', 'after'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a rejected async step by name and carries on', async () => {
    const rejection = new Error('chokidar close failed for /Users/reader/x')
    rejection.name = 'CloseError'
    const { parts, wc } = makeParts([
      { label: 'watch.dispose', runAsync: () => Promise.reject(rejection) }
    ])

    await teardownLiveView(parts)

    expect(wc.destroy).toHaveBeenCalledTimes(1)
    expect(warnsMatching('Preview teardown step failed')[0][1]).toEqual({
      panelId: DIGEST,
      step: 'watch.dispose',
      error: 'CloseError'
    })
  })
})

describe('teardownLiveView: bounded destroy', () => {
  it("announces the close, then resolves on the page's own destroyed event", async () => {
    vi.useFakeTimers()
    let destroyed: (() => void) | undefined
    const wc = makeWc({
      once: vi.fn((_event: string, listener: () => void) => {
        destroyed = listener
      }),
      close: vi.fn(() => destroyed?.())
    })
    const { parts, onClosing } = makeParts([], { mode: 'bounded', wc })

    await teardownLiveView(parts)

    expect(onClosing).toHaveBeenCalledTimes(1)
    expect(wc.close).toHaveBeenCalledTimes(1)
    expect(wc.destroy).not.toHaveBeenCalled()
  })

  it('forces destroy once CLOSE_TIMEOUT_MS passes with no destroyed event', async () => {
    vi.useFakeTimers()
    const wc = makeWc()
    const { parts } = makeParts([], { mode: 'bounded', wc })

    const done = teardownLiveView(parts)
    await vi.advanceTimersByTimeAsync(PREVIEW.CLOSE_TIMEOUT_MS)
    await done

    expect(wc.close).toHaveBeenCalledTimes(1)
    expect(wc.destroy).toHaveBeenCalledTimes(1)
  })

  it('falls back to destroy when close() throws', async () => {
    const wc = makeWc({
      close: vi.fn(() => {
        throw new Error('already closing')
      })
    })
    const { parts } = makeParts([], { mode: 'bounded', wc })

    await teardownLiveView(parts)

    expect(wc.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('teardownLiveView: detach and hand-back', () => {
  it('detaches the cage only after the page is destroyed, then hands the partition back', async () => {
    const order: string[] = []
    const wc = makeWc({ destroy: vi.fn(() => void order.push('destroy')) })
    const { parts } = makeParts([], {
      wc,
      detach: vi.fn(() => void order.push('detach')),
      release: vi.fn(async () => void order.push('release'))
    })

    await teardownLiveView(parts)

    expect(order).toEqual(['destroy', 'detach', 'release'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  // The egress-window invariant (previewLiveTeardown.ts, step 4) in bounded mode:
  // with no `destroyed` event the cage stays attached until the forced destroy.
  const throwingStep: PreviewTeardownStep = {
    label: 'boom',
    run: () => {
      throw new Error('boom')
    }
  }
  it.each([
    ['no collaborators', []],
    ['a collaborator that throws', [throwingStep]]
  ])('bounded, forced destroy: detaches only after destroy (%s)', async (_name, collaborators) => {
    vi.useFakeTimers()
    const order: string[] = []
    const { parts, detach, release } = makeParts(collaborators, {
      mode: 'bounded',
      wc: makeWc({ destroy: vi.fn(() => void order.push('destroy')) }),
      detach: vi.fn(() => void order.push('detach')),
      release: vi.fn(async () => void order.push('release'))
    })

    const done = teardownLiveView(parts)
    await vi.advanceTimersByTimeAsync(PREVIEW.CLOSE_TIMEOUT_MS - 1)
    expect(detach).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(order).toEqual(['destroy', 'detach', 'release'])
  })

  it('drops the partition name when detach throws: no release, one warn', async () => {
    const detachError = new Error('protocol handler for /Users/reader/x is gone')
    detachError.name = 'DetachError'
    const release = vi.fn(async () => {})
    const { parts } = makeParts([], {
      detach: vi.fn(() => {
        throw detachError
      }),
      release
    })

    await expect(teardownLiveView(parts)).resolves.toBeUndefined()

    expect(release).not.toHaveBeenCalled()
    const warns = warnsMatching('Preview teardown: detach failed')
    expect(warns).toHaveLength(1)
    expect(warns[0][1]).toEqual({ panelId: DIGEST, error: 'DetachError' })
  })

  it('warns and never throws when release() rejects', async () => {
    const releaseError = new Error('purge of /Users/reader/x never settled')
    releaseError.name = 'ReleaseError'
    const { parts, wc } = makeParts([], { release: vi.fn(() => Promise.reject(releaseError)) })

    await expect(teardownLiveView(parts)).resolves.toBeUndefined()

    expect(wc.destroy).toHaveBeenCalledTimes(1)
    const warns = warnsMatching('Preview teardown: partition hand-back failed')
    expect(warns).toHaveLength(1)
    expect(warns[0][1]).toEqual({ panelId: DIGEST, error: 'ReleaseError' })
    expect(JSON.stringify(warns[0][1])).not.toContain('/Users/reader')
  })
})

describe('unwindConstruction', () => {
  it('disposes what was built, in order, skipping what the constructor never reached', async () => {
    const order: string[] = []
    await unwindConstruction(PANEL_ID, {
      lifecycle: { dispose: () => void order.push('lifecycle') },
      watch: undefined,
      bounds: { dispose: async () => void order.push('bounds') }
    })

    expect(order).toEqual(['lifecycle', 'bounds'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a throwing disposer and still runs the later ones', async () => {
    const order: string[] = []
    const boom = new Error('dispose of /Users/reader/x failed')
    boom.name = 'DisposeError'

    await unwindConstruction(PANEL_ID, {
      lifecycle: {
        dispose: () => {
          throw boom
        }
      },
      bounds: { dispose: () => void order.push('bounds') }
    })

    expect(order).toEqual(['bounds'])
    const warns = warnsMatching('Preview construction unwind step failed')
    expect(warns).toHaveLength(1)
    expect(warns[0][1]).toEqual({
      panelId: DIGEST,
      step: 'lifecycle.dispose',
      error: 'DisposeError'
    })
    expect(JSON.stringify(warns[0][1])).not.toContain('/Users/reader')
  })

  it('bounds a disposer that never settles and carries on', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const done = unwindConstruction(PANEL_ID, {
      lifecycle: { dispose: () => new Promise<void>(() => {}) },
      bounds: { dispose: () => void order.push('bounds') }
    })
    await vi.advanceTimersByTimeAsync(PREVIEW.TEARDOWN_STEP_TIMEOUT_MS)
    await done

    expect(order).toEqual(['bounds'])
    expect(warnsMatching('Preview construction unwind step failed')[0][1]).toEqual({
      panelId: DIGEST,
      step: 'lifecycle.dispose',
      error: 'TimeoutError'
    })
  })
})

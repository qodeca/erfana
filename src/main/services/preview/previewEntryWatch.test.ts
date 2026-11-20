// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The watch on a live view's page, which follows a same-tab move (issue #124,
 * WI-17b; part 3 §3.4). The watcher factory is a fake that hands each watcher's
 * handlers back, so a late event from a closed watcher can be delivered. A
 * deleted page coming back (#450) is reported by the tracked watch itself
 * (`freshness/mainTrackedWatch.test.ts`); here it is one more `onChange`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import type { CheckReason } from '../../../shared/freshness/freshnessTypes'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { createPreviewEntryWatch, entryProblemFailure, type PreviewEntryWatcherFactory } from './previewEntryWatch'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Handlers = Parameters<PreviewEntryWatcherFactory>[1]

/** A real panel id's shape: the page's lower-cased path. */
const PANEL_ID = 'preview-/proj/a.html'
/** What the log lines carry instead (QG-7 S3). */
const LOGGED_PANEL_ID = stablePathDigest(PANEL_ID)

interface FakeWatcher {
  readonly path: string
  readonly handlers: Handlers
  readonly close: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly check: ReturnType<typeof vi.fn<(reason: CheckReason) => void>>
  readonly setVisible: ReturnType<typeof vi.fn<(visible: boolean) => void>>
}

function makeHarness() {
  const watchers: FakeWatcher[] = []
  const createEntryWatcher = vi.fn<PreviewEntryWatcherFactory>((path, handlers) => {
    const watcher: FakeWatcher = {
      path,
      handlers,
      close: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      check: vi.fn<(reason: CheckReason) => void>(),
      setVisible: vi.fn<(visible: boolean) => void>()
    }
    watchers.push(watcher)
    return watcher
  })
  const onChange = vi.fn<() => void>()
  const onDeleted = vi.fn<() => void>()
  const onProblem = vi.fn()
  const watch = createPreviewEntryWatch({
    panelId: PANEL_ID,
    initialPath: '/proj/a.html',
    createEntryWatcher,
    onChange,
    onDeleted,
    onProblem
  })
  return { watch, watchers, createEntryWatcher, onChange, onDeleted, onProblem }
}

describe('previewEntryWatch — the first page', () => {
  it('watches the page at once and reports a save and an unlink', () => {
    const { watchers, onChange, onDeleted } = makeHarness()

    expect(watchers.map((watcher) => watcher.path)).toEqual(['/proj/a.html'])
    watchers[0].handlers.onChange()
    watchers[0].handlers.onUnlink()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  it('logs a watcher error by name and code, the file name redacted, and reports no failure', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { watchers, onChange, onDeleted } = makeHarness()

    watchers[0].handlers.onError(Object.assign(new Error('EMFILE'), { code: 'EMFILE' }))
    watchers[0].handlers.onError(new TypeError('watch failed'))
    watchers[0].handlers.onError('not an error')

    const line = { panelId: LOGGED_PANEL_ID, path: '[redacted]/a.html' }
    expect(warn.mock.calls).toEqual([
      ['Preview entry watcher error', { ...line, error: 'Error', code: 'EMFILE' }],
      ['Preview entry watcher error', { ...line, error: 'TypeError' }],
      ['Preview entry watcher error', { ...line, error: 'string' }]
    ])
    expect(onChange).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('never logs a watcher message that carries the path (QG-7 S4)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { watchers } = makeHarness()
    const leak = "EMFILE: too many open files, watch '/proj/a.html'"

    watchers[0].handlers.onError(Object.assign(new Error(leak), { code: 'EMFILE', errno: -24 }))

    const [[, context]] = warn.mock.calls
    expect(context).toEqual({
      panelId: LOGGED_PANEL_ID,
      path: '[redacted]/a.html',
      error: 'Error',
      code: 'EMFILE'
    })
    expect(context).not.toHaveProperty('message')
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/\/proj|too many open files/)
  })

  it('lets a throwing factory throw: the construction unwinds it', () => {
    expect(() =>
      createPreviewEntryWatch({
        panelId: 'panel-A',
        initialPath: '/proj/a.html',
        createEntryWatcher: () => {
          throw new Error('Object has been destroyed')
        },
        onChange: vi.fn(),
        onDeleted: vi.fn()
      })
    ).toThrow('Object has been destroyed')
  })
})

describe('previewEntryWatch — retarget', () => {
  it('closes the old watcher, watches the new page, and ignores the old one late', () => {
    const { watch, watchers, onChange, onDeleted } = makeHarness()

    watch.retarget('/proj/b.html')

    expect(watchers.map((watcher) => watcher.path)).toEqual(['/proj/a.html', '/proj/b.html'])
    expect(watchers[0].close).toHaveBeenCalledTimes(1)
    // A late event from the page the tab left changes nothing on the page it shows.
    watchers[0].handlers.onChange()
    watchers[0].handlers.onUnlink()
    expect(onChange).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()

    watchers[1].handlers.onChange()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does nothing for the page already watched', () => {
    const { watch, watchers } = makeHarness()

    watch.retarget('/proj/a.html')

    expect(watchers).toHaveLength(1)
    expect(watchers[0].close).not.toHaveBeenCalled()
  })

  it('logs an old watcher that fails to close, by error name only', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { watch, watchers } = makeHarness()
    watchers[0].close.mockImplementationOnce(() =>
      Promise.reject(new TypeError('/proj/a.html is gone'))
    )

    watch.retarget('/proj/b.html')

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Preview entry watcher did not close', {
        panelId: LOGGED_PANEL_ID,
        path: '[redacted]/a.html',
        error: 'TypeError'
      })
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/proj')
  })

  it('keeps the page on screen when the new watcher cannot open, and silences the old one', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { watch, watchers, createEntryWatcher, onChange } = makeHarness()
    createEntryWatcher.mockImplementationOnce(() => {
      throw new Error("EMFILE: too many open files, watch '/proj/b.html'")
    })

    watch.retarget('/proj/b.html')

    expect(warn).toHaveBeenCalledWith('Preview entry watcher could not follow the page', {
      panelId: LOGGED_PANEL_ID,
      path: '[redacted]/b.html',
      error: 'Error'
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/proj')
    watchers[0].handlers.onChange()
    expect(onChange).not.toHaveBeenCalled()
    // The next move gets a watcher again.
    watch.retarget('/proj/c.html')
    expect(watchers.at(-1)?.path).toBe('/proj/c.html')
  })
})

describe('previewEntryWatch — dispose', () => {
  it('closes the watcher once and reports nothing afterwards', async () => {
    const { watch, watchers, onChange } = makeHarness()

    await watch.dispose()
    await watch.dispose()
    watch.retarget('/proj/b.html')
    watchers[0].handlers.onChange()

    expect(watchers[0].close).toHaveBeenCalledTimes(1)
    expect(watchers).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('passes a failed close on, so the teardown step logs it', async () => {
    const { watch, watchers } = makeHarness()
    watchers[0].close.mockImplementationOnce(() => Promise.reject(new Error('close failed')))

    await expect(watch.dispose()).rejects.toThrow('close failed')
  })

  it('has nothing to close when the last retarget could not open a watcher', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { watch, createEntryWatcher } = makeHarness()
    createEntryWatcher.mockImplementationOnce(() => {
      throw new Error('EMFILE')
    })
    watch.retarget('/proj/b.html')

    await expect(watch.dispose()).resolves.toBeUndefined()
  })
})

describe('previewEntryWatch — the tracked watch (#478 S17)', () => {
  it('passes a watch problem on for the badge, and drops one from a watcher it left', () => {
    const { watch, watchers, onProblem } = makeHarness()
    watchers[0].handlers.onProblem?.('stopped')
    expect(onProblem).toHaveBeenCalledWith('stopped')

    watch.retarget('/proj/b.html')
    watchers[0].handlers.onProblem?.('unreadable')
    expect(onProblem).toHaveBeenCalledTimes(1)
  })

  it('tells the current watcher when the view is shown or hidden, and checks it on demand', async () => {
    const { watch, watchers } = makeHarness()
    watch.setVisible(false)
    watch.setVisible(true)
    watch.check('focus')
    expect(watchers[0].setVisible.mock.calls).toEqual([[false], [true]])
    expect(watchers[0].check).toHaveBeenCalledWith('focus')

    await watch.dispose()
    watch.setVisible(true)
    watch.check('focus')
    expect(watchers[0].setVisible).toHaveBeenCalledTimes(2)
    expect(watchers[0].check).toHaveBeenCalledTimes(1)
  })

  it('works with a plain watcher that cannot check (a suite fake)', () => {
    const watch = createPreviewEntryWatch({
      panelId: PANEL_ID,
      initialPath: '/proj/a.html',
      createEntryWatcher: () => ({ close: () => Promise.resolve() }),
      onChange: vi.fn(),
      onDeleted: vi.fn()
    })
    expect(() => {
      watch.setVisible(true)
      watch.check('resume')
    }).not.toThrow()
  })

  it('names the page file only, never its folder, in the badge entry of each problem (§ 3.6)', () => {
    expect(entryProblemFailure('stopped', '/proj/site/index.html')).toEqual({
      type: 'auto-refresh-stopped',
      resourceUrlOrHost: 'index.html',
      reasonCode: ErrorCode.UNKNOWN_ERROR
    })
    expect(entryProblemFailure('queued', '/proj/index.html').type).toBe('watch-limit')
    // A page on a network drive or WSL (G7 × C5)
    expect(entryProblemFailure('limited', '//server/share/site/index.html')).toEqual({
      type: 'live-refresh-limited',
      resourceUrlOrHost: 'index.html',
      reasonCode: ErrorCode.UNKNOWN_ERROR
    })
    expect(entryProblemFailure('unreadable', '/proj/index.html')).toMatchObject({
      type: 'file-unreadable',
      reasonCode: ErrorCode.PATH_NOT_ACCESSIBLE
    })
  })
})

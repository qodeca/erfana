// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The image adapter's degraded states (#478, plan S15; F1, F33, G5, G7):
 * an image grown past the read limit, a refused watch, a limited watch, and a
 * project that closed (quiet – not "unavailable").
 *
 * @module useFileChangeSubscription.degraded.test
 */
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  TOO_LARGE_MB,
  WATCHED_PATH,
  installImageWatchHarness,
  openImageTab
} from './__test__/fileWatchHarness'
import { imageReadFailure } from './useFileChangeSubscription'

const SETTLED_MS = 3_000

const h = installImageWatchHarness()

describe('useFileChangeSubscription – degraded states', () => {
  it('an image grown past the limit is unavailable, with its size', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h)

    h.disk.block(WATCHED_PATH, 'too-large')
    h.disk.write(WATCHED_PATH, 'png-huge')
    await h.run(SETTLED_MS)

    expect(tab.hook.result.current.state.content).toEqual({ kind: 'unavailable', reason: 'too-large' })
    expect(tab.hook.result.current.tooLargeSize).toBe(TOO_LARGE_MB * 1024 * 1024)
    expect(tab.onBytes).not.toHaveBeenCalled()
  })

  it('a watch that cannot start is reported as unavailable (G5)', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    h.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' }, { kind: 'refused', code: 'WATCH_FAILED' })
    const tab = await openImageTab(h)
    await h.run(SETTLED_MS)

    expect(tab.hook.result.current.isWatchUnavailable).toBe(true)
  })

  it('a limited watch is reported as limited (G7)', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    h.source.scriptSubscribe({ kind: 'started', liveRefresh: 'limited' })
    const tab = await openImageTab(h)

    expect(tab.hook.result.current.state.watch).toEqual({ kind: 'active', live: 'limited' })
    expect(tab.hook.result.current.isWatchUnavailable).toBe(false)
  })

  it('a project that closed stops the watch quietly', async () => {
    h.disk.write(WATCHED_PATH, 'png-1', { silent: true })
    const tab = await openImageTab(h)

    act(() =>
      h.source.emit({ watchId: h.source.subscribeCalls[0].watchId, kind: 'ended', reason: 'project-closed' })
    )
    await h.run(SETTLED_MS)

    expect(tab.hook.result.current.state.watch).toEqual({ kind: 'stopped', reason: 'project-closed' })
    expect(tab.hook.result.current.isWatchUnavailable).toBe(false)
  })
})

describe('imageReadFailure', () => {
  it.each([
    ['Image is too large (60.5 MB)', { status: 'blocked', reason: 'too-large' }],
    ["ENOENT: no such file or directory, open '/p/a.png'", { status: 'missing' }],
    ['EBUSY: resource busy or locked', { status: 'failed' }],
    [
      "Error invoking remote method 'file:readImage': FileBusyError: File changed while it was read",
      { status: 'busy' }
    ]
  ])('maps "%s"', (message, outcome) => {
    expect(imageReadFailure(new Error(message)).outcome).toEqual(outcome)
  })

  it('reports the refused size in bytes', () => {
    expect(imageReadFailure(new Error('too large (2 MB)')).tooLargeBytes).toBe(2 * 1024 * 1024)
  })
})

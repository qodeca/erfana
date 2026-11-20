// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * A main tracked watch (#478 plan S17/S19): what its consumer hears – a change
 * once, a delete after the confirm window, a return as a change, the watch
 * stopping, waiting for a slot or failing to read – and the three checks that
 * reach it (window focus, a power resume, shown again). Over the core's fakes.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../LoggingService', () => ({ logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { TRACKED_PATH, installTrackedWatchHarness } from './__test__/trackedWatchHarness'

const h = installTrackedWatchHarness()
/** Past the confirm window, the retries and the deleted-state probe's first ask. */
const SETTLED_MS = 3_000

describe('mainTrackedWatch (#478 S17/S19)', () => {
  it('reports a write once, and nothing on open', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('preview')
    await h.clock.run(SETTLED_MS)
    expect(watch.changes).toBe(0)

    h.disk.write(TRACKED_PATH, 'v2')
    await h.clock.run(SETTLED_MS)
    expect(watch.changes).toBe(1)
    expect(watch.shown()).toBe('v2')
  })

  it('reports a confirmed delete once, then the file back as a change (F11, #450)', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('preview')
    h.disk.remove(TRACKED_PATH)
    await h.clock.run(SETTLED_MS)
    expect(watch.deletes).toBe(1)

    h.disk.write(TRACKED_PATH, 'back', { silent: true })
    await h.clock.run(SETTLED_MS)
    expect(watch.changes).toBe(1)
    expect(watch.shown()).toBe('back')
  })

  it('says `stopped` when the one restart fails, and nothing for a project that closed', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('comments')
    const first = h.source.subscribeCalls.at(-1)?.watchId as string
    h.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
    h.source.emit({ watchId: first, kind: 'ended', reason: 'watcher-error' })
    await h.clock.run(SETTLED_MS)
    expect(watch.problems).toEqual(['stopped'])

    h.disk.write('/proj/other.md', 'x', { silent: true })
    const other = await h.open('comments', '/proj/other.md')
    const id = h.source.subscribeCalls.at(-1)?.watchId as string
    h.source.emit({ watchId: id, kind: 'ended', reason: 'project-switch' })
    await h.clock.run(SETTLED_MS)
    expect(other.problems).toEqual([])
  })

  it('says `queued` past the bucket, and the focus check still catches a write (G9, F32)', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    h.source.scriptSubscribe({ kind: 'queued' })
    const watch = await h.open('comments')
    expect(watch.problems).toEqual(['queued'])

    h.disk.write(TRACKED_PATH, 'while queued', { silent: true })
    h.focus()
    await h.clock.run(SETTLED_MS)
    expect(watch.shown()).toBe('while queued')
  })

  it('says `limited` once for a file on a network or WSL volume (G7)', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    h.source.scriptSubscribe({ kind: 'started', liveRefresh: 'limited' })
    const watch = await h.open('preview')
    h.focus()
    await h.clock.run(SETTLED_MS)
    expect(watch.problems).toEqual(['limited'])
  })

  it('says `unreadable` once the read retries are spent (L2)', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('preview')
    h.disk.failNextReads(TRACKED_PATH, 4)
    h.disk.write(TRACKED_PATH, 'locked')
    await h.clock.run(SETTLED_MS)
    expect(watch.problems).toEqual(['unreadable'])
  })

  it('checks on a power resume: a write the dead watch missed is caught (G8)', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('comments')
    h.disk.write(TRACKED_PATH, 'during sleep', { silent: true })
    h.wake()
    await h.clock.run(SETTLED_MS)
    expect(watch.shown()).toBe('during sleep')
  })

  it('checks when shown again (S1), and only then', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('preview')
    watch.handle.setVisible(false)
    h.disk.write(TRACKED_PATH, 'while hidden', { silent: true })
    await h.clock.run(SETTLED_MS)
    expect(watch.changes).toBe(0)
    watch.handle.setVisible(true)
    await h.clock.run(SETTLED_MS)
    expect(watch.shown()).toBe('while hidden')
  })

  it('catches up a write made before the watch was live (G3)', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    h.source.scriptSubscribe({ kind: 'hold' })
    const watch = await h.open('preview')
    h.disk.write(TRACKED_PATH, 'before ready', { silent: true })
    h.source.releaseHeld()
    await h.clock.run(SETTLED_MS)
    expect(watch.changes).toBe(1)
    expect(watch.shown()).toBe('before ready')
  })

  it('after close: reports nothing, leaves the focus check and ends its owner', async () => {
    h.disk.write(TRACKED_PATH, 'v1', { silent: true })
    const watch = await h.open('preview')
    expect(h.registered).toBe(1)
    await watch.handle.close()
    expect(h.registered).toBe(0)
    expect(watch.sourceDisposed).toBe(true)
    h.disk.write(TRACKED_PATH, 'late')
    await h.clock.run(SETTLED_MS)
    expect(watch.changes).toBe(0)
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The Markdown preview's image follow (#478 plan S18, C3): up to eight files
 * per document followed live while the preview is shown, a change read once
 * and handed to the store, nothing followed while hidden, a file gone handed
 * back to the store, and a file back found by the store's own signal.
 */
import { describe, expect, it } from 'vitest'
import { MARKDOWN_IMAGE_FOLLOW_MAX, readOutcomeOf } from './markdownImageFreshness'
import { installImageFollowHarness } from './__test__/markdownImageFreshnessHarness'

const h = installImageFollowHarness()
const path = (n: number): string => `/proj/img/${n}.png`
/** Past the throttle, the settle and the read retries. */
const SETTLED_MS = 3_000

function writeImages(count: number): void {
  for (let n = 0; n < count; n++) h.disk.write(path(n), `image ${n}`, { silent: true })
}

describe('MarkdownImageFreshness (#478 S18)', () => {
  it(`follows the first ${MARKDOWN_IMAGE_FOLLOW_MAX} files only, with the dependent profile`, async () => {
    writeImages(10)
    h.follow.sync(Array.from({ length: 10 }, (_, n) => h.image(path(n), path(n))))
    await h.clock.run(0)
    expect(h.follow.size).toBe(MARKDOWN_IMAGE_FOLLOW_MAX)
    expect(h.source.subscribeCalls.map((call) => call.profile)).toEqual(Array(MARKDOWN_IMAGE_FOLLOW_MAX).fill('dependent'))
    expect(h.source.subscribeCalls.map((call) => call.filePath)).not.toContain(path(8))
  })

  it('hands the bytes of a change to the store, read once (C3)', async () => {
    writeImages(1)
    h.follow.sync([h.image('a', path(0))])
    await h.clock.run(0)
    h.reads.mockClear()

    h.disk.write(path(0), 'redrawn')
    await h.clock.run(SETTLED_MS)
    expect(h.refreshed.get('a')?.map((bytes) => bytes.dataUrl)).toEqual(['redrawn'])
    expect(h.reads).toHaveBeenCalledTimes(1)
  })

  it('follows nothing while hidden, and catches up on show from the version shown (G3)', async () => {
    writeImages(1)
    const shown = h.image('a', path(0))
    h.follow.sync([shown])
    await h.clock.run(0)

    h.follow.sync([])
    await h.clock.run(0)
    expect(h.follow.size).toBe(0)
    expect(h.source.subscriptions.size).toBe(0)

    h.disk.write(path(0), 'while hidden')
    await h.clock.run(SETTLED_MS)
    expect(h.refreshed.get('a')).toBeUndefined()

    h.follow.sync([shown])
    await h.clock.run(SETTLED_MS)
    expect(h.refreshed.get('a')?.at(-1)?.dataUrl).toBe('while hidden')
  })

  it('hands a file gone back to the store, and follows it again once a check finds it back', async () => {
    writeImages(1)
    h.follow.sync([h.image('a', path(0))])
    await h.clock.run(0)
    h.disk.remove(path(0))
    await h.clock.run(SETTLED_MS)
    expect(h.rechecked).toEqual(['a'])
    expect(h.follow.stateOf('a')?.content).toEqual({ kind: 'deleted' })

    h.disk.write(path(0), 'back', { silent: true })
    h.follow.checkAll('manual')
    await h.clock.run(SETTLED_MS)
    expect(h.refreshed.get('a')?.at(-1)?.dataUrl).toBe('back')
    expect(h.follow.stateOf('a')?.content).toEqual({ kind: 'fresh' })
  })

  it('checks every followed file on window focus and a power resume (S1, G8)', async () => {
    writeImages(2)
    h.follow.sync([h.image('a', path(0)), h.image('b', path(1))])
    await h.clock.run(0)
    expect(h.registered).toBe(2)
    h.disk.write(path(1), 'unheard', { silent: true })
    h.check()
    await h.clock.run(SETTLED_MS)
    expect(h.refreshed.get('a')).toBeUndefined()
    expect(h.refreshed.get('b')?.at(-1)?.dataUrl).toBe('unheard')
  })

  it('tries a stopped watch again with the next version the store shows', async () => {
    writeImages(1)
    h.follow.sync([h.image('a', path(0))])
    await h.clock.run(0)
    const first = h.source.subscribeCalls.at(-1)?.watchId as string
    h.source.scriptSubscribe({ kind: 'refused', code: 'WATCH_FAILED' })
    h.source.emit({ watchId: first, kind: 'ended', reason: 'watcher-error' })
    await h.clock.run(SETTLED_MS)
    expect(h.follow.stateOf('a')?.watch.kind).toBe('stopped')

    h.follow.sync([h.image('a', path(0))])
    await h.clock.run(0)
    expect(h.follow.stateOf('a')?.watch).toEqual({ kind: 'active', live: 'full' })
  })

  it('dispose gives every subscription back and leaves the window checks', async () => {
    writeImages(3)
    h.follow.sync([0, 1, 2].map((n) => h.image(path(n), path(n))))
    await h.clock.run(0)
    h.follow.dispose()
    await h.clock.run(0)
    expect(h.source.subscriptions.size).toBe(0)
    expect(h.registered).toBe(0)
  })
})

describe('readOutcomeOf', () => {
  const stamp = { size: 1, mtimeMs: 1, ctimeMs: 1, ino: '1' }
  it('maps each answer to the tracker outcome', () => {
    expect(readOutcomeOf({ status: 'ok', dataUrl: 'd', version: 'v', stamp })).toMatchObject({ status: 'ok', stamp })
    expect(readOutcomeOf({ status: 'refused', reason: 'not-found' })).toEqual({ status: 'missing' })
    expect(readOutcomeOf({ status: 'refused', reason: 'too-large' })).toEqual({ status: 'blocked', reason: 'too-large' })
    expect(readOutcomeOf({ status: 'refused', reason: 'unreadable' })).toEqual({ status: 'failed' })
  })

  it('labels bytes from a main process that sent no stamp by their version', () => {
    const a = readOutcomeOf({ status: 'ok', dataUrl: 'd', version: 'v1' })
    const b = readOutcomeOf({ status: 'ok', dataUrl: 'd', version: 'v2' })
    expect(a.status === 'ok' && b.status === 'ok' && a.stamp.ino !== b.stamp.ino).toBe(true)
  })
})

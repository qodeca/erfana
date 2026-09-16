// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSessionFactory tests: partition recycling (Issue #74, work item 38).
 * Split from `PreviewSessionFactory.test.ts` by topic.
 */
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'

import { attach as attachRequestFilter } from './PreviewRequestFilter'
import type { PreviewSessionLike, PreviewViewHandle } from './PreviewSessionFactory'
import { PreviewSessionFactory } from './PreviewSessionFactory'
import {
  SESSION,
  makeRegistry,
  makeStore,
  makeView,
  scopesRecordingTo
} from './__test-helpers__/previewSessionFactoryMocks'

describe('PreviewSessionFactory — partition recycling', () => {
  // Electron cannot destroy a session: every `fromPartition` with a NEW name
  // costs handles for the life of the process (measured on Windows: ~16 per
  // partition, and +0 for re-minting a name). A partition is handed back after
  // a bounded purge and reused after another; a purge that fails or overruns
  // on either side drops the name, so nothing is ever reused un-purged.
  function makeFactory(overrides: {
    purge?: ReturnType<typeof vi.fn>
    nextPartitionName?: ReturnType<typeof vi.fn>
    createSession?: ReturnType<typeof vi.fn>
  } = {}): {
    factory: PreviewSessionFactory
    purge: ReturnType<typeof vi.fn>
    nextPartitionName: ReturnType<typeof vi.fn>
    createSession: ReturnType<typeof vi.fn>
  } {
    let minted = 0
    const nextPartitionName =
      overrides.nextPartitionName ?? vi.fn<() => string>(() => `erfana-preview-fresh-${++minted}`)
    const createSession =
      overrides.createSession ?? vi.fn<(p: string) => PreviewSessionLike>(() => SESSION)
    const purge = overrides.purge ?? vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())
    const factory = new PreviewSessionFactory({
      registry: makeRegistry(),
      allowlistStore: makeStore([]),
      nextPartitionName,
      createSession,
      purge,
      buildWebPreferences: vi.fn<() => unknown>(() => ({})),
      createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
      hardenSession: vi.fn<() => () => void>(() => () => undefined),
      attachProtocol: vi.fn<() => () => void>(() => () => undefined),
      attachFilter: vi.fn<() => () => void>(() => () => undefined),
      assertSealed: vi.fn<() => void>(() => undefined)
    })
    return { factory, purge, nextPartitionName, createSession }
  }
  const ctx = () => ({ projectPath: '/proj', pageScopes: scopesRecordingTo(vi.fn()), onBlocked: vi.fn() })

  it('reuses a released partition instead of minting a new one', async () => {
    const { factory, nextPartitionName, createSession } = makeFactory()

    const first = await factory.create(ctx())
    await first.release()
    const second = await factory.create(ctx())

    expect(second.partition).toBe(first.partition)
    expect(nextPartitionName).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls.map((c) => c[0])).toEqual([first.partition, first.partition])
  })

  it('purges a recycled partition again before handing it out, and mints fresh when that purge fails', async () => {
    const purge = vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())
    const { factory, nextPartitionName } = makeFactory({ purge })

    const first = await factory.create(ctx())
    await first.release()
    expect(purge).toHaveBeenCalledTimes(1)

    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    purge.mockRejectedValueOnce(
      Object.assign(new Error('clearStorageData failed'), { code: 'EBUSY' })
    )
    const second = await factory.create(ctx())

    // The reuse purge ran, failed, and the name was dropped rather than reused.
    expect(purge).toHaveBeenCalledTimes(2)
    expect(second.partition).not.toBe(first.partition)
    expect(nextPartitionName).toHaveBeenCalledTimes(2)
    // The line names the error and its code, never the message: a purge error
    // can quote the partition's storage path (QG-7 S3).
    expect(warn).toHaveBeenCalledWith(
      'Preview partition: purge before reuse failed; minting a fresh one',
      { error: 'Error', code: 'EBUSY' }
    )
    warn.mockRestore()
  })

  it('does not reuse a partition whose purge after use never completes', async () => {
    vi.useFakeTimers()
    try {
      const purge = vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())
      const { factory, nextPartitionName } = makeFactory({ purge })

      const first = await factory.create(ctx())
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      purge.mockReturnValueOnce(new Promise<void>(() => {}))
      const releasing = first.release()
      await vi.advanceTimersByTimeAsync(PREVIEW.PARTITION_PURGE_TIMEOUT_MS + 1)
      await releasing

      const second = await factory.create(ctx())
      expect(second.partition).not.toBe(first.partition)
      expect(nextPartitionName).toHaveBeenCalledTimes(2)
      // A timeout has no code, so the line is the name alone.
      expect(warn).toHaveBeenCalledWith('Preview partition: purge after use failed; not reusing it', {
        error: 'TimeoutError'
      })
      warn.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the partition for reuse when a later build step throws (review)', async () => {
    // `rollback()` unwound the token, the view, the hardening and both attach
    // points, but never the partition: a build that failed after
    // `acquirePartition` lost the name for good, holding its handles for the
    // life of the process on the path most likely to repeat.
    const createView = vi.fn<() => PreviewViewHandle>(() => makeView())
    createView.mockImplementationOnce(() => {
      throw new Error('no view')
    })
    const purge = vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())
    const { factory, nextPartitionName, createSession } = makeFactory({ purge })
    ;(factory as unknown as { deps: { createView: unknown } }).deps.createView = createView

    await expect(factory.create(ctx())).rejects.toThrow('no view')
    await vi.waitFor(() => expect(purge).toHaveBeenCalledTimes(1))
    await new Promise((r) => setImmediate(r))
    const second = await factory.create(ctx())

    expect(nextPartitionName).toHaveBeenCalledTimes(1)
    expect(createSession.mock.calls.map((c) => c[0])).toEqual([second.partition, second.partition])
  })

  it('drops a name handed back after forgetRecycled() ran (a project switch mid-drain)', async () => {
    // `onProjectChanged` awaits the drain of every view and only THEN forgets
    // the list, while an open for the new project can arrive between two of
    // those releases and pop a name the old project just used.
    const { factory, nextPartitionName } = makeFactory()

    const first = await factory.create(ctx())
    factory.forgetRecycled()
    await first.release()
    const second = await factory.create(ctx())

    expect(second.partition).not.toBe(first.partition)
    expect(nextPartitionName).toHaveBeenCalledTimes(2)
  })

  it('treats a second release() of the same session as a no-op', async () => {
    // `fromPartition(name)` returns the same object for a name, so a late
    // second release would purge the successor's live storage and push the
    // name back while a preview is using it.
    const purge = vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())
    const { factory } = makeFactory({ purge })

    const first = await factory.create(ctx())
    await first.release()
    await first.release()

    expect(purge).toHaveBeenCalledTimes(1)
  })

  it('forgets every recycled partition when told to (a project switch)', async () => {
    const { factory, nextPartitionName } = makeFactory()

    const first = await factory.create(ctx())
    await first.release()
    factory.forgetRecycled()
    const second = await factory.create(ctx())

    expect(second.partition).not.toBe(first.partition)
    expect(nextPartitionName).toHaveBeenCalledTimes(2)
  })
})

describe('PreviewSessionFactory — a recycled partition and a stale token (#124, WI-12, RX9)', () => {
  it('re-attaches the filter with the new token, so a frame on the previous one is refused as frame-escape', async () => {
    const STALE = '11111111111111111111111111111111'
    const FRESH = '22222222222222222222222222222222'
    const registry = makeRegistry()
    vi.mocked(registry.issue).mockResolvedValueOnce(STALE).mockResolvedValueOnce(FRESH)
    // One partition, so one webRequest surface: the REAL filter attaches to it
    // for each view, as it does on a recycled session.
    const onBeforeRequest = vi.fn<(listener: unknown) => void>()
    const partition = { webRequest: { onBeforeRequest, onCompleted: vi.fn(), onErrorOccurred: vi.fn() } }
    const factory = new PreviewSessionFactory({
      registry,
      allowlistStore: makeStore([]),
      nextPartitionName: vi.fn<() => string>(() => 'erfana-preview-recycled'),
      createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
      purge: vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve()),
      buildWebPreferences: vi.fn<() => unknown>(() => ({})),
      createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
      hardenSession: vi.fn<() => () => void>(() => () => undefined),
      attachProtocol: vi.fn<() => () => void>(() => () => undefined),
      attachFilter: (_session, ctx) => attachRequestFilter(partition as never, ctx),
      assertSealed: vi.fn<() => void>(() => undefined)
    })
    const firstFrames = vi.fn()
    const secondFrames = vi.fn()

    const first = await factory.create({
      projectPath: '/proj',
      pageScopes: scopesRecordingTo(vi.fn(), firstFrames),
      onBlocked: vi.fn()
    })
    first.teardown()
    await first.release()
    const second = await factory.create({
      projectPath: '/proj',
      pageScopes: scopesRecordingTo(vi.fn(), secondFrames),
      onBlocked: vi.fn()
    })

    expect(second.partition).toBe(first.partition)
    expect(second.token).toBe(FRESH)
    const listeners = onBeforeRequest.mock.calls
      .map(([listener]) => listener)
      .filter((listener) => typeof listener === 'function') as Array<
      (details: { id: number; url: string; resourceType: string }, cb: (r: { cancel: boolean }) => void) => void
    >
    expect(listeners).toHaveLength(2)

    const stale = `erfana-preview://${STALE}/index.html`
    const staleCallback = vi.fn()
    listeners[1]({ id: 1, url: stale, resourceType: 'subFrame' }, staleCallback)
    const freshCallback = vi.fn()
    listeners[1]({ id: 2, url: `erfana-preview://${FRESH}/index.html`, resourceType: 'subFrame' }, freshCallback)

    expect(staleCallback).toHaveBeenCalledWith({ cancel: true })
    expect(secondFrames).toHaveBeenCalledWith('frame-escape', stale)
    expect(freshCallback).toHaveBeenCalledWith({ cancel: false })
    expect(firstFrames).not.toHaveBeenCalled()
    second.teardown()
  })
})

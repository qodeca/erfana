// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSessionFactory tests (Issue #74, work item 38).
 *
 * Every electron + collaborator surface is injected as a typed fake, so the §5(a)
 * sequence is verified with no real `Session`/`WebContentsView`.
 */
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'

import type { PreviewAllowlistState, IPreviewAllowlistStore } from './PreviewAllowlistStore'
import type { IPreviewRootRegistry, PreviewRootEntry } from './PreviewRootRegistry'
import type { PreviewProtocolContext } from './PreviewProtocolHandler'
import type { PreviewFilterContext } from './PreviewRequestFilter'
import type {
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import { PreviewSessionFactory } from './PreviewSessionFactory'

const TOKEN = 'abc123abc123abc123abc123abc123ab'
const ENTRY: PreviewRootEntry = {
  realRoot: '/real/proj',
  projectPath: '/proj',
  csp: "default-src 'none'; sandbox allow-scripts"
}

function makeRegistry(): IPreviewRootRegistry & {
  revoke: ReturnType<typeof vi.fn<(token: string) => void>>
} {
  return {
    issue: vi.fn<(projectPath: string, hosts: readonly string[]) => Promise<string>>(() =>
      Promise.resolve(TOKEN)
    ),
    resolve: vi.fn<(token: string) => PreviewRootEntry | undefined>(() => ENTRY),
    revoke: vi.fn<(token: string) => void>(),
    rebuildCsp: vi.fn<(token: string, hosts: readonly string[]) => void>(),
    clear: vi.fn<() => void>()
  }
}

function makeStore(origins: string[]): IPreviewAllowlistStore {
  return {
    load: vi.fn<() => Promise<PreviewAllowlistState>>(() =>
      Promise.resolve({ origins, writeBackEnabled: true })
    ),
    approveOrigin: vi.fn<(origin: string) => Promise<readonly string[]>>(() =>
      Promise.resolve(origins)
    ),
    getOrigins: vi.fn<() => ReadonlySet<string>>(() => new Set(origins)),
    isWriteBackEnabled: vi.fn<() => boolean>(() => true),
    drainBadges: vi.fn<() => PreviewFailureInput[]>(() => [])
  }
}

function makeView(): PreviewViewHandle {
  const wc = {
    id: 'wc',
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn()
  } as unknown as PreviewWebContentsHandle
  return {
    webContents: wc,
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    setVisible: vi.fn()
  } as unknown as PreviewViewHandle
}

const SESSION = { storagePath: null, isPersistent: () => false } as unknown as PreviewSessionLike

describe('PreviewSessionFactory', () => {
  it('records the badges a bad allowlist raised at load on the new view (#115)', async () => {
    // The store logs its parse badge process-wide because it has no panel to
    // address; the factory is the first place that has the panel's failure log.
    const store = makeStore([])
    const badge: PreviewFailureInput = {
      type: 'allowlist-invalid',
      resourceUrlOrHost: '.erfana/settings.json',
      reasonCode: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
    }
    ;(store.drainBadges as ReturnType<typeof vi.fn>).mockReturnValueOnce([badge])
    const factory = new PreviewSessionFactory({
      registry: makeRegistry(),
      allowlistStore: store,
      createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
      buildWebPreferences: vi.fn<() => unknown>(() => ({})),
      createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
      hardenSession: vi.fn<() => () => void>(() => () => undefined),
      attachProtocol: vi.fn<() => () => void>(() => () => undefined),
      attachFilter: vi.fn<() => () => void>(() => () => undefined),
      assertSealed: vi.fn<() => void>(() => undefined)
    })
    const recordFailure = vi.fn()

    await factory.create({ projectPath: '/proj', recordFailure, onBlocked: vi.fn() })

    expect(recordFailure).toHaveBeenCalledWith(badge)
  })

  it('runs the §5(a) sequence in order and returns a wired session', async () => {
    const order: string[] = []
    const registry = makeRegistry()
    const store = makeStore(['cdn.example.com'])
    const view = makeView()

    const detachProtocol = vi.fn<() => void>()
    const detachFilter = vi.fn<() => void>()
    const disposeHarden = vi.fn<() => void>()

    let protocolCtx: PreviewProtocolContext | undefined
    let filterCtx: PreviewFilterContext | undefined

    const factory = new PreviewSessionFactory({
      registry,
      allowlistStore: store,
      nextPartitionName: vi.fn<() => string>(() => 'erfana-preview-test'),
      createSession: vi.fn<(partition: string) => PreviewSessionLike>((partition) => {
        order.push('createSession:' + partition)
        return SESSION
      }),
      buildWebPreferences: vi.fn<(s: PreviewSessionLike) => unknown>(() => {
        order.push('buildWebPreferences')
        return { session: SESSION }
      }),
      createView: vi.fn<(wp: unknown) => PreviewViewHandle>(() => {
        order.push('createView')
        return view
      }),
      hardenSession: vi.fn<
        (s: PreviewSessionLike, wc: PreviewWebContentsHandle) => () => void
      >(() => {
        order.push('harden')
        return disposeHarden
      }),
      attachProtocol: vi.fn<
        (s: PreviewSessionLike, ctx: PreviewProtocolContext) => () => void
      >((_s, ctx) => {
        order.push('attachProtocol')
        protocolCtx = ctx
        return detachProtocol
      }),
      attachFilter: vi.fn<
        (s: PreviewSessionLike, ctx: PreviewFilterContext) => () => void
      >((_s, ctx) => {
        order.push('attachFilter')
        filterCtx = ctx
        return detachFilter
      }),
      assertSealed: vi.fn<(s: PreviewSessionLike) => void>(() => {
        order.push('assertSealed')
      })
    })

    const recordFailure = vi.fn()
    const onBlocked = vi.fn()
    const result = await factory.create({ projectPath: '/proj', recordFailure, onBlocked })

    expect(store.load).toHaveBeenCalledTimes(1)
    expect(registry.issue).toHaveBeenCalledWith('/proj', ['cdn.example.com'])
    expect(order).toEqual([
      'createSession:erfana-preview-test',
      'buildWebPreferences',
      'createView',
      'harden',
      'attachProtocol',
      'attachFilter',
      'assertSealed'
    ])

    expect(result.view).toBe(view)
    expect(result.session).toBe(SESSION)
    expect(result.token).toBe(TOKEN)
    expect(result.realRoot).toBe('/real/proj')

    // The protocol ctx resolves through the registry and forwards failures.
    expect(protocolCtx?.resolve(TOKEN)).toBe(ENTRY)
    protocolCtx?.recordFailure({
      type: 'csp-missing',
      resourceUrlOrHost: '/x',
      reasonCode: 0 as never
    })
    expect(recordFailure).toHaveBeenCalledTimes(1)

    // The filter reads the LIVE allowed-host set and forwards blocks.
    expect([...(filterCtx?.getAllowedHosts() ?? [])]).toEqual(['cdn.example.com'])
    filterCtx?.onBlocked('blocked-host', 'evil.com', 'https://evil.com/x', true)
    expect(onBlocked).toHaveBeenCalledWith('blocked-host', 'evil.com', 'https://evil.com/x', true)

    // teardown detaches everything the factory attached.
    result.teardown()
    expect(detachFilter).toHaveBeenCalledTimes(1)
    expect(detachProtocol).toHaveBeenCalledTimes(1)
    expect(disposeHarden).toHaveBeenCalledTimes(1)
  })

  it('tears down and revokes the token when assertSealed throws (⇒ no view)', async () => {
    const registry = makeRegistry()
    const store = makeStore([])
    const detachProtocol = vi.fn<() => void>()
    const detachFilter = vi.fn<() => void>()
    const disposeHarden = vi.fn<() => void>()

    const factory = new PreviewSessionFactory({
      registry,
      allowlistStore: store,
      createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
      buildWebPreferences: vi.fn<() => unknown>(() => ({})),
      createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
      hardenSession: vi.fn<() => () => void>(() => disposeHarden),
      attachProtocol: vi.fn<() => () => void>(() => detachProtocol),
      attachFilter: vi.fn<() => () => void>(() => detachFilter),
      assertSealed: vi.fn<() => void>(() => {
        throw new Error('persistent partition')
      })
    })

    await expect(
      factory.create({ projectPath: '/proj', recordFailure: vi.fn(), onBlocked: vi.fn() })
    ).rejects.toThrow('persistent partition')

    expect(detachFilter).toHaveBeenCalledTimes(1)
    expect(detachProtocol).toHaveBeenCalledTimes(1)
    expect(disposeHarden).toHaveBeenCalledTimes(1)
    expect(registry.revoke).toHaveBeenCalledWith(TOKEN)
  })

  /**
   * Every step after `registry.issue` can throw, not just the seal tripwire.
   *
   * An earlier revision guarded step 9 only, under a docblock claiming "no
   * half-wired view leaks". A throw in `attachFilter` therefore left the token
   * resolvable and the `erfana-preview://` protocol handler attached, so it kept
   * serving confined file reads for the life of the process (lens review F9).
   * These cases fail against that revision.
   */
  describe('unwinds partial construction at every step', () => {
    function buildFactory(overrides: Record<string, unknown>): {
      factory: PreviewSessionFactory
      registry: ReturnType<typeof makeRegistry>
    } {
      const registry = makeRegistry()
      const factory = new PreviewSessionFactory({
        registry,
        allowlistStore: makeStore([]),
        createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
        buildWebPreferences: vi.fn<() => unknown>(() => ({})),
        createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
        hardenSession: vi.fn<() => () => void>(() => vi.fn()),
        attachProtocol: vi.fn<() => () => void>(() => vi.fn()),
        attachFilter: vi.fn<() => () => void>(() => vi.fn()),
        assertSealed: vi.fn<() => void>(() => {}),
        ...overrides
      } as ConstructorParameters<typeof PreviewSessionFactory>[0])
      return { factory, registry }
    }

    const create = (
      factory: PreviewSessionFactory
    ): Promise<unknown> =>
      factory.create({ projectPath: '/proj', recordFailure: vi.fn(), onBlocked: vi.fn() })

    it('revokes the token when the view cannot be created', async () => {
      const { factory, registry } = buildFactory({
        createView: vi.fn(() => {
          throw new Error('no view')
        })
      })

      await expect(create(factory)).rejects.toThrow('no view')
      expect(registry.revoke).toHaveBeenCalledWith(TOKEN)
    })

    it('destroys the view and revokes the token when hardening throws', async () => {
      const view = makeView()
      const { factory, registry } = buildFactory({
        createView: vi.fn(() => view),
        hardenSession: vi.fn(() => {
          throw new Error('harden failed')
        })
      })

      await expect(create(factory)).rejects.toThrow('harden failed')
      expect(view.webContents.destroy).toHaveBeenCalledTimes(1)
      expect(registry.revoke).toHaveBeenCalledWith(TOKEN)
    })

    it('detaches the protocol handler and revokes the token when the filter throws', async () => {
      const view = makeView()
      const detachProtocol = vi.fn<() => void>()
      const disposeHarden = vi.fn<() => void>()
      const { factory, registry } = buildFactory({
        createView: vi.fn(() => view),
        hardenSession: vi.fn(() => disposeHarden),
        attachProtocol: vi.fn(() => detachProtocol),
        attachFilter: vi.fn(() => {
          throw new Error('filter failed')
        })
      })

      await expect(create(factory)).rejects.toThrow('filter failed')

      // The token must not stay resolvable: it would keep serving file reads.
      expect(registry.revoke).toHaveBeenCalledWith(TOKEN)
      expect(detachProtocol).toHaveBeenCalledTimes(1)
      expect(disposeHarden).toHaveBeenCalledTimes(1)
      expect(view.webContents.destroy).toHaveBeenCalledTimes(1)
    })

    it('still unwinds the rest when one disposer throws', async () => {
      const view = makeView()
      const { factory, registry } = buildFactory({
        createView: vi.fn(() => view),
        hardenSession: vi.fn(() => () => {
          throw new Error('disposer exploded')
        }),
        attachFilter: vi.fn(() => {
          throw new Error('filter failed')
        })
      })

      await expect(create(factory)).rejects.toThrow('filter failed')
      expect(registry.revoke).toHaveBeenCalledWith(TOKEN)
      expect(view.webContents.destroy).toHaveBeenCalledTimes(1)
    })
  })
})

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
  const ctx = () => ({ projectPath: '/proj', recordFailure: vi.fn(), onBlocked: vi.fn() })

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

    purge.mockRejectedValueOnce(new Error('clearStorageData failed'))
    const second = await factory.create(ctx())

    // The reuse purge ran, failed, and the name was dropped rather than reused.
    expect(purge).toHaveBeenCalledTimes(2)
    expect(second.partition).not.toBe(first.partition)
    expect(nextPartitionName).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a partition whose purge after use never completes', async () => {
    vi.useFakeTimers()
    try {
      const purge = vi.fn<(s: PreviewSessionLike) => Promise<void>>(() => Promise.resolve())
      const { factory, nextPartitionName } = makeFactory({ purge })

      const first = await factory.create(ctx())
      purge.mockReturnValueOnce(new Promise<void>(() => {}))
      const releasing = first.release()
      await vi.advanceTimersByTimeAsync(PREVIEW.PARTITION_PURGE_TIMEOUT_MS + 1)
      await releasing

      const second = await factory.create(ctx())
      expect(second.partition).not.toBe(first.partition)
      expect(nextPartitionName).toHaveBeenCalledTimes(2)
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

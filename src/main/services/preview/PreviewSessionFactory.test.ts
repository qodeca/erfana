// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSessionFactory tests (Issue #74, work item 38).
 *
 * Every electron + collaborator surface is injected as a typed fake, so the §5(a)
 * sequence is verified with no real `Session`/`WebContentsView`.
 *
 * Split by topic (docs/windows/contributing.md § "Test-file split policy"):
 * unwinding a partial construction is in `PreviewSessionFactory.unwind.test.ts`,
 * partition recycling in `PreviewSessionFactory.partitionRecycling.test.ts`, and
 * the shared fakes in `__test-helpers__/previewSessionFactoryMocks.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'

import type { PreviewFrameRefusalType } from './previewFrameRefusals'
import type { PreviewProtocolContext } from './PreviewProtocolHandler'
import type { PreviewFilterContext } from './PreviewRequestFilter'
import type {
  PreviewSessionLike,
  PreviewViewHandle,
  PreviewWebContentsHandle
} from './PreviewSessionFactory'
import { PreviewSessionFactory } from './PreviewSessionFactory'
import {
  ENTRY,
  SESSION,
  TOKEN,
  makeRegistry,
  makeStore,
  makeView,
  scopesRecordingTo
} from './__test-helpers__/previewSessionFactoryMocks'

/** A page as the session sees it: a failure log and a refused-frame set (WI-29, WI-12). */
function makePage() {
  return {
    recordFailure: vi.fn<(input: PreviewFailureInput) => void>(),
    frameRefusals: { record: vi.fn<(type: PreviewFrameRefusalType, address: string) => void>() }
  }
}

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

    await factory.create({
      projectPath: '/proj',
      pageScopes: scopesRecordingTo(recordFailure),
      onBlocked: vi.fn()
    })

    expect(recordFailure).toHaveBeenCalledWith(badge)
  })

  it('asks the page scopes at every write and never keeps one (#124, WI-29)', async () => {
    // The page under a session changes with every load main starts, so a scope
    // captured at build time would put a later page's diagnostics in an old badge.
    const badge: PreviewFailureInput = {
      type: 'allowlist-invalid',
      resourceUrlOrHost: '.erfana/settings.json',
      reasonCode: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
    }
    const store = makeStore([])
    ;(store.drainBadges as ReturnType<typeof vi.fn>).mockReturnValueOnce([badge])
    let protocolCtx: PreviewProtocolContext | undefined
    const factory = new PreviewSessionFactory({
      registry: makeRegistry(),
      allowlistStore: store,
      createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
      buildWebPreferences: vi.fn<() => unknown>(() => ({})),
      createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
      hardenSession: vi.fn<() => () => void>(() => () => undefined),
      attachProtocol: vi.fn<(s: PreviewSessionLike, ctx: PreviewProtocolContext) => () => void>(
        (_s, ctx) => {
          protocolCtx = ctx
          return () => undefined
        }
      ),
      attachFilter: vi.fn<() => () => void>(() => () => undefined),
      assertSealed: vi.fn<() => void>(() => undefined)
    })
    const pageA = makePage()
    const pageB = makePage()
    const loading = { recordFailure: vi.fn<(input: PreviewFailureInput) => void>() }
    const recordViewFailure = vi.fn<(input: PreviewFailureInput) => void>()
    let onScreen = pageA

    await factory.create({
      projectPath: '/proj',
      pageScopes: () => ({
        committed: () => onScreen,
        forMainDocument: () => loading,
        recordViewFailure
      }),
      onBlocked: vi.fn()
    })
    // The allowlist's badge is the view's, not page A's, so a reload keeps it.
    expect(recordViewFailure).toHaveBeenCalledWith(badge)
    expect(pageA.recordFailure).not.toHaveBeenCalled()

    // A load commits: the next diagnostic goes to the new page on screen, and a
    // protocol diagnostic never goes to the page still loading.
    onScreen = pageB
    const failure: PreviewFailureInput = {
      type: 'csp-missing',
      resourceUrlOrHost: '/x',
      reasonCode: ErrorCode.PREVIEW_CSP_INVALID
    }
    protocolCtx?.recordFailure(failure)

    expect(pageB.recordFailure).toHaveBeenCalledWith(failure)
    expect(pageA.recordFailure).not.toHaveBeenCalled()
    expect(recordViewFailure).toHaveBeenCalledTimes(1)
    expect(loading.recordFailure).not.toHaveBeenCalled()
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
    const result = await factory.create({
      projectPath: '/proj',
      pageScopes: scopesRecordingTo(recordFailure),
      onBlocked
    })

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
      factory.create({ projectPath: '/proj', pageScopes: scopesRecordingTo(vi.fn()), onBlocked: vi.fn() })
    ).rejects.toThrow('persistent partition')

    expect(detachFilter).toHaveBeenCalledTimes(1)
    expect(detachProtocol).toHaveBeenCalledTimes(1)
    expect(disposeHarden).toHaveBeenCalledTimes(1)
    expect(registry.revoke).toHaveBeenCalledWith(TOKEN)
  })
})

describe('PreviewSessionFactory – the handler and filter contexts (#124, WI-12)', () => {
  /** A factory that keeps every context it hands to the two attach steps. */
  function capturingFactory() {
    const protocol: PreviewProtocolContext[] = []
    const filter: PreviewFilterContext[] = []
    const factory = new PreviewSessionFactory({
      registry: makeRegistry(),
      allowlistStore: makeStore([]),
      createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
      buildWebPreferences: vi.fn<() => unknown>(() => ({})),
      createView: vi.fn<() => PreviewViewHandle>(() => makeView()),
      hardenSession: vi.fn<() => () => void>(() => () => undefined),
      attachProtocol: vi.fn<(s: PreviewSessionLike, ctx: PreviewProtocolContext) => () => void>(
        (_s, ctx) => {
          protocol.push(ctx)
          return () => undefined
        }
      ),
      attachFilter: vi.fn<(s: PreviewSessionLike, ctx: PreviewFilterContext) => () => void>(
        (_s, ctx) => {
          filter.push(ctx)
          return () => undefined
        }
      ),
      assertSealed: vi.fn<() => void>(() => undefined)
    })
    return { factory, protocol, filter }
  }

  const URL_CHILD = `erfana-preview://${TOKEN}/child.html`

  it("gives the filter the session's token and one ledger shared with the handler", async () => {
    const { factory, protocol, filter } = capturingFactory()
    await factory.create({ projectPath: '/proj', pageScopes: scopesRecordingTo(vi.fn()), onBlocked: vi.fn() })

    expect(filter[0].ownToken).toBe(TOKEN)
    filter[0].ledger.note(URL_CHILD, 'subFrame')
    expect(protocol[0].ledger.take(URL_CHILD)).toBe('subFrame')
    expect(protocol[0].resolve(TOKEN)).toBe(ENTRY)
  })

  it('rebuilds both contexts, and the ledger, in every create', async () => {
    const { factory, protocol, filter } = capturingFactory()
    const ctx = () => ({ projectPath: '/proj', pageScopes: scopesRecordingTo(vi.fn()), onBlocked: vi.fn() })
    await factory.create(ctx())
    await factory.create(ctx())

    expect(filter[1]).not.toBe(filter[0])
    expect(protocol[1]).not.toBe(protocol[0])
    filter[0].ledger.note(URL_CHILD, 'mainFrame')
    expect(protocol[1].ledger.take(URL_CHILD)).toBeUndefined()
  })

  it('sends a main-document refusal to the page loading and every frame refusal to the page on screen, per write', async () => {
    const { factory, protocol, filter } = capturingFactory()
    const pageA = makePage()
    const pageB = makePage()
    const loading = { recordFailure: vi.fn<(input: PreviewFailureInput) => void>() }
    let onScreen = pageA
    await factory.create({
      projectPath: '/proj',
      pageScopes: () => ({
        committed: () => onScreen,
        forMainDocument: () => loading,
        recordViewFailure: vi.fn()
      }),
      onBlocked: vi.fn()
    })
    const refused: PreviewFailureInput = {
      type: 'missing-local-file',
      resourceUrlOrHost: '/gone.html',
      reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
    }

    protocol[0].recordDocumentFailure(refused)
    filter[0].recordFrameRefusal('frame-remote', 'https://evil.example/')
    onScreen = pageB
    protocol[0].recordFrameRefusal('missing-local-file', '/missing.html')

    expect(loading.recordFailure).toHaveBeenCalledWith(refused)
    expect(pageA.frameRefusals.record).toHaveBeenCalledWith('frame-remote', 'https://evil.example/')
    expect(pageB.frameRefusals.record).toHaveBeenCalledWith('missing-local-file', '/missing.html')
    expect(pageA.recordFailure).not.toHaveBeenCalled()
    expect(pageB.recordFailure).not.toHaveBeenCalled()
  })
})

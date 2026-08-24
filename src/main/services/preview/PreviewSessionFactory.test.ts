// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSessionFactory tests (Issue #74, work item 38).
 *
 * Every electron + collaborator surface is injected as a typed fake, so the §5(a)
 * sequence is verified with no real `Session`/`WebContentsView`.
 */
import { describe, expect, it, vi } from 'vitest'

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

function makeStore(hosts: string[]): IPreviewAllowlistStore {
  return {
    load: vi.fn<() => Promise<PreviewAllowlistState>>(() =>
      Promise.resolve({ hosts, writeBackEnabled: true })
    ),
    approveHost: vi.fn<(host: string) => Promise<readonly string[]>>(() => Promise.resolve(hosts)),
    getHosts: vi.fn<() => ReadonlySet<string>>(() => new Set(hosts)),
    isWriteBackEnabled: vi.fn<() => boolean>(() => true)
  }
}

function makeView(): PreviewViewHandle {
  const wc = { id: 'wc' } as unknown as PreviewWebContentsHandle
  return {
    webContents: wc,
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    setVisible: vi.fn()
  } as unknown as PreviewViewHandle
}

const SESSION = { storagePath: null, isPersistent: () => false } as unknown as PreviewSessionLike

describe('PreviewSessionFactory', () => {
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
})

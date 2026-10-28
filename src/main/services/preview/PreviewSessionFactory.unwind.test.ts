// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSessionFactory tests: unwinding a partial construction (Issue #74,
 * work item 38). Split from `PreviewSessionFactory.test.ts` by topic; the outer
 * `describe` keeps every test's full name as it was.
 */
import { describe, expect, it, vi } from 'vitest'

import type { PreviewSessionLike, PreviewViewHandle } from './PreviewSessionFactory'
import { PreviewSessionFactory } from './PreviewSessionFactory'
import {
  SESSION,
  TOKEN,
  makeRegistry,
  makeStore,
  makeView,
  scopesRecordingTo
} from './__test-helpers__/previewSessionFactoryMocks'

describe('PreviewSessionFactory', () => {
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
      factory.create({ projectPath: '/proj', pageScopes: scopesRecordingTo(vi.fn()), onBlocked: vi.fn() })

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

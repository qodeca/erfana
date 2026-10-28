// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewSessionFactory × HTML Preview comments: the flag picks the view's
 * `WebPreferences` when the view is built (docs/designs/html-preview-comments.md
 * §3 "Feature flag", §4.2; SEC-22; docs/adrs/0005-sub-frame-preload-one-receive-channel.md).
 *
 * The default `buildWebPreferences` runs here – that default is the code under
 * test – with every other electron surface faked as in `PreviewSessionFactory.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PreviewSessionLike, PreviewViewHandle } from './PreviewSessionFactory'
import { PreviewSessionFactory } from './PreviewSessionFactory'
import type { PreviewSessionCommentDeps } from './previewSessionFilterContext'
import { SESSION, makeRegistry, makeStore, makeView, scopesRecordingTo } from './__test-helpers__/previewSessionFactoryMocks'

const PRELOAD = '/out/preload/previewPage.js'

/** The preferences the view was created with, for `comments` as given. */
async function preferencesWith(comments: PreviewSessionCommentDeps | undefined): Promise<Record<string, unknown>> {
  const createView = vi.fn<(prefs: unknown) => PreviewViewHandle>(() => makeView())
  const factory = new PreviewSessionFactory({
    registry: makeRegistry(),
    allowlistStore: makeStore([]),
    previewPagePreloadPath: PRELOAD,
    ...(comments === undefined ? {} : { comments }),
    createSession: vi.fn<(p: string) => PreviewSessionLike>(() => SESSION),
    createView,
    hardenSession: vi.fn<() => () => void>(() => () => undefined),
    attachProtocol: vi.fn<() => () => void>(() => () => undefined),
    attachFilter: vi.fn<() => () => void>(() => () => undefined),
    assertSealed: vi.fn<() => void>(() => undefined)
  })
  await factory.create({ projectPath: '/proj', pageScopes: scopesRecordingTo(vi.fn()), onBlocked: vi.fn() })
  expect(createView).toHaveBeenCalledTimes(1)
  return createView.mock.calls[0][0] as Record<string, unknown>
}

/** Comment deps with the flag answering `isEnabled`; a stub client, so no worker starts. */
function commentDeps(isEnabled: () => boolean): PreviewSessionCommentDeps {
  return { isEnabled, client: { instrument: vi.fn(), warm: vi.fn() } as never }
}

describe('PreviewSessionFactory web preferences and the comments flag (SEC-22)', () => {
  it('SEC-22 runs the preload in sub-frames only when the flag is on', async () => {
    const on = await preferencesWith(commentDeps(() => true))
    expect(on.nodeIntegrationInSubFrames).toBe(true)
    expect(on.additionalArguments).toEqual(['--erfana-hpc'])
    expect(on.preload).toBe(PRELOAD)
    expect([on.sandbox, on.contextIsolation, on.nodeIntegration]).toEqual([true, true, false])
  })

  it('SEC-22 keeps today’s preferences with the flag off, unwired, or unreadable', async () => {
    const off = await preferencesWith(commentDeps(() => false))
    const unwired = await preferencesWith(undefined)
    const unreadable = await preferencesWith(
      commentDeps(() => {
        throw new Error('settings unavailable')
      })
    )
    for (const prefs of [off, unwired, unreadable]) {
      expect(prefs.nodeIntegrationInSubFrames).toBe(false)
      expect(prefs.additionalArguments).toBeUndefined()
      expect(prefs.preload).toBe(PRELOAD)
    }
  })
})

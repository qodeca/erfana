// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lifecycle defects split out of #112 (#120), at the service seam:
 *   - a view construction that throws AFTER the native view was attached to the
 *     window removes it again (unless the window is already gone);
 *   - a live view whose contents is gone refuses to export, reload or swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewViewDeps } from './PreviewViewService'
import type { PreviewLiveView } from './PreviewLiveView'
import {
  makeHarness,
  removeProjects,
  type NavHarness
} from './__test-helpers__/previewViewServiceNavHarness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeProjects()
})

function depsOf(h: NavHarness): PreviewViewDeps {
  return (h.service as unknown as { deps: PreviewViewDeps }).deps
}

function liveViewOf(h: NavHarness, panelId = 'panel-A'): PreviewLiveView {
  const registry = (
    h.service as unknown as { registry: { get(id: string): PreviewLiveView | null } }
  ).registry
  return registry.get(panelId)!
}

/** Make every view the session factory builds throw when bounds are first placed. */
function throwOnPlaceBounds(h: NavHarness): { views: unknown[] } {
  const create = depsOf(h).sessionFactory.create as Mock
  const original = create.getMockImplementation()!
  const views: unknown[] = []
  create.mockImplementation(async (ctx: unknown) => {
    const session = await original(ctx)
    session.view.setBounds = vi.fn(() => {
      throw new Error('setBounds failed')
    })
    views.push(session.view)
    return session
  })
  return { views }
}

describe('construction unwind detaches the child view (#120)', () => {
  it('removes the view from the window when a step after addChildView throws', async () => {
    const h = makeHarness()
    const { views } = throwOnPlaceBounds(h)

    await h.service.open(h.request('panel-A', 'a.html'), h.window).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)

    expect(h.window.contentView.addChildView).toHaveBeenCalledWith(views[0])
    expect(h.window.contentView.removeChildView).toHaveBeenCalledWith(views[0])
  })

  it('does not touch a window that is already destroyed', async () => {
    const h = makeHarness()
    throwOnPlaceBounds(h)
    let gone = false
    const window = {
      ...h.window,
      isDestroyed: () => gone,
      contentView: {
        addChildView: vi.fn(() => {
          gone = true
        }),
        removeChildView: vi.fn()
      }
    } as unknown as typeof h.window

    await h.service.open(h.request('panel-A', 'a.html'), window).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(0)

    expect(window.contentView.addChildView).toHaveBeenCalled()
    expect(window.contentView.removeChildView).not.toHaveBeenCalled()
  })
})

describe('a live view whose contents is gone does no work (#120)', () => {
  it('exportPdf returns a failure without calling the export controller', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    const live = liveViewOf(h)
    page.contents.destroy()

    const result = await live.exportPdf('preview')

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED })
    expect(depsOf(h).exportController.exportToPdf).not.toHaveBeenCalled()
  })

  it('reload does not reload a destroyed contents', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    const live = liveViewOf(h)
    page.contents.destroy()

    live.reload(true)
    live.reload(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(page.contents.reloadIgnoringCache).not.toHaveBeenCalled()
    expect(page.contents.reload).not.toHaveBeenCalled()
  })

  it('swapStylesheet runs no script in a destroyed contents', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    const live = liveViewOf(h)
    page.contents.destroy()
    page.contents.executeJavaScriptInIsolatedWorld.mockClear()

    await expect(live.swapStylesheet('a.css')).resolves.toBe(false)

    expect(page.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(page.contents.reloadIgnoringCache).not.toHaveBeenCalled()
  })
})

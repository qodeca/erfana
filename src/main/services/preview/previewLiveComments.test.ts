// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Building one live view's comment service (docs/designs/comments/html-preview-comments.md
 * §4.2, §7.5): only when both halves exist, from the view's own parts, and
 * never throwing – a view without comments is still a preview.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../LoggingService'
import { PreviewCommentService } from './comments/PreviewCommentService'
import { createPreviewLiveComments, type PreviewLiveCommentParts } from './previewLiveComments'
import type { PreviewLiveViewParams } from './previewLiveTypes'

vi.mock('../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('./comments/PreviewCommentService', () => ({ PreviewCommentService: vi.fn() }))

const PANEL = 'preview-/home/ada/secret-project/index.html'
const RECT = { x: 1, y: 2, width: 300, height: 200 }

function params(overrides: { shared?: object | undefined; serving?: object | undefined } = {}) {
  const window = { id: 7, getContentBounds: vi.fn(() => ({ x: 10, y: 20, width: 800, height: 600 })) }
  const deps = {
    comments: 'shared' in overrides ? overrides.shared : { registry: {} },
    stillFrameCache: { captureFresh: vi.fn() },
    getZoomFactor: vi.fn(() => 1.25),
    now: vi.fn(() => 42),
    platform: 'linux'
  }
  const session = {
    comments: 'serving' in overrides ? overrides.serving : { unavailableReason: vi.fn() },
    view: { webContents: { id: 3 } },
    token: 'tok',
    realRoot: '/real/root'
  }
  return { panelId: PANEL, window, deps, session, projectPath: '/root' } as unknown as PreviewLiveViewParams
}

const parts = (): PreviewLiveCommentParts => ({
  page: { currentPage: vi.fn(() => '/root/index.html') },
  pipeline: { reload: vi.fn() },
  bounds: { lastRect: vi.fn(() => RECT), lastCssSize: vi.fn(() => ({ width: 300, height: 200 })) },
  visibility: { isDrawn: vi.fn(() => true) }
})

type ServiceDeps = ConstructorParameters<typeof PreviewCommentService>[0]
const built = (): ServiceDeps[] => vi.mocked(PreviewCommentService).mock.calls.map(([deps]) => deps)

beforeEach(() => {
  vi.mocked(PreviewCommentService).mockReset()
  vi.mocked(logger.warn).mockClear()
})

describe('createPreviewLiveComments', () => {
  it('builds nothing when the session has no comment serving, or the root wired no shared parts', () => {
    expect(createPreviewLiveComments(params({ serving: undefined }), parts())).toBeUndefined()
    expect(createPreviewLiveComments(params({ shared: undefined }), parts())).toBeUndefined()
    expect(PreviewCommentService).not.toHaveBeenCalled()
  })

  it('builds the service from the view\'s parts, with a new session number per view', () => {
    const p = params()
    const viewParts = parts()
    expect(createPreviewLiveComments(p, viewParts)).toBeInstanceOf(PreviewCommentService)
    createPreviewLiveComments(params(), parts())
    const [first, second] = built()
    expect(first).toMatchObject({ panelId: PANEL, windowId: 7, token: 'tok', realRoot: '/real/root', projectPath: '/root', platform: 'linux' })
    expect(second.session).toBe(first.session + 1)

    expect(first.still.lastRect()).toEqual(RECT)
    expect(first.still.lastCssSize()).toEqual({ width: 300, height: 200 })
    expect(first.still.isDrawn()).toBe(true)
    expect(first.geometry.viewRect()).toEqual(RECT)
    expect(first.geometry.contentBounds()).toEqual({ x: 10, y: 20, width: 800, height: 600 })
    expect(first.geometry.hostZoom()).toBe(1.25)
    expect(first.currentPage()).toBe('/root/index.html')
    first.reload()
    expect(viewParts.pipeline.reload).toHaveBeenCalledWith(false)
    expect(first.now?.()).toBe(42)
  })

  it('a service that cannot start leaves the view without comments, logged by digest only', () => {
    vi.mocked(PreviewCommentService).mockImplementationOnce(function failingService() {
      throw new TypeError(`bad ${PANEL}`)
    })
    expect(createPreviewLiveComments(params(), parts())).toBeUndefined()
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('could not start')
    expect(logged).toContain('TypeError')
    expect(logged).not.toContain('secret-project')

    vi.mocked(PreviewCommentService).mockImplementationOnce(function failingWithAString() {
      throw 'not an Error'
    })
    expect(createPreviewLiveComments(params(), parts())).toBeUndefined()
    expect(vi.mocked(logger.warn).mock.calls.at(-1)?.[1]).toMatchObject({ error: 'string' })
  })
})

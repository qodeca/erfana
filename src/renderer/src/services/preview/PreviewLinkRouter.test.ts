// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview link router tests (sd-074b §5.4).
 *
 * The point of this layer is that a link click ends up in the SAME open path as
 * a project-tree click, so an ineligible file opens as source without that rule
 * existing twice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PreviewOpenFileRequestedPayload } from '../../../../shared/ipc/preview-schema'

const openFileInPanel = vi.hoisted(() => vi.fn())
vi.mock('../../utils/openFileInPanel', () => ({ openFileInPanel }))

const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))
vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

import { createPreviewLinkRouter } from './PreviewLinkRouter'

/** A fake dockview api; the router only forwards it. */
const dockviewApi = { getPanel: vi.fn() } as never

function mount(options: {
  kind?: 'editor' | 'image' | 'preview'
  api?: unknown
  resolveKind?: ReturnType<typeof vi.fn>
}): {
  emit: (payload: PreviewOpenFileRequestedPayload) => void
  dispose: () => void
  unsubscribed: () => boolean
} {
  let listener: ((payload: PreviewOpenFileRequestedPayload) => void) | null = null
  let unsubscribed = false

  const router = createPreviewLinkRouter({
    subscribe: (callback) => {
      listener = callback
      return () => {
        unsubscribed = true
      }
    },
    getDockviewApi: () => (options.api === undefined ? dockviewApi : (options.api as never)),
    resolveKind: (options.resolveKind ??
      vi.fn().mockResolvedValue(options.kind ?? 'preview')) as never
  })

  return {
    emit: (payload) => listener?.(payload),
    dispose: () => router.dispose(),
    unsubscribed: () => unsubscribed
  }
}

const PAYLOAD: PreviewOpenFileRequestedPayload = {
  sourcePanelId: 'preview-1',
  filePath: '/projects/site/other.html',
  anchor: null
}

describe('createPreviewLinkRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens an eligible html file as a running preview', async () => {
    const harness = mount({ kind: 'preview' })

    harness.emit(PAYLOAD)
    await vi.waitFor(() => expect(openFileInPanel).toHaveBeenCalled())

    expect(openFileInPanel).toHaveBeenCalledWith(dockviewApi, PAYLOAD.filePath, {
      kind: 'preview',
      renderer: 'always'
    })
  })

  it('opens an ineligible html file as SOURCE, deciding that in the renderer', async () => {
    // Main sends no panel kind, so this rule lives in exactly one place.
    const harness = mount({ kind: 'editor' })

    harness.emit({ ...PAYLOAD, filePath: '/projects/site/node_modules/pkg/demo.html' })
    await vi.waitFor(() => expect(openFileInPanel).toHaveBeenCalled())

    expect(openFileInPanel).toHaveBeenCalledWith(
      dockviewApi,
      '/projects/site/node_modules/pkg/demo.html',
      { kind: 'editor' }
    )
  })

  it('does nothing when the project closed between the click and the event', async () => {
    const harness = mount({ api: null })

    harness.emit(PAYLOAD)
    await Promise.resolve()

    expect(openFileInPanel).not.toHaveBeenCalled()
  })

  it('logs and continues when resolving the panel kind throws', async () => {
    const harness = mount({ resolveKind: vi.fn().mockRejectedValue(new Error('boom')) })

    harness.emit(PAYLOAD)
    await vi.waitFor(() => expect(mockLogger.error).toHaveBeenCalled())

    expect(openFileInPanel).not.toHaveBeenCalled()
  })

  it('unsubscribes on dispose', () => {
    const harness = mount({})

    harness.dispose()

    expect(harness.unsubscribed()).toBe(true)
  })
})

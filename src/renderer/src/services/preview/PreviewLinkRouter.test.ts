// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview link router tests (sd-074b §5.4, issue #124 part 3 §3.6).
 *
 * The point of this layer is that a link click ends up in the SAME open path as
 * a project-tree click, so an ineligible file opens as source without that rule
 * existing twice – and, since #124, that a same-tab link goes to the move
 * coordinator instead. The production router has ONE creator
 * (`mountPreviewLinkRouter`, called by `EditorAreaSplitPanel`); the reader
 * creates nothing (changed on purpose: the lazily created singleton is gone).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../shared/errors'
import type { PreviewNavigateRequest } from '../../../../shared/ipc/preview-navigation-schema'
import type { PreviewOpenFileRequestedPayload } from '../../../../shared/ipc/preview-schema'

const openFileInPanel = vi.hoisted(() => vi.fn())
vi.mock('../../utils/openFileInPanel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openFileInPanel
}))

const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))
vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

import {
  createPreviewLinkRouter,
  getPreviewLinkRouter,
  mountPreviewLinkRouter,
  resetPreviewLinkRouter
} from './PreviewLinkRouter'
import { editorSaveRegistry } from '../editorSaveRegistry'
import { usePreviewTabStore } from '../../stores/usePreviewTabStore'
import { useProjectStore } from '../../stores/useProjectStore'

/** A fake dockview api; the router only forwards it. */
const dockviewApi = { getPanel: vi.fn() } as never

function mount(options: {
  kind?: 'editor' | 'image' | 'preview'
  api?: unknown
  resolveKind?: ReturnType<typeof vi.fn>
  getLinkMode?: (panelId: string) => 'new-tab' | 'same-tab'
}) {
  let listener: ((payload: PreviewOpenFileRequestedPayload) => void) | null = null
  let unsubscribed = false
  const tabMove = { move: vi.fn().mockResolvedValue({ status: 'cancelled' }) }

  const router = createPreviewLinkRouter({
    subscribe: (callback) => {
      listener = callback
      return () => {
        unsubscribed = true
      }
    },
    getDockviewApi: () => (options.api === undefined ? dockviewApi : (options.api as never)),
    resolveKind: (options.resolveKind ??
      vi.fn().mockResolvedValue(options.kind ?? 'preview')) as never,
    getLinkMode: options.getLinkMode,
    tabMove
  })

  return {
    router,
    tabMove,
    emit: (payload: PreviewOpenFileRequestedPayload) => listener?.(payload),
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
    usePreviewTabStore.getState().reset()
  })

  it('opens an eligible html file as a running preview', async () => {
    // Changed on purpose (issue #124): a new preview now carries the source
    // tab's link mode – `new-tab` for a source tab that never changed it.
    const harness = mount({ kind: 'preview' })

    harness.emit(PAYLOAD)
    await vi.waitFor(() => expect(openFileInPanel).toHaveBeenCalled())

    expect(openFileInPanel).toHaveBeenCalledWith(dockviewApi, PAYLOAD.filePath, {
      kind: 'preview',
      renderer: 'always',
      params: { linkMode: 'new-tab' }
    })
  })

  it("gives a new preview tab the source tab's link mode (part 3 §3.3)", async () => {
    usePreviewTabStore.getState().setLinkMode(PAYLOAD.sourcePanelId, 'same-tab')
    const harness = mount({ kind: 'preview' })

    // An explicit new-tab link from a same-tab tab: a new tab that inherits.
    harness.emit({ ...PAYLOAD, disposition: 'new-tab' })
    await vi.waitFor(() => expect(openFileInPanel).toHaveBeenCalled())

    expect(openFileInPanel).toHaveBeenCalledWith(
      dockviewApi,
      PAYLOAD.filePath,
      expect.objectContaining({ params: { linkMode: 'same-tab' } })
    )
  })

  it('reads the source mode through an injected reader when one is given', async () => {
    const getLinkMode = vi.fn().mockReturnValue('same-tab')
    const harness = mount({ kind: 'preview', getLinkMode })

    harness.emit(PAYLOAD)
    await vi.waitFor(() => expect(openFileInPanel).toHaveBeenCalled())

    expect(getLinkMode).toHaveBeenCalledWith('preview-1')
    expect(openFileInPanel).toHaveBeenCalledWith(
      dockviewApi,
      PAYLOAD.filePath,
      expect.objectContaining({ params: { linkMode: 'same-tab' } })
    )
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

  it('sends a same-tab link to the move coordinator and opens no tab (part 3 §3.6)', async () => {
    const harness = mount({ kind: 'preview' })

    harness.emit({ ...PAYLOAD, anchor: 'plans', disposition: 'same-tab' })
    await Promise.resolve()

    expect(harness.tabMove.move).toHaveBeenCalledWith({
      panelId: 'preview-1',
      origin: 'page',
      action: 'open',
      filePath: PAYLOAD.filePath,
      anchor: 'plans'
    })
    expect(openFileInPanel).not.toHaveBeenCalled()
  })

  it.each([
    ['same-tab', true],
    ['new-tab', false]
  ] as const)('a by-mode link follows the source tab mode (%s)', async (mode, moves) => {
    const harness = mount({ kind: 'preview', getLinkMode: () => mode })

    harness.emit({ ...PAYLOAD, disposition: 'by-mode' })
    await vi.waitFor(() =>
      expect(moves ? harness.tabMove.move : openFileInPanel).toHaveBeenCalled()
    )

    expect(moves ? openFileInPanel : harness.tabMove.move).not.toHaveBeenCalled()
  })

  it('moves a tab (Back and Forward) through the same coordinator', async () => {
    const harness = mount({})

    await harness.router.move({ panelId: 'preview-1', origin: 'chrome', action: 'back' })

    expect(harness.tabMove.move).toHaveBeenCalledWith({
      panelId: 'preview-1',
      origin: 'chrome',
      action: 'back'
    })
  })
})

describe('mountPreviewLinkRouter / getPreviewLinkRouter – one creator', () => {
  const A = '/proj/site/overview.html'
  const B = '/proj/site/pricing.html'
  let listener: ((payload: PreviewOpenFileRequestedPayload) => void) | null
  let bridge: { onOpenFileRequested: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }
  const unsubscribe = vi.fn()
  const panelOf = (id: string, component: string, filePath: string) => ({
    id,
    params: { filePath },
    view: { contentComponent: component, content: { element: document.createElement('div') } }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    listener = null
    bridge = {
      onOpenFileRequested: vi.fn((callback) => {
        listener = callback
        return unsubscribe
      }),
      navigate: vi.fn(async (request: PreviewNavigateRequest) =>
        request.action === 'open'
          ? { ok: true, target: { filePath: request.filePath, anchor: request.anchor }, generation: 1 }
          : { ok: false, errorCode: ErrorCode.PREVIEW_NAV_SKIPPED }
      )
    }
    ;(window as unknown as { api: unknown }).api = {
      preview: bridge,
      utils: { getPlatform: () => 'darwin' }
    }
    const panels = [panelOf('preview-t', 'htmlPreview', A), panelOf('editor-b', 'editor', B)]
    useProjectStore.setState({
      dockviewApi: { panels, getPanel: (id: string) => panels.find((p) => p.id === id) } as never,
      dirtyPanelIds: new Set(['editor-b'])
    })
    usePreviewTabStore.getState().reset()
    editorSaveRegistry.reset()
    resetPreviewLinkRouter()
  })

  afterEach(() => {
    resetPreviewLinkRouter()
    useProjectStore.setState({ dockviewApi: null, dirtyPanelIds: new Set() })
    delete (window as unknown as { api?: unknown }).api
  })

  const MOVE_TO_B = { panelId: 'preview-t', origin: 'chrome', action: 'open', filePath: B, anchor: null } as const

  it('the reader returns null before mount and creates nothing', () => {
    expect(getPreviewLinkRouter()).toBeNull()
    expect(bridge.onOpenFileRequested).not.toHaveBeenCalled()
  })

  it('mount subscribes and is what the reader returns; dispose unsubscribes and empties it', () => {
    const router = mountPreviewLinkRouter({ closePanel: vi.fn() })

    expect(getPreviewLinkRouter()).toBe(router)
    expect(bridge.onOpenFileRequested).toHaveBeenCalledTimes(1)

    router.dispose()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(getPreviewLinkRouter()).toBeNull()
  })

  it('a remount re-binds the prompt, and the old instance cannot clear the new one', async () => {
    const promptA = vi.fn().mockResolvedValue('cancel')
    const promptB = vi.fn().mockResolvedValue('cancel')
    const first = mountPreviewLinkRouter({ prompt: promptA, closePanel: vi.fn() })
    const second = mountPreviewLinkRouter({ prompt: promptB, closePanel: vi.fn() })

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    first.dispose()
    expect(getPreviewLinkRouter()).toBe(second)

    await expect(second.move(MOVE_TO_B)).resolves.toEqual({ status: 'cancelled' })
    expect(promptB).toHaveBeenCalledWith({ fileName: 'pricing.html', variant: 'save' })
    expect(promptA).not.toHaveBeenCalled()
  })

  it('without a prompt, a move that needs one is refused', async () => {
    const router = mountPreviewLinkRouter({ closePanel: vi.fn() })

    await expect(router.move(MOVE_TO_B)).resolves.toMatchObject({ status: 'refused', reason: 'no-prompt' })
  })

  it('Save goes through the save registry, then the other tab closes via closePanel', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const release = vi.fn()
    editorSaveRegistry.register('editor-b', { save, hasConflict: () => false, holdAutosave: () => release })
    const closePanel = vi.fn()
    const router = mountPreviewLinkRouter({ prompt: vi.fn().mockResolvedValue('save'), closePanel })

    await expect(router.move(MOVE_TO_B)).resolves.toMatchObject({ status: 'moved' })

    expect(save).toHaveBeenCalledTimes(1)
    expect(bridge.navigate).toHaveBeenCalledTimes(2)
    expect(closePanel).toHaveBeenCalledWith('editor-b')
    expect(release).not.toHaveBeenCalled()
  })

  it('a same-tab link from a page reaches main, and a refusal shows a global toast', async () => {
    bridge.navigate.mockResolvedValue({ ok: false, errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED })
    const toasts: Array<{ title: string }> = []
    const onToast = (event: Event) => toasts.push((event as CustomEvent).detail)
    window.addEventListener('app:toast', onToast)
    mountPreviewLinkRouter({ closePanel: vi.fn() })

    listener?.({ sourcePanelId: 'preview-t', filePath: B, anchor: null, disposition: 'same-tab' })
    await vi.waitFor(() => expect(toasts).toHaveLength(1))

    expect(bridge.navigate).toHaveBeenCalledWith(expect.objectContaining({ phase: 'check', filePath: B }))
    expect(toasts[0].title).toBe('Could not show pricing.html')
    window.removeEventListener('app:toast', onToast)
  })

  it('mounts without a preview bridge: nothing is routed and nothing throws', () => {
    delete (window as unknown as { api?: unknown }).api

    expect(() => mountPreviewLinkRouter({ closePanel: vi.fn() })).not.toThrow()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Live-view eviction tests (issue #124, WI-2).
 *
 * `PreviewViewService.test.ts` ("live-view budget") drives eviction through the
 * service with a real registry. These cases reach what that suite cannot: a
 * candidate whose view is already gone, and a still-frame capture that never
 * settles. The capture wait runs under fake timers, so its bound is advanced
 * rather than waited out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import type { PreviewLiveView } from './PreviewLiveView'
import { createPreviewViewEviction, type PreviewViewEvictionDeps } from './previewViewEviction'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** The three calls eviction makes on a live view. */
interface FakeView {
  readonly view: PreviewLiveView
  readonly setVisibility: ReturnType<typeof vi.fn<(visible: boolean) => void>>
  readonly whenCaptureSettled: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly teardown: ReturnType<typeof vi.fn<(mode: 'immediate' | 'bounded') => Promise<void>>>
}

function makeView(): FakeView {
  const setVisibility = vi.fn<(visible: boolean) => void>()
  const whenCaptureSettled = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const teardown = vi.fn<(mode: 'immediate' | 'bounded') => Promise<void>>(() => Promise.resolve())
  const view = { setVisibility, whenCaptureSettled, teardown } as unknown as PreviewLiveView
  return { view, setVisibility, whenCaptureSettled, teardown }
}

/** Eviction over a fake registry that offers `candidates` and holds `views`. */
function makeEviction(
  candidates: readonly string[],
  views: ReadonlyMap<string, FakeView>
): {
  enforceBudget: (keepPanelId: string) => Promise<void>
  evictionCandidates: ReturnType<typeof vi.fn<(limit: number, keep: string) => readonly string[]>>
  invalidateOpen: ReturnType<typeof vi.fn<(panelId: string) => void>>
  onSuspended: ReturnType<typeof vi.fn<(panelId: string) => void>>
} {
  const evictionCandidates = vi.fn<(limit: number, keep: string) => readonly string[]>(
    () => candidates
  )
  const invalidateOpen = vi.fn<(panelId: string) => void>()
  const remove = vi.fn<(panelId: string) => PreviewLiveView | null>(
    panelId => views.get(panelId)?.view ?? null
  )
  const onSuspended = vi.fn<(panelId: string) => void>()
  const deps: PreviewViewEvictionDeps = {
    registry: { evictionCandidates, invalidateOpen, remove },
    onSuspended
  }
  const eviction = createPreviewViewEviction(deps)
  return {
    enforceBudget: keepPanelId => eviction.enforceBudget(keepPanelId),
    evictionCandidates,
    invalidateOpen,
    onSuspended
  }
}

/** Swallow warnings so the run stays quiet, and hand back the spy. */
function spyOnWarn(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(logger, 'warn').mockImplementation(() => {})
}

describe('createPreviewViewEviction — a candidate with no view', () => {
  it('skips it quietly and still suspends the next candidate', async () => {
    // Suspends run one after another, so while an earlier one awaits its
    // capture and teardown, a close can remove a later candidate first. That
    // candidate must cost nothing: no teardown, and no 'suspended' for a panel
    // the renderer has already closed.
    const warn = spyOnWarn()
    const live = makeView()
    const h = makeEviction(['panel-gone', 'panel-live'], new Map([['panel-live', live]]))

    await h.enforceBudget('panel-new')

    expect(h.evictionCandidates).toHaveBeenCalledWith(PREVIEW.MAX_LIVE_VIEWS, 'panel-new')
    expect(h.onSuspended.mock.calls).toEqual([['panel-live']])
    expect(live.teardown).toHaveBeenCalledWith('immediate')
    expect(warn).not.toHaveBeenCalled()
  })

  it('still invalidates its open', async () => {
    // It happens before the registry is asked for the view: an open parked on
    // its load must abandon.
    const h = makeEviction(['panel-gone'], new Map())

    await h.enforceBudget('panel-new')

    expect(h.invalidateOpen).toHaveBeenCalledWith('panel-gone')
    expect(h.onSuspended).not.toHaveBeenCalled()
  })
})

describe('createPreviewViewEviction — a capture that never settles', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('waits no longer than the capture bound, logs it and suspends anyway', async () => {
    const warn = spyOnWarn()
    const live = makeView()
    live.whenCaptureSettled.mockReturnValue(new Promise<void>(() => {}))
    const h = makeEviction(['panel-1'], new Map([['panel-1', live]]))

    const enforcing = h.enforceBudget('panel-new')
    await vi.advanceTimersByTimeAsync(PREVIEW.CAPTURE_SETTLE_TIMEOUT_MS - 1)

    // Hidden at once, but not destroyed while the capture may still be reading
    // the page.
    expect(live.setVisibility).toHaveBeenCalledWith(false)
    expect(live.teardown).not.toHaveBeenCalled()
    expect(h.onSuspended).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await enforcing

    expect(warn).toHaveBeenCalledWith(
      'Preview eviction: capture did not settle; suspending anyway',
      { panelId: stablePathDigest('panel-1'), error: 'TimeoutError' }
    )
    expect(live.teardown).toHaveBeenCalledWith('immediate')
    expect(h.onSuspended).toHaveBeenCalledWith('panel-1')
  })
})

describe('createPreviewViewEviction — enforceBudget never rejects', () => {
  it('logs a failed teardown, whatever was thrown, and still reports the suspend', async () => {
    // A throw here must not become the answer of the open that asked for the
    // budget, and the renderer must still hear 'suspended' or the tab stays dead.
    const warn = spyOnWarn()
    const live = makeView()
    live.teardown.mockRejectedValue('renderer gone')
    const h = makeEviction(['panel-1'], new Map([['panel-1', live]]))

    await expect(h.enforceBudget('panel-new')).resolves.toBeUndefined()

    expect(h.onSuspended).toHaveBeenCalledWith('panel-1')
    expect(warn).toHaveBeenCalledWith('Preview live-view budget enforcement failed', {
      panelId: stablePathDigest('panel-new'),
      error: 'string'
    })
  })
})

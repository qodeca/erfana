// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One page's state and a view's holder of them (issue #124, WI-29; part 2 §2.3).
 * The failure log is the real one, so its coalesce timers are real too: a
 * snapshot a disposed or pending page must never send would be sent here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { describeFramesOverLimit } from '../../../shared/previewFrameBadgeText'
import { createPreviewFailureLog } from './PreviewFailureLog'
import {
  createPageScopeHolder,
  createPreviewPageScope,
  type PreviewPageScopeHandle
} from './previewPageScope'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const SCRIPT_ERROR: PreviewFailureInput = {
  type: 'script-error',
  resourceUrlOrHost: 'boom',
  reasonCode: ErrorCode.UNKNOWN_ERROR
}
/** The protocol handler's refusal of a page's main document. */
const REFUSED_PAGE: PreviewFailureInput = {
  type: 'missing-local-file',
  resourceUrlOrHost: '/b.html',
  reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
}
/** The allowlist's load-time badge: the view's, not one page's (#115). */
const ALLOWLIST_INVALID: PreviewFailureInput = {
  type: 'allowlist-invalid',
  resourceUrlOrHost: '.erfana/settings.json',
  reasonCode: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
}

/** A CSP report as the page's preload sends it. */
function cspReport(url: string): { blockedURI: string; effectiveDirective: string } {
  return { blockedURI: url, effectiveDirective: 'img-src' }
}

function makeScopes() {
  const emit = {
    failuresChanged:
      vi.fn<(panelId: string, failures: readonly PreviewFailureInput[], truncated: boolean) => void>(),
    hostBlocked: vi.fn<
      (
        panelId: string,
        host: string,
        approvable: boolean,
        kinds: readonly string[],
        truncated: boolean
      ) => void
    >()
  }
  const created: PreviewPageScopeHandle[] = []
  const createScope = (): PreviewPageScopeHandle => {
    const scope = createPreviewPageScope({
      panelId: 'panel-A',
      emit,
      createFailureLog: (onEmit) => createPreviewFailureLog({ onEmit })
    })
    created.push(scope)
    return scope
  }
  return { emit, created, createScope }
}

describe('createPreviewPageScope', () => {
  it('stays silent until it goes live, while still keeping what was recorded', async () => {
    const { emit, createScope } = makeScopes()
    const scope = createScope()

    scope.recordFailure(SCRIPT_ERROR)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)

    expect(emit.failuresChanged).not.toHaveBeenCalled()
    expect(scope.failures()).toEqual([expect.objectContaining(SCRIPT_ERROR)])
  })

  it('sends its snapshot at once when it goes live with `announce`, an empty list included', () => {
    const { emit, createScope } = makeScopes()

    createScope().goLive(true)
    expect(emit.failuresChanged).toHaveBeenLastCalledWith('panel-A', [], false)

    const refused = createScope()
    refused.recordFailure(REFUSED_PAGE)
    refused.goLive(true)
    expect(emit.failuresChanged).toHaveBeenLastCalledWith(
      'panel-A',
      [expect.objectContaining(REFUSED_PAGE)],
      false
    )
  })

  it('goes live once, then emits through its coalesced log', async () => {
    const { emit, createScope } = makeScopes()
    const scope = createScope()

    scope.goLive(false)
    scope.goLive(true)
    expect(emit.failuresChanged).not.toHaveBeenCalled()

    scope.recordFailure(SCRIPT_ERROR)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(emit.failuresChanged).toHaveBeenCalledTimes(1)
  })

  it("carries the log's `truncated` flag, seen while silent, into the snapshot it announces", async () => {
    const { emit, createScope } = makeScopes()
    const scope = createScope()
    for (let i = 0; i <= PREVIEW.MAX_FAILURES; i += 1) {
      scope.recordFailure(SCRIPT_ERROR)
    }
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)

    scope.goLive(true)

    expect(emit.failuresChanged).toHaveBeenCalledTimes(1)
    expect(emit.failuresChanged).toHaveBeenLastCalledWith('panel-A', expect.any(Array), true)
  })

  it('reports a refused host to the band once and every refusal to its log', () => {
    const { emit, createScope } = makeScopes()
    const scope = createScope()
    scope.goLive(false)

    scope.reportBlocked('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/a.png', true, 'image')
    scope.reportBlocked('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/b.png', true, 'image')

    expect(emit.hostBlocked).toHaveBeenCalledTimes(1)
    expect(scope.failures()).toHaveLength(2)
  })

  it('feeds a CSP violation through its own dedupe into its own ledger and log', () => {
    const { emit, createScope } = makeScopes()
    const scope = createScope()
    scope.goLive(false)

    scope.handleCspViolation(cspReport('https://cdn.example.com/a.png'))
    scope.handleCspViolation(cspReport('https://cdn.example.com/b.png'))

    expect(emit.hostBlocked).toHaveBeenCalledTimes(1)
    expect(emit.hostBlocked.mock.calls[0][1]).toBe('https://cdn.example.com')
    expect(scope.failures()).toEqual([
      expect.objectContaining({ type: 'blocked-host', resourceUrlOrHost: 'https://cdn.example.com' })
    ])
  })

  it('records refused frames into its own log', () => {
    const { createScope } = makeScopes()
    const scope = createScope()

    scope.frameRefusals.record('frame-remote', 'https://example.com/frame')

    expect(scope.failures()).toEqual([
      expect.objectContaining({ type: 'frame-remote', resourceUrlOrHost: 'https://example.com/frame' })
    ])
  })

  it('is inert once disposed: its timer cancelled, later writes ignored, nothing emitted', async () => {
    const { emit, createScope } = makeScopes()
    const scope = createScope()
    scope.goLive(false)
    scope.recordFailure(SCRIPT_ERROR)

    scope.dispose()
    scope.dispose()
    scope.recordFailure(SCRIPT_ERROR)
    scope.reportBlocked('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/a.png', true, 'image')
    scope.handleCspViolation(cspReport('https://other.example.com/a.png'))
    scope.frameRefusals.record('frame-remote', 'https://example.com/frame')
    scope.goLive(true)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)

    expect(emit.failuresChanged).not.toHaveBeenCalled()
    expect(emit.hostBlocked).not.toHaveBeenCalled()
    expect(scope.failures()).toEqual([])
  })
})

describe('createPageScopeHolder', () => {
  it('commits the first page from the start, live but silent until its first failure', async () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)

    expect(created).toHaveLength(1)
    expect(holder.committed()).toBe(created[0])
    expect(holder.forMainDocument()).toBe(created[0])
    expect(emit.failuresChanged).not.toHaveBeenCalled()

    holder.committed().recordFailure(SCRIPT_ERROR)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(emit.failuresChanged).toHaveBeenCalledWith(
      'panel-A',
      [expect.objectContaining(SCRIPT_ERROR)],
      false
    )
  })

  it('lets only a main-document write reach the pending page', async () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)

    holder.beginPending()
    expect(holder.committed()).toBe(created[0])
    expect(holder.forMainDocument()).toBe(created[1])

    holder.forMainDocument().recordFailure(REFUSED_PAGE)
    // A late event of the page on screen stays in that page's scope.
    holder.committed().recordFailure(SCRIPT_ERROR)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)

    // The badge shows the page on screen only; the pending refusal waits, silent.
    expect(emit.failuresChanged).toHaveBeenCalledTimes(1)
    expect(emit.failuresChanged).toHaveBeenLastCalledWith(
      'panel-A',
      [expect.objectContaining(SCRIPT_ERROR)],
      false
    )
    expect(created[1].failures()).toEqual([expect.objectContaining(REFUSED_PAGE)])
  })

  it('commit: the pending page takes over, the old one and its timer go, the new snapshot is sent', async () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.committed().recordFailure(SCRIPT_ERROR)
    holder.beginPending()
    holder.forMainDocument().recordFailure(REFUSED_PAGE)

    holder.commit()

    expect(holder.committed()).toBe(created[1])
    expect(holder.forMainDocument()).toBe(created[1])
    // The main-document refusal survives the commit and is sent at once.
    expect(emit.failuresChanged).toHaveBeenCalledTimes(1)
    expect(emit.failuresChanged).toHaveBeenLastCalledWith(
      'panel-A',
      [expect.objectContaining(REFUSED_PAGE)],
      false
    )
    // The old page's armed timer went with it: no late snapshot of the old page.
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)
    const sentTypes = emit.failuresChanged.mock.calls.flatMap(([, failures]) =>
      failures.map((failure) => failure.type)
    )
    expect(sentTypes).not.toContain('script-error')
    created[0].recordFailure(SCRIPT_ERROR)
    expect(created[0].failures()).toEqual([])
  })

  it('commit sends an empty snapshot for a clean page, so the badge mirrors main', () => {
    const { emit, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.committed().recordFailure(SCRIPT_ERROR)
    holder.beginPending()

    holder.commit()

    expect(emit.failuresChanged).toHaveBeenCalledWith('panel-A', [], false)
  })

  it('dropPending keeps the committed page, its badge and its timer', async () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.committed().recordFailure(SCRIPT_ERROR)
    holder.beginPending()
    holder.forMainDocument().recordFailure(REFUSED_PAGE)

    holder.dropPending()

    expect(holder.committed()).toBe(created[0])
    expect(holder.forMainDocument()).toBe(created[0])
    expect(created[1].failures()).toEqual([])
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS)
    expect(emit.failuresChanged).toHaveBeenCalledTimes(1)
    expect(emit.failuresChanged).toHaveBeenLastCalledWith(
      'panel-A',
      [expect.objectContaining(SCRIPT_ERROR)],
      false
    )
  })

  it('a second beginPending drops the first pending page', () => {
    const { created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.beginPending()
    holder.forMainDocument().recordFailure(REFUSED_PAGE)

    holder.beginPending()

    expect(holder.forMainDocument()).toBe(created[2])
    expect(created[1].failures()).toEqual([])
  })

  it('commit and dropPending do nothing when nothing is pending', () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)

    holder.commit()
    holder.dropPending()

    expect(holder.committed()).toBe(created[0])
    expect(emit.failuresChanged).not.toHaveBeenCalled()
  })

  it('dispose ends both pages and their timers and emits nothing; no page is created after it', async () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.committed().recordFailure(SCRIPT_ERROR)
    holder.beginPending()
    holder.forMainDocument().recordFailure(REFUSED_PAGE)

    holder.dispose()
    holder.dispose()
    holder.beginPending()
    holder.commit()
    holder.committed().recordFailure(SCRIPT_ERROR)
    holder.forMainDocument().recordFailure(REFUSED_PAGE)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)

    expect(created).toHaveLength(2)
    expect(emit.failuresChanged).not.toHaveBeenCalled()
    expect(created.map((scope) => scope.failures())).toEqual([[], []])
  })

  it("puts the view's failures into every page it starts, and forgets them with the view (#115)", async () => {
    const { emit, created, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.beginPending()

    holder.recordViewFailure(ALLOWLIST_INVALID)
    // Both the page on screen and the page loading carry it.
    expect(created.map((scope) => scope.failures())).toEqual([
      [expect.objectContaining(ALLOWLIST_INVALID)],
      [expect.objectContaining(ALLOWLIST_INVALID)]
    ])

    // A page started later begins with it, ahead of its own failures.
    holder.beginPending()
    holder.forMainDocument().recordFailure(REFUSED_PAGE)
    holder.commit()
    expect(emit.failuresChanged).toHaveBeenLastCalledWith(
      'panel-A',
      [expect.objectContaining(ALLOWLIST_INVALID), expect.objectContaining(REFUSED_PAGE)],
      false
    )

    holder.dispose()
    holder.recordViewFailure(ALLOWLIST_INVALID)
    await vi.advanceTimersByTimeAsync(PREVIEW.FAILURE_COALESCE_MS * 2)

    expect(emit.failuresChanged).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(3)
    expect(created[2].failures()).toEqual([])
  })

  it('resets the log and the CSP dedupe together: a host page A reported is news again on B', () => {
    const { emit, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    holder.committed().handleCspViolation(cspReport('https://cdn.example.com/a.png'))
    holder.committed().handleCspViolation(cspReport('https://cdn.example.com/a.png'))
    expect(emit.hostBlocked).toHaveBeenCalledTimes(1)

    holder.beginPending()
    holder.commit()
    expect(holder.committed().failures()).toEqual([])
    holder.committed().handleCspViolation(cspReport('https://cdn.example.com/a.png'))

    expect(emit.hostBlocked).toHaveBeenCalledTimes(2)
    expect(holder.committed().failures()).toHaveLength(1)
  })

  it('resets the blocked-host ledger with the page: a hostname gets its budget back on B', () => {
    const { emit, createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    const report = (port: number): void =>
      holder
        .committed()
        .reportBlocked('blocked-host', `https://cdn.example.com:${port}`, 'https://cdn.example.com/a.js', true, 'script')
    for (let port = 1; port <= 20; port += 1) {
      report(port)
    }
    expect(emit.hostBlocked).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST)

    holder.beginPending()
    holder.commit()
    report(9999)

    expect(emit.hostBlocked).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST + 1)
  })

  it("keeps page A's refused frames out of page B", () => {
    const { createScope } = makeScopes()
    const holder = createPageScopeHolder(createScope)
    expect(holder.committed().frameRefusals.record('frame-remote', 'https://example.com/f')).toBe(true)

    holder.beginPending()
    holder.commit()

    expect(holder.committed().failures()).toEqual([])
    expect(holder.committed().frameRefusals.record('frame-remote', 'https://example.com/f')).toBe(true)
  })
})

describe("a page scope's frame bookkeeping (WI-14)", () => {
  const overLimitEntries = (scope: PreviewPageScopeHandle): string[] =>
    scope
      .failures()
      .filter((entry) => entry.type === 'frame-over-limit')
      .map((entry) => entry.resourceUrlOrHost)

  it('remembers which frames showed a document, until the page ends', () => {
    const scope = makeScopes().createScope()

    scope.frames.noteCommitted(7)
    expect(scope.frames.hasCommitted(7)).toBe(true)
    expect(scope.frames.hasCommitted(8)).toBe(false)

    scope.dispose()
    expect(scope.frames.hasCommitted(7)).toBe(false)
  })

  it('lists frames past the cap once, FRAME_OVER_LIMIT_QUIET_MS after the last, then only counts', () => {
    const scope = makeScopes().createScope()
    const quiet = PREVIEW_LIMITS.FRAME_OVER_LIMIT_QUIET_MS

    scope.frames.countOverLimit('src')
    vi.advanceTimersByTime(quiet - 1)
    scope.frames.countOverLimit('src')
    vi.advanceTimersByTime(quiet - 1)
    expect(overLimitEntries(scope)).toEqual([])
    expect(scope.frames.isOverCap()).toBe(true)

    vi.advanceTimersByTime(1)
    expect(overLimitEntries(scope)).toEqual([describeFramesOverLimit(2, 'src')])

    scope.frames.countOverLimit('src')
    scope.frames.flushOverLimit()
    vi.advanceTimersByTime(quiet * 2)
    expect(overLimitEntries(scope)).toEqual([describeFramesOverLimit(2, 'src')])
  })

  it('writes both kinds at once when the page stops loading', () => {
    const scope = makeScopes().createScope()

    scope.frames.countOverLimit('srcdoc')
    scope.frames.countOverLimit('src')
    scope.frames.countOverLimit('srcdoc')
    scope.frames.flushOverLimit()

    expect(overLimitEntries(scope)).toEqual([
      describeFramesOverLimit(1, 'src'),
      describeFramesOverLimit(2, 'srcdoc')
    ])
  })

  it("dispose cancels the over-limit timer and forgets the page's counters (RS14)", () => {
    const scope = makeScopes().createScope()
    scope.frames.countOverLimit('src')

    scope.dispose()
    scope.frames.countOverLimit('src')
    scope.frames.noteCommitted(3)
    vi.advanceTimersByTime(PREVIEW_LIMITS.FRAME_OVER_LIMIT_QUIET_MS * 2)
    scope.frames.flushOverLimit()

    expect(scope.failures()).toEqual([])
    expect(scope.frames.isOverCap()).toBe(false)
    expect(scope.frames.hasCommitted(3)).toBe(false)
  })

  it('remembers a bounded number of frames; one past the bound counts as never shown', () => {
    const scope = makeScopes().createScope()

    for (let id = 1; id <= 5_000; id += 1) {
      scope.frames.noteCommitted(id)
    }

    expect(scope.frames.hasCommitted(1)).toBe(true)
    expect(scope.frames.hasCommitted(5_000)).toBe(false)
  })
})

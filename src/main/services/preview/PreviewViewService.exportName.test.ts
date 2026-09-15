// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The name Export to PDF suggests follows the page on screen (issue #124,
 * part 3 §3.10, P3-AC2): the first page's name, then the page a same-tab move
 * landed on – never a page a move has not committed yet. The request carries
 * only the panel id, so the name is derived main-side; the service's
 * `suggestedName` is only the fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewViewDeps } from './PreviewViewService'
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

/**
 * The harness's export controller. The shared harness does not return its
 * deps, so read them off the service (as `PreviewSessionFactory.partitionRecycling.test.ts` does).
 */
function exportToPdfOf(h: NavHarness): Mock {
  return (h.service as unknown as { deps: PreviewViewDeps }).deps.exportController
    .exportToPdf as Mock
}

/** The name the last export asked the save dialog to suggest. */
function lastSuggestedName(h: NavHarness): unknown {
  return exportToPdfOf(h).mock.calls.at(-1)?.[1]
}

describe('PreviewViewService — the PDF name follows the page on screen', () => {
  it("suggests the first page's name", async () => {
    const h = makeHarness()
    await h.openCommitted('a.html')

    await h.service.exportPdf('panel-A', 'preview')

    expect(lastSuggestedName(h)).toBe('a')
  })

  it('suggests the page a same-tab move landed on, once it commits', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    await h.move('b.html')

    // The move has not committed: a.html is still the page on screen.
    await h.service.exportPdf('panel-A', 'preview')
    expect(lastSuggestedName(h)).toBe('a')

    page.commit(h.url('b.html'))
    await h.service.exportPdf('panel-A', 'preview')
    expect(lastSuggestedName(h)).toBe('b')
  })

  it('opens no dialog when the panel has no live page', async () => {
    const h = makeHarness()

    const result = await h.service.exportPdf('panel-A', 'preview')

    expect(result).toEqual({ ok: false, errorCode: ErrorCode.PDF_EXPORT_FAILED })
    expect(exportToPdfOf(h)).not.toHaveBeenCalled()
  })
})

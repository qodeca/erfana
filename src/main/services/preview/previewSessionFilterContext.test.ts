// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The contexts a preview session's protocol handler and request filter run on
 * (issue #124, WI-12; design part 2 §2.2, §2.4): one ledger shared by both,
 * the session's own token for the filter, and every write routed to the page
 * it belongs to, looked up at the moment it is written (WI-29).
 */
import { describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { PreviewFrameRefusalType } from './previewFrameRefusals'
import {
  buildPreviewSessionContexts,
  type PreviewSessionContextParams,
  type PreviewSessionPageScopes
} from './previewSessionFilterContext'

const TOKEN = 'abc123abc123abc123abc123abc123ab'
const ENTRY = { realRoot: '/real/proj', csp: "default-src 'none'; sandbox allow-scripts" }

const FAILURE: PreviewFailureInput = {
  type: 'missing-local-file',
  resourceUrlOrHost: '/gone.html',
  reasonCode: ErrorCode.PREVIEW_LOCAL_FILE_MISSING
}

/** A page as the session sees it, with spies for both of its sinks. */
function makePage() {
  return {
    recordFailure: vi.fn<(input: PreviewFailureInput) => void>(),
    frameRefusals: { record: vi.fn<(type: PreviewFrameRefusalType, address: string) => boolean>() }
  }
}

/** Page scopes whose page on screen and page loading the test swaps by hand. */
function makeScopes() {
  const slots = { onScreen: makePage(), loading: makePage() }
  const scopes: PreviewSessionPageScopes = {
    committed: () => slots.onScreen,
    forMainDocument: () => slots.loading,
    recordViewFailure: vi.fn()
  }
  const pageScopes = vi.fn(() => scopes)
  return { slots, pageScopes }
}

function build(overrides: Partial<PreviewSessionContextParams> = {}) {
  const { slots, pageScopes } = makeScopes()
  const allowed = new Set(['https://cdn.example'])
  const onBlocked = vi.fn()
  const resolve = vi.fn((token: string) => (token === TOKEN ? ENTRY : null))
  const contexts = buildPreviewSessionContexts({
    token: TOKEN,
    resolve,
    getAllowedHosts: () => allowed,
    pageScopes,
    onBlocked,
    ...overrides
  })
  return { contexts, slots, pageScopes, onBlocked, resolve, allowed }
}

describe('buildPreviewSessionContexts', () => {
  it("gives the filter this session's token and the registry's lookup to the handler", () => {
    const { contexts, resolve, allowed } = build()

    expect(contexts.filter.ownToken).toBe(TOKEN)
    expect(contexts.protocol.resolve(TOKEN)).toBe(ENTRY)
    expect(contexts.protocol.resolve('other')).toBeNull()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(contexts.filter.getAllowedHosts()).toBe(allowed)
  })

  it('shares one ledger: what the filter notes, the handler takes (S1)', () => {
    const { contexts } = build()
    const url = `erfana-preview://${TOKEN}/child.html`

    contexts.filter.ledger.note(url, 'subFrame')

    expect(contexts.protocol.ledger.take(url)).toBe('subFrame')
    expect(contexts.protocol.ledger.take(url)).toBeUndefined()
  })

  it('builds a fresh ledger for every session', () => {
    const first = build()
    const second = build()
    const url = `erfana-preview://${TOKEN}/a.html`

    first.contexts.filter.ledger.note(url, 'mainFrame')

    expect(second.contexts.protocol.ledger.take(url)).toBeUndefined()
    expect(first.contexts.protocol.ledger.take(url)).toBe('mainFrame')
  })

  it("routes a main-frame document's failure to the page it belongs to, and a diagnostic to the page on screen", () => {
    const { contexts, slots } = build()

    contexts.protocol.recordDocumentFailure(FAILURE)
    contexts.protocol.recordFailure({ ...FAILURE, type: 'csp-missing' })

    expect(slots.loading.recordFailure).toHaveBeenCalledWith(FAILURE)
    expect(slots.onScreen.recordFailure).toHaveBeenCalledWith({ ...FAILURE, type: 'csp-missing' })
    expect(slots.onScreen.recordFailure).toHaveBeenCalledTimes(1)
    expect(slots.loading.recordFailure).toHaveBeenCalledTimes(1)
  })

  it("lists both layers' frame refusals in the refusal set of the page on screen", () => {
    const { contexts, slots } = build()

    contexts.filter.recordFrameRefusal('frame-remote', 'https://evil.example/')
    contexts.protocol.recordFrameRefusal('frame-excluded', '/node_modules/x.html')

    expect(slots.onScreen.frameRefusals.record.mock.calls).toEqual([
      ['frame-remote', 'https://evil.example/'],
      ['frame-excluded', '/node_modules/x.html']
    ])
    expect(slots.loading.frameRefusals.record).not.toHaveBeenCalled()
    // A frame refusal is a badge entry, never a permission-band row.
    expect(slots.onScreen.recordFailure).not.toHaveBeenCalled()
  })

  it('asks the page scopes at every write and never keeps a page (WI-29)', () => {
    const { contexts, slots, pageScopes } = build()
    const pageA = slots.onScreen

    contexts.filter.recordFrameRefusal('frame-escape', 'erfana-preview://x/a.html')
    // A load commits: the next write goes to the new page on screen.
    const pageB = makePage()
    slots.onScreen = pageB
    contexts.filter.recordFrameRefusal('frame-escape', 'erfana-preview://x/b.html')
    contexts.protocol.recordFailure(FAILURE)

    expect(pageA.frameRefusals.record).toHaveBeenCalledTimes(1)
    expect(pageB.frameRefusals.record).toHaveBeenCalledWith('frame-escape', 'erfana-preview://x/b.html')
    expect(pageB.recordFailure).toHaveBeenCalledWith(FAILURE)
    expect(pageA.recordFailure).not.toHaveBeenCalled()
    expect(pageScopes).toHaveBeenCalledTimes(3)
  })

  it('passes a network refusal straight to the band sink and ignores request lifetimes', () => {
    const { contexts, onBlocked } = build()

    contexts.filter.onBlocked('blocked-host', 'https://evil.example', 'https://evil.example/x', true, 'script')
    contexts.filter.onRequestStarted(1)
    contexts.filter.onRequestSettled(1)

    expect(onBlocked).toHaveBeenCalledWith(
      'blocked-host',
      'https://evil.example',
      'https://evil.example/x',
      true,
      'script'
    )
  })
})

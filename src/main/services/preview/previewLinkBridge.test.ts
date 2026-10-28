// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page→main link channel (sd-074b §5.1–5.3).
 *
 * The bridge is what stands between an untrusted preview renderer and the side
 * effects in `previewLinkNavigation`, so its own rules — validation, the two
 * per-provenance budgets, de-duplication — need testing directly rather than
 * through the e2e suite, which cannot reach the preload path at all (a
 * synthesised click has `isTrusted === false`, which the preload refuses).
 *
 * THE PROVENANCE SPLIT IS THE POINT. `handleActivation` carries a proven user
 * gesture; `handleWillNavigate` does not, because a page can drive it with
 * `location.href` and no click. Lens review F1: before the split, a page could
 * run `setInterval(() => location.href = …)` and reach `shell.openExternal` at
 * ten dialogs a second with nobody touching the mouse.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { createPreviewLinkBridge, type PreviewLinkBridge } from './previewLinkBridge'
import type { PreviewLinkContext, PreviewLinkNavigationDeps } from './previewLinkNavigation'
import type { ConfineVerdict } from './previewPathResolve'
import { CLICK_SETTLE_CAP_MS, NAVIGATION_GRACE_MS } from './previewNavigationHold'

// A fake 32-hex preview root token. Not a credential: the real one is minted
// per view by PreviewRootRegistry and never leaves the main process.
const TOKEN = 'abcdef0123456789abcdef0123456789' // gitleaks:allow
const REAL_ROOT = '/projects/site'

const CONTEXT: PreviewLinkContext = {
  panelId: 'preview-1',
  token: TOKEN,
  realRoot: REAL_ROOT,
  windowId: 7,
  currentUrl: `erfana-preview://${TOKEN}/index.html`
}

type SpiedDeps = PreviewLinkNavigationDeps & {
  requestOpenFile: Mock
  openExternal: Mock
  recordFailure: Mock
  confine: Mock
  now: () => number
}

/** Frozen clock so the budgets and the de-dupe window are deterministic. */
let clock = 1_000_000

function makeDeps(
  verdict: ConfineVerdict = { ok: true, realTarget: `${REAL_ROOT}/a.html`, rel: 'a.html' }
): SpiedDeps {
  return {
    requestOpenFile: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn(),
    confine: vi.fn().mockResolvedValue(verdict),
    now: () => clock
  }
}

function makeBridge(deps: SpiedDeps): PreviewLinkBridge {
  return createPreviewLinkBridge(CONTEXT, deps)
}

/** A well-formed payload from the preload. */
function payload(href: string): unknown {
  return { href, target: '', download: false, button: 0 }
}

const EXTERNAL = 'https://example.com/docs'
const IN_PROJECT = `erfana-preview://${TOKEN}/docs/a.html`

beforeEach(() => {
  clock = 1_000_000
})

describe('createPreviewLinkBridge — provenance', () => {
  it('hands an external link to the OS when it came from a real click', async () => {
    const deps = makeDeps()
    makeBridge(deps).handleActivation(payload(EXTERNAL))
    await vi.waitFor(() => expect(deps.openExternal).toHaveBeenCalledWith(EXTERNAL))
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('refuses an external link that arrived through will-navigate', async () => {
    const deps = makeDeps()
    makeBridge(deps).handleWillNavigate(EXTERNAL)

    // The page drove this, not the user. Nothing reaches the OS.
    await vi.waitFor(() =>
      expect(deps.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'blocked-link',
          reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
        })
      )
    )
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('still opens an in-project link that arrived through will-navigate', async () => {
    const deps = makeDeps()
    makeBridge(deps).handleWillNavigate(IN_PROJECT)
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
  })
})

describe('createPreviewLinkBridge — validation', () => {
  it('records a failure for a malformed payload and routes nothing', () => {
    const deps = makeDeps()
    makeBridge(deps).handleActivation({ nope: true })
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked-link' })
    )
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('accepts the raw href attribute the preload now reports', async () => {
    const deps = makeDeps()
    makeBridge(deps).handleActivation({ ...(payload(IN_PROJECT) as object), rawHref: 'docs/a.html' })

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('an over-long raw href costs only the label, never the activation', async () => {
    // `rawHref` is refusal-only label data. URL resolution collapses dot
    // segments, so a page can make the attribute exceed the bound while the
    // resolved href is short and legal; failing the WHOLE payload turned that
    // into "(malformed link message)" — the label defect this field exists to
    // remove, page-triggerable.
    const deps = makeDeps()
    makeBridge(deps).handleActivation({
      ...(payload(IN_PROJECT) as object),
      rawHref: 'a'.repeat(2049)
    })

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('applies the same length bound to will-navigate as to the preload', async () => {
    const deps = makeDeps()
    const overlong = `https://example.com/${'a'.repeat(2100)}`
    makeBridge(deps).handleWillNavigate(overlong)

    await vi.waitFor(() => expect(deps.recordFailure).toHaveBeenCalled())
    expect(deps.openExternal).not.toHaveBeenCalled()
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
  })

  it('accepts an href exactly at the bound', async () => {
    const deps = makeDeps()
    const prefix = `erfana-preview://${TOKEN}/`
    const atLimit = prefix + 'a'.repeat(2048 - prefix.length)
    expect(atLimit).toHaveLength(2048)

    makeBridge(deps).handleActivation(payload(atLimit))
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
  })
})

describe('createPreviewLinkBridge — budgets', () => {
  it('honours ten gesture activations in a second and drops the eleventh', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    for (let i = 0; i < 11; i += 1) {
      bridge.handleActivation(payload(`${IN_PROJECT}?i=${i}`))
    }

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(10))
  })

  it('holds will-navigate to a much tighter budget than a real click', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    for (let i = 0; i < 10; i += 1) {
      bridge.handleWillNavigate(`${IN_PROJECT}?i=${i}`)
    }

    // A page-driven navigation loop must not be able to spend the human's
    // allowance. Well under ten gets through.
    await vi.waitFor(() => expect(deps.requestOpenFile.mock.calls.length).toBeGreaterThan(0))
    expect(deps.requestOpenFile.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('refills the budget in the next second', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    for (let i = 0; i < 11; i += 1) {
      bridge.handleActivation(payload(`${IN_PROJECT}?i=${i}`))
    }
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(10))

    clock += 1001
    bridge.handleActivation(payload(`${IN_PROJECT}?later=1`))
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(11))
  })
})

describe('createPreviewLinkBridge — de-duplication', () => {
  it('honours the click when will-navigate reaches main a moment BEFORE the preload report', async () => {
    // One click reaches main twice, over two different IPC paths, and nothing
    // orders them. When the navigation half wins the race the old bridge routed
    // it first — as `navigation`, which an external link refuses with a badge —
    // and then dropped the real gesture as a duplicate: a click that produced a
    // "Blocked link" badge instead of the consent dialog.
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleWillNavigate(EXTERNAL)
    bridge.handleActivation(payload(EXTERNAL))

    await vi.waitFor(() => expect(deps.openExternal).toHaveBeenCalledTimes(1))
    // Give the deferred navigation half time to fire and be dropped.
    await new Promise((r) => setTimeout(r, 120))
    expect(deps.recordFailure).not.toHaveBeenCalled()
    expect(deps.openExternal).toHaveBeenCalledTimes(1)
  })

  it('routes one click once even though both entry points see it', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleActivation(payload(IN_PROJECT))
    bridge.handleWillNavigate(IN_PROJECT)

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(1))
  })

  it('does not suppress the same link forever while it keeps being clicked', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleActivation(payload(IN_PROJECT))
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(1))

    // Half a second later, still the same click's echo — suppressed.
    clock += 500
    bridge.handleActivation(payload(IN_PROJECT))

    // A second after the FIRST activation the window has passed, so a genuine
    // second click is honoured. A sliding window would swallow this one.
    clock += 600
    bridge.handleActivation(payload(IN_PROJECT))
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(2))
  })
})

describe('createPreviewLinkBridge — dispose', () => {
  it('routes nothing after dispose', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)
    bridge.dispose()

    bridge.handleActivation(payload(IN_PROJECT))
    bridge.handleWillNavigate(EXTERNAL)

    await new Promise((r) => setImmediate(r))
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.openExternal).not.toHaveBeenCalled()
  })
})

describe('createPreviewLinkBridge — the click button (issue #124)', () => {
  /** Deps whose eligibility check says every page runs as a preview. */
  function eligibleDeps(): SpiedDeps {
    return { ...makeDeps(), runsAsPreview: vi.fn().mockResolvedValue(true), platform: 'darwin' }
  }

  /** The disposition handed to the renderer with the last open request. */
  function lastDisposition(deps: SpiedDeps): unknown {
    return deps.requestOpenFile.mock.calls.at(-1)?.[4]
  }

  it('carries the button to the link table: a middle click opens a new tab', async () => {
    const deps = eligibleDeps()
    makeBridge(deps).handleActivation({ ...(payload(IN_PROJECT) as object), button: 1 })

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(lastDisposition(deps)).toBe('new-tab')
  })

  it('leaves a primary click on a page that can stay to the tab’s mode', async () => {
    const deps = eligibleDeps()
    makeBridge(deps).handleActivation(payload(IN_PROJECT))

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(lastDisposition(deps)).toBe('by-mode')
  })

  it('treats a report without a button as a primary click', async () => {
    const deps = eligibleDeps()
    makeBridge(deps).handleActivation({ href: IN_PROJECT, target: '', download: false })

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(lastDisposition(deps)).toBe('by-mode')
  })

  it.each([-1, 5, 1.5, '1', null])(
    'refuses button %s as a malformed message and routes nothing',
    (button) => {
      const deps = eligibleDeps()
      makeBridge(deps).handleActivation({ ...(payload(IN_PROJECT) as object), button })

      expect(deps.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ resourceUrlOrHost: '(malformed link message)' })
      )
      expect(deps.requestOpenFile).not.toHaveBeenCalled()
    }
  )

  it('SECURITY INVARIANT: a will-navigate report opens a new tab even for a page that could stay', async () => {
    const deps = eligibleDeps()
    makeBridge(deps).handleWillNavigate(IN_PROJECT)

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(lastDisposition(deps)).toBe('new-tab')
  })

  it('opens every page in a new tab while no eligibility check is wired', async () => {
    const deps = makeDeps()
    makeBridge(deps).handleActivation(payload(IN_PROJECT))

    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalled())
    expect(lastDisposition(deps)).toBe('new-tab')
  })
})

describe('createPreviewLinkBridge — the page on screen (issue #124, WI-17b)', () => {
  it('reads the page on screen at every click, so a same-tab move changes what a scroll is', async () => {
    const INDEX = `erfana-preview://${TOKEN}/index.html`
    let onScreen = INDEX
    const context: PreviewLinkContext = {
      ...CONTEXT,
      get currentUrl(): string {
        return onScreen
      }
    }
    const deps = makeDeps()
    const bridge = createPreviewLinkBridge(context, deps)

    // On index.html, a link to it is a scroll, which Chromium handles itself.
    bridge.handleActivation(payload(`${INDEX}#top`))
    await new Promise((r) => setImmediate(r))
    expect(deps.requestOpenFile).not.toHaveBeenCalled()

    // The tab moved to docs/a.html: the same link now opens index.html…
    onScreen = IN_PROJECT
    clock += 2_000
    bridge.handleActivation(payload(`${INDEX}#top`))
    await vi.waitFor(() => expect(deps.requestOpenFile).toHaveBeenCalledTimes(1))

    // …and a link into docs/a.html is the scroll.
    clock += 2_000
    bridge.handleActivation(payload(`${IN_PROJECT}#faq`))
    await new Promise((r) => setImmediate(r))
    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
  })
})

describe('createPreviewLinkBridge — a click whose report lands late (fake timers)', () => {
  // The preload reports a click one task after it, so a later page listener can
  // cancel it first — and the browser's `will-navigate` for the same click
  // starts as soon as the click's dispatch ends, so it normally reaches main
  // FIRST. On a page that is busy after the click the report can trail it by
  // far more than the 50 ms grace. The preload's `seen` note, sent during the
  // click, is what tells the bridge to keep holding that navigation.

  /** Past the old fixed 50 ms grace, well inside the cap. */
  const WELL_PAST_GRACE_MS = 200

  const seen = (gestureId: number, href: string): unknown => ({ kind: 'seen', gestureId, href })
  const cancelled = (gestureId: number): unknown => ({ kind: 'cancelled', gestureId })
  const report = (gestureId: number, href: string, extra: object = {}): unknown => ({
    ...(payload(href) as object),
    gestureId,
    ...extra
  })

  /** Advance the fake clock and let the routing's promises run. */
  const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms)
  }

  /** Deps whose eligibility check says every page runs as a preview. */
  function eligibleDeps(): SpiedDeps {
    return { ...makeDeps(), runsAsPreview: vi.fn().mockResolvedValue(true), platform: 'darwin' }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['49 ms, just inside the grace', NAVIGATION_GRACE_MS - 1],
    ['200 ms, well past the grace', WELL_PAST_GRACE_MS]
  ])('asks before opening an external link whose report lands %s after will-navigate', async (_label, lateMs) => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, EXTERNAL))
    bridge.handleWillNavigate(EXTERNAL)
    await advance(lateMs)
    expect(deps.recordFailure).not.toHaveBeenCalled()

    bridge.handleActivation(report(1, EXTERNAL))
    await advance(0)
    expect(deps.openExternal).toHaveBeenCalledTimes(1)

    // The held navigation half is let go as the click's duplicate: no
    // "Blocked link", even once every timer has run out.
    await advance(CLICK_SETTLE_CAP_MS * 2)
    expect(deps.recordFailure).not.toHaveBeenCalled()
    expect(deps.openExternal).toHaveBeenCalledTimes(1)
  })

  it('keeps a late-reported click on a page that can stay in its tab', async () => {
    // Routed as the navigation, this click would open a new tab whatever the
    // tab's mode (the security invariant above). As the gesture it stays.
    const deps = eligibleDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    bridge.handleWillNavigate(IN_PROJECT)
    await advance(WELL_PAST_GRACE_MS)
    bridge.handleActivation(report(1, IN_PROJECT))
    await advance(CLICK_SETTLE_CAP_MS * 2)

    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
    expect(deps.requestOpenFile.mock.calls[0]?.[4]).toBe('by-mode')
  })

  it('keeps the escape label of a late-reported link that climbed out of the project', async () => {
    // Only the report carries the attribute as written; `will-navigate` has
    // the collapsed href alone, which would read as a missing file.
    const deps = makeDeps({ ok: false, reason: 'missing' })
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    bridge.handleWillNavigate(IN_PROJECT)
    await advance(WELL_PAST_GRACE_MS)
    bridge.handleActivation(report(1, IN_PROJECT, { rawHref: '../../../outside.html' }))
    await advance(CLICK_SETTLE_CAP_MS * 2)

    expect(deps.recordFailure).toHaveBeenCalledTimes(1)
    expect(deps.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ type: 'path-escape' }))
  })

  it('still holds the navigation when the seen note lands just after it', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleWillNavigate(EXTERNAL)
    await advance(NAVIGATION_GRACE_MS - 1)
    bridge.handleLinkNote(seen(1, EXTERNAL))
    await advance(WELL_PAST_GRACE_MS)
    expect(deps.recordFailure).not.toHaveBeenCalled()

    bridge.handleActivation(report(1, EXTERNAL))
    await advance(CLICK_SETTLE_CAP_MS * 2)
    expect(deps.openExternal).toHaveBeenCalledTimes(1)
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('routes a navigation with no seen click after the grace alone', async () => {
    // A page that navigates itself has no preload click behind it, so it waits
    // only the grace — not the cap.
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleWillNavigate(IN_PROJECT)
    await advance(NAVIGATION_GRACE_MS - 1)
    expect(deps.requestOpenFile).not.toHaveBeenCalled()

    await advance(1)
    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
    expect(deps.requestOpenFile.mock.calls[0]?.[4]).toBe('new-tab')
  })

  it('lets a held navigation go as the page’s own when the click is cancelled', async () => {
    // A navigation behind a cancelled click is one the page made itself (a
    // router that cancels the click and sets `location`): today's rules.
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, EXTERNAL))
    bridge.handleWillNavigate(EXTERNAL)
    await advance(WELL_PAST_GRACE_MS)
    expect(deps.recordFailure).not.toHaveBeenCalled()

    bridge.handleLinkNote(cancelled(1))
    await advance(0)
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked-link', reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED })
    )
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('stops waiting for a cancelled click, so a later navigation waits only the grace', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    bridge.handleLinkNote(cancelled(1))
    bridge.handleWillNavigate(IN_PROJECT)
    await advance(NAVIGATION_GRACE_MS)

    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
  })

  it('routes the navigation on its own once the cap passes with no report', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    bridge.handleWillNavigate(IN_PROJECT)
    await advance(CLICK_SETTLE_CAP_MS - 1)
    expect(deps.requestOpenFile).not.toHaveBeenCalled()

    await advance(1)
    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
    expect(deps.requestOpenFile.mock.calls[0]?.[4]).toBe('new-tab')
  })

  it('caps the wait from the navigation’s arrival, even while new clicks keep its href pending', async () => {
    // Each seen click expires on its own, but a stream of them on one href
    // would otherwise hold its navigation for as long as the stream lasts.
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    bridge.handleWillNavigate(IN_PROJECT)
    await advance(CLICK_SETTLE_CAP_MS - WELL_PAST_GRACE_MS)
    bridge.handleLinkNote(seen(2, IN_PROJECT))
    await advance(WELL_PAST_GRACE_MS - 1)
    expect(deps.requestOpenFile).not.toHaveBeenCalled()

    await advance(1)
    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
  })

  it('waits for every pending click on the same href before letting its navigation go', async () => {
    // Two clicks on one link in quick succession: the first is cancelled, the
    // second is not. The cancelled note must not release the navigation that
    // belongs to the second click.
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, EXTERNAL))
    bridge.handleLinkNote(seen(2, EXTERNAL))
    bridge.handleWillNavigate(EXTERNAL)
    bridge.handleLinkNote(cancelled(1))
    await advance(WELL_PAST_GRACE_MS)
    expect(deps.recordFailure).not.toHaveBeenCalled()

    bridge.handleActivation(report(2, EXTERNAL))
    await advance(CLICK_SETTLE_CAP_MS * 2)
    expect(deps.openExternal).toHaveBeenCalledTimes(1)
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('tracks a bounded number of pending clicks, forgetting the oldest', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    for (let gestureId = 2; gestureId <= 17; gestureId += 1) {
      bridge.handleLinkNote(seen(gestureId, `${IN_PROJECT}?n=${gestureId}`))
    }
    bridge.handleWillNavigate(IN_PROJECT)
    await advance(NAVIGATION_GRACE_MS)

    // The first click was forgotten to make room, so nothing holds this one.
    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['an unknown kind', { kind: 'opened', gestureId: 1 }],
    ['a zero id', { kind: 'seen', gestureId: 0, href: IN_PROJECT }],
    ['a fractional id', { kind: 'cancelled', gestureId: 1.5 }],
    ['a missing href', { kind: 'seen', gestureId: 1 }],
    ['an over-long href', { kind: 'seen', gestureId: 1, href: `${IN_PROJECT}?${'a'.repeat(2048)}` }],
    ['an extra key', { kind: 'cancelled', gestureId: 1, href: IN_PROJECT }],
    ['a non-object', 'seen']
  ])('refuses a note with %s and holds nothing for it', async (_label, note) => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(note)
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ resourceUrlOrHost: '(malformed link message)' })
    )

    bridge.handleWillNavigate(IN_PROJECT)
    await advance(NAVIGATION_GRACE_MS)
    expect(deps.requestOpenFile).toHaveBeenCalledTimes(1)
  })

  it('refuses a report whose id is not a positive whole number', () => {
    const deps = makeDeps()
    makeBridge(deps).handleActivation(report(0, IN_PROJECT))

    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ resourceUrlOrHost: '(malformed link message)' })
    )
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
  })

  it('routes nothing held or pending after dispose', async () => {
    const deps = makeDeps()
    const bridge = makeBridge(deps)

    bridge.handleLinkNote(seen(1, IN_PROJECT))
    bridge.handleWillNavigate(IN_PROJECT)
    bridge.handleWillNavigate(EXTERNAL)
    bridge.dispose()
    // Nothing is left to fire: no held navigation, no pending click's expiry.
    expect(vi.getTimerCount()).toBe(0)

    bridge.handleLinkNote(seen(2, EXTERNAL))
    await advance(CLICK_SETTLE_CAP_MS * 2)
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })
})

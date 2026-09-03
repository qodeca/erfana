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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { createPreviewLinkBridge, type PreviewLinkBridge } from './previewLinkBridge'
import type { PreviewLinkContext, PreviewLinkNavigationDeps } from './previewLinkNavigation'
import type { ConfineVerdict } from './previewPathResolve'

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
  requestOpenFile: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  recordFailure: ReturnType<typeof vi.fn>
  confine: ReturnType<typeof vi.fn>
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
  return { href, target: '', download: false }
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

  it('bounds the raw href attribute like the resolved href', () => {
    const deps = makeDeps()
    makeBridge(deps).handleActivation({
      ...(payload(IN_PROJECT) as object),
      rawHref: 'a'.repeat(2049)
    })

    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked-link' })
    )
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
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

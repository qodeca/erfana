// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Link routing side effects (sd-074b §5.4).
 *
 * The decision table lives in `PreviewNavigationPolicy.test.ts`; this suite
 * covers what actually HAPPENS — confinement, the renderer hand-off, the OS
 * hand-off, and that a refused link always leaves a badge entry instead of
 * today's silence.
 */
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { routeLinkActivation, type PreviewLinkNavigationDeps } from './previewLinkNavigation'
import type { ConfineVerdict } from './previewPathResolve'

// A fake 32-hex preview root token. Not a credential: the real one is minted
// per view by PreviewRootRegistry and never leaves the main process.
const TOKEN = 'abcdef0123456789abcdef0123456789' // gitleaks:allow
const REAL_ROOT = '/projects/site'
const CURRENT = `erfana-preview://${TOKEN}/index.html`

const CONTEXT = {
  panelId: 'preview-1',
  token: TOKEN,
  realRoot: REAL_ROOT,
  windowId: 7,
  currentUrl: CURRENT
}

type SpiedDeps = PreviewLinkNavigationDeps & {
  requestOpenFile: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  recordFailure: ReturnType<typeof vi.fn>
  confine: ReturnType<typeof vi.fn>
}

function makeDeps(
  verdict: ConfineVerdict = { ok: true, realTarget: `${REAL_ROOT}/other.html`, rel: 'other.html' }
): SpiedDeps {
  return {
    requestOpenFile: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn(),
    confine: vi.fn().mockResolvedValue(verdict)
  } as unknown as SpiedDeps
}

describe('routeLinkActivation', () => {
  it('asks the OWNING window to open a confined in-project file', async () => {
    const deps = makeDeps()

    await routeLinkActivation({ href: `erfana-preview://${TOKEN}/other.html`, provenance: 'gesture' }, CONTEXT, deps)

    expect(deps.requestOpenFile).toHaveBeenCalledWith(
      'preview-1',
      `${REAL_ROOT}/other.html`,
      null,
      7
    )
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('passes the anchor through to the renderer', async () => {
    const deps = makeDeps()

    await routeLinkActivation(
      { href: `erfana-preview://${TOKEN}/other.html#part-2`, provenance: 'gesture' },
      CONTEXT,
      deps
    )

    expect(deps.requestOpenFile).toHaveBeenCalledWith(
      'preview-1',
      `${REAL_ROOT}/other.html`,
      'part-2',
      7
    )
  })

  it('opens an excluded in-project path anyway, so it can be read as source', async () => {
    const deps = makeDeps({
      ok: true,
      realTarget: `${REAL_ROOT}/node_modules/pkg/demo.html`,
      rel: 'node_modules/pkg/demo.html'
    })

    await routeLinkActivation(
      { href: `erfana-preview://${TOKEN}/node_modules/pkg/demo.html`, provenance: 'gesture' },
      CONTEXT,
      deps
    )

    // Confinement is asked to skip the BUILD-DIRECTORY rule only — never the
    // escape rules and never the dot-segment rule (F2). The candidate is
    // asserted exactly, not as `expect.any(String)`: the whole point is that the
    // path handed to confinement is re-resolved against the real root rather
    // than taken from the page.
    expect(deps.confine).toHaveBeenCalledWith(
      REAL_ROOT,
      resolve(REAL_ROOT, 'node_modules/pkg/demo.html'),
      { allowBuildDirs: true }
    )
    expect(deps.requestOpenFile).toHaveBeenCalled()
  })

  it('records a path-escape failure and opens nothing when confinement refuses', async () => {
    const deps = makeDeps({ ok: false, reason: 'escape' })

    await routeLinkActivation(
      { href: `erfana-preview://${TOKEN}/..%2F..%2Fetc%2Fhosts`, provenance: 'gesture' },
      CONTEXT,
      deps
    )

    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'path-escape' })
    )
  })

  it('records a missing-file failure for a dead in-project link', async () => {
    const deps = makeDeps({ ok: false, reason: 'missing' })

    await routeLinkActivation({ href: `erfana-preview://${TOKEN}/gone.html`, provenance: 'gesture' }, CONTEXT, deps)

    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'missing-local-file' })
    )
  })

  it('names an excluded path as excluded, not missing', async () => {
    const deps = makeDeps({ ok: false, reason: 'excluded' })

    await routeLinkActivation(
      { href: `erfana-preview://${TOKEN}/.git/config`, provenance: 'gesture' },
      CONTEXT,
      deps
    )

    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'excluded-path', reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED })
    )
  })

  it('names a link that climbed out of the project as an escape, from the raw attribute', async () => {
    // Chromium collapses `../` past the root before main sees `href`, so the
    // resolved URL is a clean in-root path that is merely missing. The
    // attribute still shows the climb (Windows verification, 2026-09-03).
    const deps = makeDeps({ ok: false, reason: 'missing' })

    await routeLinkActivation(
      {
        href: `erfana-preview://${TOKEN}/outside.html`,
        rawHref: '../outside.html',
        provenance: 'gesture'
      },
      CONTEXT,
      deps
    )

    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'path-escape', reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED })
    )
  })

  it('does not call a dead link an escape when its raw attribute stays inside the project', async () => {
    const deps = makeDeps({ ok: false, reason: 'missing' })

    await routeLinkActivation(
      {
        href: `erfana-preview://${TOKEN}/gone.html`,
        rawHref: 'sub/../gone.html',
        provenance: 'gesture'
      },
      CONTEXT,
      deps
    )

    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'missing-local-file' })
    )
  })

  it('hands an external link to the OS browser', async () => {
    const deps = makeDeps()

    await routeLinkActivation({ href: 'https://example.com/docs', provenance: 'gesture' }, CONTEXT, deps)

    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(deps.requestOpenFile).not.toHaveBeenCalled()
  })

  it('refuses an external link the page navigated to itself', async () => {
    const deps = makeDeps()

    // `will-navigate` fires for `location.href = …` exactly as it does for a
    // click, so it proves nothing about user intent. Only the preload can prove
    // a gesture, and the OS hand-off requires one (F1).
    await routeLinkActivation(
      { href: 'https://example.com/docs', provenance: 'navigation' },
      CONTEXT,
      deps
    )

    expect(deps.openExternal).not.toHaveBeenCalled()
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked-link', resourceUrlOrHost: 'https://example.com' })
    )
  })

  it('still opens an in-project link the page navigated to itself', async () => {
    const deps = makeDeps()

    // The degradation path stays useful: a plain same-tab link keeps working
    // even if the preload is missing from the bundle.
    await routeLinkActivation(
      { href: `erfana-preview://${TOKEN}/other.html`, provenance: 'navigation' },
      CONTEXT,
      deps
    )

    expect(deps.requestOpenFile).toHaveBeenCalled()
  })

  it('records a failure when the OS refuses the hand-off', async () => {
    const deps = makeDeps()
    deps.openExternal.mockRejectedValue(new Error('no handler'))

    await routeLinkActivation({ href: 'https://example.com/', provenance: 'gesture' }, CONTEXT, deps)

    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked-link' })
    )
  })

  it('records a blocked-link failure for a dangerous scheme — never silence', async () => {
    const deps = makeDeps()

    await routeLinkActivation({ href: 'javascript:alert(1)', provenance: 'gesture' }, CONTEXT, deps)

    expect(deps.recordFailure).toHaveBeenCalledWith({
      type: 'blocked-link',
      resourceUrlOrHost: 'javascript:',
      reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
    })
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('never puts the full href in the failure entry', async () => {
    const deps = makeDeps()

    await routeLinkActivation(
      { href: 'https://user:pass@example.com/secret?token=abc123', provenance: 'gesture' },
      CONTEXT,
      deps
    )

    const recorded = JSON.stringify(deps.recordFailure.mock.calls)
    expect(recorded).not.toContain('abc123')
    expect(recorded).not.toContain('secret')
    expect(recorded).toContain('example.com')
  })

  it('strips control characters from the recorded value', async () => {
    const deps = makeDeps()

    await routeLinkActivation({ href: 'javascript:\u0000\u001f fake-log-line', provenance: 'gesture' }, CONTEXT, deps)

    const recorded = deps.recordFailure.mock.calls[0][0] as { resourceUrlOrHost: string }
    // eslint-disable-next-line no-control-regex
    expect(recorded.resourceUrlOrHost).not.toMatch(/[\u0000-\u001f\u007f]/)
  })

  it('does nothing for a fragment on the current document', async () => {
    const deps = makeDeps()

    await routeLinkActivation({ href: `${CURRENT}#section`, provenance: 'gesture' }, CONTEXT, deps)

    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.openExternal).not.toHaveBeenCalled()
    expect(deps.recordFailure).not.toHaveBeenCalled()
  })

  it('blocks a download attempt', async () => {
    const deps = makeDeps()

    await routeLinkActivation(
      { href: `erfana-preview://${TOKEN}/report.pdf`, download: true, provenance: 'gesture' },
      CONTEXT,
      deps
    )

    expect(deps.requestOpenFile).not.toHaveBeenCalled()
    expect(deps.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'blocked-link' })
    )
  })
})

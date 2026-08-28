// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Acts on a link activated inside a previewed page (sd-074b §5.4).
 *
 * `PreviewNavigationPolicy` decides WHAT a link means with no I/O; this module
 * does the I/O that follows — realpath confinement, the renderer hand-off, the
 * OS-browser hand-off, and the failure entry when a link goes nowhere.
 *
 * The split matters: the decision table is exhaustively unit-tested as pure
 * data, and everything with a side effect lives here behind injected seams.
 *
 * TRUST: the href came from an untrusted page. The relative path the policy
 * extracted is re-resolved against the REAL project root and re-confined here
 * before it is handed to anyone. Nothing the page says is believed.
 */
import { resolve } from 'node:path'

import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import { decideLinkIntent, type LinkActivation } from './PreviewNavigationPolicy'
import { confinePath } from './previewPathResolve'

/** Where the activated link happened, and who should hear about the result. */
export interface PreviewLinkContext {
  /** The panel whose page was clicked in. */
  readonly panelId: string
  /** This preview's root token — the expected `erfana-preview://` host. */
  readonly token: string
  /** The realpath'd project root every target is confined to. */
  readonly realRoot: string
  /** The window that owns the preview, so the open request reaches only it. */
  readonly windowId: number
  /** The URL of the document the click happened in. */
  readonly currentUrl: string
}

/** Injected side effects, so the routing itself stays testable. */
export interface PreviewLinkNavigationDeps {
  /** Ask the owning renderer to open a project file in a tab. */
  readonly requestOpenFile: (
    sourcePanelId: string,
    filePath: string,
    anchor: string | null,
    windowId: number
  ) => void
  /** Hand a vetted URL to the OS browser. */
  readonly openExternal: (url: string) => Promise<void>
  /** Record a failure entry for this panel's badge. */
  readonly recordFailure: (input: PreviewFailureInput) => void
  /** Confinement, injectable for tests; defaults to {@link confinePath}. */
  readonly confine?: typeof confinePath
}

/**
 * A short, safe description of a refused link for the failure badge and logs.
 *
 * NEVER the full href: it is attacker-controlled, so it is both a leak surface
 * (a `mailto:` body, a query string) and a log-injection surface. Scheme plus
 * host is enough to tell the user which link misbehaved.
 */
function describeLink(href: string): string {
  try {
    const url = new URL(href)
    return url.host === '' ? url.protocol : `${url.protocol}//${url.host}`
  } catch {
    return '(unparseable link)'
  }
}

/** Strip control characters, so a crafted href cannot forge log or badge lines. */
function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256)
}

/**
 * Route one activated link to its side effect.
 *
 * @param activation - The href, the document it was clicked in, and the token.
 * @param context - Panel, root and window the click belongs to.
 * @param deps - Injected effects.
 *
 * @example
 * ```ts
 * await routeLinkActivation(
 *   { href: 'erfana-preview://tok/docs/a.html', currentUrl, token: 'tok' },
 *   { panelId, token: 'tok', realRoot, windowId, currentUrl },
 *   deps
 * )
 * ```
 */
export async function routeLinkActivation(
  activation: Omit<LinkActivation, 'currentUrl' | 'token'>,
  context: PreviewLinkContext,
  deps: PreviewLinkNavigationDeps
): Promise<void> {
  const confine = deps.confine ?? confinePath

  const intent = decideLinkIntent({
    ...activation,
    currentUrl: context.currentUrl,
    token: context.token
  })

  switch (intent.kind) {
    case 'same-document':
      // Chromium already scrolled the page; nothing to do.
      return

    case 'blocked':
      deps.recordFailure({
        type: 'blocked-link',
        resourceUrlOrHost: sanitize(describeLink(activation.href)),
        reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
      })
      return

    case 'external':
      try {
        await deps.openExternal(intent.url)
      } catch {
        // The OS refused the hand-off (no registered handler, for example).
        deps.recordFailure({
          type: 'blocked-link',
          resourceUrlOrHost: sanitize(describeLink(intent.url)),
          reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
        })
      }
      return

    case 'in-project': {
      const candidate = resolve(context.realRoot, intent.relPath)
      // `allowExcluded`: a link into `node_modules/` or `dist/` must still be
      // openable as SOURCE, so the exclusion rule is skipped while every escape
      // rule stays (sd-074b §3.2). The renderer's `resolvePanelKind` is what
      // then decides it opens in Monaco rather than as a running preview.
      const verdict = await confine(context.realRoot, candidate, { allowExcluded: true })

      if (!verdict.ok) {
        deps.recordFailure({
          type: verdict.reason === 'escape' ? 'path-escape' : 'missing-local-file',
          resourceUrlOrHost: sanitize(intent.relPath),
          reasonCode:
            verdict.reason === 'escape'
              ? ErrorCode.PREVIEW_LINK_BLOCKED
              : ErrorCode.PREVIEW_LOCAL_FILE_MISSING
        })
        return
      }

      deps.requestOpenFile(context.panelId, verdict.realTarget, intent.anchor, context.windowId)
      return
    }
  }
}

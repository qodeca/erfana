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
import type { PreviewFailureInput, PreviewFailureType } from '../../../shared/ipc/preview-types'
import { decideLinkIntent, type LinkActivation } from './PreviewNavigationPolicy'
import { confinePath } from './previewPathResolve'

/**
 * How the activation reached us, and therefore how much it is trusted.
 *
 * `gesture` comes from the preview preload, which refuses anything without
 * `event.isTrusted` — so a real person clicked something. `navigation` comes
 * from `will-navigate`, which fires for `location.href = …` just as readily as
 * for a click, so it proves nothing about user intent.
 *
 * The distinction is load-bearing, not cosmetic: `will-navigate` is the ONLY
 * lock on a page navigating itself under `CSP: sandbox`, and before the split a
 * page could reach `shell.openExternal` in a `setInterval` loop with nobody
 * touching the mouse (lens review F1).
 */
export type LinkProvenance = 'gesture' | 'navigation'

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

/**
 * Whether a RELATIVE href, resolved the way a browser would against the
 * document's own path, climbs above the project root at any point.
 *
 * URL maths, not `path.resolve`: on Windows `path.resolve(dir, '..\\x')`
 * escapes while this `standard: true` scheme treats `\` as `/`, and a `<base
 * href>` the page inserted is deliberately ignored — this only ever softens a
 * label ("escaped" instead of "missing"), never a decision, so a false
 * positive costs one word on a badge. Absolute references (any scheme, or
 * protocol-relative) cannot climb and answer `false`.
 */
function rawHrefEscapesDocument(rawHref: string, currentUrl: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref) || rawHref.startsWith('//')) {
    return false
  }
  const pathPart = rawHref.split(/[?#]/, 1)[0].replace(/\\/g, '/')
  let depth = 0
  if (!pathPart.startsWith('/')) {
    try {
      // The document's DIRECTORY depth: `/a/b/page.html` → 2.
      depth = Math.max(0, new URL(currentUrl).pathname.split('/').filter(Boolean).length - 1)
    } catch {
      return false
    }
  }
  for (const segment of pathPart.split('/')) {
    let decoded = segment
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      // Keep the raw segment; a bad escape is not a climb.
    }
    if (decoded === '..') {
      depth -= 1
      if (depth < 0) return true
    } else if (decoded !== '' && decoded !== '.') {
      depth += 1
    }
  }
  return false
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
  activation: Omit<LinkActivation, 'currentUrl' | 'token'> & {
    provenance: LinkProvenance
    /** The `href` attribute as written; see `LinkActivationPayloadSchema`. */
    rawHref?: string
  },
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
      // Handing a URL to the OS browser is the highest-consequence thing a link
      // can do here, so it requires a gesture we can actually vouch for. Only
      // the preload can prove one, and it ships in every build — `will-navigate`
      // is the degradation path for plain links, not an equal citizen (F1).
      if (activation.provenance !== 'gesture') {
        deps.recordFailure({
          type: 'blocked-link',
          resourceUrlOrHost: sanitize(describeLink(intent.url)),
          reasonCode: ErrorCode.PREVIEW_LINK_BLOCKED
        })
        return
      }
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
      // `allowBuildDirs`: a link into `node_modules/` or `dist/` must still be
      // openable as SOURCE, so the build-directory rule is skipped while every
      // escape rule AND the dot-segment rule stay (sd-074b §3.2). The renderer's
      // `resolvePanelKind` is what then decides it opens in Monaco rather than as
      // a running preview.
      //
      // Do NOT widen this to the dot-segment rule: that would let a link in an
      // untrusted page open `.env` or `.git/config` in the editor (F2).
      const verdict = await confine(context.realRoot, candidate, { allowBuildDirs: true })

      if (!verdict.ok) {
        // One label per reason, and the raw attribute gets a say: Chromium
        // collapses `../` past the root BEFORE main sees `href`, so a link that
        // climbed out of the project arrives as a clean in-root path that is
        // merely missing. The attribute still shows the climb. It only ever
        // changes the LABEL — the decision above was made on the confined path.
        const climbedOut =
          verdict.reason === 'missing' &&
          activation.rawHref !== undefined &&
          rawHrefEscapesDocument(activation.rawHref, context.currentUrl)
        const type: PreviewFailureType =
          verdict.reason === 'escape' || climbedOut
            ? 'path-escape'
            : verdict.reason === 'excluded'
              ? 'excluded-path'
              : 'missing-local-file'
        deps.recordFailure({
          type,
          resourceUrlOrHost: sanitize(intent.relPath),
          reasonCode:
            type === 'missing-local-file'
              ? ErrorCode.PREVIEW_LOCAL_FILE_MISSING
              : ErrorCode.PREVIEW_LINK_BLOCKED
        })
        return
      }

      deps.requestOpenFile(context.panelId, verdict.realTarget, intent.anchor, context.windowId)
      return
    }
  }
}

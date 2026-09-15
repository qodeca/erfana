// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a link clicked inside a previewed page may open: the link table
 * (issue #124, part 3 §3.2).
 *
 * Pure. It runs after `decideLinkIntent` has dealt with external links,
 * refusals and same-page `#section` jumps, and after the in-project target was
 * confined. It only answers WHERE that confined page opens:
 *
 * | # | Condition | Disposition |
 * |---|---|---|
 * | 1 | provenance is not `gesture` (the `will-navigate` fallback) | `new-tab` – a security invariant |
 * | 2 | a button other than the primary one, or the platform accelerator | `new-tab` |
 * | 3 | `target` is `_blank` or a named target | `new-tab` |
 * | 4 | `target` is `_self`, `_top` or `_parent` | `same-tab` |
 * | 5 | no `target` | `by-mode` – the renderer applies the tab's mode |
 * | 6 | rows 4 and 5, but the target does not run as a preview | `new-tab` |
 *
 * Main never learns the tab's link mode (part 3 §3.3): row 5 hands that choice
 * to the renderer, and main checks a same-tab move again before it loads.
 * Shift and Alt mean nothing here.
 *
 * Inputs are injected – the platform for row 2, the eligibility verdict for
 * row 6 – so nothing here reads `process` or the disk.
 *
 * @see docs/design/design-issue-124-part3.md §3.2
 */
import { extname } from 'node:path'

import type { PreviewLinkDisposition } from '../../../shared/ipc/preview-types'
import type { LinkProvenance } from './previewLinkNavigation'

/** The modifier keys held during the click, as the preload reports them. */
export interface LinkModifiers {
  readonly meta: boolean
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
}

/** What the table reads about one activated link. */
export interface LinkDispositionInput {
  /** Who vouches for the click; see `LinkProvenance`. */
  readonly provenance: LinkProvenance
  /**
   * `MouseEvent.button`: `0` primary, `1` middle. Absent – a `will-navigate`
   * report – counts as primary.
   */
  readonly button?: number
  /** Absent for `will-navigate`, which knows no keys. */
  readonly modifiers?: LinkModifiers
  /** The anchor's `target` after the preload's `<base target>` fallback; `''` or absent for none. */
  readonly target?: string
}

/** What main found out about the confined target (row 6). */
export interface LinkTargetFacts {
  /** The confined target; only its extension is read. */
  readonly filePath: string
  /** The main-side eligibility check says the file runs as a preview. */
  readonly eligible: boolean
}

/** Injected so the table never reads `process.platform` itself. */
export interface LinkDispositionDeps {
  /** Picks the accelerator of row 2: Cmd on `darwin`, Ctrl elsewhere. */
  readonly platform: NodeJS.Platform
}

/** `MouseEvent.button` of a plain (left) click. */
const PRIMARY_BUTTON = 0

/**
 * Targets that name the tab the page is in. The preload runs in the top frame
 * only, so `_top` and `_parent` are that tab too. Compared ASCII
 * case-insensitively, as HTML compares these keywords.
 */
const SAME_TAB_TARGETS: ReadonlySet<string> = new Set(['_self', '_top', '_parent'])

/** Extensions that can run as a preview – the rule `PreviewEligibilityService` applies too. */
const PREVIEW_PAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm'])

/** Whether a path has an extension that can run as a preview (`.html`, `.htm`, any case). */
export function isPreviewPagePath(filePath: string): boolean {
  return PREVIEW_PAGE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

/**
 * Rows 1 to 5: where the link itself asks to open, before anything is known
 * about its target. A caller that gets `new-tab` can stop there and skip the
 * eligibility check, which may run `git`.
 */
export function requestedLinkDisposition(
  link: LinkDispositionInput,
  deps: LinkDispositionDeps
): PreviewLinkDisposition {
  // Row 1 – SECURITY INVARIANT (RX11). Only the preload proves that a person
  // clicked; `will-navigate` fires for `location.href = …` just as readily, so
  // without this a page could move its own tab to any page, with no click.
  // Written as "not a gesture" so any other provenance fails closed too.
  if (link.provenance !== 'gesture') return 'new-tab'

  // Row 2. Every non-primary button, not only the middle one: the preload
  // reports 0 and 1 alone, so anything else came from a compromised page
  // renderer, and a new tab is what every link did before #124.
  const button = link.button ?? PRIMARY_BUTTON
  if (button !== PRIMARY_BUTTON || acceleratorDown(link.modifiers, deps.platform)) {
    return 'new-tab'
  }

  // Rows 3 to 5 exclude each other; which one applies depends on `target` alone.
  const target = link.target ?? ''
  if (target === '') return 'by-mode'
  return SAME_TAB_TARGETS.has(target.toLowerCase()) ? 'same-tab' : 'new-tab'
}

/**
 * The whole table: rows 1 to 5, then row 6.
 *
 * @example
 * ```ts
 * decideLinkDisposition(
 *   { provenance: 'gesture', button: 0, target: '' },
 *   { filePath: '/site/pricing.html', eligible: true },
 *   { platform: 'darwin' }
 * ) // 'by-mode'
 * ```
 */
export function decideLinkDisposition(
  link: LinkDispositionInput,
  target: LinkTargetFacts,
  deps: LinkDispositionDeps
): PreviewLinkDisposition {
  const requested = requestedLinkDisposition(link, deps)
  if (requested === 'new-tab') return 'new-tab'
  // Row 6: a page that cannot run as a preview opens in its usual panel.
  return isPreviewPagePath(target.filePath) && target.eligible ? requested : 'new-tab'
}

/** The platform accelerator – Cmd on macOS, Ctrl elsewhere – is down. */
function acceleratorDown(modifiers: LinkModifiers | undefined, platform: NodeJS.Platform): boolean {
  if (modifiers === undefined) return false
  return platform === 'darwin' ? modifiers.meta : modifiers.ctrl
}

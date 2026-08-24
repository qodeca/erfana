// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure logic for the HTML preview panel (Issue #74, work item 71).
 *
 * Everything here is a pure function so the panel component (`HtmlPreviewPanel.tsx`)
 * stays glue-only and the interesting decisions are unit-tested in isolation —
 * the same split the image viewer uses (`imageViewer.logic.ts`). No React, no
 * `window.api`, no store.
 *
 * The four decisions this module owns:
 * - {@link deriveBounds} — placeholder rect → the `PreviewBounds` pushed to main.
 * - {@link selectPanelView} — limit-reached vs failed vs normal top-level state.
 * - {@link selectFallback} — still-frame `<img>` vs placeholder colour.
 * - {@link summarizeFailures} — failure list → badge count + grouped popover data.
 *
 * @module htmlPreview.logic
 * @see Issue #74 - HTML preview with CSS and JavaScript execution
 */

import type { PreviewFailure } from '../../../../../shared/ipc/preview-schema'
import type { PreviewBounds, PreviewFailureType } from '../../../../../shared/ipc/preview-types'
import type { PreviewLoadState } from '../../../stores/usePreviewStore'

// ============================================================================
// Bounds
// ============================================================================

/**
 * The subset of a `DOMRect` {@link deriveBounds} reads.
 *
 * Structural so a test passes a plain object and the panel passes the real
 * `getBoundingClientRect()` result.
 */
export interface RectLike {
  /** Distance from the viewport's left edge, in CSS pixels. */
  left: number
  /** Distance from the viewport's top edge, in CSS pixels. */
  top: number
  /** Width in CSS pixels. */
  width: number
  /** Height in CSS pixels. */
  height: number
}

/**
 * Converts a placeholder rectangle into the bounds payload sent to main.
 *
 * The renderer reports CSS pixels; main does the zoom→DIP conversion and the
 * window-content clamp (design §4.3), so this function only reshapes and drops
 * the degenerate case. A rect with width or height `<= 0` — a tab mid-collapse,
 * a not-yet-laid-out placeholder — returns `null` so the caller sends nothing
 * rather than a zero-area view main would drop anyway.
 *
 * `topInset` shrinks the view from the top by that many CSS pixels (UX-002):
 * the native `WebContentsView` paints ABOVE all sibling DOM, so the find bar
 * would be invisible behind it. Reserving a DOM strip the view does not cover
 * keeps the bar visible while native `findInPage` highlights stay inside the
 * (slightly shorter) view. An inset that leaves no area returns `null`.
 *
 * @param rect - The placeholder's bounding rectangle in CSS pixels.
 * @param topInset - CSS pixels to reserve at the top (default `0`).
 * @returns The bounds to send, or `null` when the rect (after inset) has no area.
 *
 * @example
 * ```ts
 * deriveBounds({ left: 10, top: 20, width: 300, height: 200 })
 * // → { x: 10, y: 20, width: 300, height: 200 }
 * deriveBounds({ left: 10, top: 20, width: 300, height: 200 }, 48)
 * // → { x: 10, y: 68, width: 300, height: 152 }
 * deriveBounds({ left: 0, top: 0, width: 0, height: 200 }) // → null
 * ```
 */
export function deriveBounds(rect: RectLike, topInset = 0): PreviewBounds | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const inset = topInset > 0 ? topInset : 0
  const height = rect.height - inset
  if (height <= 0) return null
  return { x: rect.left, y: rect.top + inset, width: rect.width, height }
}

// ============================================================================
// Top-level panel view
// ============================================================================

/**
 * The three mutually-exclusive top-level states the panel body can be in.
 *
 * - `limit-reached` — this `open` was refused because another preview is live
 *   (`PREVIEW_VIEW_LIMIT_REACHED`); the panel shows "a preview is already open"
 *   + "Open as source" (design §1.4 X20/NEW-9).
 * - `failed` — the render process is gone, the page is unresponsive, or the
 *   entry file was deleted; the panel shows a banner + Reload.
 * - `normal` — the native view paints over the placeholder (with the
 *   still-frame/placeholder fallback behind it).
 */
export type PreviewPanelView = 'limit-reached' | 'failed' | 'normal'

/** Inputs to {@link selectPanelView}. */
export interface SelectPanelViewInput {
  /** `true` once `open` returned `PREVIEW_VIEW_LIMIT_REACHED`. */
  limitReached: boolean
  /** The panel's current load state from the preview store. */
  loadState: PreviewLoadState
}

/**
 * Picks the top-level panel view, limit-reached first.
 *
 * Precedence is deliberate: a refusal means no view was ever created for this
 * panel, so a stale `loadState` must never mask the "already open" message;
 * `failed` then wins over `normal` because a failed view has nothing live to
 * paint over the placeholder.
 *
 * @param input - Whether the panel was refused, and its load state.
 * @returns The view the panel body should render.
 *
 * @example
 * ```ts
 * selectPanelView({ limitReached: true, loadState: 'ready' })  // 'limit-reached'
 * selectPanelView({ limitReached: false, loadState: 'failed' }) // 'failed'
 * selectPanelView({ limitReached: false, loadState: 'ready' })  // 'normal'
 * ```
 */
export function selectPanelView(input: SelectPanelViewInput): PreviewPanelView {
  if (input.limitReached) return 'limit-reached'
  if (input.loadState === 'failed') return 'failed'
  return 'normal'
}

// ============================================================================
// Still-frame vs placeholder fallback
// ============================================================================

/** What the fallback layer (behind the native view) should paint. */
export type PreviewFallbackKind = 'frame' | 'placeholder'

/** Inputs to {@link selectFallback}. */
export interface SelectFallbackInput {
  /** `true` when the store holds a cached still frame for this panel. */
  hasFrame: boolean
  /**
   * `true` when the native view is currently hidden (inactive tab or an overlay
   * occludes it). Main captures a still frame *before* hiding, so while hidden
   * the panel shows that frame instead of a hole.
   */
  isViewHidden: boolean
}

/**
 * Decides whether to show the cached still frame or the placeholder colour.
 *
 * The still frame is only meaningful while the native view is hidden — when the
 * view is visible it paints over the placeholder, so the fallback stays behind
 * it and the placeholder colour is enough. When hidden with no cached frame the
 * placeholder colour (`var(--color-brand-black)`, matching main's
 * `setBackgroundColor('#FF161312')`) is shown — never a blank rectangle
 * (design §1.4).
 *
 * @param input - Whether a frame is cached and whether the view is hidden.
 * @returns `'frame'` to show the cached `<img>`, else `'placeholder'`.
 *
 * @example
 * ```ts
 * selectFallback({ hasFrame: true, isViewHidden: true })   // 'frame'
 * selectFallback({ hasFrame: true, isViewHidden: false })  // 'placeholder'
 * selectFallback({ hasFrame: false, isViewHidden: true })  // 'placeholder'
 * ```
 */
export function selectFallback(input: SelectFallbackInput): PreviewFallbackKind {
  return input.hasFrame && input.isViewHidden ? 'frame' : 'placeholder'
}

// ============================================================================
// Failure badge + popover grouping
// ============================================================================

/** Human-readable labels for each failure type, shown in the popover. */
export const FAILURE_TYPE_LABELS: Readonly<Record<PreviewFailureType, string>> = {
  'blocked-host': 'Blocked host',
  'insecure-scheme': 'Insecure scheme',
  'missing-local-file': 'Missing local file',
  'path-escape': 'Path escaped the project',
  'excluded-path': 'Excluded path',
  'asset-too-large': 'Asset too large',
  'unsupported-asset-type': 'Unsupported asset type',
  'csp-missing': 'Security policy error',
  'network-error': 'Network error',
  'network-timeout': 'Network timeout',
  'script-error': 'Script error',
  'render-crash': 'Preview crashed',
  'unresolved-specifier': 'Unresolved import',
  'allowlist-invalid': 'Invalid allowlist host',
  'allowlist-unsupported-version': 'Unsupported allowlist version'
}

/** One grouped bucket of failures sharing a type, in first-seen order. */
export interface FailureGroup {
  /** The failure type this bucket collects. */
  type: PreviewFailureType
  /** Display label for {@link type}. */
  label: string
  /** The failure entries of this type, in arrival order. */
  entries: PreviewFailure[]
}

/** Badge + popover data derived from a panel's failure list. */
export interface FailureSummary {
  /** Total failure count — the badge number. */
  count: number
  /** Failures grouped by type, groups ordered by first occurrence. */
  groups: FailureGroup[]
  /** Distinct hosts from `blocked-host` entries, in first-seen order (AC20). */
  blockedHosts: string[]
}

/**
 * Summarises a panel's failures into badge count + grouped popover data.
 *
 * Grouping is by {@link PreviewFailureType}, with both the groups and the
 * entries inside them kept in first-seen order so the popover is stable as new
 * failures coalesce in. `blockedHosts` is pulled out separately because the
 * "blocked host" case is the one the user can act on (approve), so the badge
 * surfaces it directly.
 *
 * @param failures - The panel's current failure entries (already coalesced main-side).
 * @returns The badge count, ordered groups, and distinct blocked hosts.
 *
 * @example
 * ```ts
 * summarizeFailures([
 *   { type: 'blocked-host', resourceUrlOrHost: 'cdn.example', ... },
 *   { type: 'blocked-host', resourceUrlOrHost: 'cdn.example', ... },
 *   { type: 'script-error', resourceUrlOrHost: 'app.js', ... }
 * ])
 * // → { count: 3, groups: [blocked-host×2, script-error×1], blockedHosts: ['cdn.example'] }
 * ```
 */
export function summarizeFailures(failures: readonly PreviewFailure[]): FailureSummary {
  const groupsByType = new Map<PreviewFailureType, FailureGroup>()
  const blockedHosts: string[] = []
  const seenHosts = new Set<string>()

  for (const failure of failures) {
    let group = groupsByType.get(failure.type)
    if (!group) {
      group = { type: failure.type, label: FAILURE_TYPE_LABELS[failure.type], entries: [] }
      groupsByType.set(failure.type, group)
    }
    group.entries.push(failure)

    if (failure.type === 'blocked-host' && !seenHosts.has(failure.resourceUrlOrHost)) {
      seenHosts.add(failure.resourceUrlOrHost)
      blockedHosts.push(failure.resourceUrlOrHost)
    }
  }

  return {
    count: failures.length,
    groups: Array.from(groupsByType.values()),
    blockedHosts
  }
}

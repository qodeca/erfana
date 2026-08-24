// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview path-exclusion predicates (Issue #74, work item 5).
 *
 * Pure segment classifiers shared across BOTH the eligibility layer
 * (`PreviewEligibilityService`) and the protocol confinement layer — step 8d
 * and step 8h of `resolveConfined` (design §2.4). Keeping them in one leaf
 * module is what makes the two layers provably enforce the same rule.
 *
 * All three accept a RELATIVE path that may use either separator: the main
 * process hands native paths across IPC, so a Windows `rel` can contain `\`.
 * Every function therefore splits on both `/` and `\` before classifying.
 */

/**
 * Directory names never served through the preview protocol regardless of
 * casing. Matched case-insensitively because Windows and macOS default to
 * case-insensitive filesystems, so `Node_Modules` must be excluded too
 * (design §2.8 accepted-risk 1).
 */
const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'out',
  'coverage',
  '.git'
])

/** Split a relative path into non-empty segments, tolerating either separator. */
function toSegments(rel: string): string[] {
  return rel.split(/[/\\]/).filter((segment) => segment.length > 0)
}

/**
 * True when any path segment names an excluded build-output or VCS directory.
 * Case-insensitive; separator-agnostic.
 */
export function isInExcludedDirectory(rel: string): boolean {
  return toSegments(rel).some((segment) => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))
}

/**
 * True when any path segment is dot-prefixed (`.env`, `.git`, `.erfana`, …).
 * This is what keeps dot-directories and dotfiles unreadable through the
 * protocol (design §2.4 step 8d/8h). `.` and `..` are already rejected earlier
 * by `isSafeSegment`, but a dot-prefixed name that survived (e.g. via an
 * unresolved short name) is caught here.
 */
export function hasDotSegment(rel: string): boolean {
  return toSegments(rel).some((segment) => segment.startsWith('.'))
}

/**
 * True when — on Windows only — any segment looks like an 8.3 short-name alias
 * (`ENV~1`, `GIT~1`). This is NEW-1 layer 1 (design §2.4): a cheap segment
 * rejection, NOT the fix. A long name may legitimately contain `~1`, so it is
 * win32-gated and the real enforcement is the post-resolve re-check at step 8h.
 *
 * `platform` is a parameter (default `process.platform`) so the predicate is
 * directly testable on any host, per the design's implementation note that the
 * gate must be exercised even where win32 is unavailable.
 */
export function hasShortNameAlias(
  rel: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform !== 'win32') {
    return false
  }
  return toSegments(rel).some((segment) => /~[0-9]/.test(segment))
}

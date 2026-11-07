// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Names under `<project>/.erfana/browser/` (spec 025 naming contracts; ADR 0009
 * decision 1). Main-side for now: a shared copy belongs in `src/shared/browser/`
 * once the renderer needs the names.
 */

export const ERFANA_DIR_NAME = '.erfana'
export const BROWSER_DIR_NAME = 'browser'
export const BROWSER_GITIGNORE_NAME = '.gitignore'
/** The self-ignore file's whole content (spec change S-20): exactly `*`, no newline. */
export const BROWSER_GITIGNORE_CONTENT = '*'
export const PROFILE_DIR_NAME = 'profile'
/** Erfana's own files inside the profile (marker, trust, zoom, …). */
export const PROFILE_ERFANA_DIR_NAME = 'Erfana'
export const CAPTURES_DIR_NAME = 'captures'
export const MARKER_FILE_NAME = 'marker.json'
/** Prefix of a set-aside profile folder: `profile.untrusted-<UTC time>`. */
export const UNTRUSTED_PROFILE_PREFIX = `${PROFILE_DIR_NAME}.untrusted-`

/** `.erfana/browser` as path segments below the project root. */
export const BROWSER_DIR_SEGMENTS: readonly string[] = Object.freeze([ERFANA_DIR_NAME, BROWSER_DIR_NAME])
/** `.erfana/browser` as a project-relative, `/`-separated path. */
export const BROWSER_DIR_REL = BROWSER_DIR_SEGMENTS.join('/')

/**
 * Whether a project-relative, `/`-separated path is `.erfana/browser` or lies
 * below it – the folder the project tree, the watcher and git polling never
 * look into (025-FR-015). Folded on a case-insensitive volume, where
 * `.Erfana/Browser` is the same folder.
 */
export function isBrowserDataRelPath(rel: string, caseSensitive: boolean): boolean {
  const key = caseSensitive ? rel : rel.toLowerCase()
  return key === BROWSER_DIR_REL || key.startsWith(`${BROWSER_DIR_REL}/`)
}

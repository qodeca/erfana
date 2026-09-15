// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `erfana-preview://` URL for a local file (Issue #124, WI-1; design §3),
 * whether two such URLs name the same document (WI-29), and the project-space
 * spelling of a confined real path (QG-6 A2).
 *
 * The builder moved out of `PreviewLiveView.ts` unchanged. The path arrives in
 * NATIVE form – `\` on Windows – so it is made relative to the real root, split
 * on the platform separator, and each segment is percent-encoded on its own.
 * Joining with `/` afterwards is what makes the URL path the same on every
 * platform.
 */

import { join, relative, sep } from 'node:path'

/**
 * The two `node:path` members the builder uses. A parameter only so a test can
 * apply the Windows rules (`path.win32`) on any host; production passes nothing.
 */
export interface PreviewUrlPathApi {
  relative(from: string, to: string): string
  readonly sep: string
}

/**
 * The two `node:path` members {@link toProjectPath} uses. A parameter for the
 * same reason as {@link PreviewUrlPathApi}; production passes nothing.
 */
export interface ProjectPathApi {
  join(...paths: string[]): string
  relative(from: string, to: string): string
}

const NATIVE_PATH: PreviewUrlPathApi & ProjectPathApi = { join, relative, sep }

/**
 * Build an `erfana-preview://<token>/<enc rel>` URL for an absolute local path.
 *
 * @param token - the view's registry token, used as the URL host
 * @param realRoot - the real (symlink-resolved) root the token serves
 * @param absPath - an absolute path inside `realRoot`, with native separators
 * @param pathApi - the path rules to apply; the host platform's by default
 */
export function buildPreviewUrl(
  token: string,
  realRoot: string,
  absPath: string,
  pathApi: PreviewUrlPathApi = NATIVE_PATH
): string {
  const segments = pathApi.relative(realRoot, absPath).split(pathApi.sep)
  return `erfana-preview://${token}/${segments.map(encodeURIComponent).join('/')}`
}

/**
 * The tree's spelling of a confined real path (issue #124, QG-6 A2; part 3
 * §3.4): the target's place under the real root, re-rooted at the project path
 * the tree shows. The renderer compares this string exactly for
 * one-file-one-tab, so every main-side site that turns a real path into a tab's
 * file path goes through here – two spellings of one file would open two tabs.
 *
 * Spelling only, not confinement: `realTarget` must already be confined inside
 * `realRoot` (`confinePath`). A plain file path comes back, not a URL, so
 * nothing is percent-encoded.
 *
 * @param projectPath - the project root as the tree spells it (may be a symlink)
 * @param realRoot - the real (symlink-resolved) project root
 * @param realTarget - a real path inside `realRoot`, with native separators
 * @param pathApi - the path rules to apply; the host platform's by default
 */
export function toProjectPath(
  projectPath: string,
  realRoot: string,
  realTarget: string,
  pathApi: ProjectPathApi = NATIVE_PATH
): string {
  return pathApi.join(projectPath, pathApi.relative(realRoot, realTarget))
}

/**
 * Whether two preview URLs name the same document (issue #124, WI-29; part 2
 * §2.3, RS3-2).
 *
 * Both sides go through `new URL`, and the scheme, the host (the view's token)
 * and the path must match. The fragment is ignored, and so is a query, which
 * the builder never produces and the protocol handler never reads. Spike S15:
 * Chromium hands an encoded path back unchanged but re-encodes a raw fragment
 * (`#sec 1` comes back as `#sec%201`), so an exact string match would never see
 * such a commit. A value that does not parse names no document.
 */
export function samePreviewDocument(a: string, b: string): boolean {
  const left = parseUrl(a)
  const right = parseUrl(b)
  return (
    left !== null &&
    right !== null &&
    left.protocol === right.protocol &&
    left.host === right.host &&
    left.pathname === right.pathname
  )
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

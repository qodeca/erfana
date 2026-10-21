// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown Link Resolver
 *
 * Resolves markdown links to absolute file paths, supporting:
 * - Relative links: ./file.md, ../docs/file.md
 * - Absolute from project root: /docs/file.md
 * - Filename only: file.md
 * - Anchors: file.md#section
 * - Percent-encoded names and anchors: my%20file.md#%C3%A9t%C3%A9
 *
 * Path math is done here on a parsed root + segments form, never with a
 * POSIX-only library: the main process hands the renderer NATIVE paths, so on
 * Windows they are `C:\proj\a.md` or `\\server\share\proj\a.md`.
 *
 * Security: the target is built from the project root's own strings plus
 * root-relative segments, and a `..` that would leave the root rejects the
 * link, so nothing outside the project is ever checked on disk.
 * Security: Blocks dangerous protocols (javascript:, data:, vbscript:, file:)
 */

import { isDangerousProtocol, isExternalProtocol } from './linkProtocols'
import { logger } from './logger'
import { stablePathDigest } from './fileUtils'
import { getRendererPlatform, isWindows } from './platform'

export interface ResolvedLink {
  /** Absolute file path (native separators for the platform) */
  filePath: string
  /** Optional anchor/fragment (e.g., "section-name"), percent-decoded */
  anchor?: string
  /** Whether the file exists */
  exists: boolean
}

/** An absolute path split into a root prefix and its segments. */
interface ParsedPath {
  /** '' (POSIX), 'C:' (drive) or '//server/share' (UNC), as written */
  root: string
  /** Segments with '.', '..' and empty parts already resolved */
  segments: string[]
}

const DRIVE_ROOT = /^([A-Za-z]):(?:\/|$)/
const UNC_ROOT = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/
const DRIVE_PREFIX = /^[A-Za-z]:/
const DRIVE_ABSOLUTE = /^[A-Za-z]:\//
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

/** Keep the non-empty, non-'.' parts of a '/'-separated string. */
function splitSegments(p: string): string[] {
  return p.split('/').filter((part) => part !== '' && part !== '.')
}

/** Resolve '..' in an already-absolute path, clamping at the root. */
function resolveDots(parts: string[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

/**
 * Split an absolute native path into root and segments. Returns null for a
 * relative path.
 *
 * Only on win32 is '\' a separator and are drive ('C:') and UNC
 * ('//server/share') roots recognised. Elsewhere '\' is an ordinary filename
 * character and '//' is an ordinary path. Links never get their '..' resolved
 * here – see {@link applyLink}.
 */
function parseAbsolute(input: string, platform: NodeJS.Platform): ParsedPath | null {
  if (!isWindows(platform)) {
    if (!input.startsWith('/')) return null
    return { root: '', segments: resolveDots(splitSegments(input)) }
  }
  const p = input.replace(/\\/g, '/')
  const unc = UNC_ROOT.exec(p)
  if (unc) {
    return {
      root: `//${unc[1]}/${unc[2]}`,
      segments: resolveDots(splitSegments(p.slice(unc[0].length)))
    }
  }
  const drive = DRIVE_ROOT.exec(p)
  if (drive) {
    return {
      root: `${drive[1]}:`,
      segments: resolveDots(splitSegments(p.slice(drive[0].length)))
    }
  }
  return null
}

/** Render a root plus segments in the native form of the given platform. */
function formatPath(root: string, segments: readonly string[], platform: NodeJS.Platform): string {
  const joined = root + '/' + segments.join('/')
  return isWindows(platform) ? joined.replace(/\//g, '\\') : joined
}

/** Compare two names (segments or roots), folding case only on Windows. */
function sameName(a: string, b: string, platform: NodeJS.Platform): boolean {
  return isWindows(platform) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether `file` equals or is nested under `root`. */
function isUnder(file: ParsedPath, root: ParsedPath, platform: NodeJS.Platform): boolean {
  if (!sameName(file.root, root.root, platform)) return false
  if (file.segments.length < root.segments.length) return false
  return root.segments.every((seg, i) => sameName(seg, file.segments[i], platform))
}

/**
 * Apply a '/'-separated relative link to a root-relative directory.
 *
 * Returns null the moment a '..' would climb above the root, or – on win32 –
 * when a segment contains ':' (a drive or stream marker). The result is inside
 * the project by construction, so containment never depends on case folding.
 */
function applyLink(
  base: readonly string[],
  link: string,
  platform: NodeJS.Platform
): string[] | null {
  const out = [...base]
  for (const part of link.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    if (isWindows(platform) && part.includes(':')) return null
    out.push(part)
  }
  return out
}

/**
 * Check if a path is within the project directory
 *
 * Handles POSIX paths, and on win32 drive-letter and UNC paths with either
 * separator, comparing case-insensitively. Pure string math for link
 * resolution – real confinement stays main-side.
 *
 * @param filePath - Absolute path to check
 * @param projectRoot - Absolute path to project root
 * @param platform - Whose path rules apply; defaults to the renderer's own
 * @returns true if filePath is within or equal to projectRoot
 *
 * @example
 * isPathWithinProject('/project/docs/file.md', '/project') // => true
 * isPathWithinProject('/etc/passwd', '/project') // => false
 * isPathWithinProject('c:\\Proj\\a.md', 'C:\\proj', 'win32') // => true
 */
export function isPathWithinProject(
  filePath: string,
  projectRoot: string,
  platform: NodeJS.Platform = getRendererPlatform()
): boolean {
  const file = parseAbsolute(filePath, platform)
  const root = parseAbsolute(projectRoot, platform)
  // Both should be absolute paths
  if (!file || !root) return false
  return isUnder(file, root, platform)
}

/**
 * Check if a file exists using the IPC API
 *
 * @param filePath - Absolute path to check
 * @returns Promise resolving to true if file exists, false if ENOENT
 * @throws Error for non-ENOENT errors (permission denied, IPC failure, etc.)
 */
async function checkFileExists(filePath: string): Promise<boolean> {
  // Uses the dedicated file:exists IPC channel (fs.access, never throws), so a
  // missing target is a plain `false` with no error-log noise and no fragile
  // error-message parsing.
  const exists = await window.api.file.exists(filePath)
  if (!exists) {
    // Digest, not the path: it names a file in the user's project
    logger.debug('[MarkdownLinkResolver] link target missing', {
      pathDigest: stablePathDigest(filePath)
    })
  }
  return exists
}

/**
 * Search for a filename in the current directory and project root (in parallel)
 *
 * Both candidates are inside the project before either is checked on disk.
 *
 * @returns The root-relative segments of the file found, or the current
 *          directory candidate when neither exists
 */
async function searchForFile(
  currentCandidate: string[],
  rootCandidate: string[],
  rootPath: ParsedPath,
  platform: NodeJS.Platform
): Promise<string[]> {
  const full = (rel: string[]): string =>
    formatPath(rootPath.root, [...rootPath.segments, ...rel], platform)
  const [existsInCurrentDir, existsInProjectRoot] = await Promise.all([
    checkFileExists(full(currentCandidate)),
    checkFileExists(full(rootCandidate))
  ])
  if (existsInCurrentDir) return currentCandidate
  if (existsInProjectRoot) return rootCandidate
  return currentCandidate
}

/** Percent-decode text; a malformed escape leaves the text as written. */
function decodeLinkPath(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * Resolve a markdown link to an absolute file path
 *
 * @param linkHref - The href attribute from the markdown link
 * @param currentFilePath - Absolute path of the current markdown file
 * @param projectRoot - Absolute path of the project root directory
 * @param platform - Platform whose path rules apply; defaults to the renderer's own
 * @returns ResolvedLink object or null if the link is external, invalid or outside the project
 *
 * @example
 * await resolveMarkdownLink('./docs/api.md', '/project/README.md', '/project')
 * // => { filePath: '/project/docs/api.md', exists: true }
 *
 * // Windows: result keeps native separators
 * await resolveMarkdownLink('./api.md', 'C:\\proj\\README.md', 'C:\\proj', 'win32')
 * // => { filePath: 'C:\\proj\\api.md', exists: true }
 */
export async function resolveMarkdownLink(
  linkHref: string,
  currentFilePath: string,
  projectRoot: string,
  platform: NodeJS.Platform = getRendererPlatform()
): Promise<ResolvedLink | null> {
  // Security: Block dangerous protocols
  if (isDangerousProtocol(linkHref)) {
    logger.warn('[MarkdownLinkResolver] Blocked dangerous protocol: ' + linkHref.split(':')[0])
    return null
  }

  // Parse anchor/fragment
  const hashIndex = linkHref.indexOf('#')
  let pathPart: string
  let anchor: string | undefined

  if (hashIndex !== -1) {
    pathPart = linkHref.slice(0, hashIndex)
    anchor = decodeLinkPath(linkHref.slice(hashIndex + 1))
  } else {
    pathPart = linkHref
  }

  // Skip external URLs and safe external protocols
  if (isExternalProtocol(pathPart)) {
    return null
  }

  // Skip empty paths (anchor-only links like #section)
  if (pathPart === '') {
    return null
  }

  // A protocol hidden behind percent-escapes is not a file link either
  const decoded = decodeLinkPath(pathPart)
  if (decoded !== pathPart && (isDangerousProtocol(decoded) || isExternalProtocol(decoded))) {
    return null
  }

  // Normalize path separators (convert Windows backslashes to forward slashes)
  // Also collapse multiple consecutive slashes (e.g., docs//api.md -> docs/api.md)
  const linkPath = decoded.replace(/\\/g, '/').replace(/\/+/g, '/')

  const rootPath = parseAbsolute(projectRoot, platform)
  const parsedFile = parseAbsolute(currentFilePath, platform)
  if (!rootPath || !parsedFile || !isUnder(parsedFile, rootPath, platform)) {
    logger.warn('[MarkdownLinkResolver] Current file is not inside the project')
    return null
  }
  // The current file's directory, relative to the root
  const currentDir = parsedFile.segments.slice(rootPath.segments.length, -1)

  let target: string[] | null

  if (isWindows(platform) && DRIVE_PREFIX.test(linkPath)) {
    // Drive-absolute link (C:/docs/a.md): a path like any other, so it must lie
    // in the project. Drive-relative (C:a.md) names no fixed place: refused.
    const absolute = DRIVE_ABSOLUTE.test(linkPath) ? parseAbsolute(linkPath, platform) : null
    target =
      absolute && isUnder(absolute, rootPath, platform)
        ? absolute.segments.slice(rootPath.segments.length)
        : null
  } else if (isWindows(platform) && URL_SCHEME.test(linkPath)) {
    // Any other scheme ('foo:bar'): ':' cannot appear in a Windows file name
    target = null
  } else if (linkPath.startsWith('/')) {
    // Case 1: Absolute from project root (/docs/file.md)
    target = applyLink([], linkPath, platform)
  } else if (linkPath.startsWith('./') || linkPath.startsWith('../')) {
    // Case 2: Relative (./ or ../)
    target = applyLink(currentDir, linkPath, platform)
  } else {
    // Case 3: Filename only (file.md)
    const inCurrentDir = applyLink(currentDir, linkPath, platform)
    const inRoot = applyLink([], linkPath, platform)
    target =
      inCurrentDir && inRoot
        ? await searchForFile(inCurrentDir, inRoot, rootPath, platform)
        : null
  }

  // Security: nothing outside the project reaches the file system. The log
  // carries no part of the link or the path.
  if (!target) {
    logger.warn('[MarkdownLinkResolver] Link points outside project')
    return null
  }

  const filePath = formatPath(rootPath.root, [...rootPath.segments, ...target], platform)
  const exists = await checkFileExists(filePath)

  return {
    filePath,
    anchor,
    exists
  }
}

/**
 * Get a human-readable description of the resolved link for tooltips
 *
 * @param linkHref - Original link from markdown
 * @param resolvedPath - Resolved absolute path
 * @param exists - Whether the file exists
 * @returns Tooltip text with emoji indicator
 */
export function getLinkTooltip(
  linkHref: string,
  resolvedPath: string,
  exists: boolean
): string {
  if (!exists) {
    return `⚠️ File not found: ${linkHref}`
  }

  return `📄 ${linkHref} → ${resolvedPath}`
}

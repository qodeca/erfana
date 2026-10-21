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
 * - Percent-encoded names: my%20file.md
 *
 * Path math is done here on a parsed root + segments form, never with a
 * POSIX-only library: the main process hands the renderer NATIVE paths, so on
 * Windows they are `C:\proj\a.md` or `\\server\share\proj\a.md`.
 *
 * Security: Ensures resolved paths stay within project boundaries
 * Security: Blocks dangerous protocols (javascript:, data:, vbscript:, file:)
 */

import { isDangerousProtocol, isExternalProtocol } from './linkProtocols'
import { logger } from './logger'
import { getRendererPlatform, isWindows } from './platform'

export interface ResolvedLink {
  /** Absolute file path (native separators for the platform) */
  filePath: string
  /** Optional anchor/fragment (e.g., "section-name") */
  anchor?: string
  /** Whether the file exists */
  exists: boolean
}

/** An absolute path split into a root prefix and its normalised segments. */
interface ParsedPath {
  /** '' (POSIX), 'C:' (drive) or '//server/share' (UNC) */
  root: string
  /** Segments with '.', '..' and empty parts already resolved */
  segments: string[]
}

const DRIVE_ROOT = /^([A-Za-z]):(?:\/|$)/
const UNC_ROOT = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/

/**
 * Collapse '.', '..' and empty segments. A '..' at the root is dropped, the
 * same way `path.resolve` clamps at the filesystem root.
 */
function collapseSegments(parts: string[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out
}

/**
 * Split an absolute path into root and segments, whatever separators it uses.
 * Returns null for a relative path. The drive letter is upper-cased and UNC
 * roots are kept as '//server/share'.
 */
function parseAbsolute(input: string): ParsedPath | null {
  const p = input.replace(/\\/g, '/')
  const unc = UNC_ROOT.exec(p)
  if (unc) {
    return {
      root: `//${unc[1]}/${unc[2]}`,
      segments: collapseSegments(p.slice(unc[0].length).split('/'))
    }
  }
  const drive = DRIVE_ROOT.exec(p)
  if (drive) {
    return {
      root: `${drive[1].toUpperCase()}:`,
      segments: collapseSegments(p.slice(drive[0].length).split('/'))
    }
  }
  if (p.startsWith('/')) {
    return { root: '', segments: collapseSegments(p.split('/')) }
  }
  return null
}

/** Render a parsed path in the native form of the given platform. */
function formatPath(parsed: ParsedPath, platform: NodeJS.Platform): string {
  const joined = parsed.root + '/' + parsed.segments.join('/')
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

/** Append '/'-separated relative parts to a parsed base. */
function joinParsed(base: ParsedPath, relative: string): ParsedPath {
  return {
    root: base.root,
    segments: collapseSegments([...base.segments, ...relative.split('/')])
  }
}

/**
 * Check if a path is within the project directory
 *
 * Handles POSIX, drive-letter and UNC paths with either separator; on Windows
 * the comparison ignores case. Pure string math for link resolution – real
 * confinement stays main-side.
 *
 * @param filePath - Absolute path to check
 * @param projectRoot - Absolute path to project root
 * @param platform - Whose case rule applies; defaults to the renderer's own
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
  const file = parseAbsolute(filePath)
  const root = parseAbsolute(projectRoot)
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
    logger.debug('[MarkdownLinkResolver] link target missing', { filePath })
  }
  return exists
}

/**
 * Search for a filename in the current directory and project root (in parallel)
 *
 * @param filename - Relative '/'-separated name (e.g., "file.md")
 * @param currentDir - Parsed current directory
 * @param projectRoot - Parsed project root
 * @param platform - Platform used to render the native candidate paths
 * @returns Promise resolving to found path, or current dir candidate if not found
 */
async function searchForFile(
  filename: string,
  currentDir: ParsedPath,
  projectRoot: ParsedPath,
  platform: NodeJS.Platform
): Promise<ParsedPath> {
  const candidateInCurrentDir = joinParsed(currentDir, filename)
  const candidateInProjectRoot = joinParsed(projectRoot, filename)

  // Parallel checks to avoid race conditions
  const [existsInCurrentDir, existsInProjectRoot] = await Promise.all([
    checkFileExists(formatPath(candidateInCurrentDir, platform)),
    checkFileExists(formatPath(candidateInProjectRoot, platform))
  ])

  // Prefer current directory
  if (existsInCurrentDir) {
    return candidateInCurrentDir
  }

  if (existsInProjectRoot) {
    return candidateInProjectRoot
  }

  // Not found - return current dir candidate as fallback
  return candidateInCurrentDir
}

/** Percent-decode a link path; a malformed escape leaves the text as written. */
function decodeLinkPath(pathPart: string): string {
  try {
    return decodeURIComponent(pathPart)
  } catch {
    return pathPart
  }
}

/**
 * Resolve a markdown link to an absolute file path
 *
 * @param linkHref - The href attribute from the markdown link
 * @param currentFilePath - Absolute path of the current markdown file
 * @param projectRoot - Absolute path of the project root directory
 * @param platform - Platform whose path rules apply; defaults to the renderer's own
 * @returns ResolvedLink object or null if the link is external or invalid
 *
 * @example
 * // Relative link
 * await resolveMarkdownLink('./docs/api.md', '/project/README.md', '/project')
 * // => { filePath: '/project/docs/api.md', exists: true }
 *
 * // Absolute from root
 * await resolveMarkdownLink('/docs/api.md', '/project/README.md', '/project')
 * // => { filePath: '/project/docs/api.md', exists: true }
 *
 * // With anchor
 * await resolveMarkdownLink('./api.md#section', '/project/README.md', '/project')
 * // => { filePath: '/project/api.md', anchor: 'section', exists: true }
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
    anchor = linkHref.slice(hashIndex + 1)
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

  // Normalize path separators (convert Windows backslashes to forward slashes)
  // Also collapse multiple consecutive slashes (e.g., docs//api.md -> docs/api.md)
  const normalizedPathPart = decodeLinkPath(pathPart).replace(/\\/g, '/').replace(/\/+/g, '/')

  const parsedFile = parseAbsolute(currentFilePath)
  const parsedRoot = parseAbsolute(projectRoot)
  if (!parsedFile || !parsedRoot) {
    logger.warn('[MarkdownLinkResolver] Current file or project root is not an absolute path')
    return null
  }
  const currentDir: ParsedPath = { root: parsedFile.root, segments: parsedFile.segments.slice(0, -1) }

  let resolved: ParsedPath

  // Case 1: Absolute from project root (/docs/file.md)
  if (normalizedPathPart.startsWith('/')) {
    resolved = joinParsed(parsedRoot, normalizedPathPart)
  }
  // Case 2: Relative (./ or ../)
  else if (normalizedPathPart.startsWith('./') || normalizedPathPart.startsWith('../')) {
    resolved = joinParsed(currentDir, normalizedPathPart)
  }
  // Case 3: Filename only (file.md)
  else {
    resolved = await searchForFile(normalizedPathPart, currentDir, parsedRoot, platform)
  }

  // Security: Ensure path is within project
  if (!isUnder(resolved, parsedRoot, platform)) {
    // Log only the tail below the shared prefix to avoid exposing full filesystem structure
    logger.warn(
      '[MarkdownLinkResolver] Link points outside project: ' +
        resolved.segments.slice(parsedRoot.segments.length).join('/')
    )
    return null
  }

  const filePath = formatPath(resolved, platform)

  // Check if file exists
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

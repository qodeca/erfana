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
 *
 * Security: Ensures resolved paths stay within project boundaries
 * Security: Blocks dangerous protocols (javascript:, data:, vbscript:, file:)
 */

import path from 'path-browserify'
import { isDangerousProtocol, isExternalProtocol } from './linkProtocols'
import { logger } from './logger'

export interface ResolvedLink {
  /** Absolute file path */
  filePath: string
  /** Optional anchor/fragment (e.g., "section-name") */
  anchor?: string
  /** Whether the file exists */
  exists: boolean
}

/**
 * Check if a path is within the project directory
 *
 * @param filePath - Absolute path to check
 * @param projectRoot - Absolute path to project root
 * @returns true if filePath is within or equal to projectRoot
 *
 * @example
 * isPathWithinProject('/project/docs/file.md', '/project') // => true
 * isPathWithinProject('/etc/passwd', '/project') // => false
 */
export function isPathWithinProject(filePath: string, projectRoot: string): boolean {
  const normalizedFile = path.normalize(filePath)
  const normalizedRoot = path.normalize(projectRoot)

  // Both should be absolute paths
  if (!path.isAbsolute(normalizedFile) || !path.isAbsolute(normalizedRoot)) {
    return false
  }

  // Exact match - file is the project root itself
  if (normalizedFile === normalizedRoot) {
    return true
  }

  // Use path.relative to check containment
  // If relative path starts with '..' or is absolute, it's outside
  const relative = path.relative(normalizedRoot, normalizedFile)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
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
 * @param filename - Just the filename (e.g., "file.md")
 * @param currentDir - Absolute path to current directory
 * @param projectRoot - Absolute path to project root
 * @returns Promise resolving to found path, or current dir candidate if not found
 */
async function searchForFile(
  filename: string,
  currentDir: string,
  projectRoot: string
): Promise<string> {
  // Check both in parallel for better performance
  const candidateInCurrentDir = path.join(currentDir, filename)
  const candidateInProjectRoot = path.join(projectRoot, filename)

  // Parallel checks to avoid race conditions
  const [existsInCurrentDir, existsInProjectRoot] = await Promise.all([
    checkFileExists(candidateInCurrentDir),
    checkFileExists(candidateInProjectRoot)
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

/**
 * Resolve a markdown link to an absolute file path
 *
 * @param linkHref - The href attribute from the markdown link
 * @param currentFilePath - Absolute path of the current markdown file
 * @param projectRoot - Absolute path of the project root directory
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
 */
export async function resolveMarkdownLink(
  linkHref: string,
  currentFilePath: string,
  projectRoot: string
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
  const normalizedPathPart = pathPart.replace(/\\/g, '/').replace(/\/+/g, '/')

  let resolvedPath: string
  const currentDir = path.dirname(currentFilePath)

  // Case 1: Absolute from project root (/docs/file.md)
  if (normalizedPathPart.startsWith('/')) {
    resolvedPath = path.join(projectRoot, normalizedPathPart.slice(1))
  }
  // Case 2: Relative (./ or ../)
  else if (normalizedPathPart.startsWith('./') || normalizedPathPart.startsWith('../')) {
    resolvedPath = path.resolve(currentDir, normalizedPathPart)
  }
  // Case 3: Filename only (file.md)
  else {
    resolvedPath = await searchForFile(normalizedPathPart, currentDir, projectRoot)
  }

  // Normalize for consistent comparison
  resolvedPath = path.normalize(resolvedPath)
  const normalizedProjectRoot = path.normalize(projectRoot)

  // Security: Ensure path is within project
  if (!isPathWithinProject(resolvedPath, normalizedProjectRoot)) {
    // Log relative path only to avoid exposing full filesystem structure
    const relativePath = path.relative(normalizedProjectRoot, resolvedPath)
    logger.warn('[MarkdownLinkResolver] Link points outside project: ' + relativePath)
    return null
  }

  // Check if file exists
  const exists = await checkFileExists(resolvedPath)

  return {
    filePath: resolvedPath,
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

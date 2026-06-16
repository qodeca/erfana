// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File Utility Functions
 * Shared utilities for file operations in the renderer process
 */

/**
 * Sanitize file path for use as a panel ID
 * Converts: /Users/name/docs/notes.md → users-name-docs-notes-md
 */
export function sanitizeFilePath(filePath: string): string {
  return filePath
    .replace(/^\//, '')              // Remove leading slash
    .replace(/[^a-zA-Z0-9]/g, '-')  // Replace special chars with dash
    .toLowerCase()                   // Lowercase for consistency
}

/**
 * Extract the final path segment (folder or file name) from a path, handling
 * both POSIX ('/') and Windows ('\\') separators plus any trailing separators.
 *
 * Renderer paths arrive with their native separators (the main process does not
 * convert Windows '\\' to '/'), so a plain `split('/')` returns the whole path
 * on Windows. Use this anywhere a display name is derived from a path.
 */
export function getBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() ?? ''
}

/**
 * Extract the parent (directory) portion of a path, handling both POSIX ('/')
 * and Windows ('\\') separators plus any trailing separators.
 *
 * Returns the parent in the path's NATIVE separators, or '' when there is no
 * separator at all (unlike Node's `path.dirname`, which would return '.').
 * Callers that need the root sentinel should wrap the result as `|| '/'`.
 *
 * Display/parse-only — not for security confinement.
 */
export function getDirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const m = trimmed.match(/^(.*)[\\/][^\\/]+$/)
  return m ? m[1] : ''
}

/**
 * Normalize a path for comparison: collapse runs of either separator to a
 * single '/' and strip any trailing separators. Internal helper only.
 *
 * Display/parse-only — not for security confinement.
 */
function normalizePathForCompare(p: string): string {
  return p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
}

/**
 * Derive a display-friendly relative path for a file under a base path,
 * handling both POSIX ('/') and Windows ('\\') separators. The returned tail
 * uses '/' separators. Falls back to the basename when there is no base path,
 * when the file equals the base, or when the file lies outside the base.
 *
 * Display/parse-only — not for security confinement.
 */
export function getDisplayRelativePath(filePath: string, basePath: string | null): string {
  if (!basePath || !filePath) return getBasename(filePath)
  const normFile = filePath.replace(/[\\/]+/g, '/')
  const normBase = basePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  if (normFile === normBase) return getBasename(filePath)
  if (normFile.startsWith(normBase + '/')) return normFile.slice(normBase.length + 1)
  return getBasename(filePath)
}

/**
 * Check whether childPath is the same as, or nested under, parentPath. Handles
 * both POSIX ('/') and Windows ('\\') separators and ignores trailing
 * separators. Equal paths return true.
 *
 * Display/parse-only — not for security confinement.
 */
export function isPathInside(parentPath: string, childPath: string): boolean {
  if (!parentPath || !childPath) return false
  const p = normalizePathForCompare(parentPath)
  const c = normalizePathForCompare(childPath)
  return c === p || c.startsWith(p + '/')
}

/**
 * Check whether childPath is strictly nested under parentPath (a proper
 * descendant). Equal paths return false. Handles both POSIX ('/') and
 * Windows ('\\') separators.
 *
 * Display/parse-only — not for security confinement.
 */
export function isStrictDescendant(parentPath: string, childPath: string): boolean {
  return (
    normalizePathForCompare(childPath) !== normalizePathForCompare(parentPath) &&
    isPathInside(parentPath, childPath)
  )
}

/**
 * Check if file is a markdown file by extension
 */
export function isMarkdownFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

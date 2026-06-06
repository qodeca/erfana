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
 * Check if file is a markdown file by extension
 */
export function isMarkdownFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

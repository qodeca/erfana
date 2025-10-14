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
 * Check if file is a markdown file by extension
 */
export function isMarkdownFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * Shell Path Escaping Utilities
 * Functions for safely escaping file paths for use in shell commands.
 *
 * Used by terminal drag-and-drop to insert file paths that are safe
 * regardless of spaces, quotes, or special characters in the path.
 */

/**
 * Escapes a file path for safe use in shell commands.
 * Uses single-quote wrapping with internal quote escaping.
 *
 * The escaping strategy:
 * - Wrap entire path in single quotes
 * - Escape any internal single quotes as: '\''
 *   (end quote, escaped quote, start quote)
 *
 * This handles all shell metacharacters (spaces, $, `, !, etc.)
 * because single-quoted strings in POSIX shells treat everything
 * literally except the closing single quote.
 *
 * @param path - The file path to escape
 * @returns The escaped path safe for shell insertion
 *
 * @example Simple path with spaces
 * ```ts
 * escapePathForShell('/path/with spaces/file.txt')
 * // Returns: '/path/with spaces/file.txt'
 * ```
 *
 * @example Path with single quote
 * ```ts
 * escapePathForShell("/path/with'quote/file.txt")
 * // Returns: '/path/with'\''quote/file.txt'
 * ```
 *
 * @example Path with shell metacharacters
 * ```ts
 * escapePathForShell('/path/$HOME/file.txt')
 * // Returns: '/path/$HOME/file.txt'
 * // (The $HOME is NOT expanded because it's in single quotes)
 * ```
 */
export function escapePathForShell(path: string): string {
  // Remove null bytes (defense-in-depth - file systems reject them anyway)
  const sanitized = path.replace(/\0/g, '')
  // Single-quote wrap with internal quote escaping
  // 'path' -> 'path'
  // path's -> 'path'\''s'
  return "'" + sanitized.replace(/'/g, "'\\''") + "'"
}

/**
 * Formats multiple paths for terminal insertion, one per line.
 *
 * Each path is individually escaped, then joined with newlines.
 * This allows dragging multiple files to insert them all at once.
 *
 * @param paths - Array of file paths to format
 * @returns Newline-separated escaped paths
 *
 * @example Multiple files
 * ```ts
 * formatPathsForTerminal(['/path/file1.txt', '/path/file2.txt'])
 * // Returns: "'/path/file1.txt'\n'/path/file2.txt'"
 * ```
 */
export function formatPathsForTerminal(paths: string[]): string {
  return paths.map(escapePathForShell).join('\n')
}

/**
 * Template helper functions for prompt rendering
 * These are simple functions that don't require Handlebars (CSP-safe)
 */

/**
 * Truncate a string to a maximum length
 * Usage: {{truncate selectedText 100}}
 */
export function truncate(str?: string | number, length?: string | number): string {
  if (typeof str !== 'string') return ''
  const maxLength = typeof length === 'number' ? length : Number(length)
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str
}

/**
 * Get the basename (filename) from a file path
 * Usage: {{basename filePath}}
 */
export function basename(path?: string | number): string {
  if (typeof path !== 'string') return ''
  return path.split('/').pop() || path
}

/**
 * Get the directory name from a file path
 * Usage: {{dirname filePath}}
 */
export function dirname(path?: string | number): string {
  if (typeof path !== 'string') return ''
  const parts = path.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

/**
 * Format a line range into a human-readable string
 * Usage: {{formatLineRange startLine endLine}}
 */
export function formatLineRange(start?: string | number, end?: string | number): string {
  const startNum = typeof start === 'number' ? start : Number(start)
  const endNum = typeof end === 'number' ? end : Number(end)

  if (!startNum) return ''
  if (!endNum || startNum === endNum) return `line ${startNum}`
  return `lines ${startNum}-${endNum}`
}

/**
 * Convert text to uppercase
 * Usage: {{uppercase text}}
 */
export function uppercase(str?: string | number): string {
  if (typeof str !== 'string') return ''
  return str.toUpperCase()
}

/**
 * Convert text to lowercase
 * Usage: {{lowercase text}}
 */
export function lowercase(str?: string | number): string {
  if (typeof str !== 'string') return ''
  return str.toLowerCase()
}

/**
 * Pluralize a word based on count
 * Usage: {{pluralize count "file" "files"}}
 */
export function pluralize(
  count?: string | number,
  singular?: string | number,
  plural?: string | number
): string {
  const num = typeof count === 'number' ? count : Number(count)
  const singularStr = String(singular)
  const pluralStr = String(plural)
  return num === 1 ? singularStr : pluralStr
}

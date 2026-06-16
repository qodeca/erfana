// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * File Extension Constants
 *
 * Centralized source of truth for file extension categorization.
 * Used by TextConverter (for file dialog filters) and ConverterRegistry
 * (for fallback text detection).
 */

/**
 * Primary text file extensions shown in file dialog filters
 * These are common document and data formats
 */
export const TEXT_EXTENSIONS = [
  // Plain text
  'txt',
  'text',
  // Markdown
  'md',
  'markdown',
  'mdown',
  'mkd',
  // Data formats
  'json',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'toml',
  // Config files
  'ini',
  'conf',
  'cfg',
  'properties',
  'env',
  // Log files
  'log',
  // Shell scripts
  'sh',
  'bash',
  'zsh',
  'bat',
  'cmd',
  'ps1',
  // Web formats
  'html',
  'htm',
  'css',
  'svg',
  // Other text formats
  'rtf',
  'tex',
  'latex',
  'rst',
  'adoc',
  'asciidoc',
  'org'
] as const

/**
 * Code/programming file extensions
 * Used for fallback text detection when a file extension
 * isn't in TEXT_EXTENSIONS but is likely still text
 */
export const CODE_EXTENSIONS = [
  // JavaScript/TypeScript
  'js',
  'ts',
  'jsx',
  'tsx',
  'mjs',
  'cjs',
  // Python
  'py',
  'pyw',
  'pyi',
  // Ruby
  'rb',
  'erb',
  // PHP
  'php',
  // Java/JVM
  'java',
  'kt',
  'scala',
  'groovy',
  // C-family
  'c',
  'cpp',
  'cc',
  'cxx',
  'h',
  'hpp',
  'hxx',
  // C#/F#
  'cs',
  'fs',
  // Go
  'go',
  // Rust
  'rs',
  // Swift
  'swift',
  // Lua
  'lua',
  // Perl
  'pl',
  'pm',
  // R
  'r',
  // SQL
  'sql',
  // Modern web frameworks
  'vue',
  'svelte',
  // Config files without standard extensions
  'lock',
  'editorconfig',
  'gitignore',
  'gitattributes',
  'dockerignore',
  'npmrc',
  'nvmrc',
  'babelrc',
  'eslintrc',
  'prettierrc'
] as const

/**
 * All extensions that are likely to be text files
 */
export const ALL_TEXT_LIKE_EXTENSIONS = [...TEXT_EXTENSIONS, ...CODE_EXTENSIONS] as const

/**
 * Extensions that LiteParseConverter must never claim.
 * These are handled natively by TextConverter (csv, tsv as data, svg as markup).
 * Used by both LiteParseConverter and ConverterRegistry.updateConverterExtensions().
 *
 * @see Issue #132 – LiteParse document import
 */
export const LITEPARSE_EXCLUDED_EXTENSIONS = new Set(['csv', 'tsv', 'svg'])

/**
 * Video file extensions supported for import with audio extraction
 *
 * @see Issue #110 - Video file import
 */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'] as const

/**
 * Check if an extension is a supported video file extension
 *
 * @param ext - Extension to check (with or without dot, case-insensitive)
 * @returns true if it's a video extension
 */
export function isVideoExtension(ext: string): boolean {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  return (VIDEO_EXTENSIONS as readonly string[]).includes(normalized)
}

/**
 * Check if an extension is a known text file extension
 * (from TEXT_EXTENSIONS list)
 *
 * @param ext - Extension to check (with or without dot, case-insensitive)
 * @returns true if it's a primary text extension
 */
export function isTextExtension(ext: string): boolean {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  return (TEXT_EXTENSIONS as readonly string[]).includes(normalized)
}

/**
 * Check if an extension is a known code file extension
 * (from CODE_EXTENSIONS list)
 *
 * @param ext - Extension to check (with or without dot, case-insensitive)
 * @returns true if it's a code extension
 */
export function isCodeExtension(ext: string): boolean {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  return (CODE_EXTENSIONS as readonly string[]).includes(normalized)
}

/**
 * Check if an extension is likely to be a text file
 * (from either TEXT_EXTENSIONS or CODE_EXTENSIONS)
 *
 * @param ext - Extension to check (with or without dot, case-insensitive)
 * @returns true if it's likely text
 */
export function isTextLikeExtension(ext: string): boolean {
  return isTextExtension(ext) || isCodeExtension(ext)
}

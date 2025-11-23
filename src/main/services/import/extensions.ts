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

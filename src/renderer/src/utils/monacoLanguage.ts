// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Monaco language resolution
 *
 * Maps a file path to the Monaco language id used to open it in the editor.
 * Unknown or extension-less paths default to `'markdown'`, so the editor's
 * existing behaviour is unchanged for anything the map does not recognise.
 */

import { getBasename } from './fileUtils'

/** Language id used when an extension is unknown or absent. */
const DEFAULT_LANGUAGE = 'markdown'

/**
 * Lowercase file extension (without the leading dot) → Monaco language id.
 *
 * Only extensions Erfana intends to open with rich (non-markdown) tokenization
 * are listed; everything else falls through to {@link DEFAULT_LANGUAGE}.
 */
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  svg: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown'
}

/**
 * Extract the lowercase extension (without the leading dot) from a file path.
 *
 * Uses the cross-platform {@link getBasename} so Windows `\` separators are
 * handled, and treats dot-files (`.gitignore`) and trailing dots as having no
 * extension.
 */
function getExtension(filePath: string): string {
  const name = getBasename(filePath)
  const dot = name.lastIndexOf('.')
  // No dot, a leading-dot dotfile, or a trailing dot => no usable extension.
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * Resolve the Monaco language id for a file path.
 *
 * @param filePath - The file path (native separators are accepted).
 * @returns The Monaco language id, or `'markdown'` for unknown/absent extensions.
 */
export function getMonacoLanguage(filePath: string): string {
  const ext = getExtension(filePath)
  return EXTENSION_TO_LANGUAGE[ext] ?? DEFAULT_LANGUAGE
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview console-message classifier (Issue #74, work item 16).
 *
 * A PURE function that maps one Chromium `console-message` into a preview
 * failure input, or `null` when the message is not a class Erfana surfaces.
 * This is the ONLY producer of the `script-error` and `unresolved-specifier`
 * failure types (design §1.3).
 *
 * The console text is authored by the previewed page and is therefore untrusted
 * DATA: it is never executed and never reflected into a response. This module
 * bounds it to {@link CONSOLE_MESSAGE_MAX_CHARS} (512, per the §0 diagnostic
 * table) and strips Cf/Cc code points from every value it emits, so a hostile
 * page cannot smuggle bidi-override or zero-width characters through the
 * classifier. (`PreviewFailureLog.record` strips again — defence in depth.)
 *
 * @see docs/designs/sd-074-html-preview.md §0 (Console messages bound), §1.3
 */
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'

/**
 * Chromium's `MessageDetails.source` union (Electron `console-message`). Kept
 * local so this leaf module needs no `electron` import; a plain `string` is also
 * accepted for forward compatibility with future source kinds.
 */
export type ConsoleSource =
  | 'javascript'
  | 'xml'
  | 'network'
  | 'console-api'
  | 'storage'
  | 'rendering'
  | 'security'
  | 'deprecation'
  | 'worker'
  | 'violation'
  | 'intervention'
  | 'recommendation'
  | 'other'
  | (string & {})

/** Max characters retained from a console message (§0 diagnostic bound). */
export const CONSOLE_MESSAGE_MAX_CHARS = 512

/**
 * Chromium console level: 0 verbose, 1 info, 2 warning, 3 error
 * (`electron.d.ts` `ConsoleMessageEvent.level`). Only error-level messages are
 * classified — diagnostics below error are page-normal noise.
 */
const CONSOLE_LEVEL_ERROR = 3

/** Substring that identifies a failed ES-module specifier resolution. */
const MODULE_SPECIFIER_MARKER = 'Failed to resolve module specifier'

/** A leading "Uncaught …" marks an uncaught page exception. */
const UNCAUGHT_PATTERN = /^\s*uncaught\b/i

const CF_CC_PATTERN = /[\p{Cf}\p{Cc}]/gu

/** Bound + Cf/Cc-strip a page-authored string before it leaves this module. */
function sanitize(value: string): string {
  return value.replace(CF_CC_PATTERN, '').slice(0, CONSOLE_MESSAGE_MAX_CHARS)
}

/**
 * Extract the offending specifier from a "Failed to resolve module specifier
 * \"lodash\". …" message. Returns the quoted token (single or double quotes),
 * or `null` when no quoted specifier is present.
 */
function extractSpecifier(message: string): string | null {
  const match = message.match(/module specifier\s+["']([^"']+)["']/i)
  return match ? match[1] : null
}

/**
 * Classify a single Chromium console message.
 *
 * @param level   Chromium level (0–3); only `3` (error) is classified.
 * @param message The raw console text (page-authored, untrusted).
 * @param source  The message source kind; retained for future gating, and to
 *   keep the signature aligned with `MessageDetails` (design §1.3).
 * @returns A {@link PreviewFailureInput} for `unresolved-specifier` /
 *   `script-error`, or `null` when the message is not a surfaced class.
 *
 * `reasonCode` is `ErrorCode.UNKNOWN_ERROR` for both classes: the precise
 * semantics live in the `type` field, and the frozen error enum carries no
 * dedicated code for a page-side script or specifier error.
 */
export function classifyConsoleMessage(
  level: number,
  message: string,
  source: ConsoleSource
): PreviewFailureInput | null {
  void source
  if (level < CONSOLE_LEVEL_ERROR) {
    return null
  }

  if (message.includes(MODULE_SPECIFIER_MARKER)) {
    const specifier = extractSpecifier(message)
    return {
      type: 'unresolved-specifier',
      resourceUrlOrHost: sanitize(specifier ?? message),
      reasonCode: ErrorCode.UNKNOWN_ERROR
    }
  }

  if (UNCAUGHT_PATTERN.test(message)) {
    return {
      type: 'script-error',
      resourceUrlOrHost: sanitize(message),
      reasonCode: ErrorCode.UNKNOWN_ERROR
    }
  }

  return null
}

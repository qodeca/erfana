// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Derive a friendly, display-safe model name from a raw Claude model id.
 *
 * Security remediation §10: the raw id is UNTRUSTED transcript data that ends
 * up in visible text, the `aria-label`, and logs (React escaping covers only
 * HTML/XSS). So we FIRST sanitize — strip control characters and newlines, then
 * truncate to ≤64 chars — before any matching or fallback.
 *
 * Resolution order:
 *  1. Exact override table (curated display names).
 *  2. Generic derivation for `claude-<family>-<maj>-<min>[-<8-digit date>]`:
 *     strip `claude-`, drop a trailing date segment, title-case the family,
 *     join `maj.min` (e.g. `claude-opus-5-0` → `Opus 5.0`).
 *  3. Fallback: the sanitized raw id.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2, §10
 */

/** Max characters retained from an untrusted model id (§10). */
const MAX_MODEL_ID_LENGTH = 64

/** Curated display-name overrides for known model ids. */
const OVERRIDES: Readonly<Record<string, string>> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-haiku-4-5': 'Haiku 4.5'
}

/**
 * `claude-<family>-<maj>-<min>` with an optional trailing 8-digit date.
 * Family is alphabetic; version parts are numeric. Anchored to reject junk.
 */
const GENERIC_PATTERN = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/

/**
 * Matches C0 controls (U+0000–U+001F, incl. \n \r \t), DEL (U+007F), and C1
 * controls (U+0080–U+009F). These are stripped from untrusted ids.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g

/**
 * Remove control characters (incl. newlines) and bound length.
 */
function sanitize(modelId: string): string {
  return modelId.replace(CONTROL_CHARS, '').slice(0, MAX_MODEL_ID_LENGTH)
}

/** Upper-case the first letter of a lower-case family token (`opus` → `Opus`). */
function titleCase(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1)
}

export function friendlyModelName(modelId: string): string {
  const clean = sanitize(modelId)

  const override = OVERRIDES[clean]
  if (override) return override

  const match = GENERIC_PATTERN.exec(clean)
  if (match) {
    const [, family, major, minor] = match
    return `${titleCase(family)} ${major}.${minor}`
  }

  return clean
}

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Derive a friendly, display-safe model name from a raw Claude model id.
 *
 * Security remediation §10: the raw id is UNTRUSTED transcript data that ends
 * up in visible text, the `aria-label`, and logs (React escaping covers only
 * HTML/XSS). So we FIRST sanitize — strip control characters and newlines, then
 * truncate to ≤64 chars — before any matching or fallback. The order
 * `sanitize → parse → render` is load-bearing and must not be reordered.
 *
 * Resolution order:
 *  1. `parseModelId` (the SHARED grammar, #41): render `Family Major[.Minor]`,
 *     dropping any snapshot date and bracketed variant — `claude-opus-5` →
 *     `Opus 5`, `claude-opus-5-0` → `Opus 5.0`, `claude-haiku-4-5-20251001` →
 *     `Haiku 4.5`. Using the same parse as the window detector is the point of
 *     #41: for ids the grammar ACCEPTS, the label and the window cannot disagree.
 *  2. A bare family alias (`opus`) → its title-cased family (design §6.3).
 *  3. Fallback: the sanitized raw id, in its ORIGINAL casing.
 *
 * Steps 2 and 3 are OUTSIDE that guarantee, by design: an alias, an over-length
 * id (truncated here, rejected for windowing) and `claude-mythos-preview` (a
 * window from the undecomposable map, no derived label) each resolve their label
 * and their window by different routes and may legitimately differ.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §6.3, §11, §13
 */
import { MAX_MODEL_ID_LENGTH } from '../../../shared/ipc/claude-status-schema'
import { familyAlias, parseModelId } from './modelId'

/**
 * Characters stripped from an untrusted id before it is rendered or parsed:
 *
 *  - C0 controls (U+0000–U+001F, incl. \n \r \t), DEL (U+007F), C1 controls
 *    (U+0080–U+009F) — the original §10 remediation.
 *  - Zero-width and directional formatting characters: ZWSP/ZWNJ/ZWJ/LRM/RLM
 *    (U+200B–U+200F), the bidi embedding and OVERRIDE controls (U+202A–U+202E),
 *    the bidi isolates (U+2066–U+2069) and the BOM (U+FEFF). These are invisible
 *    but reorder rendered text, so `claude-opus-4-5\u202E…` can be made to READ
 *    as a different model in the status bar and its aria-label. A meter that can
 *    be made to display the wrong model is worse than one that displays nothing.
 */
const CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * Upper bound on how much of an untrusted id is SCANNED (design §11).
 *
 * `modelId` reaches here straight from a transcript `model` field, which the
 * parser bounds only by the 256 KB tail window — and this runs once per status
 * refresh, ~1x/1.25s per terminal, on the main-process event loop. Scanning and
 * copying the whole string before truncating made the cost linear in attacker-
 * controlled input.
 *
 * Deliberately a MULTIPLE of {@link MAX_MODEL_ID_LENGTH} rather than the bound
 * itself: slicing to 64 first would let a 64-character invisible prefix push a
 * legitimate id out of the window entirely, which is a different bug. Eight
 * times the bound keeps every realistic id intact while making the work O(1) in
 * the size of the input.
 */
const SANITIZE_SCAN_LIMIT = MAX_MODEL_ID_LENGTH * 8

/**
 * Bound the scan, remove control/bidi/zero-width characters, then bound length.
 *
 * Exported so `ClaudeStatusService` can apply the SAME rules to the raw
 * `modelId` it puts on the wire — one sanitizer, one character class, so the two
 * fields of a snapshot cannot diverge in what they consider safe.
 */
export function sanitizeModelId(modelId: string): string {
  return modelId
    .slice(0, SANITIZE_SCAN_LIMIT)
    .replace(CONTROL_CHARS, '')
    .slice(0, MAX_MODEL_ID_LENGTH)
}

/** Upper-case the first letter of a lower-case family token (`opus` → `Opus`). */
function titleCase(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1)
}

export function friendlyModelName(modelId: string): string {
  const clean = sanitizeModelId(modelId)

  const parsed = parseModelId(clean)
  if (parsed !== null) {
    // An omitted minor is rendered as omitted: `claude-opus-5` is "Opus 5", not
    // "Opus 5.0" — the two are distinct published ids (AC6).
    const version = parsed.minorOmitted ? `${parsed.major}` : `${parsed.major}.${parsed.minor}`
    return `${titleCase(parsed.family)} ${version}`
  }

  const alias = familyAlias(clean)
  if (alias !== null) return titleCase(alias)

  return clean
}

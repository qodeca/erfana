// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * friendlyModelName tests
 *
 * Covers label derivation, dated-id handling, raw fallback, and the §10
 * sanitization (control-char strip + length cap).
 *
 * Since #41 the curated override table is gone — every label is derived from the
 * SHARED grammar, so the old override cases are kept here as pins that the
 * rewrite changed no published label. This file also carries the AC6
 * minor-omitted cases, the bare-alias rule, the bidi/zero-width spoofing suite
 * and the coupling test that fails if `sanitizeModelId`'s cap and the IPC
 * schema's bound ever drift apart in either direction.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/216-claude-status-bar.md §2, §10
 * @see docs/designs/41-model-capability-registry.md §6.2, §6.3, §11
 */
import { describe, it, expect } from 'vitest'
import { friendlyModelName, sanitizeModelId } from './friendlyModelName'
import {
  ClaudeStatusSnapshotSchema,
  MAX_MODEL_ID_LENGTH
} from '../../../shared/ipc/claude-status-schema'

describe('friendlyModelName - known ids', () => {
  // Issue #41 §9.2: these were an explicit override table; they are now produced
  // by the shared generic derivation. Kept verbatim as pins so the rewrite cannot
  // silently change a published label.
  const cases: ReadonlyArray<[string, string]> = [
    ['claude-opus-4-8', 'Opus 4.8'],
    ['claude-opus-4-7', 'Opus 4.7'],
    ['claude-opus-4-6', 'Opus 4.6'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ['claude-sonnet-4-5', 'Sonnet 4.5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-haiku-4-5', 'Haiku 4.5']
  ]

  it.each(cases)('maps %s → %s', (input, expected) => {
    expect(friendlyModelName(input)).toBe(expected)
  })
})

describe('friendlyModelName - generic derivation', () => {
  it('derives a future undated id', () => {
    expect(friendlyModelName('claude-opus-5-0')).toBe('Opus 5.0')
  })

  it('derives another family', () => {
    expect(friendlyModelName('claude-sonnet-5-2')).toBe('Sonnet 5.2')
  })

  it('drops a trailing 8-digit date segment', () => {
    expect(friendlyModelName('claude-opus-5-0-20260101')).toBe('Opus 5.0')
  })

  it('handles multi-digit version parts', () => {
    expect(friendlyModelName('claude-haiku-10-12')).toBe('Haiku 10.12')
  })
})

describe('friendlyModelName - raw fallback', () => {
  it('returns the sanitized raw id for an unknown/garbage id', () => {
    expect(friendlyModelName('gpt-4o')).toBe('gpt-4o')
  })

  it('returns the raw id when the version shape does not match', () => {
    expect(friendlyModelName('claude-opus')).toBe('claude-opus')
  })

  // Issue #41 §9.2 / decision (d): flipped from the raw id. An unrecognised
  // trailing segment is metadata, not a capability signal, and rejecting it here
  // is exactly the label-vs-window disagreement #41 exists to remove — the window
  // detector already accepted this id.
  it('renders a derived label despite a non-8-digit trailing segment', () => {
    expect(friendlyModelName('claude-opus-5-0-2026')).toBe('Opus 5.0')
  })
})

describe('friendlyModelName - §10 sanitization', () => {
  it('strips control characters and newlines before matching', () => {
    expect(friendlyModelName('claude-opus-4-8\n')).toBe('Opus 4.8')
    expect(friendlyModelName('claude\t-opus-4-8')).not.toContain('\t')
  })

  it('strips embedded control chars from an otherwise-garbage id', () => {
    const result = friendlyModelName('weird\u0000model\u0007id')
    expect(result).toBe('weirdmodelid')
  })

  it('truncates an overlong id to 64 characters', () => {
    const long = 'x'.repeat(200)
    const result = friendlyModelName(long)
    expect(result).toHaveLength(64)
  })

  it('truncates after stripping controls (cap applies to clean text)', () => {
    const noisy = '\u0001'.repeat(100) + 'y'.repeat(100)
    const result = friendlyModelName(noisy)
    expect(result).toBe('y'.repeat(64))
  })
})

describe('friendlyModelName - bidi and zero-width spoofing (security audit LOW)', () => {
  // These characters are INVISIBLE but reorder rendered text, so a model id can
  // be made to READ as a different model in the status bar and its aria-label.
  // A meter that displays the wrong model is worse than one that displays nothing.
  const invisible: ReadonlyArray<[string, string]> = [
    ['U+202E right-to-left override', '\u202E'],
    ['U+202D left-to-right override', '\u202D'],
    ['U+200B zero-width space', '\u200B'],
    ['U+200E left-to-right mark', '\u200E'],
    ['U+2066 left-to-right isolate', '\u2066'],
    ['U+2069 pop directional isolate', '\u2069'],
    ['U+FEFF byte-order mark', '\uFEFF']
  ]

  it.each(invisible)('strips %s from the fallback label', (_name, char) => {
    expect(friendlyModelName(`weird${char}model`)).toBe('weirdmodel')
  })

  it.each(invisible)('strips %s before parsing, so the id still derives', (_name, char) => {
    expect(friendlyModelName(`claude-opus-4-${char}8`)).toBe('Opus 4.8')
  })

  it('defeats a right-to-left override spoof of a different model', () => {
    // Rendered, `claude-opus-\u202E5-4-supo` reads back-to-front after the
    // override. Stripping the control leaves the honest sequence.
    const spoof = 'claude-opus-\u202E5-4-supo'
    expect(friendlyModelName(spoof)).not.toContain('\u202E')
  })

  it('bounds the scan, so an oversize id costs no more than a normal one', () => {
    // Behavioural: `modelId` arrives straight from a transcript `model` field,
    // bounded only by the 256 KB tail window, and this runs ~1x/1.25s per
    // terminal on the main-process event loop. Scanning the whole string before
    // truncating made the cost linear in attacker-controlled input.
    const huge = `${'\u0000'.repeat(64)}${'q'.repeat(8 * 1024 * 1024)}`
    expect(friendlyModelName(huge)).toBe('q'.repeat(64))
  })
})

describe('friendlyModelName - AC6 minor-omitted ids (issue #41)', () => {
  const cases: ReadonlyArray<[string, string]> = [
    // The #41 label defect: these rendered as the RAW identifier before the
    // shared grammar made the minor segment optional.
    ['claude-opus-5', 'Opus 5'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-fable-5', 'Fable 5'],
    ['claude-mythos-5', 'Mythos 5'],
    // An omitted minor is rendered as omitted; an explicit `-0` is not.
    ['claude-opus-5-0', 'Opus 5.0'],
    // F14 boundary: a minor-omitted id BELOW the family's newest known entry
    // must still label correctly (it just gets no 1M window).
    ['claude-opus-4', 'Opus 4'],
    ['claude-opus-3', 'Opus 3'],
    ['claude-opus-5-20260101', 'Opus 5'],
    // Decision (a): lower-casing the interpretation removes a label-vs-window
    // disagreement - the detector already accepted this id.
    ['CLAUDE-OPUS-4-8', 'Opus 4.8'],
    ['  claude-opus-5  ', 'Opus 5']
  ]

  it.each(cases)('AC6: %s → %s', (input, expected) => {
    expect(friendlyModelName(input)).toBe(expected)
  })

  it('AC2: a bracketed variant never leaks into the label', () => {
    expect(friendlyModelName('claude-opus-5[1m]')).toBe('Opus 5')
    expect(friendlyModelName('claude-opus-5[1m][beta]')).toBe('Opus 5')
    // An UNRECOGNISED variant is ignored for display (a label is not an action),
    // unlike a `/model` override, which fails closed - design decision (e).
    expect(friendlyModelName('claude-opus-4-7[thinking]')).toBe('Opus 4.7')
  })
})

describe('friendlyModelName - bare aliases (design 6.3)', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['opus', 'Opus'],
    ['sonnet', 'Sonnet'],
    ['haiku', 'Haiku'],
    ['fable', 'Fable'],
    ['OPUS', 'Opus']
  ]

  it.each(cases)('renders the alias %s as %s', (input, expected) => {
    expect(friendlyModelName(input)).toBe(expected)
  })

  it('leaves non-family tokens alone', () => {
    // `<synthetic>` never reaches here (the parser rejects it at the source), but
    // the fallback must still be safe and lossless.
    expect(friendlyModelName('<synthetic>')).toBe('<synthetic>')
    expect(friendlyModelName('default')).toBe('default')
    expect(friendlyModelName('claude-mythos-preview')).toBe('claude-mythos-preview')
  })
})

describe('friendlyModelName - sanitize runs BEFORE parse (F22)', () => {
  it('strips an INTERIOR control character that trim cannot reach', () => {
    // A trailing space or newline is removed by the parser's own trim, so a pin
    // using one passes under EITHER ordering. This backspace sits between the
    // major and the minor digit, where trim can never reach it: only
    // `sanitize -> parse` yields a derived label. Under the wrong order the
    // parse fails and the fallback returns 'claude-opus-4-8' instead.
    expect(friendlyModelName('claude-opus-4-\u00088')).toBe('Opus 4.8')
  })

  it('truncates BEFORE parsing, so an over-long id whose first 64 chars parse still derives', () => {
    const at64 = `claude-opus-4-8-${'a'.repeat(48)}`
    const over64 = `${at64}bb`
    expect(at64).toHaveLength(64)
    expect(over64.length).toBeGreaterThan(64)
    // The full form exceeds the shared bound and is unparseable; its 64-char
    // truncation is a valid id. Under the wrong order the raw 64-char id is
    // returned instead of the derived label.
    expect(friendlyModelName(over64)).toBe('Opus 4.8')
  })
})

describe('sanitizeModelId is COUPLED to the IPC bound, in both directions', () => {
  // The register handler `safeParse`s the payload and DROPS it on failure, so a
  // sanitizer that truncates above the schema bound makes the status bar vanish
  // silently — a green suite and no bar. A sanitizer that truncates below it
  // costs label fidelity for no reason. Neither side names the number here: the
  // assertions are against MAX_MODEL_ID_LENGTH, so moving one without the other
  // fails the build instead of the user.

  it('truncates to EXACTLY the shared bound', () => {
    expect(sanitizeModelId('x'.repeat(MAX_MODEL_ID_LENGTH * 4))).toHaveLength(MAX_MODEL_ID_LENGTH)
    expect(sanitizeModelId('y'.repeat(MAX_MODEL_ID_LENGTH))).toHaveLength(MAX_MODEL_ID_LENGTH)
    // Not truncating shorter input is the other half of "exactly".
    expect(sanitizeModelId('claude-opus-5')).toBe('claude-opus-5')
  })

  it('produces a snapshot the IPC schema accepts, for hostile inputs', () => {
    const hostile: ReadonlyArray<[label: string, raw: string]> = [
      ['far over the bound', 'z'.repeat(8 * 1024)],
      ['exactly at the bound', 'q'.repeat(MAX_MODEL_ID_LENGTH)],
      ['one over the bound', 'q'.repeat(MAX_MODEL_ID_LENGTH + 1)],
      ['control characters', `claude-opus-4-8${'\u0007'.repeat(500)}`],
      ['bidi override padding', `${'\u202E'.repeat(500)}claude-opus-5`],
      ['zero-width padding', `${'\u200B'.repeat(500)}claude-sonnet-5`],
      ['a long variant payload', `claude-opus-5[${'a'.repeat(4096)}]`]
    ]

    for (const [label, raw] of hostile) {
      const modelId = sanitizeModelId(raw)
      const friendlyName = friendlyModelName(raw)
      const parsed = ClaudeStatusSnapshotSchema.safeParse({
        terminalId: 't1',
        modelId,
        friendlyName,
        windowSize: 200000,
        usedTokens: 0,
        percent: 0,
        level: 'green',
        tooltip: '0k / 200k',
        inferred: false
      })
      // `label` is in the message so a failure names which input drifted.
      expect(parsed.success, `hostile input rejected by the schema: ${label}`).toBe(true)
    }
  })
})

// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * modelId tests — the shared model-id grammar and the context-window capability
 * registry.
 *
 * PROVENANCE OF {@link REGISTRY_ORACLE}
 * -------------------------------------
 * Source document: `docs/designs/41-model-capability-registry.md`
 * (§7.1 exact-id map, §7.1.1 undecomposable-id map).
 *
 * The table was **independently derived on 2026-08-08 from Revision 3**, with
 * `modelId.ts`, `friendlyModelName.ts`, `ClaudeWindowDetector.ts` and both
 * detector test files excluded from the deriver's inputs, and the exclusion
 * audited. It matched the shipped registry on every row. Every revision since
 * has changed citations, prose and procedure but **no window value**, so the
 * derivation still holds — and unlike the claim itself, that is checkable: guard
 * 1 below re-parses the live document on every run, so a revision that did move
 * a Window cell would fail the build rather than silently invalidate this note.
 * No revision number is pinned here for the same reason: the guard tracks the
 * document, and a hand-maintained version stamp would be one more thing to drift.
 *
 * **No test can verify where these numbers came from.** Provenance is procedure,
 * not enforcement: nothing stops a future editor from reading `modelId.ts` while
 * writing a row. That procedure lives in design §9.4.1. What IS mechanically
 * checkable are the two guards below, and both have been observed failing:
 *
 *  - **Guard 1, document parity** — parses §7.1/§7.1.1 out of the markdown and
 *    asserts row-for-row agreement with this table, in both directions. It reads
 *    the DOCUMENT, never `modelId.ts`.
 *  - **Guard 2, key-set coverage** — asserts the registry's exported id set
 *    equals the design's id column, so a row added to the code without a design
 *    row and an oracle row fails the build. Ids only, never windows: coverage
 *    may be derived from the implementation, expectations may not (§9.4.2).
 *
 * PROHIBITED RESOLUTION
 * ---------------------
 * If this table and the code disagree, **amend the design first** (§2.0 step 3)
 * and let this table follow it. Editing this table to match the code is exactly
 * how the original defect was created: on 2026-08-07 the implementer found the
 * design and the code disagreed on `claude-sonnet-4-6`, edited the oracle to
 * agree with the code, and the design stayed wrong for eight days while the one
 * artefact meant to catch it had quietly switched sides.
 *
 * @see Issue #41 - Context meter reads the 200k window for Opus 5 sessions
 * @see docs/designs/41-model-capability-registry.md §7.1, §9.4, §9.4.1, §9.4.2
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CAPABILITIES_VERIFIED_ON,
  familyAlias,
  isExtendedVariant,
  isRecognisedVariant,
  parseModelId,
  stickyModelKey,
  stripModelVariants,
  windowForModelId,
  REGISTRY_IDS_FOR_TESTS
} from './modelId'
import { readDesignCapabilityTable } from './__fixtures__/designCapabilityTable'
import { friendlyModelName } from './friendlyModelName'
import { MAX_MODEL_ID_LENGTH } from '../../../shared/ipc/claude-status-schema'

/** The two window sizes this registry may report, written out locally. */
const STANDARD = 200_000
const EXTENDED = 1_000_000

/** An id one character over the shared 64-char bound (`MAX_MODEL_ID_LENGTH`). */
const OVER_LENGTH_ID = `claude-opus-4-8-${'a'.repeat(49)}`

/** Exactly 64 characters, and a valid id — the truncation of {@link OVER_LENGTH_ID}. */
const AT_LENGTH_ID = `claude-opus-4-8-${'a'.repeat(48)}`

/**
 * THE oracle. One const, transcribed from design §7.1 + §7.1.1 — see the file
 * header for its provenance and for the prohibited resolution.
 *
 * There were two copies of this until 2026-08-08, and maintaining two
 * restatements of the same claim is how they drifted apart independently.
 */
const REGISTRY_ORACLE: ReadonlyArray<[id: string, window: number, label: string]> = [
  ['claude-opus-4-5', STANDARD, 'Opus 4.5'],
  ['claude-opus-4-6', STANDARD, 'Opus 4.6'],
  ['claude-opus-4-7', EXTENDED, 'Opus 4.7'],
  ['claude-opus-4-8', EXTENDED, 'Opus 4.8'],
  ['claude-opus-5', EXTENDED, 'Opus 5'],
  ['claude-sonnet-4-5', STANDARD, 'Sonnet 4.5'],
  ['claude-sonnet-4-6', STANDARD, 'Sonnet 4.6'],
  ['claude-sonnet-5', EXTENDED, 'Sonnet 5'],
  ['claude-haiku-4-5', STANDARD, 'Haiku 4.5'],
  ['claude-haiku-4-5-20251001', STANDARD, 'Haiku 4.5'],
  ['claude-fable-5', EXTENDED, 'Fable 5'],
  ['claude-mythos-5', EXTENDED, 'Mythos 5'],
  ['claude-mythos-preview', EXTENDED, 'claude-mythos-preview']
]

describe('parseModelId - accepted shapes', () => {
  const cases: ReadonlyArray<[string, Partial<ReturnType<typeof parseModelId>>]> = [
    // The #41 defect: a minor-omitted id must parse.
    ['claude-opus-5', { family: 'opus', major: 5, minor: 0, minorOmitted: true, canonicalId: 'claude-opus-5-0' }],
    ['claude-opus-4-8', { family: 'opus', major: 4, minor: 8, minorOmitted: false, canonicalId: 'claude-opus-4-8' }],
    ['claude-sonnet-5', { family: 'sonnet', major: 5, minor: 0, minorOmitted: true }],
    ['claude-fable-5', { family: 'fable', major: 5, minor: 0, minorOmitted: true }],
    ['claude-mythos-5', { family: 'mythos', major: 5, minor: 0, minorOmitted: true }],
    [
      'claude-haiku-4-5-20251001',
      { family: 'haiku', major: 4, minor: 5, date: '20251001', canonicalId: 'claude-haiku-4-5-20251001' }
    ],
    ['claude-opus-4-8-20260115', { family: 'opus', major: 4, minor: 8, date: '20260115' }],
    // A bare 8-digit segment straight after the major is a snapshot date, not a minor.
    [
      'claude-opus-5-20260101[1m]',
      { family: 'opus', major: 5, minor: 0, minorOmitted: true, date: '20260101', variants: ['1m'] }
    ],
    ['claude-opus-5[1m]', { family: 'opus', major: 5, variants: ['1m'] }],
    ['CLAUDE-OPUS-4-8', { family: 'opus', major: 4, minor: 8 }],
    ['  claude-opus-5  ', { family: 'opus', major: 5, minorOmitted: true }],
    ['claude-opus-10-12', { family: 'opus', major: 10, minor: 12, canonicalId: 'claude-opus-10-12' }],
    // Unrecognised trailing metadata is tolerated (design decision (d)).
    ['claude-opus-5-0-2026', { family: 'opus', major: 5, minor: 0, minorOmitted: false, canonicalId: 'claude-opus-5-0' }],
    // Boundary shapes for F14 — parseable, but deliberately NOT 1M (see below).
    ['claude-opus-4', { family: 'opus', major: 4, minor: 0, minorOmitted: true }],
    ['claude-opus-3', { family: 'opus', major: 3, minor: 0, minorOmitted: true }],
    [AT_LENGTH_ID, { family: 'opus', major: 4, minor: 8 }]
  ]

  it.each(cases)('parses %s', (input, expected) => {
    expect(parseModelId(input)).toMatchObject(expected as Record<string, unknown>)
  })

  it('reports no date when the id pins none', () => {
    expect(parseModelId('claude-opus-5')?.date).toBeUndefined()
    expect(parseModelId('claude-opus-5-0-2026')?.date).toBeUndefined()
  })
})

describe('parseModelId - rejected shapes', () => {
  const cases: ReadonlyArray<[string]> = [
    [''],
    ['claude-opus'],
    ['claude-opus-x-y'],
    ['claude-foo'],
    ['claude--5'],
    ['gpt-4o'],
    ['totally-bogus-id'],
    ['default'],
    ['opus'],
    ['<synthetic>'],
    // Undecomposable by the grammar — it resolves via the private map instead.
    ['claude-mythos-preview'],
    ['claude-opus-5['],
    ['claude-opus-5[1m'],
    ['claude-opus-5[1m]x'],
    ['claude-opus-5[1m][a][b][c][d]'],
    [OVER_LENGTH_ID]
  ]

  it.each(cases)('rejects %j', (input) => {
    expect(parseModelId(input)).toBeNull()
  })

  it('rejects a generation number too large to be a safe integer', () => {
    // Untrusted transcript data: a 20-digit segment parses to 1e20, which cannot
    // round-trip as an integer, so the id is refused rather than mis-keyed.
    expect(parseModelId('claude-opus-99999999999999999999')).toBeNull()
    expect(parseModelId('claude-opus-5-99999999999999999999')).toBeNull()
    expect(windowForModelId('claude-opus-99999999999999999999')).toBeNull()
  })

  it('rejects a non-string id without throwing', () => {
    expect(parseModelId(undefined as unknown as string)).toBeNull()
    expect(windowForModelId(undefined as unknown as string)).toBeNull()
    expect(stickyModelKey(undefined as unknown as string)).toBe('')
  })
})

describe('windowForModelId - AC4 exact-id map', () => {
  const cases = REGISTRY_ORACLE.map(([id, window]): [string, number] => [id, window])

  it.each(cases)('AC4: %s reports exactly %i', (id, expected) => {
    expect(windowForModelId(id)).toBe(expected)
  })

  it('AC4: an exact 200k row is an ANSWER, not a fall-through', () => {
    // The registry ANSWERS 200k here; the fall-through would also be 200k, so the
    // distinguishing evidence is that a heuristic-only id returns null instead.
    expect(windowForModelId('claude-haiku-4-5')).toBe(STANDARD)
    expect(windowForModelId('claude-haiku-3-1')).toBeNull()
  })

  it('resolves a dated id through its undated alias when the snapshot is unpinned', () => {
    expect(windowForModelId('claude-opus-4-8-20260115')).toBe(EXTENDED)
  })

  it('AC1: a claude-opus-5 session resolves to the 1M window with no other signal', () => {
    expect(windowForModelId('claude-opus-5')).toBe(EXTENDED)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(windowForModelId('CLAUDE-OPUS-4-8')).toBe(EXTENDED)
    expect(windowForModelId('  claude-opus-5  ')).toBe(EXTENDED)
  })
})

describe('windowForModelId - boundary with the minor omitted (F14)', () => {
  // The exact defect class being fixed. An implementation that defaults an
  // omitted minor to Infinity — or compares the major only — passes every
  // minor-omitted case ABOVE a family threshold and fails these.
  it('does NOT report 1M for claude-opus-4 (below the 4.7 threshold)', () => {
    expect(windowForModelId('claude-opus-4')).not.toBe(EXTENDED)
    expect(windowForModelId('claude-opus-4')).toBeNull()
  })

  it('does NOT report 1M for claude-opus-3 (older, unlisted)', () => {
    expect(windowForModelId('claude-opus-3')).not.toBe(EXTENDED)
    expect(windowForModelId('claude-opus-3')).toBeNull()
  })

  it('labels claude-opus-4 as "Opus 4", not "Opus 4.0"', () => {
    expect(friendlyModelName('claude-opus-4')).toBe('Opus 4')
  })
})

describe('windowForModelId - AC2 bracketed variants', () => {
  it('AC2: a [1m] suffix resolves to the same window as the unsuffixed id', () => {
    expect(windowForModelId('claude-opus-5[1m]')).toBe(windowForModelId('claude-opus-5'))
    expect(friendlyModelName('claude-opus-5[1m]')).toBe('Opus 5')
  })

  it('AC2: a [1m] suffix upgrades an otherwise-200k model', () => {
    expect(windowForModelId('claude-sonnet-4-5')).toBe(STANDARD)
    expect(windowForModelId('claude-sonnet-4-5[1m]')).toBe(EXTENDED)
  })

  it('AC2: unreachable-in-practice — [1m] never reaches message.model', () => {
    // Design §2.2: `rg '"model":"[^"]*\[1m\]"'` over the whole local transcript
    // corpus matched ZERO files, and the CLI docs state the suffix is stripped
    // before the request is made. This branch is defensive, NOT the detection
    // mechanism — the exact-id registry is. Kept so a future reader does not
    // mistake it for the mechanism, and so a leaked suffix degrades gracefully.
    expect(windowForModelId('claude-opus-5[1m]')).toBe(EXTENDED)
  })

  it('ignores an unrecognised variant for window purposes', () => {
    expect(windowForModelId('claude-opus-5[thinking]')).toBe(EXTENDED)
    expect(windowForModelId('claude-sonnet-4-5[thinking]')).toBe(STANDARD)
  })

  it('honours [1m] among mixed variants', () => {
    expect(windowForModelId('claude-sonnet-4-5[1m][beta]')).toBe(EXTENDED)
  })

  it('recognises only 1m, case-insensitively', () => {
    expect(isRecognisedVariant('1m')).toBe(true)
    expect(isRecognisedVariant('1M')).toBe(true)
    expect(isExtendedVariant('1M')).toBe(true)
    expect(isRecognisedVariant('thinking')).toBe(false)
    expect(isRecognisedVariant('beta')).toBe(false)
    expect(isExtendedVariant('beta')).toBe(false)
    expect(isRecognisedVariant(undefined as unknown as string)).toBe(false)
  })
})

describe('windowForModelId - AC3 bounded family heuristic', () => {
  const cases: ReadonlyArray<[string, number | null]> = [
    // Unknown point release at/after the newest known entry in a known major.
    ['claude-opus-4-9', EXTENDED],
    ['claude-opus-4-12', EXTENDED],
    // ...but only within MAX_MINOR_LOOKAHEAD. Newest known opus-4 is 4-8, so a
    // far-future minor gets no opinion: over-stating is the unbounded-error
    // direction (§5.1) because observation can upgrade a window but never demote
    // one, so a wrong 1M persists while a wrong 200k self-corrects.
    ['claude-opus-4-13', null],
    ['claude-opus-4-99', null],
    ['claude-sonnet-4-99', null],
    // Exactly one major past the newest known major → inherits it.
    ['claude-opus-6', EXTENDED],
    ['claude-sonnet-6', EXTENDED],
    ['claude-haiku-5', STANDARD],
    // Two majors past → no opinion; the meter falls through to observed usage.
    ['claude-opus-7', null],
    ['claude-opus-10-12', null],
    // Older unlisted id → no opinion (defaults safely at R4).
    ['claude-opus-4-1', null],
    ['claude-sonnet-3-5', null],
    // Unknown family → no opinion.
    ['claude-zephyr-9', null],

    // ---- major-5 boundaries: the shape #41 was actually opened for ----
    // Every positive minor row above sits on opus major 4, where the exact map
    // supplies minor 8. But `claude-opus-5` canonicalises to minor 0, so major
    // 5's live bound is 0..4 — the untested half, on the family the issue names.
    ['claude-opus-5-1', EXTENDED],
    ['claude-opus-5-4', EXTENDED],
    ['claude-opus-5-5', null],
    ['claude-sonnet-5-1', EXTENDED],
    ['claude-sonnet-5-5', null],
    ['claude-fable-5-4', EXTENDED],
    ['claude-fable-5-5', null],
    ['claude-mythos-5-1', EXTENDED],
    ['claude-mythos-5-5', null],

    // ---- per-major bounds on other families ----
    // sonnet major 4 tops out at minor 6, so 6..10 inherit and 11 does not.
    ['claude-sonnet-4-7', STANDARD],
    ['claude-sonnet-4-10', STANDARD],
    ['claude-sonnet-4-11', null],
    // haiku major 4 tops out at minor 5, so 5..9 inherit and 10 does not.
    ['claude-haiku-4-9', STANDARD],
    ['claude-haiku-4-10', null],
    // Minor-omitted ids below their major's newest entry (F14).
    ['claude-opus-4', null],
    ['claude-opus-3', null]
  ]

  it.each(cases)('AC3: %s → %s', (id, expected) => {
    expect(windowForModelId(id)).toBe(expected)
  })

  it('the PER-MAJOR entry decides — not the family newest (§7.2.1)', () => {
    // Three user-facing documents said an unknown id "inherits the family's
    // newest known window". That is wrong whenever the major is known, and
    // sonnet is the counterexample: the family's newest known entry is
    // `claude-sonnet-5` at 1M, yet a hypothetical `claude-sonnet-4-7` belongs to
    // the 4-series and must report 200k. The family-wide value only ever answers
    // for an id whose major is entirely unknown.
    expect(windowForModelId('claude-sonnet-5')).toBe(EXTENDED)
    expect(windowForModelId('claude-sonnet-4-7')).toBe(STANDARD)
    // ...while an unknown MAJOR does take the family-wide value.
    expect(windowForModelId('claude-sonnet-6')).toBe(EXTENDED)
  })

  it('claude-opus-5-0-2026 hits the EXACT MAP, not the heuristic', () => {
    // `-2026` is not an 8-digit date, so it is an unknown tail segment and is
    // dropped from the canonical id. What remains is `claude-opus-5-0`, and
    // registry keys are canonicalised on load, so `claude-opus-5` IS that key —
    // this resolves by exact lookup. Window and label are pinned together so the
    // path cannot change silently on one side.
    expect(windowForModelId('claude-opus-5-0-2026')).toBe(EXTENDED)
    expect(friendlyModelName('claude-opus-5-0-2026')).toBe('Opus 5.0')
    expect(parseModelId('claude-opus-5-0-2026')?.canonicalId).toBe('claude-opus-5-0')
  })

  it('AC3: extrapolation reaches exactly one major past the newest known entry', () => {
    expect(windowForModelId('claude-opus-6')).toBe(EXTENDED)
    expect(windowForModelId('claude-opus-7')).toBeNull()
  })
})

describe('windowForModelId - inherited Object keys are not capability data (M3)', () => {
  // The undecomposable-id lookup takes an UNTRUSTED key straight from
  // `message.model`, which the transcript parser accepts as any non-empty
  // non-`<synthetic>` string. Backed by an object literal it answered
  // `Object.prototype` members, returning a function where the signature
  // promises `200000 | 1000000 | null`.
  const inherited = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

  it.each(inherited)('%s yields no window opinion', (key) => {
    expect(windowForModelId(key)).toBeNull()
  })

  it.each(inherited)('%s is not a sticky key collision either', (key) => {
    expect(stickyModelKey(key)).toBe(key.toLowerCase())
  })

  it('still resolves the real undecomposable entry', () => {
    expect(windowForModelId('claude-mythos-preview')).toBe(EXTENDED)
  })
})

describe('windowForModelId - aliases and unresolvable ids', () => {
  const noOpinion: ReadonlyArray<[string]> = [
    ['opus'],
    ['sonnet'],
    ['haiku'],
    ['<synthetic>'],
    ['default'],
    [''],
    ['gpt-4o'],
    ['totally-bogus-id'],
    ['claude-opus'],
    ['claude-opus-x-y'],
    ['claude-foo'],
    [OVER_LENGTH_ID]
  ]

  it.each(noOpinion)('has no window opinion for %j', (id) => {
    expect(windowForModelId(id)).toBeNull()
  })

  it('resolves a bare alias to its family for labelling only', () => {
    expect(familyAlias('opus')).toBe('opus')
    expect(familyAlias('  SONNET ')).toBe('sonnet')
    expect(familyAlias('haiku')).toBe('haiku')
    expect(familyAlias('gpt')).toBeNull()
    expect(familyAlias('<synthetic>')).toBeNull()
    expect(familyAlias(undefined as unknown as string)).toBeNull()
  })
})

describe('stripModelVariants - grammar, caps and trimming', () => {
  it('returns the trimmed, lower-cased base with no brackets', () => {
    expect(stripModelVariants('  CLAUDE-Opus-5  ')).toEqual({ base: 'claude-opus-5', variants: [] })
  })

  it('splits variant groups in source order', () => {
    expect(stripModelVariants('claude-opus-5[1M][Beta]')).toEqual({
      base: 'claude-opus-5',
      variants: ['1m', 'beta']
    })
  })

  it('accepts exactly four variant groups and rejects a fifth', () => {
    expect(stripModelVariants('claude-opus-5[a][b][c][d]')?.variants).toEqual(['a', 'b', 'c', 'd'])
    expect(stripModelVariants('claude-opus-5[a][b][c][d][e]')).toBeNull()
  })

  it('F21: trims an interior control character off the base', () => {
    // Without the post-split trim, `modelId` would carry a raw tab into the
    // snapshot — the exact class #216 §10 excluded.
    expect(stripModelVariants('claude-opus-5\t[1m]')).toEqual({
      base: 'claude-opus-5',
      variants: ['1m']
    })
    expect(parseModelId('claude-opus-5\t[1m]')?.canonicalId).toBe('claude-opus-5-0')
  })

  it('rejects malformed bracket syntax', () => {
    expect(stripModelVariants('claude-opus-5[')).toBeNull()
    expect(stripModelVariants('claude-opus-5[1m')).toBeNull()
    expect(stripModelVariants('claude-opus-5[1m]x')).toBeNull()
    expect(stripModelVariants('claude-opus-5[1-m]')).toBeNull()
    expect(stripModelVariants('claude-opus-5[]')).toBeNull()
  })

  it('F10: rejects a 256 KB variant payload', () => {
    // `arg` reaches this function from a `<command-args>` block bounded only by
    // the 256 KB tail window, on the main-process event loop ~1x/1.25s per
    // terminal, so a hostile payload must be refused.
    const hostile = `claude-opus-5${'[a]'.repeat(90_000)}`
    expect(hostile.length).toBeGreaterThan(256 * 1024)

    // This pins that the payload is REJECTED — not where. Deleting the length cap
    // leaves this passing, because MAX_VARIANT_TOKENS returns null after four
    // loop iterations. The cap's POSITION is pinned by the next test instead.
    expect(stripModelVariants(hostile)).toBeNull()
  })

  it('F10: the cap runs BEFORE any length-proportional work (§9.1.1)', () => {
    // Verified with the cap temporarily removed: this payload returns
    // { base: '', variants: ['aaa…'] } — one group, inside MAX_VARIANT_TOKENS,
    // and VARIANT_TOKEN_RE (/^[a-z0-9]+$/) has no length bound of its own. So
    // every DOWNSTREAM guard accepts it, and a null return is attributable to the
    // cap alone.
    //
    // The discriminating observable is NOT the null return — a cap placed
    // anywhere inside the function still returns null. It is that no
    // length-proportional string primitive runs at all. `raw.trim()` (and the
    // `.toLowerCase()` it feeds) and `value.indexOf('[')` are the first such
    // operations, so relocating the cap below them makes at least `trim` execute
    // and the zero-invocation assertion fail. That is the O(1) claim in §11.
    const payload = `[${'a'.repeat(200_000)}]`
    expect(payload.length).toBeGreaterThan(MAX_MODEL_ID_LENGTH)

    let overLongTrims = -1
    let overLongIndexOfs = -1
    let overLongResult: unknown = 'unset'
    const overLongTrimSpy = vi.spyOn(String.prototype, 'trim')
    const overLongIndexOfSpy = vi.spyOn(String.prototype, 'indexOf')
    try {
      overLongResult = stripModelVariants(payload)
      // Captured BEFORE mockRestore and before any expect(): these spies are
      // global, so the measurement window must contain only the call under test.
      overLongTrims = overLongTrimSpy.mock.calls.length
      overLongIndexOfs = overLongIndexOfSpy.mock.calls.length
    } finally {
      overLongTrimSpy.mockRestore()
      overLongIndexOfSpy.mockRestore()
    }

    // Positive control, same instrumentation on an id the cap lets through. A
    // mis-wired spy would make the zero-assertions above pass vacuously — which
    // is the exact defect class this test exists to close.
    let acceptedTrims = -1
    let acceptedIndexOfs = -1
    let acceptedResult: unknown = 'unset'
    const acceptedTrimSpy = vi.spyOn(String.prototype, 'trim')
    const acceptedIndexOfSpy = vi.spyOn(String.prototype, 'indexOf')
    try {
      acceptedResult = stripModelVariants(AT_LENGTH_ID)
      acceptedTrims = acceptedTrimSpy.mock.calls.length
      acceptedIndexOfs = acceptedIndexOfSpy.mock.calls.length
    } finally {
      acceptedTrimSpy.mockRestore()
      acceptedIndexOfSpy.mockRestore()
    }

    expect(overLongResult).toBeNull()
    expect(overLongTrims).toBe(0)
    expect(overLongIndexOfs).toBe(0)

    expect(acceptedResult).not.toBeNull()
    expect(acceptedTrims).toBeGreaterThanOrEqual(1)
    expect(acceptedIndexOfs).toBeGreaterThanOrEqual(1)
  })

  it('rejects an id one character over the shared length bound', () => {
    expect(OVER_LENGTH_ID).toHaveLength(65)
    expect(stripModelVariants(OVER_LENGTH_ID)).toBeNull()
    expect(stripModelVariants(AT_LENGTH_ID)).not.toBeNull()
  })
})

describe('stickyModelKey - sticky-window identity', () => {
  it('drops the snapshot date so a dated id is the SAME model', () => {
    expect(stickyModelKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(stickyModelKey('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })

  it('normalises casing, padding, and an omitted minor', () => {
    expect(stickyModelKey('  CLAUDE-OPUS-5  ')).toBe('claude-opus-5-0')
    expect(stickyModelKey('claude-opus-5-0')).toBe('claude-opus-5-0')
    expect(stickyModelKey('claude-opus-5[1m]')).toBe('claude-opus-5-0')
  })

  // Security audit LOW-1: this previously asserted the WHOLE over-length id came
  // back. The fallback fires precisely because the input exceeded the bound, and
  // the caller retains the result for the life of the terminal, so returning it
  // whole made both the work and the retention attacker-controlled.
  it('keys an id the grammar refuses on its BOUNDED normalised text', () => {
    expect(stickyModelKey(OVER_LENGTH_ID)).toBe(
      OVER_LENGTH_ID.slice(0, MAX_MODEL_ID_LENGTH).toLowerCase()
    )
    expect(stickyModelKey('  CLAUDE-OPUS-5[  ')).toBe('claude-opus-5[')
    expect(stickyModelKey('claude-opus-99999999999999999999')).toBe(
      'claude-opus-99999999999999999999'
    )
  })

  it('LOW-1: never returns more than the shared bound, however large the input', () => {
    const huge = 'z'.repeat(4 * 1024 * 1024)
    const key = stickyModelKey(huge)
    expect(key).toHaveLength(MAX_MODEL_ID_LENGTH)
    expect(key).toBe('z'.repeat(MAX_MODEL_ID_LENGTH))
    // Distinctness within the bound is what the sticky-window comparison needs.
    expect(stickyModelKey(`a${huge}`)).not.toBe(key)
  })

  it('is total: distinct unparseable ids never collide', () => {
    expect(stickyModelKey('gpt-4o')).toBe('gpt-4o')
    expect(stickyModelKey('claude-mythos-preview')).toBe('claude-mythos-preview')
    expect(stickyModelKey('gpt-4o')).not.toBe(stickyModelKey('totally-bogus-id'))
    expect(stickyModelKey('claude-opus-4-8')).not.toBe(stickyModelKey('claude-opus-4-7'))
  })
})

describe('grammar linearity (F19)', () => {
  it('excludes the "-" delimiter from the tail character class', () => {
    // The ReDoS mitigation is the SHAPE of the regex, not the length cap: the
    // mandatory delimiter is outside `[a-z0-9]`, so every input admits exactly
    // one segmentation and the tail group cannot backtrack. Adding `-` to that
    // class would make the parse ambiguous — this pin exists to stop that edit.
    const source = readFileSync(resolve(__dirname, 'modelId.ts'), 'utf8')
    const line = source.split('\n').find((l) => l.includes('const MODEL_ID_RE'))
    expect(line).toBeDefined()
    expect(line).toContain('(?:-[a-z0-9]+)*')
    expect(line).not.toContain('[a-z0-9-]')
  })

  it('parses a long segmented tail unambiguously', () => {
    // Linearity is guaranteed by the regex shape pinned above, so this asserts
    // the outcome rather than a wall-clock bound.
    const parsed = parseModelId(`claude-opus-4-8${'-a'.repeat(20)}`)
    expect(parsed).not.toBeNull()
    expect(parsed?.canonicalId).toBe('claude-opus-4-8')
  })
})

describe('capability freshness (F18)', () => {
  const MAX_AGE_DAYS = 180

  it('fails once CAPABILITIES_VERIFIED_ON is more than 180 days old', () => {
    const verifiedAt = Date.parse(`${CAPABILITIES_VERIFIED_ON}T00:00:00Z`)
    expect(Number.isNaN(verifiedAt)).toBe(false)

    const ageDays = (Date.now() - verifiedAt) / 86_400_000
    expect(
      ageDays,
      [
        `The model-capability table is ${Math.floor(ageDays)} days old (verified ${CAPABILITIES_VERIFIED_ON}).`,
        'Re-fetch ALL SIX primary sources, re-confirm every row in modelId.ts,',
        'then bump CAPABILITIES_VERIFIED_ON to the new fetch date:',
        '  https://platform.claude.com/docs/en/about-claude/models/overview',
        '  https://platform.claude.com/docs/en/build-with-claude/context-windows',
        '  https://code.claude.com/docs/en/model-config',
        '  https://code.claude.com/docs/en/context-window',
        '  https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5',
        '  https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5',
        'Procedure (what to check per row, and what to do when a value differs):',
        '  docs/designs/41-model-capability-registry.md §2.0'
      ].join('\n')
    ).toBeLessThan(MAX_AGE_DAYS)
  })

  it('is not dated in the future', () => {
    expect(Date.parse(`${CAPABILITIES_VERIFIED_ON}T00:00:00Z`)).toBeLessThanOrEqual(Date.now())
  })
})

describe('cross-module consistency (§9.4)', () => {
  /**
   * {@link REGISTRY_ORACLE} plus the non-registry rows §9.4.1 step 4 requires:
   * heuristic no-opinion cases and a foreign-vendor id, each derived from §6.2
   * and §7.2 rather than observed from a run.
   */
  const expectations: ReadonlyArray<[string, number | null, string]> = [
    ...REGISTRY_ORACLE,
    // No registry opinion, but still a derived label.
    ['claude-opus-4', null, 'Opus 4'],
    ['claude-opus-4-1', null, 'Opus 4.1'],
    // Neither a window nor a derived label.
    ['gpt-4o', null, 'gpt-4o']
  ]

  it.each(expectations)('%s → window %s, label %s', (id, window, label) => {
    expect(windowForModelId(id)).toBe(window)
    expect(friendlyModelName(id)).toBe(label)
  })

  it('one-directional: a parseable id always yields a derived label', () => {
    // No converse claim: `friendlyModelName` also derives labels for bare
    // aliases and for over-length ids that parse once truncated, neither of
    // which `parseModelId` accepts.
    for (const [id] of expectations) {
      if (parseModelId(id) !== null) expect(friendlyModelName(id)).not.toBe(id)
    }
  })
})

describe('guard 1 - the DESIGN DOCUMENT and the oracle agree (§9.4.2)', () => {
  // Reads the markdown, never modelId.ts. Had this existed on 2026-08-07 it
  // would have failed the moment the oracle was edited to say 200k while §7.1
  // still said 1M, instead of the design staying wrong for eight days.
  const designRows = readDesignCapabilityTable()

  it('parses a plausible number of rows, and throws rather than skipping', () => {
    // A lenient parser that drops a malformed row, or a renamed heading that
    // yields zero rows, would make every assertion below vacuously true.
    expect(designRows.length).toBe(REGISTRY_ORACLE.length)
    expect(designRows.length).toBeGreaterThanOrEqual(13)
    for (const row of designRows) {
      expect([STANDARD, EXTENDED]).toContain(row.window)
      expect(row.id.length).toBeGreaterThan(0)
      expect(row.label.length).toBeGreaterThan(0)
    }
  })

  it('every design row appears in the oracle with the same window and label', () => {
    const oracle = new Map(REGISTRY_ORACLE.map(([id, window, label]) => [id, { window, label }]))
    for (const { id, window, label } of designRows) {
      expect(oracle.get(id), `design row "${id}" is missing from the oracle`).toBeDefined()
      expect({ id, ...oracle.get(id) }).toEqual({ id, window, label })
    }
  })

  it('every oracle row appears in the design (no invented rows)', () => {
    // The other direction. Without it the oracle could carry a row the design
    // never authorised and guard 1 would still pass.
    const design = new Map(designRows.map((row) => [row.id, row]))
    for (const [id, window, label] of REGISTRY_ORACLE) {
      expect(design.get(id), `oracle row "${id}" is not in the design`).toBeDefined()
      expect({ id, window, label }).toEqual({ id, window: design.get(id)?.window, label: design.get(id)?.label })
    }
  })

  it('reads Window by COLUMN — a line-scanner would pass where this throws', () => {
    // The structural proof, and the one that catches EVERY line-scanning variant.
    // On the real document the Window column precedes the Note, so a first-match
    // line-scan coincidentally binds the right value and no assertion on the
    // OUTPUT can tell the two apart (verified by injecting exactly that variant).
    // Here the Window cell is malformed while a window-shaped number sits in the
    // Note: column indexing throws, any line-scanner binds 1000000 and succeeds.
    // Padded past the minimum row count so the ONLY thing that can throw is the
    // decoy's Window cell — a line-scanner parses all 13 rows and throws nothing.
    const filler = Array.from(
      { length: 12 },
      (_, i) => `| claude-filler-${i} | 200000 | Filler ${i} | (1) | n |`
    )
    const synthetic = [
      '### 7.1 Exact-id map',
      '',
      '| Id | Window | Label | Source | Note |',
      '|---|---|---|---|---|',
      ...filler,
      '| claude-decoy-1 | not-a-number | Decoy 1 | (1) | prose mentioning 1000000 |',
      '',
      '### 7.1.1 Undecomposable-id map',
      '',
      '| Id | Window | Label | Source | Note |',
      '|---|---|---|---|---|',
      '| claude-decoy-preview | 1000000 | claude-decoy-preview | (2) | n |',
      '',
      '### 7.2 x'
    ].join('\n')

    expect(() => readDesignCapabilityTable(synthetic)).toThrow(/Window cell/)
  })

  it('rejects a reordered header instead of binding Label as Window', () => {
    const swapped = [
      '### 7.1 Exact-id map',
      '',
      '| Id | Label | Window | Source | Note |',
      '|---|---|---|---|---|',
      '| claude-decoy-1 | Decoy 1 | 200000 | (1) | n |',
      '',
      '### 7.1.1 Undecomposable-id map',
      '',
      '### 7.2 x'
    ].join('\n')

    expect(() => readDesignCapabilityTable(swapped)).toThrow(/unexpected header/)
  })

  it('throws rather than yielding zero rows when a heading is renamed', () => {
    expect(() => readDesignCapabilityTable('# nothing here')).toThrow(/not found/)
  })

  it('binds the Sonnet 4.6 window by COLUMN, not by line-scanning (the canary)', () => {
    // §7.1's Note for this row quotes the superseded value `1000000` while
    // explaining what was wrong. A regex hunting the line for a window-shaped
    // number finds two and can bind the wrong one — passing while comparing the
    // wrong value. The numeral is retained deliberately; this asserts the parser
    // is immune to it.
    const sonnet46 = designRows.find((row) => row.id === 'claude-sonnet-4-6')
    expect(sonnet46).toBeDefined()
    expect(sonnet46?.window).toBe(STANDARD)

    const raw = readFileSync(
      resolve(__dirname, '../../../../docs/designs/41-model-capability-registry.md'),
      'utf8'
    )
    const line = raw.split('\n').find((l) => l.startsWith('| claude-sonnet-4-6 |'))
    expect(line, 'the canary row must stay in §7.1').toBeDefined()
    expect(line).toContain('1000000')
  })
})

describe('guard 2 - the registry key set matches the design id column (§9.4.2)', () => {
  // IDS ONLY. Coverage may be derived from the implementation; expectations may
  // not. Asking the code WHICH ids exist keeps a new registry row from going
  // untested; asking it what a row's window should be would make the oracle
  // circular.
  const designIds = readDesignCapabilityTable().map((row) => row.id)

  it('the code declares exactly the ids the design declares', () => {
    expect([...REGISTRY_IDS_FOR_TESTS].sort()).toEqual([...designIds].sort())
  })

  it('and exactly the ids the oracle covers, so no registry row is untested', () => {
    expect([...REGISTRY_IDS_FOR_TESTS].sort()).toEqual(REGISTRY_ORACLE.map(([id]) => id).sort())
  })

  it('exposes no windows — the key set is ids only', () => {
    for (const id of REGISTRY_IDS_FOR_TESTS) expect(typeof id).toBe('string')
  })
})

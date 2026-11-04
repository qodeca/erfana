// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Family heuristic (#383): an unknown model NEWER than its family's newest
 * listed one inherits that model's window, however far ahead, and the answer is
 * reported as a guess.
 *
 * Expectations are hand-written from design §7.1/§7.2, never derived from the
 * registry. The full window sweep stays in `modelId.test.ts`; this file pins the
 * #383 rule, its guess flag, and the pure module on synthetic data.
 *
 * @see Issue #383 - context meter shows 200k for newer Claude models
 * @see docs/designs/context-meter/41-model-capability-registry.md §7.2
 */
import { describe, expect, it } from 'vitest'
import { buildFamilyHeuristics, guessWindow, type ModelGeneration } from './familyHeuristic'
import { isFamilyGuess, windowForModelId } from './modelId'

const STANDARD = 200_000
const EXTENDED = 1_000_000

describe('#383 - a newer unknown model inherits its family newest window', () => {
  // Newest listed per family (design §7.1): Opus 5.5, Sonnet 5.5, Haiku 5.5,
  // Fable 5.1, Mythos 5.1 – all 1M. Each row is past the pre-#383 bound (more
  // than one major or four minors ahead), where the meter used to show 200k.
  const farNewer: ReadonlyArray<[string]> = [
    ['claude-opus-5-10'],
    ['claude-opus-7'],
    ['claude-sonnet-5-12'],
    ['claude-sonnet-8'],
    ['claude-haiku-5-10'],
    ['claude-haiku-7-1'],
    ['claude-fable-5-6'],
    ['claude-fable-7'],
    ['claude-mythos-5-6'],
    ['claude-mythos-7'],
    ['us.anthropic.claude-opus-7']
  ]

  it.each(farNewer)('%s → 1M, flagged as a family guess', (id) => {
    expect(windowForModelId(id)).toBe(EXTENDED)
    expect(isFamilyGuess(id)).toBe(true)
  })

  it('a listed model is never a guess', () => {
    for (const id of ['claude-opus-5-5', 'claude-haiku-4-5', 'claude-mythos-preview']) {
      expect(isFamilyGuess(id)).toBe(false)
    }
  })

  it('no answer is not a guess either', () => {
    // Unknown family, older unlisted id, bare alias, explicit `[1m]`, junk.
    for (const id of ['claude-zephyr-9', 'claude-opus-5-1', 'opus', 'claude-opus-7[1m]', '']) {
      expect(isFamilyGuess(id)).toBe(false)
    }
  })

  it('a guessed 200k (older major point release) is flagged too', () => {
    expect(windowForModelId('claude-sonnet-4-7')).toBe(STANDARD)
    expect(isFamilyGuess('claude-sonnet-4-7')).toBe(true)
  })
})

describe('guessWindow - pure rules on synthetic data', () => {
  const gen = (family: string, major: number, minor: number): ModelGeneration => ({
    family,
    major,
    minor
  })
  const heuristics = buildFamilyHeuristics([
    [gen('zeta', 3, 2), EXTENDED],
    [gen('zeta', 2, 1), STANDARD],
    [gen('zeta', 3, 0), STANDARD]
  ])

  it('inherits the newest listed model, not the last row listed', () => {
    expect(guessWindow(heuristics, gen('zeta', 3, 9))).toBe(EXTENDED)
    expect(guessWindow(heuristics, gen('zeta', 40, 0))).toBe(EXTENDED)
  })

  it('keeps the four-minor bound on an older major', () => {
    expect(guessWindow(heuristics, gen('zeta', 2, 5))).toBe(STANDARD)
    expect(guessWindow(heuristics, gen('zeta', 2, 6))).toBeNull()
    expect(guessWindow(heuristics, gen('zeta', 2, 0))).toBeNull()
  })

  it('has no opinion below the newest minor, on an unlisted older major, or a new family', () => {
    expect(guessWindow(heuristics, gen('zeta', 3, 1))).toBeNull()
    expect(guessWindow(heuristics, gen('zeta', 1, 0))).toBeNull()
    expect(guessWindow(heuristics, gen('omega', 9, 0))).toBeNull()
  })
})

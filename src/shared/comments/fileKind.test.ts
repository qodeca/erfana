// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The file-kind seam's own rules (spec 024 architecture note 001 § 3, § 8 C1). */
import { describe, expect, it } from 'vitest'
import { agentNoteProblem, isKindRefusal } from './fileKind'
import { AGENT_NOTE_LINES } from './format'

describe('agentNoteProblem', () => {
  it('accepts the shipped HTML note', () => {
    expect(agentNoteProblem(AGENT_NOTE_LINES)).toBeUndefined()
  })

  it('refuses no lines, a first line readers would not skip, non-ASCII, control characters and --', () => {
    expect(agentNoteProblem([])).toMatch(/no lines/)
    expect(agentNoteProblem(['written by Erfana.'])).toMatch(/note to agents:/)
    const note = (second: string): string | undefined => agentNoteProblem(['note to agents: hi.', second])
    expect(note('café')).toMatch(/line 2/)
    expect(note('a\tb')).toMatch(/line 2/)
    expect(note('a\nb')).toMatch(/line 2/)
    expect(note('close --> here')).toMatch(/line 2/)
    expect(note('a - b')).toBeUndefined()
  })
})

describe('isKindRefusal', () => {
  it('tells a refusal from a target', () => {
    expect(isKindRefusal({ refused: 'not-found' })).toBe(true)
    expect(isKindRefusal({ tag: 'p', start: 0, id: undefined, textStart: 0, textEnd: 0 })).toBe(false)
  })
})

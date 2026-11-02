// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { caption, LABEL_UI_NAMES, layoutProblems, lengthProblem, planStory, speechModelProblem, STORY, VIDEO, wordCount } from './demo-story.mjs'

/** Nine back-to-back steps of `each` seconds from t = 10. */
const steps = (each = 4) => STORY.map((s, i) => ({ id: s.id, start: 10 + i * each, end: 10 + (i + 1) * each }))

describe('the story (023-FR-001, 023-FR-007)', () => {
  it('has nine steps, each label six words or fewer', () => {
    expect(STORY.map((s) => s.id)).toEqual(['open', 'agent', 'import', 'edit', 'transcribe', 'html', 'comment', 'export', 'screenshot'])
    for (const s of STORY) expect(wordCount(s.label)).toBeLessThanOrEqual(VIDEO.maxLabelWords)
  })

  it('uses each app name it claims in a label (break: a label renamed away from the app name)', () => {
    for (const name of LABEL_UI_NAMES) expect(STORY.some((s) => s.label.includes(name))).toBe(true)
  })

  it('starts each label with a capital that has no descender, which the legibility check measures', () => {
    for (const s of STORY) expect(s.label).toMatch(/^[A-IK-PR-Z]/)
  })

  it('marks a sped-up stretch with ×N, real time with nothing', () => {
    expect(caption('Export to PDF', 1)).toBe('Export to PDF')
    expect(caption('Export to PDF', 8)).toBe('Export to PDF  ×8')
  })
})

describe('planStory (023-FR-008, 023-FR-009)', () => {
  it('plays everything at real speed when nothing waits', () => {
    const p = planStory({ steps: steps(6), waits: [] })
    expect(p.segments).toEqual([{ from: 10, to: 64, speed: 1 }])
    expect(p.content).toBe(54)
    expect(p.duration).toBe(54 + VIDEO.holdSeconds + VIDEO.fadeSeconds)
    expect(p.captions.map((c) => c.text)).toEqual(STORY.map((s) => s.label))
  })

  it('speeds up only the waits, with no gap between segments (break: a cut)', () => {
    const log = { steps: steps(), waits: [{ from: 20, to: 140 }] }
    log.steps[2].end = 150
    for (let i = 3; i < 9; i++) Object.assign(log.steps[i], { start: 150 + (i - 3) * 4, end: 154 + (i - 3) * 4 })
    const p = planStory(log)
    for (let i = 1; i < p.segments.length; i++) expect(p.segments[i].from).toBe(p.segments[i - 1].to)
    const sped = p.segments.find((s) => s.speed > 1)
    expect(sped).toMatchObject({ from: 20, to: 140 })
    expect(Number.isInteger(sped.speed)).toBe(true)
    expect(p.duration).toBeLessThanOrEqual(VIDEO.targetSeconds + 1)
    // The import step's label shows its speed only while the wait plays.
    const importCaps = p.captions.filter((c) => c.text.startsWith(STORY[2].label))
    expect(importCaps.map((c) => c.text)).toEqual([STORY[2].label, caption(STORY[2].label, sped.speed), STORY[2].label])
  })

  it('keeps the last label through the hold and the fade', () => {
    const p = planStory({ steps: steps(6) })
    expect(p.captions.at(-1).to).toBe(p.duration)
  })

  it('refuses a log that does not tell the story (break: a step missing or out of order)', () => {
    expect(() => planStory({ steps: steps().slice(1) })).toThrow(/9 steps/)
    const swapped = steps()
    ;[swapped[0].id, swapped[1].id] = [swapped[1].id, swapped[0].id]
    expect(() => planStory({ steps: swapped })).toThrow(/expected "open"/)
    const overlap = steps()
    overlap[1].start = overlap[0].end - 1
    expect(() => planStory({ steps: overlap })).toThrow(/starts before/)
    expect(() => planStory({ steps: steps(), waits: [{ from: 0, to: 12 }] })).toThrow(/outside the story/)
    expect(() => planStory({ steps: steps(), waits: [{ from: 12, to: 20 }, { from: 18, to: 22 }] })).toThrow(/overlap/)
  })
})

describe('lengthProblem (023-NFR-003)', () => {
  it('passes 50–70 s only', () => {
    expect(lengthProblem(60)).toBeNull()
    expect(lengthProblem(49.9)).toMatch(/under 50 s/)
    expect(lengthProblem(70.1)).toMatch(/over 70 s/)
  })
})

describe('layoutProblems (023-FR-002)', () => {
  const ok = { window: 1920, tree: 288, preview: 998, terminal: 634, columns: 86, editorVisible: false }
  it('passes the planned layout', () => {
    expect(layoutProblems(ok)).toEqual([])
  })
  it('names a panel out of range, a visible editor and a narrow terminal', () => {
    const p = layoutProblems({ ...ok, tree: 700, editorVisible: true, columns: 60 })
    expect(p.join('\n')).toMatch(/tree is 36\.5 %/)
    expect(p.join('\n')).toMatch(/editor pane is visible/)
    expect(p.join('\n')).toMatch(/60 columns, under 80/)
  })
})

describe('speechModelProblem (023-AC-018)', () => {
  it('passes when the tiny model is listed, and names the missing model otherwise', () => {
    expect(speechModelProblem('[{"name":"tiny","downloaded":true}]')).toBeNull()
    expect(speechModelProblem('error: offline')).toMatch(/speech model is not downloaded \(error: offline\); nothing was recorded/)
  })
})

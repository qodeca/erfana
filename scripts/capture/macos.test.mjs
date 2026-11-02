// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { FRONT_PROCESS, MENU_BAR_ITEMS, osa, SCREEN_RECORDING_JXA, videoPrerequisiteProblems } from './macos.mjs'

/** A fake osascript: answers by script, throws for a script mapped to an Error. */
const fake = (answers) => (script) => {
  const a = answers[script]
  if (a instanceof Error) throw a
  return a ?? ''
}
const allOk = { [SCREEN_RECORDING_JXA]: 'true', [FRONT_PROCESS]: 'Terminal', [MENU_BAR_ITEMS]: 'Clock, Focus, Wi-Fi' }

describe('videoPrerequisiteProblems (023-FR-018)', () => {
  it('is empty when every prerequisite holds', () => {
    expect(videoPrerequisiteProblems({ osa: fake(allOk) })).toEqual([])
  })

  it('names each missing prerequisite (break: a run records without a permission or with notifications on)', () => {
    expect(videoPrerequisiteProblems({ osa: fake({ ...allOk, [SCREEN_RECORDING_JXA]: 'false' }) }).join()).toMatch(/Screen Recording/)
    expect(videoPrerequisiteProblems({ osa: fake({ ...allOk, [MENU_BAR_ITEMS]: 'Clock, Wi-Fi' }) }).join()).toMatch(/Do Not Disturb is off/)
    const noAx = videoPrerequisiteProblems({ osa: fake({ ...allOk, [FRONT_PROCESS]: new Error('not allowed') }) })
    expect(noAx).toHaveLength(1)
    expect(noAx[0]).toMatch(/Accessibility/)
  })

  it('treats a failing check as not granted', () => {
    expect(videoPrerequisiteProblems({ osa: () => { throw new Error('x') } })).toHaveLength(2)
  })

  it('runs osascript with an argument array', () => {
    const calls = []
    expect(osa('x', { lang: 'JavaScript', exec: (...a) => (calls.push(a), ' ok\n') })).toBe('ok')
    expect(calls[0][0]).toBe('osascript')
    expect(calls[0][1]).toEqual(['-l', 'JavaScript', '-e', 'x'])
  })
})

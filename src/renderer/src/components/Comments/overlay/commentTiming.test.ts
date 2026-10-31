// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The large-file timing's mark points (spec 024 024-NFR-001): one entry per
 * name at most, "pins visible" once per list, "saved visible" for an awaited
 * thread only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMENT_TIMING_MARKS,
  awaitSavedPin,
  markCommentTiming,
  noteCommentPinsDrawn,
  noteCommentSaveStart,
  resetCommentTiming
} from './commentTiming'

const count = (name: string): number => performance.getEntriesByName(name, 'mark').length

describe('commentTiming', () => {
  beforeEach(() => {
    resetCommentTiming()
    performance.clearMarks()
  })
  afterEach(() => performance.clearMarks())

  it('every name is prefixed erfana:comments:', () => {
    for (const name of Object.values(COMMENT_TIMING_MARKS)) expect(name).toMatch(/^erfana:comments:[a-z-]+$/)
  })

  it('a mark replaces its previous entry, so the timeline never grows', () => {
    for (let i = 0; i < 5; i += 1) markCommentTiming(COMMENT_TIMING_MARKS.previewRendered)
    expect(count(COMMENT_TIMING_MARKS.previewRendered)).toBe(1)
  })

  it('pins-visible: once per list with icons; a redraw of the same list and an empty draw do not mark', () => {
    const list = [{ threadKey: 'a' }]
    noteCommentPinsDrawn(list, [])
    expect(count(COMMENT_TIMING_MARKS.pinsVisible)).toBe(0)
    noteCommentPinsDrawn(list, ['a'])
    const first = performance.getEntriesByName(COMMENT_TIMING_MARKS.pinsVisible)[0]
    noteCommentPinsDrawn(list, ['a'])
    expect(performance.getEntriesByName(COMMENT_TIMING_MARKS.pinsVisible)[0]).toBe(first)
    noteCommentPinsDrawn([{ threadKey: 'a' }], ['a'])
    expect(performance.getEntriesByName(COMMENT_TIMING_MARKS.pinsVisible)[0]).not.toBe(first)
  })

  it('saved-visible: only when an awaited thread is drawn, and once', () => {
    noteCommentSaveStart()
    expect(count(COMMENT_TIMING_MARKS.saveStart)).toBe(1)
    noteCommentPinsDrawn([], ['old'])
    expect(count(COMMENT_TIMING_MARKS.savedVisible)).toBe(0)
    awaitSavedPin('new')
    noteCommentPinsDrawn([], ['old'])
    expect(count(COMMENT_TIMING_MARKS.savedVisible)).toBe(0)
    noteCommentPinsDrawn([], ['old', 'new'])
    const saved = performance.getEntriesByName(COMMENT_TIMING_MARKS.savedVisible)[0]
    expect(saved).toBeDefined()
    noteCommentPinsDrawn([], ['old', 'new'])
    expect(performance.getEntriesByName(COMMENT_TIMING_MARKS.savedVisible)[0]).toBe(saved)
  })

  it('at most 16 saved threads wait for their icon: the oldest goes first', () => {
    for (let i = 0; i < 17; i += 1) awaitSavedPin(`t${i}`)
    noteCommentPinsDrawn([], ['t0'])
    expect(count(COMMENT_TIMING_MARKS.savedVisible)).toBe(0)
    noteCommentPinsDrawn([], ['t16'])
    expect(count(COMMENT_TIMING_MARKS.savedVisible)).toBe(1)
  })
})
